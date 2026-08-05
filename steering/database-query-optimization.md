# Database & Query Optimization

This is the highest-leverage file in this skill. In nearly every full-stack app, the database layer is where the biggest, cheapest wins live — and where the DSA framing pays off most directly, because every pattern here maps to a textbook complexity problem.

For each pattern: the complexity shape, how to detect it, the fix in both Supabase-flavor and RDS/ORM-flavor code, and what it costs.

---

## 1. Sequential Awaits (the batching problem)

**Shape:** N independent operations done one at a time instead of concurrently. Not actually a Big-O problem — it's an O(1)×N problem where N round-trips happen serially when they could happen in parallel. On a network-hop-costly connection (managed DB over a VPC, a tunneled connection, cross-region), each hop can cost 50-250ms; 8 sequential hops on an otherwise-instant query is 400ms-2s of pure waiting for nothing.

**Detect:** grep for consecutive `await db.` / `await supabase.` calls where the second call's inputs don't depend on the first call's output. If two queries only share something already known before either runs (a request param, an already-resolved ID), they're independent and belong in the same batch.

**Fix — RDS/Drizzle/Prisma-flavor:**
```ts
// ❌ Sequential — 3 round-trips, ~150-450ms wasted if each hop is ~50-150ms
const course = await db.select().from(courses).where(eq(courses.id, courseId));
const enrollments = await db.select().from(enrollments).where(eq(enrollments.courseId, courseId));
const mentor = await db.select().from(profiles).where(eq(profiles.id, mentorId));

// ✅ Parallel — 1 round-trip's worth of wall-clock time
const [course, enrollments, mentor] = await Promise.all([
  db.select().from(courses).where(eq(courses.id, courseId)),
  db.select().from(enrollments).where(eq(enrollments.courseId, courseId)),
  db.select().from(profiles).where(eq(profiles.id, mentorId)),
]);
```

**Fix — Supabase-flavor** (identical principle, PostgREST client):
```ts
// ❌ Sequential
const { data: course } = await supabase.from('courses').select('*').eq('id', courseId).single();
const { data: enrollments } = await supabase.from('enrollments').select('*').eq('course_id', courseId);

// ✅ Parallel
const [{ data: course }, { data: enrollments }] = await Promise.all([
  supabase.from('courses').select('*').eq('id', courseId).single(),
  supabase.from('enrollments').select('*').eq('course_id', courseId),
]);
```

**When they genuinely can't be parallel:** if query B needs an ID that only exists in query A's result (fetch a course, then fetch its enrollments by the course's resolved institution_id), that's a real dependency — leave it sequential and say so in the report rather than forcing a fake parallelization. Don't parallelize things that aren't actually independent; that's a correctness bug, not a perf win.

**Cost:** free. Pure code change, zero infra impact.

---

## 2. N+1 Queries (loop-triggered fan-out)

**Shape:** O(N) round-trips where N is the size of a result set — one query to get a list, then one query per item in that list. This is the single most common DB performance bug in full-stack apps and it's O(N) that should be O(1).

**Detect:** any DB call inside a `for`, `.map()`, or `.forEach()` where the call's filter is derived from the loop variable.

```ts
// ❌ N+1 — 1 query for the list + N queries for details. 100 users = 101 round-trips.
const users = await db.select().from(profiles).where(eq(profiles.orgId, orgId));
for (const user of users) {
  const roles = await db.select().from(userRoles).where(eq(userRoles.userId, user.id));
  user.roles = roles;
}

// ✅ Collect IDs, one batched query, build a lookup map — O(1) round-trips regardless of N
const users = await db.select().from(profiles).where(eq(profiles.orgId, orgId));
const userIds = users.map(u => u.id);
const allRoles = await db.select().from(userRoles).where(inArray(userRoles.userId, userIds));
const rolesByUser = new Map<string, Role[]>();
for (const r of allRoles) {
  const arr = rolesByUser.get(r.userId) ?? [];
  arr.push(r);
  rolesByUser.set(r.userId, arr);
}
for (const user of users) user.roles = rolesByUser.get(user.id) ?? [];
```

Same fix shape on Supabase: replace the loop with `.in('user_id', userIds)` once, then group in JS with a `Map`.

**Cost:** free.

---

## 3. Missing / Wrong Indexes

**Shape:** without an index, a `WHERE`, `JOIN`, or `ORDER BY` on a large table is an O(n) sequential scan. A B-tree index turns the lookup into O(log n). At 100 rows the difference is imperceptible; at 5 million rows it's the difference between 4ms and 4 seconds.

**Detect (Postgres — Supabase or RDS, same SQL):**
```sql
-- Find slow queries missing index support
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = '...' ORDER BY created_at DESC LIMIT 20;
-- Look for "Seq Scan" on a large table in the plan — that's the smell.
-- A healthy plan shows "Index Scan" or "Index Only Scan".
```

**Critical correction most agents get wrong:** `EXPLAIN ANALYZE` run as a superuser/admin connection can show a fast index scan while the SAME query run by a real authenticated user is dramatically slower — because Row Level Security (RLS) policies add correlated subqueries that only execute under the real security context. **Always re-run the EXPLAIN as the real caller** would run it:
```sql
-- Supabase/Postgres: simulate the real authenticated request before trusting a plan
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "the-real-user-uuid", "role": "authenticated"}';
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = '...';
```
A query that's 4ms as superuser and 400ms under real RLS is not an index problem at all — it's an RLS policy problem (see §6). Don't misdiagnose one as the other.

**Fix:**
```sql
-- Single column
CREATE INDEX CONCURRENTLY idx_orders_customer_id ON orders(customer_id);

-- Composite index — column order matters: put the equality-filtered column(s) first,
-- the range/sort column last. This index serves "WHERE customer_id = ? ORDER BY created_at DESC"
CREATE INDEX CONCURRENTLY idx_orders_customer_created ON orders(customer_id, created_at DESC);

-- Partial index — when queries almost always filter to a subset (e.g. only "active" rows),
-- a partial index is smaller and faster than indexing the whole table
CREATE INDEX CONCURRENTLY idx_orders_active ON orders(customer_id) WHERE status = 'active';
```
Always use `CONCURRENTLY` in production so index creation doesn't lock the table against writes. On Supabase, run this via the SQL editor or a migration — not through the JS client. On RDS, run via your migration tool (Drizzle Kit, Prisma Migrate, or raw SQL migration).

**Cost:** cheap but not free — an index adds write overhead (every insert/update must also update the index) and storage. Worth it when read frequency >> write frequency on that column, which is true for almost all dashboard/listing queries. State this tradeoff in the report rather than treating indexes as purely free.

**The forward-looking index judgment call:** if a table has 50 rows today but is modeled to hold millions (e.g., a per-tenant table that will scale with customer count), adding the index now is correct even though `EXPLAIN` shows no measurable difference today — the planner will choose a seq scan on a tiny table regardless, that's correct Postgres behavior, not a sign the index is useless. Say this explicitly rather than either skipping the index or overclaiming a today-benefit that doesn't exist yet.

---

## 4. Unbounded Selects & Silent Truncation

**Shape:** fetching an entire table (or an entire result set) when only a page of it is needed is O(n) data transfer for an O(page size) actual need. Beyond wasted bandwidth, some clients silently truncate large results — a landmine, not just a slowness issue.

**Detect:** any `.select()` / `SELECT *` with no `.limit()`/`LIMIT` and no pagination on a table that can grow past a few hundred rows.

**Supabase-specific landmine:** the Supabase JS client silently caps results at 1000 rows by default with **no error thrown**. A query that should return 1500 rows will silently return 1000, and unless you explicitly check `data.length === 1000` as a truncation signal, you'll ship a bug where users are missing a third of their data with no error anywhere.
```ts
// ❌ Silently returns at most 1000 rows, no warning
const { data } = await supabase.from('big_table').select('*');

// ✅ Explicit pagination, or a loop if you truly need everything
const PAGE = 1000;
let offset = 0;
const all: Row[] = [];
while (true) {
  const { data } = await supabase.from('big_table').select('*').range(offset, offset + PAGE - 1);
  if (!data?.length) break;
  all.push(...data);
  if (data.length < PAGE) break;
  offset += PAGE;
}
```

**RDS/ORM-flavor** (no silent cap, but the fetch-everything anti-pattern is just as common):
```ts
// ❌ Fetches the whole table, slices client-side in JS
const all = await db.select().from(courses).where(eq(courses.institutionId, id));
const page = all.slice((pageNum - 1) * pageSize, pageNum * pageSize);

// ✅ Push pagination to the DB — only the requested page is ever transferred
const page = await db.select().from(courses)
  .where(eq(courses.institutionId, id))
  .limit(pageSize)
  .offset((pageNum - 1) * pageSize);
```

**Cost:** free.

---

## 5. Redundant/Overlapping Queries

**Shape:** two queries fetching overlapping data where one is a strict subset of the other — an O(2n) round-trip cost for what's really an O(n) need.

**Detect:** two queries against the same table where one's filter conditions are a superset of the other's (e.g., "all classes" and "upcoming classes" where "upcoming" = "all" + one extra date condition).

**Fix:** fetch the superset once, derive the subset in memory:
```ts
// ❌ Two round-trips for overlapping data
const allClasses = await db.select().from(classes).where(eq(classes.courseId, id));
const upcoming = await db.select().from(classes).where(and(eq(classes.courseId, id), gte(classes.scheduledAt, now)));

// ✅ One round-trip, partition in memory (the in-memory filter is O(n), negligible vs a network hop)
const allClasses = await db.select().from(classes).where(eq(classes.courseId, id));
const upcoming = allClasses.filter(c => c.scheduledAt >= now);
```

**Cost:** free.

---

## 6. RLS / Policy-Induced Slowness (Supabase-specific, but the lesson generalizes)

**Shape:** Row Level Security policies that OR together multiple conditions, several of which are `SECURITY DEFINER` function calls, force Postgres to evaluate every one of those functions as a correlated subquery **per row scanned**, before any `LIMIT` can apply. This turns what looks like an indexed O(log n) lookup into an O(n × k) cost, where k is the number of policy conditions.

**Detect:** if a query is fast as superuser/service-role but slow for a real authenticated user (see §3's correction), inspect the table's RLS policies:
```sql
SELECT polname, pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'your_table'::regclass;
```
Look for policies with multiple `OR`'d conditions calling functions.

**Fix options, cheapest first:**
1. If the calling code already independently verifies the same authorization the RLS policy exists to enforce (e.g., an admin API route that already checked the caller's role and resolved their `institution_id`, then filters explicitly by it), it's legitimate to use a service-role/admin client for that specific query — the security boundary is already enforced in application code, RLS would just be redundant work. Document why in a code comment.
2. Simplify the policy to lead with the cheapest, most selective condition first (Postgres short-circuits `OR`).
3. Cache the identity/role resolution (e.g., in a JWT claim set at login) so the RLS function doesn't need a table lookup per row — see `auth-realtime-performance.md`.

**Cost:** free (option 1/2) to a one-time auth architecture change (option 3, still free but more effort).

---

## 7. COUNT(*) and Aggregate Overuse

**Shape:** `COUNT(*)` on a large table is O(n) unless the count is over an indexed, filtered subset (still O(log n + matches)). Running an exact count on every page load of a paginated list is a classic waste — the user doesn't need an exact number refreshed every render.

**Fix:**
- Run count and data-page queries in parallel (§1), never sequentially.
- For genuinely huge tables where even an indexed count is too slow at the frequency it's called, use `EXPLAIN`'s planner row estimate for a "~2.3M results" style approximate count, or cache the exact count with a short TTL (see `caching-and-data-layer.md`).
- Never recompute a count inside a loop — this is N+1's cousin.

**Cost:** free to cheap (a cache layer if approximation isn't acceptable).

---

## 8. Connection Pooling Misconfiguration

**Shape:** every DB connection has real memory/CPU cost on the DB server. Serverless/edge functions that open a new raw connection per invocation can exhaust the DB's max connections under concurrent load — this isn't a query-shape problem, it's a resource-exhaustion problem, but it presents as "random timeouts under load" which looks like a query problem until you check pool metrics.

**Detect:** DB error logs showing "too many connections" or "remaining connection slots reserved" during traffic spikes; app-side timeouts that correlate with concurrent request count, not with any single slow query.

**Fix — Supabase:** use the pooled connection string (port 6543, Supavisor/PgBouncer) for application traffic, never the direct connection (port 5432) from serverless/edge functions. Direct connections are for migrations and long-running admin work only.

**Fix — RDS:** put PgBouncer or RDS Proxy in front of Postgres; size the pool based on `(max_connections - reserved_superuser_connections) / number_of_app_instances`, not a guessed round number.

**Cost:** free (Supabase pooler is included) to cheap (RDS Proxy has a small hourly cost, PgBouncer on a small instance is cheap) — and it's a cost that prevents a much larger cost (an outage under load).

---

## Complexity cheat-sheet (for the report)

| Pattern | Bad shape | Good shape | Typical fix |
|---|---|---|---|
| Sequential independent queries | O(1) × N round-trips, serial | O(1) × N round-trips, concurrent | `Promise.all` |
| N+1 loop query | O(N) round-trips | O(1) round-trips | Batch with `IN`/`inArray`, group with `Map` |
| Unindexed filter/sort | O(n) scan | O(log n) index scan | `CREATE INDEX CONCURRENTLY` |
| Lookup inside a loop (in JS) | O(n×m) | O(n+m) | `Map`/`Set` built once before the loop |
| Fetch-all-then-slice pagination | O(n) transfer for O(page) need | O(page) transfer | DB-level `LIMIT`/`OFFSET` or `.range()` |
| Redundant superset+subset queries | O(2n) round-trips | O(n) round-trips + O(n) in-memory filter | Fetch once, `.filter()` in memory |
