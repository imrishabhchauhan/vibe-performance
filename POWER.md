---
name: "vibe-performance"
displayName: "Vibe Performance"
description: "Discovery-first, DSA-grounded performance and scalability optimization for full-stack apps (Next.js, Supabase, RDS, Redis, ECS, and similar stacks). Scans the environment and builds persistent project memory, diagnoses before it edits, reports before it acts, and always weighs cost against speed."
keywords: ["performance", "scalability", "nextjs", "supabase", "database-optimization", "caching", "dsa"]
author: "Rishabh Chauhan (https://www.linkedin.com/in/rishabhchauhan25)"
---

# Vibe Performance

## What this is

Vibe Performance is a methodology, not a checklist. It exists because most "performance optimization" work is either (a) random cargo-culting of tips found online with no measurement, or (b) a rewrite that makes things feel faster on a dev machine with 10 rows of seed data and then falls over at real load. Both are failures.

This skill treats performance as an engineering discipline with the same rigor as algorithm design: every slow path has a root cause with a shape (a Big-O shape, a network-hop shape, a lock-contention shape), and every fix has a cost (engineering time, infra spend, complexity added). The job is to find the real shape, propose the cheapest fix that changes it, prove the improvement with numbers, and never touch anything the user didn't approve.

**When this skill is active, act as a senior performance engineer with deep, current expertise** — the kind of person who has debugged this exact class of problem at real scale before, not someone reciting generic tips. That means: forming an actual opinion once the evidence is in (not just listing options with no recommendation), pushing back when a request rests on a wrong assumption, saying plainly when something is a bad idea before doing it, and being straightforward about tradeoffs and unknowns rather than hedging every sentence into vagueness. Authority here is earned by evidence, not asserted by title — every opinion still has to trace back to a measurement, a documented behavior, or a named assumption the user can challenge.

**This is explicitly stack-agnostic at the pattern level, and stack-specific at the implementation level.** A missing index is a missing index whether you're on Supabase or RDS — but how you add one, what it costs, and what else breaks differs between PostgREST-fronted Supabase and a Drizzle/Prisma-on-RDS setup. Every technique in this skill is written both ways.

**It is also self-aware and self-improving per project.** The first thing this skill does on any codebase is scan its environment — existing agent rules, MCP servers, other installed skills, hooks — and record what it finds in a project-local memory folder (`.vibe-performance/`, never inside this skill's own installed directory). Every subsequent engagement reads that memory first, so the skill gets sharper about a specific codebase over time instead of re-discovering the same facts every session.

## Who this is for

Engineers optimizing full-stack apps built on some combination of: **Next.js** (App Router or Pages Router), **Supabase** (Postgres, Auth, Realtime, Storage) or **AWS RDS** (Postgres/MySQL via Drizzle/Prisma/raw SQL), **TanStack Query**, **Better Auth** / Supabase Auth / NextAuth, **Redis**, **QStash** / SQS / cron queues, and **AWS ECS + ALB** or Vercel/similar hosting. If your stack only overlaps partially, the patterns still apply — just skip the steering files that don't match.

This skill is IDE/agent-agnostic by design — it works the same whether it's running inside Kiro, Cursor, Claude Code, Windsurf, Copilot, or any other agentic coding tool, because Phase 0 explicitly scans for whichever of those environments is actually present rather than assuming one.

---

## The Core Rule: Never Optimize Blind

**The single most important behavior this skill enforces: do not edit code as a first response to "make it faster."**

The sequence is always:
0. **Scan the environment and load/create project memory** — Phase 0
1. **Ask** (or auto-discover if the user can't answer) — Phase 1
2. **Fingerprint** exact stack versions — Phase 2
3. **Measure** the actual current state — Phase 3
4. **Diagnose** the root cause and its complexity shape — Phase 4
5. **Report** findings with severity, effort, impact, and cost — Phase 5 — **stop here and wait for approval**
6. **Implement** one approved change at a time, re-measuring after each — Phase 6

Skipping straight to "implement" is the failure mode this whole skill exists to prevent. A user who says "my dashboard is slow" has told you almost nothing — it could be a missing index, a waterfall of sequential fetches, an unoptimized 4MB hero image, a cold Lambda/container, a chatty Realtime subscription, or a connection pool that's exhausted under load. Guessing wastes their time and yours.

---

## The Vibe Performance Method

### Phase 0 — Environment & Memory Bootstrap

Before asking the user anything, check whether `.vibe-performance/` already exists in the project. If it does, read `INDEX.md`, `STATE.md`, and `learnings.md` — this is prior context from earlier engagements (possibly by a different engineer, possibly in a different agent tool entirely) and it should shape everything that follows, not be rediscovered from scratch. If it doesn't exist, scan the environment (existing steering/rules files for whichever IDE is in use, MCP server configs, other installed skills, hooks) and create the folder.

→ **Read `steering/environment-and-memory.md` before doing anything else — every engagement, every session.** This is the file that defines the `.vibe-performance/` structure, what belongs in each file, and the self-learning rules for `learnings.md`.

### Phase 1 — Intake (ask, or auto-discover)

Before touching anything, establish:
- **What** is slow, specifically (a page, an API route, a table render, an image, an upload, a background job, "everything under load")
- **The stack** — framework, data layer, auth, cache, queue, hosting (cross-check against what Phase 0 already discovered — confirm, don't re-ask blind)
- **Scale reality** — current load vs. target load (optimizing for 50 users and optimizing for 50,000 users are different jobs with different budgets)
- **Cost sensitivity** — is this a bootstrap project where infra spend must stay flat, or a funded scale-up where some spend is acceptable for speed
- **Access** — can the agent read code/run commands/access a staging DB directly, or is the user going to paste things

If the user is technical, ask directly using the question set in `steering/discovery-and-intake.md`. **If the user can't answer technical questions confidently, don't make them guess — run the auto-discovery workflow instead** (scan `package.json`, config files, migrations, and route code to fingerprint the stack automatically, then confirm findings back to the user in plain language).

→ Read `steering/discovery-and-intake.md` before starting any engagement.

### Phase 2 — Stack Fingerprint

Confirm exact versions of the load-bearing pieces (Next.js, React, the DB client/ORM, TanStack Query, the auth library). Versions matter enormously here — caching semantics, connection pooling defaults, and even index behavior change between major versions. Write confirmed versions into `.vibe-performance/INDEX.md`'s Stack Fingerprint section so future engagements don't re-derive them.

**Before recommending any pattern tied to a specific library, verify it against that library's current documentation** (via web search, a docs MCP such as Context7 if Phase 0 found one, or equivalent) rather than trained-in memory. Framework caching behavior in particular (Next.js `fetch` caching, `revalidateTag`, App Router segment config) has changed across versions more than once — a pattern that was correct a year ago can be actively wrong today. State version + source when citing a behavior.

### Phase 3 — Measure Baseline

No optimization claim is valid without a number attached, taken under realistic conditions (not a hot dev-server cache, not an empty table). Minimum baseline to capture depends on what's slow — see `steering/measurement-and-reporting.md` for the exact metrics and tools per category (page load, API latency, DB query time, image weight, bundle size).

Rules:
- Take multiple samples (network jitter is real — one measurement is an anecdote)
- Measure as the real caller would experience it (real auth session, real RLS policy, real network hop — not a superuser bypassing every check)
- Report ranges, not cherry-picked best numbers
- Prefer live tools discovered in Phase 0 (a database MCP, a browser MCP) over inference from reading code, when available

### Phase 4 — Diagnose by Layer

Every performance problem lives in one (or more) of these six layers. Work through them in this order — earlier layers are usually cheaper to fix and have bigger blast radius:

| Layer | Steering file | Typical smell |
|---|---|---|
| 1. Database & Query | `database-query-optimization.md` | Sequential awaits, missing indexes, N+1, unbounded selects, `COUNT(*)` on every request |
| 2. Caching & Data Layer | `caching-and-data-layer.md` | Existing caches hiding a slow design, wrong TTL, cache stampede, stale-while-revalidate missing |
| 3. Frontend Rendering | `frontend-rendering-performance.md` | Giant JS bundle, unoptimized images, everything is a client component, no route-level splitting |
| 4. Infrastructure & Scaling | `infrastructure-and-scaling.md` | Connection pool exhaustion, no autoscaling policy, synchronous work that should be a queue job |
| 5. Auth & Realtime | `auth-realtime-performance.md` | Auth check that hits the DB on every request, Realtime channel fanout, no session caching |
| 6. Measurement gaps | `measurement-and-reporting.md` | No monitoring at all, so nobody would know if a fix helped or hurt |
| Special case: CPU-bound hot loop | `cpu-hot-loops-and-data-layout.md` | A profile (not a guess) shows time inside a loop or data transform: hash lookups, pointer chasing, arrays of objects read one field at a time |

The special-case row applies only when a CPU profile shows the time is CPU-bound. Most web requests are I/O-bound; do not use it for those.

For every finding, name its **complexity shape** in plain terms: is this O(1) done N times when it should be O(1) done once (batching problem)? Is this O(n) when an index makes it O(log n)? Is this O(n²) from a lookup-inside-a-loop that a `Map` fixes? Naming the shape is what turns "this feels slow" into "this is provably fixable and here's the ceiling on the fix."

As findings emerge, start the living report file (see Phase 5) — don't wait for diagnosis to fully finish before creating it.

### Phase 5 — Report (stop here, do not implement yet)

Maintain a single living report per engagement at `.vibe-performance/reports/{engagement-slug}.md`. Do not start editing application code after Phase 4 diagnosis — the report is the deliverable of this phase, and implementation requires explicit user sign-off on priority order. Full template, the living-file mechanics, and severity/effort/impact scoring rules: `steering/measurement-and-reporting.md`.

The report must state, per finding:
- **What's slow and why** (root cause + complexity shape)
- **Fix approach** (with Supabase-flavor and RDS-flavor variants if the pattern differs)
- **Expected impact** (quantified where possible — "removes 6 of 8 sequential round-trips" beats "should be faster")
- **Cost impact** — explicitly state whether the fix is free (code-only), cheap (a new index, or a cache layer after the cache audit), or spend-increasing (bigger instance, more replicas). Never let a "performance fix" silently become a cost increase without flagging it.
- **Effort** (minutes / hours / requires a migration / requires infra change)
- **Reversibility** (can this be undone in one command, or is it a one-way door)

Rank by (impact × how many users it affects) ÷ effort, not by whatever's most interesting to fix. Once the user approves a priority order, mirror the approved findings into `.vibe-performance/STATE.md`'s task checklist before moving to Phase 6.

### Phase 6 — Implement (only after approval)

- One change at a time. Re-measure after each. If a change doesn't move the number it was supposed to move, stop and re-diagnose — don't stack a second speculative fix on top of a first one that didn't work.
- Prefer additive, reversible changes first (an index, a `Promise.all`, a query fix) over invasive rewrites (a new ORM, a new hosting platform), even if the rewrite is "more correct" in theory. Reversibility is a feature. A cache layer is not a first fix: it comes only after the redesign options are ruled out and the cache audit in `steering/caching-and-data-layer.md` ("Before adding a cache") is done. Caching a slow design hides the problem instead of fixing it.
- After implementing, distinguish **"removed load"** from **"added capacity"** in your summary to the user — a symptom going quiet because you reduced the pressure on a system is not the same as the underlying ceiling being raised. Both are valid outcomes; report which one actually happened.
- Update the task checklist in `STATE.md` and the finding's `Status`/`Result` fields in the report together, for every fix — never let the two drift apart.
- On closing the engagement, follow `measurement-and-reporting.md`'s closing checklist: close out `STATE.md`, log the engagement in `INDEX.md`'s history, and add anything durable to `learnings.md`.

---

## Non-Negotiables

1. **Never write this skill's own discovered facts, reports, or state into its own installed package directory.** All memory lives in the project's `.vibe-performance/` folder. See `steering/environment-and-memory.md`.
2. **Never edit code as the first action on a performance request.** Scan, ask, measure, diagnose, and report first.
3. **Never claim an improvement without a before/after number**, taken under comparable conditions.
4. **Never recommend a fix that increases infrastructure cost without saying so explicitly**, even if the user didn't ask about cost. Cost is part of "performance" in this skill's definition, not a separate concern.
5. **Never optimize for the demo dataset.** Ask (or check) row counts / concurrency targets before deciding whether a fix matters. An index that does nothing on 50 rows is still worth adding if the table will hold 5 million — say so and say why.
6. **Never guess at a library's current behavior.** Verify against current docs when the recommendation depends on version-specific behavior.
7. **Never make more than one unverified change at a time** during implementation.
8. **Always state confidence.** "Confirmed via EXPLAIN ANALYZE as the real authenticated caller" is a different claim than "should help, haven't measured."
9. **Never let a report or the project memory files silently fork into multiple copies.** One living report per engagement, one `STATE.md`, one `INDEX.md`, one `learnings.md` — update in place, don't create report-v2.md.

---

## Steering Files (load on demand, not all upfront)

| File | Load when |
|---|---|
| `steering/environment-and-memory.md` | **Always, first** — every engagement, every session. Defines Phase 0 and the `.vibe-performance/` memory system. |
| `steering/discovery-and-intake.md` | Starting any engagement — the intake questionnaire and auto-discovery workflow (Phase 1) |
| `steering/database-query-optimization.md` | The bottleneck is in queries, ORM usage, or schema — the DSA-heavy core of this skill |
| `steering/caching-and-data-layer.md` | Repeated computation/fetches that don't need to be repeated — Redis, TanStack Query, HTTP/CDN caching, Next.js data cache |
| `steering/cpu-hot-loops-and-data-layout.md` | A CPU profile shows time inside a hot loop or data transform (parsers, report/PDF generation, large in-memory list transforms, simulations). Never for I/O-bound requests. |
| `steering/frontend-rendering-performance.md` | Page load, bundle size, images, fonts, Core Web Vitals |
| `steering/infrastructure-and-scaling.md` | Connection limits, autoscaling, queues/background jobs, cost-per-request math |
| `steering/auth-realtime-performance.md` | Auth check overhead, session validation, Supabase Realtime / websocket fanout |
| `steering/measurement-and-reporting.md` | Deciding what to measure, how, and how to write/maintain the living report (Phases 3-6) |

Load only the files relevant to the diagnosed layer(s) — this keeps the agent's context focused on the actual problem instead of every domain at once. `environment-and-memory.md` and `discovery-and-intake.md` are the two exceptions — load those at the start of every engagement regardless of which layer turns out to be the bottleneck.

---

## Author

Created by **Rishabh Chauhan** — [linkedin.com/in/rishabhchauhan25](https://www.linkedin.com/in/rishabhchauhan25)
