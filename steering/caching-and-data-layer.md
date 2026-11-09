# Caching & Data Layer

Caching is the technique that turns "fast for the first user, slow for every subsequent one" into "computed once, served instantly for everyone." It's also the technique most likely to be misused — a wrong TTL or a missed invalidation creates a correctness bug that's worse than the slowness it was meant to fix. Every recommendation here comes with an explicit invalidation story; a cache without one is a bug waiting to happen.

## Before adding a cache: audit the ones you already have

A cache is the last fix, not the first. It makes slow work look fast without making it fast, and it adds a second copy of the data that can go wrong. Redesign first (fix the query, add the index, batch the calls, change the data layout; see `cpu-hot-loops-and-data-layout.md` for CPU-bound loops), and cache last.

**Step 1: list every cache that already exists.** Search the code and the config for all of these:
- in-memory maps, module-level variables and memoization (`memoize`, `lru-cache`, `useMemo` used as a data cache)
- Redis or a similar store
- framework data caches (for example the Next.js data cache; version-sensitive, verify first)
- HTTP and CDN caching (`Cache-Control` headers, CDN rules)
- client query caches (TanStack Query, SWR: check `staleTime` and the cache lifetime)

**Step 2: for each one, record these five things** in the report:

| Question | Why it matters |
|---|---|
| What slow thing does it hide? | A cache in front of an N+1 query hides the N+1. Fix the query and the cache may not be needed. |
| How is it invalidated? | No invalidation path means stale data and a hidden correctness bug. |
| What is its hit rate (if it can be measured)? | A low hit rate means you pay for the cache and still do the slow work. |
| Could the underlying work be made fast instead? | If yes, flag the cache as "hiding a slow design" and put the redesign in the report. |
| What breaks if it is removed? | If the answer is "nothing you can measure", propose removing it (after approval). |

Example: a Redis key caches the dashboard stats for 5 minutes because the stats query takes 4 seconds. The query runs 40 sub-queries in a loop (an N+1). Fix: one grouped query. If it becomes fast, the cache can be deleted, and the stale-for-5-minutes bug goes with it. (Measure before and after; the timings here are only an illustration.)

**When a cache is the right answer** (check all that apply):
1. The work is still inherently expensive after redesign (a heavy aggregation, a third-party call with a rate limit or a per-call fee, a report that needs real compute).
2. It is requested often enough that recomputing each time is wasteful.
3. Some staleness is acceptable, and there is an explicit invalidation or TTL decision.
4. The cache key includes every input that changes the result.
5. Or the content is static or public and served over HTTP: a CDN is almost always right (see below).

Do not delete existing caches wholesale. Flag the ones that hide a slow design, show the redesign, and let the user approve each removal.

## The caching decision, in order

Before reaching for Redis, check these cheaper layers first — each is free or nearly free and often makes a dedicated cache unnecessary:

1. **Don't refetch what hasn't changed** — TanStack Query / SWR already dedupes and caches on the client; check `staleTime`/`cacheTime` before adding a server cache
2. **Don't recompute what's deterministic for a given input** — in-memory memoization within a single request (or process, for rarely-changing reference data)
3. **Don't hit the DB for data that changes rarely** — a short-TTL cache (Redis, or even a module-level in-memory cache) for settings/config/plan-tier lookups
4. **Don't regenerate what a CDN can serve** — static assets, images, and even full pages via HTTP caching headers
5. **Only then**: a dedicated cache layer (Redis) for expensive, frequently-requested, moderately-fresh data

## TanStack Query — client-side caching done right

**The most common mistake:** treating every query the same regardless of how often the underlying data actually changes.

```ts
// Static/rarely-changing reference data (a list of countries, a question bank, plan tiers)
useQuery({
  queryKey: ['reference-data'],
  queryFn: fetchReferenceData,
  staleTime: 60 * 60_000, // 1 hour — this data changes maybe once a month
  refetchOnWindowFocus: false,
});

// Frequently-changing operational data (a live queue, a chat)
useQuery({
  queryKey: ['queue-status'],
  queryFn: fetchQueueStatus,
  staleTime: 0,          // always consider stale
  refetchInterval: 5_000, // poll — or better, use a websocket/Realtime subscription instead
});

// Most dashboard data — somewhere in between
useQuery({
  queryKey: ['dashboard-stats', userId],
  queryFn: () => fetchDashboardStats(userId),
  staleTime: 30_000, // fresh enough that a re-render within 30s doesn't refetch
});
```

**Invalidation:** every mutation that changes data a query depends on must call `queryClient.invalidateQueries({ queryKey: [...] })` (or use `queryClient.setQueryData` for an optimistic update). A cache that's never invalidated on write is a correctness bug, not a performance win — flag any mutation you find that doesn't invalidate its related queries.

## Next.js data cache — version-sensitive, verify before using

Next.js's `fetch` caching behavior, `revalidateTag`/`revalidatePath`, and the App Router's default caching posture have changed materially across major versions (the default fetch caching behavior flipped in recent versions from "cache by default" to "no caching by default" in some contexts). **Do not recommend a specific caching directive from memory — verify against the installed Next.js version's current docs first.** State the version you verified against.

General pattern once verified for the actual version in use:
```ts
// Tag-based revalidation — invalidate precisely what changed, not everything
fetch('https://api.example.com/data', { next: { tags: ['products'] } });
// ...after a mutation:
revalidateTag('products');
```
Prefer tag-based invalidation over time-based-only (`revalidate: 3600`) when the data changes on identifiable write events — it gives you both freshness and cache-hit rate, instead of trading one for the other.

## Redis — the dedicated cache layer

**When it's worth it:** the underlying query/computation is expensive (a multi-table join, an aggregate over a large table, a third-party API call) AND it's requested often enough that recomputing every time is wasteful AND some staleness is acceptable.

```ts
// Generic cache-aside pattern — works with any Redis client
async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as T;
  const value = await compute();
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  return value;
}

// Usage
const settings = await cached(`institution-settings:${id}`, 300, () => fetchSettingsFromDb(id));
```

**Choosing a TTL — the actual decision framework, not a guess:**

| Data type | Change frequency | Suggested TTL |
|---|---|---|
| Plan tier / feature flags / org settings | Rare (admin action) | 5-60 min, or invalidate explicitly on the admin write |
| Reference/lookup tables | Very rare | 1 hour+ or process-lifetime in-memory |
| Aggregated stats/dashboards | Frequent but tolerant of staleness | 30s-5min |
| Per-request auth/session context | Per session | Session lifetime, invalidate on logout/role change |
| Anything driving a financial transaction | N/A | Do not cache — always read fresh |

**The cache stampede problem:** if a popular cache key expires and 500 concurrent requests all miss at once, they can all hammer the DB simultaneously — turning a cache into a thundering-herd amplifier instead of a protection. Fix with a lock/single-flight pattern (only one request recomputes, others wait for that result) or by staggering TTLs with jitter so keys don't all expire at the same instant.

**Cost:** Redis (managed, e.g. Upstash/ElastiCache) has a real monthly cost, usually small at low volume but scales with memory and request count. Always weigh it against the DB load it removes — if the query being cached is already cheap, adding Redis adds cost and complexity for no real gain. Say so if that's the case rather than reaching for Redis by default.

## HTTP/CDN caching — the free tier that gets skipped

For anything served over HTTP that doesn't vary per-user (public API responses, static pages, images, fonts), CDN/HTTP caching is close to free and removes load entirely rather than just speeding it up:
```
Cache-Control: public, max-age=3600, stale-while-revalidate=86400
```
`stale-while-revalidate` specifically: serve the stale cached version instantly while revalidating in the background — the user never waits, and the origin only gets hit once per revalidation window instead of once per request. This is one of the highest-leverage, lowest-cost techniques available and is frequently missing entirely on API routes that could safely use it.

## Supabase Realtime — cache the subscription, not just the data

A common anti-pattern: subscribing to a Realtime channel that broadcasts on every row change in a busy table, when the UI only needs to know "something changed, go refetch" for a specific subset. Broad subscriptions fan out to every connected client regardless of relevance, which is a cost and scale problem, not just a performance one (see `auth-realtime-performance.md` for the full treatment).

## Anti-patterns (banned outright)

| Pattern | Why it's banned | Fix |
|---|---|---|
| Caching per-user financial/balance data with a TTL | Staleness there is a correctness bug, not an optimization | Read fresh, cache nothing, or cache with immediate invalidation on write |
| Cache key that doesn't include all the inputs that affect the result | Two different users/params silently share one cached value — a data leak or wrong-data bug | Always include every distinguishing input in the cache key |
| Infinite TTL with no invalidation path | Data goes stale forever with no way to fix it short of a manual flush | Always pair a long TTL with an explicit invalidation trigger on the write path |
| A cache "warm-up" cron running more often than the TTL | Defeats the purpose of the cache — you're now paying for both the cron AND cache infra | TTL should be ≥ the interval between legitimate changes, not shorter |
