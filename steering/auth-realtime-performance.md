# Auth & Realtime Performance

Auth is on the hot path of nearly every request — a small inefficiency here multiplies across every single request the app serves. Realtime/websocket features have a different failure mode: they don't slow down a single request, they consume server resources per open connection and can fan out load in ways a normal request never does. Both are covered here because they're both "invisible until scale" problems.

## Auth — the cost of checking who someone is, every request

**Shape:** if every request re-verifies identity/role by hitting the database (or a downstream auth provider), you've made auth's cost scale with total request volume rather than with login frequency, which is orders of magnitude less frequent. This is the auth-equivalent of an N+1 query.

**Detect:** middleware or a request-scoped helper that does a DB lookup for role/permission data on every single request, with no caching layer.

**Fix — the JWT claims pattern (works with Supabase Auth, Better Auth, NextAuth, or a custom JWT setup):**
```ts
// ❌ DB round-trip on every request just to know the user's role
export async function middleware(req: NextRequest) {
  const session = await getSession(req);
  const { data: role } = await db.select().from(roles).where(eq(roles.userId, session.userId));
  // ...
}

// ✅ Role encoded in the JWT at login/token-refresh time — zero DB round-trips
// to read it on every subsequent request. Only re-verify from DB when the
// role could plausibly have changed (a short-TTL cache, or on next refresh).
export async function middleware(req: NextRequest) {
  const claims = await verifyJwt(req); // cryptographic verification, no DB hit
  const role = claims.role; // already embedded
}
```
**The tradeoff to state explicitly:** a JWT-embedded role is only as fresh as the token's lifetime — if an admin revokes a role, the change won't take effect until the token refreshes/expires. For most apps this is an acceptable tradeoff (minutes of staleness on a rare event) in exchange for removing a DB hit from every request; for anything security-critical (a ban, a payment-gating role change) either force a token refresh on that specific write, or keep a short-TTL cache-checked-on-refresh instead of pure JWT-only trust.

**Fix — cached role/session cookie (when JWT claims aren't feasible):** cache the resolved role/permission set in a short-TTL cookie or Redis entry (5-15 min), re-resolved from DB only on expiry or explicit invalidation (logout, role change). This is strictly better than a DB hit per request and simpler to reason about than full JWT claim embedding if the auth provider doesn't make claims easy to customize.

## Auth provider-specific notes

**Supabase Auth:** session validation via `getUser()` does verify the JWT signature without a network call in most SDK versions, but confirm this against the current SDK docs for the version in use — behavior has differed across versions and between server/client SDK variants. Avoid `getSession()` on the server for anything security-sensitive if current docs indicate it doesn't revalidate — verify before asserting.

**Better Auth:** session lookups can be backed by a DB session table or JWT-based — check which mode is configured, since the DB-session mode reintroduces a per-request DB hit unless paired with a cache in front of the session table.

**NextAuth/Auth.js:** JWT strategy avoids a DB hit per request by design; database strategy does not — this is a configuration choice with the same cost/freshness tradeoff as above, make sure it was chosen deliberately, not defaulted into.

**Whichever provider:** verify the current recommended pattern via that library's docs before implementing — auth libraries change session/token handling more often than most other categories, and an outdated pattern here is a security surface, not just a performance one.

## RLS and Auth — the connection point

Row Level Security policies (Supabase or self-managed Postgres) that call a function to check the current user's role/org membership are doing a mini "auth check" **per row scanned**, not once per request. This is covered in depth in `database-query-optimization.md` §6 — the fix (encode identity context in the JWT claims that the RLS function reads directly, rather than the RLS function doing its own table lookup) is the exact same JWT-claims pattern described above, applied at the database layer instead of the app layer.

## Supabase Realtime / WebSocket Fanout

**Shape:** a Realtime subscription that listens to all changes on a busy table broadcasts to every connected client on every write, regardless of whether that client's UI actually needs to react to that specific change. This is an O(subscribers × writes) fanout cost, not O(writes) — the cost of a single write scales with how many people happen to be online, which is a scaling trap that doesn't show up until concurrent usage is high.

**Detect:** a channel subscription with a broad filter (or no filter) on a table that receives frequent writes from many different users/contexts, where the UI only cares about a specific subset (their own org, their own record, a specific room).

**Fix:**
```ts
// ❌ Every client listening to ALL changes on the whole table
supabase.channel('any-change')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, handleChange)
  .subscribe();

// ✅ Scoped to exactly what this client needs — Postgres Realtime filters
// support column-based filtering so the fanout only reaches relevant subscribers
supabase.channel(`room-${roomId}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, handleChange)
  .subscribe();
```

**When even a scoped subscription is the wrong tool:** if the UI just needs "something changed here, go refetch," a lighter broadcast-only channel (no postgres_changes payload, just a signal) plus a TanStack Query invalidation is often cheaper than a full row-change Realtime subscription — you avoid shipping the full changed-row payload over the wire when the client was going to refetch fresh data anyway.

**Connection budget:** every open Realtime/websocket connection holds server-side resources for the life of the connection, unlike a request-response HTTP call. Confirm the Realtime provider's plan/tier connection limits against expected concurrent user count — this is a hard ceiling, not a soft degradation, and it's a cost-tier decision as much as a code one.

**Unsubscribe discipline:** a component that subscribes on mount but doesn't clean up on unmount leaks a connection per navigation — in a long user session with lots of navigation, this silently accumulates open connections that never needed to exist. Always pair a `.subscribe()` with `.unsubscribe()` in a cleanup function (`useEffect` return, or the framework-equivalent lifecycle hook).

## Complexity/impact cheat-sheet

| Pattern | Bad shape | Good shape | Fix |
|---|---|---|---|
| DB hit for role/permission on every request | O(1) DB round-trip × every request | O(1) DB round-trip × logins/refreshes only | JWT claims or short-TTL cached session |
| RLS policy doing its own auth lookup per row | O(n rows scanned) auth checks | O(1) — read from already-verified JWT claim | Same JWT-claims pattern, applied at the DB layer |
| Unscoped Realtime subscription | O(subscribers × all writes) fanout | O(subscribers × relevant writes) fanout | Column/row-level filter on the subscription |
| Realtime subscription never unsubscribed | Connections accumulate over a session | Bounded by actual concurrently-mounted components | Cleanup function pairing every subscribe |
