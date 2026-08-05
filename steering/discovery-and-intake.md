# Discovery and Intake

This is the first file to read on any Vibe Performance engagement. Its job: figure out what's actually being asked before anyone touches code.

## Step 1 — Classify the request

Performance requests fall into one of these buckets. Identify which one before asking anything else, because it changes the whole rest of the engagement:

| Bucket | Signal | What matters most |
|---|---|---|
| **Single slow page/route** | "This page takes 3 seconds" | Waterfall analysis, N+1 queries, bundle size for that route |
| **Slow under load, fine alone** | "Fast for me, slow for users" / "falls over during peak" | Connection pooling, autoscaling, lock contention, queue depth |
| **Everything feels sluggish** | "The whole app is slow" | Systemic — likely infra tier, DB compute size, or a global anti-pattern repeated everywhere |
| **One asset type is slow** | "Images take forever" / "uploads time out" | Frontend rendering / infra (CDN, upload path) specifically |
| **Pre-launch scale prep** | "We're about to onboard 10,000 users" | Load testing, capacity planning, cost-per-request modeling — nothing is "broken" yet, this is prevention |
| **Cost, not speed** | "AWS bill doubled, nothing got faster" | Usually a resource leak, inefficient query pattern, or over-provisioning — speed and cost are the same investigation here |

## Step 2 — The question set (for technical users)

Ask only what's relevant to the bucket above — don't run the full list on someone who clearly just wants their dashboard fixed. Use multiple-choice format wherever possible; it's faster for the user to answer and faster for you to act on.

**Always ask (any bucket):**
1. What exactly feels slow — a specific page, a specific action, or general? (get a URL/route if possible)
2. What's the current scale — active users, rows in the biggest tables, requests/minute at peak?
3. What's the target scale — where does this need to hold up in 3-12 months?
4. Is infra cost a hard constraint right now, or is some spend acceptable to buy speed?
5. Can I read the codebase directly, run commands, and query the (non-production, or read-only production) database? Or do I need you to paste things?

**Ask if DB-related:**
6. Supabase or self-managed/RDS Postgres? (Or something else entirely?)
7. What ORM/query layer — raw SQL, Prisma, Drizzle, Supabase JS client, something else?
8. Do you have a staging environment with realistic data volume, or is staging basically empty?

**Ask if frontend-related:**
9. App Router or Pages Router (if Next.js)? What's the deployment target — Vercel, self-hosted, ECS, other?
10. Do you have Lighthouse/PageSpeed/Core Web Vitals numbers already, or has nobody measured yet?

**Ask if "under load" specifically:**
11. Has anyone load-tested this, even informally? What broke first?
12. What's the hosting/scaling setup — fixed instance count, autoscaling group, serverless?

**Ask if cost-flagged:**
13. What's the current monthly infra spend breakdown (roughly) — compute, DB, storage, egress, third-party APIs?

## Step 3 — Auto-discovery (when the user can't answer confidently)

Non-technical or partially-technical users often can't answer the questions above — and forcing them to guess produces bad answers that lead to a wrong diagnosis. When the user signals uncertainty ("I don't know what ORM we use", "not sure how it's hosted"), switch to auto-discovery:

**Fingerprint the stack from the repo, not from the user:**
- `package.json` dependencies → framework version, ORM/query client, auth library, state/query library (React Query/TanStack, SWR), UI framework
- `next.config.*` → App Router vs Pages, image domains, experimental flags, output mode (standalone = containerized, export = static)
- Look for `drizzle.config.*`, `prisma/schema.*`, `supabase/` directory, `.env.example` keys (`DATABASE_URL` shape tells you Postgres flavor and often the host — `.supabase.co`, `.rds.amazonaws.com`, etc.)
- `docker-compose.yml` / `Dockerfile` / `.github/workflows/*` / `vercel.json` → hosting target
- Migration files directory → whether the schema is managed (good sign) or ad-hoc (red flag, mention it)
- Grep for `createClient` (Supabase), `drizzle(`, `new PrismaClient`, `pg.Pool`, `mysql2` → confirms the actual data-access pattern in use, which can differ from what's in `package.json` if there's dead dependencies

**Fingerprint the scale from the data, not from the user's guess:**
- If DB access is available: row counts on the 5-10 largest tables (`SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10` on Postgres), current connection count, index list
- If DB access is not available: ask for a rough user count and let the DB checks (Phase 2) fill in the rest once granted

**Then confirm back to the user in plain language before proceeding:**

> "Here's what I found: you're on Next.js 15 App Router, deployed to Vercel, using Supabase (Postgres + Auth) with the Supabase JS client directly (no ORM). Your `profiles` table has about 40,000 rows and your busiest table `orders` has 2.1 million rows with no covering index on the column your dashboard filters by. Does that match your understanding? Anything I'm missing about where this runs in production?"

This confirmation step matters even when discovery was fully automated — it catches cases where staging and production have diverged, or where there's a second app/service the agent doesn't have visibility into.

## Step 3.5 — Turn a concrete goal into a staged roadmap

Sometimes the user doesn't describe a symptom ("the dashboard is slow") — they describe a **goal**: a target user experience plus a target scale. For example: *"I want this fast even on low networks, and scalable to 5 lakh (500,000) monthly active users."*

This is a different, and more valuable, request than a single-bug fix. Treat it as a request for a **roadmap**, not a single diagnosis:

1. **Translate the goal into concrete, checkable numbers.** "Fast on low networks" → target metrics (e.g. LCP < 2.5s on a throttled 3G/4G profile, total JS for the entry route under a specific KB budget). "Scalable to 5 lakh MAU" → derive realistic concurrency and request-rate assumptions from it (a rough rule of thumb: MAU does not mean 500,000 simultaneous users — model peak concurrent users as a fraction of MAU based on the app's actual usage pattern, and state that assumption explicitly rather than silently guessing a number and moving on).
2. **Research before modeling.** Before proposing target numbers or an architecture, look up current guidance for the stack in play — Vercel/Next.js's own scaling guidance, the DB provider's connection-pooling limits at the relevant tier, CDN edge cache behavior for the hosting target. Don't derive capacity math from memory alone; a wrong assumption here cascades into every later phase. See "Mandatory web research" below.
3. **Build the roadmap as staged milestones, not one giant task list.** A jump from "current state" to "5 lakh MAU" is not one project — it's several. Structure it as stages with their own scale target, e.g.:
   - Stage 1: Solid to ~5,000–10,000 MAU (fix existing bottlenecks, add missing indexes/caching, get Core Web Vitals green)
   - Stage 2: Solid to ~50,000–100,000 MAU (connection pooling headroom, CDN/caching layer, background job queue for anything synchronous today)
   - Stage 3: Solid to 5 lakh MAU (horizontal scaling, read replicas or equivalent, load-tested and proven, not just architecturally plausible)
   Each stage gets its own findings, its own report section, and its own approval gate — don't ask the user to approve all three stages' work at once if Stage 1 hasn't even been measured yet.
4. **State the roadmap back to the user before starting Phase 2.** Confirm the staged breakdown, the metrics chosen for "fast," and the concurrency assumption behind the MAU target — this is exactly the kind of interpretation that should be checked, not assumed silently.
5. **Persist the roadmap** in `.vibe-performance/STATE.md` and reference it from `INDEX.md` so a future session picks up "we're mid-way through Stage 2" instead of losing the plan.

## Mandatory web research (before diagnosing, not just when citing a version)

This skill exists partly because trained-in model knowledge about frameworks, cloud provider limits, and "current best practice" goes stale — sometimes within months. Treat a live web search (or a docs MCP such as Context7, if Phase 0 found one) as a **required step**, not an optional nice-to-have, in these situations:

- Before recommending any specific fix tied to a framework/library version (already required — see `POWER.md` Phase 2)
- Before proposing capacity numbers or an architecture for a scale target (Step 3.5 above) — provider limits, pricing tiers, and recommended patterns change often
- Before diagnosing anything where the "textbook" fix might have been superseded (e.g. a caching pattern that was standard two years ago but has a newer, cheaper equivalent now)
- Whenever the user's own stack fingerprint (Phase 2) includes a library/service version released after this skill's own knowledge is likely to be current — treat this as a trigger to look it up, not a reason to hedge and guess anyway

State what was actually looked up and when in the report's Confidence notes (e.g. "Verified against current Supabase connection-pooling docs, fetched this session" vs. "Based on general Postgres connection-pooling behavior, not verified against current provider docs"). Never present a capacity plan or fix recommendation as settled fact when it rests on unverified, possibly-stale assumptions — flag the gap and either close it with a search or tell the user explicitly that it wasn't checked.

## Step 4 — Set expectations before proceeding

Once intake is done, briefly state the plan before starting Phase 1-2 work:

> "I'll fingerprint exact versions next, then measure the current baseline for [the specific thing], then report back with findings ranked by impact vs effort before changing anything. I won't edit code until you've seen that report and told me what to prioritize."

This is the moment to also flag if the request itself implies a scale mismatch worth naming out loud — e.g., if someone asks to "make it handle 100k concurrent users" on a $10/month DB tier, say that plainly now, not after doing free diagnostic work that the tier can't support anyway.
