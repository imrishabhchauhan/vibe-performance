# Measurement & Reporting

This file governs Phase 3 (measure), Phase 4 (diagnose), and Phase 5 (report) of the method. Read `environment-and-memory.md` first — in this skill, a report is not a one-shot document dropped in chat. It's a **living file** at `.vibe-performance/reports/{engagement-slug}.md`, created once and updated in place through the whole engagement, mirrored by a task checklist in `.vibe-performance/STATE.md`. This is what keeps a multi-session investigation from turning into report-v1/report-v2/final-final sprawl.

## What to measure, by category

| Category | Metric(s) | Tool |
|---|---|---|
| Page load | LCP, INP, CLS, Time to First Byte | Lighthouse, PageSpeed Insights, `web-vitals` for real-user data |
| API/route latency | Response time (p50/p95/p99, not just average), broken down by DB time vs. compute time | Network tab timing, APM (Sentry Performance, Datadog, etc.), or explicit timing logs |
| DB query time | Execution time under real RLS/auth context, not superuser | `EXPLAIN ANALYZE` with the correct role set (see `database-query-optimization.md` §3) |
| Table/list render | Time from navigation to interactive/populated state, plus row count at time of measurement | Browser network tab + a timestamp log around the render |
| Image load | Transferred file size, format, dimensions vs. displayed size | Network tab, Lighthouse's "Properly size images" / "Serve images in next-gen formats" audits |
| Upload | Time to complete, file size, whether it's chunked/resumable | Network tab, or explicit client-side timing around the upload call |
| Bundle size | Total JS shipped for the route, broken down by chunk | `@next/bundle-analyzer` or equivalent |
| Under-load behavior | Error rate, latency degradation curve, and the specific failure point as concurrency increases | A load-testing tool (k6, Artillery, or similar) against a non-production target |

Prefer live tools discovered during Phase 0's environment scan over manual/inferred checks when available — a database MCP gives real `EXPLAIN ANALYZE` output instead of a guess from reading the query; a browser/Playwright MCP gives a real LCP measurement instead of an estimate from reading the component tree. Record which tools were actually available for this engagement in the report's Confidence notes.

## Measurement rules (apply to every category)

1. **Multiple samples, not one.** Network conditions and cache state vary run to run. Report a range or a median across 3-5 samples, not a single lucky number.
2. **Real caller context.** Measure with the actual auth/session/RLS context a real user would have — not a superuser bypass, not a locally-seeded admin account with different permissions than a real end user.
3. **Realistic data volume.** A query that's instant on 20 seed rows tells you nothing about production with 2 million rows. If staging is empty, either seed it realistically or clearly caveat that the baseline is not representative and state what row count would need to be checked before trusting the number.
4. **State what was measured vs. inferred.** "Confirmed via `EXPLAIN ANALYZE` as the real authenticated caller: 340ms" is a different claim than "this query pattern typically causes slowness, haven't measured this specific instance yet." Both are legitimate things to say — just never blur the line between them.
5. **Baseline before, same method after.** The Phase 6 "after" measurement must use the exact same method as the Phase 3 "before" measurement, or the comparison is meaningless.

## Starting the living report (once, at the start of diagnosis)

As soon as Phase 3 measurement produces the first real finding, create `.vibe-performance/reports/{engagement-slug}.md` using the structure below — don't wait until every finding is in hand to start the file. Update it incrementally as diagnosis continues, and update `STATE.md`'s `Stage` field to `Diagnosing` at the same time.

```markdown
# Performance Report — [what was investigated]

Slug: [engagement-slug]
Stage: [Diagnosing | Reported-Awaiting-Approval | Implementing | Verifying | Closed]
Last updated: YYYY-MM-DD

## Summary
[2-4 sentences: what's slow, the biggest root cause(s), and the headline recommendation.
Lead with the bottom line — don't bury the most important finding under preamble.
Keep this current — rewrite it if a later finding changes the headline story.]

## Current Scale & Target Scale
- Current: [users / rows / requests-per-minute, as discovered or stated]
- Target: [what this needs to hold up to, per intake]
- Cost sensitivity: [bootstrap/flat-cost vs. some-spend-acceptable, per intake]

## Findings

### Finding 1: [short title]
- **Status:** Open / Approved / In Progress / Fixed / Rejected by user
- **Severity:** Critical / High / Medium / Low
- **Layer:** Database / Caching / Frontend / Infrastructure / Auth-Realtime
- **What's happening:** [root cause, plain language]
- **Complexity shape:** [e.g. "O(N) round-trips where N = enrolled students; should be O(1)"]
- **Measured impact:** [the actual number(s) from Phase 3 — "340ms average across 5 samples, real auth context"]
- **Fix approach:**
  - Supabase-flavor: [if applicable]
  - RDS/self-managed-flavor: [if applicable]
- **Expected impact of fix:** [quantified where possible]
- **Cost impact:** Free / Cheap ($X/mo estimate if knowable) / Spend-increasing (state the driver)
- **Effort:** Minutes / Hours / Requires migration / Requires infra change
- **Reversibility:** [one command to undo / straightforward to revert / one-way door]
- **Confidence:** [state basis — "confirmed via X" vs "inferred from pattern, not yet measured"]
- **Result (filled in after Phase 6):** [before → after number, "removed load" vs "added capacity", any surprise]

[repeat per finding — add new findings by appending, never by deleting/renumbering existing ones
once the user has seen them; if a finding turns out to be wrong, mark it Rejected with why,
don't silently remove it]

## Priority Ranking
[Ordered list — rank by (impact × affected-user-fraction) ÷ effort, not by novelty or personal interest.
State the ranking rationale in one line per item if it's not obvious from the order.
Re-order this section if the user's approval in Phase 5 changes the sequence.]

## What Was NOT Investigated
[Be explicit about scope boundaries — what wasn't checked and why (out of scope for this ask,
no access, ran out of budget/time). Don't let silence imply "everything else is fine."]

## Recommended Next Step
[Usually: "confirm priority order, then I'll implement one at a time and re-measure after each."]
```

## Syncing the report to `STATE.md` (Phase 5 → Phase 6 handoff)

Once the user approves a priority order (Phase 5's stop-and-wait gate), mirror the approved findings into `STATE.md`'s task checklist exactly as named in the report (same short titles, so the two files stay trivially cross-referenceable):

```markdown
## Task Checklist
- [ ] Finding 1: [short title] — Not started
- [ ] Finding 2: [short title] — Not started
```

During Phase 6 implementation, update **both** files together for each fix: check off the task in `STATE.md`, and fill in that finding's `Status` and `Result` fields in the report. Never let the two drift out of sync — `STATE.md` is the at-a-glance tracker, the report is the detail; if someone opens only one of them they should still get an accurate picture.

## Severity definitions (use consistently)

| Severity | Definition |
|---|---|
| **Critical** | Actively causing failures, timeouts, or data issues today; or a catastrophic (not graceful) failure mode at a load increase that's plausible soon |
| **High** | Measurably slow in a way users would notice and complain about; clear fix available |
| **Medium** | A real inefficiency with a real fix, but currently masked by low scale or acceptable latency — will become High as scale grows |
| **Low** | A correct-but-not-optimal pattern where the fix effort likely exceeds the practical benefit at any realistic scale for this app |

## What "done" looks like for the report

The report is in good shape when a non-technical stakeholder could read the Summary and Priority Ranking sections alone and make an informed "yes, do these three first" decision, while a technical implementer could read the full Findings section and start work without needing to ask what was meant. If either reader would be confused, keep refining before asking for approval.

## Closing an engagement

When every approved finding is Fixed (or explicitly deferred with the user's agreement), do all of the following together — this is the step that turns a single engagement's work into durable project memory for the next one:
1. Set the report's `Stage` to `Closed`.
2. Set `STATE.md`'s `Stage` to `Closed`, and clear or archive the task checklist.
3. Append one row to `INDEX.md`'s Prior Engagements table pointing at the closed report.
4. If anything from this engagement qualifies under `environment-and-memory.md`'s `learnings.md` criteria (a durable, reusable fact — not routine notes), add it now, don't leave it for "later."

## After implementation — the retrospective note (per fix, during Phase 6)

- **Before → after number**, same measurement method both times.
- **"Removed load" vs "added capacity"** — explicitly state which one happened (see `POWER.md` Phase 6) — this single distinction is one non-technical stakeholders otherwise never get told, and it directly affects whether they should expect the same class of problem to resurface at a higher scale.
- **Anything that didn't move the number as expected** — report this too, in the finding's `Result` field; a fix that didn't help is real information, not a failure to hide.
