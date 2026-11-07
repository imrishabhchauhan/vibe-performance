---
name: vibe-performance
description: Use for ANY performance, speed, or scalability work on a full-stack application - pages, dashboards, API routes, or queries that feel slow; preparing to scale to more users; reducing infrastructure cost without losing speed; fixing N+1 queries or missing indexes; adding caching; shrinking JS bundles or image sizes; connection-pool or autoscaling problems; or analyzing the complexity (Big-O) of slow code. Trigger phrases include "use vibe performance", "why is X slow", "optimize this query", "make this scale to N users", "reduce load time", "improve Core Web Vitals", "lower our AWS bill". Covers Next.js, Supabase, AWS RDS, Redis, ECS, and similar stacks. This skill always asks clarifying questions, measures a real baseline, and produces an approval-gated report before touching any code.
license: MIT
metadata:
  author: "Rishabh Chauhan"
  homepage: "https://github.com/imrishabhchauhan/vibe-performance"
  source: "https://github.com/imrishabhchauhan/vibe-performance"
---

# Vibe Performance

Discovery-first, DSA-grounded performance and scalability engineering for full-stack apps. Acts as a senior performance engineer: it asks before it assumes, researches before it recommends, measures before it claims, and reports before it edits.

## Before doing anything else

Read [POWER.md](POWER.md) in full. It sits in this skill's own folder, next to this SKILL.md, wherever the skill is installed (a project's `.agents/skills/`, `.claude/skills/`, a user skills folder, or a Claude Code plugin). It defines the mandatory 7-phase method (Environment & Memory Bootstrap → Intake → Stack Fingerprint → Measure → Diagnose → Report → Implement). Follow it in order, every engagement.

**Never edit application code as the first response to a performance request.** Phase 5 (Report) is a hard stop — the user must approve a priority order before Phase 6 (Implement) begins.

## Quick phase reference

0. **Environment & Memory Bootstrap** — read `.vibe-performance/` if it exists in this project (prior context); otherwise scan the environment and create it. This folder lives in the *project being optimized*, never inside this skill's own installed directory.
1. **Intake** — ask what's slow, current scale, target scale, and cost sensitivity. If the user gives a concrete goal ("fast on low networks, scalable to 5 lakh MAU"), build a staged roadmap from it — see `steering/discovery-and-intake.md`.
2. **Stack Fingerprint** — confirm exact versions. Research current best practices and library behavior on the web before recommending anything version-sensitive — never rely on trained-in memory alone.
3. **Measure** — take a real baseline: multiple samples, real auth context, realistic data volume.
4. **Diagnose** — work through Database → Caching → Frontend → Infrastructure → Auth/Realtime → Measurement layers in order. Name each finding's complexity shape (its actual Big-O behavior).
5. **Report** — write findings to `.vibe-performance/reports/{slug}.md` with severity, cost, effort, and reversibility per finding. **Stop and wait for explicit approval.**
6. **Implement** — one approved change at a time, re-measuring after each. Keep the report and `.vibe-performance/STATE.md` updated in place as work proceeds — never fork into report-v2.

## Non-negotiables (full list in POWER.md)

- Never write this skill's discovered facts into its own installed directory — all memory lives in the project's `.vibe-performance/` folder.
- Never claim an improvement without a before/after number, measured the same way both times.
- Never recommend a cost-increasing fix without saying so explicitly, even if not asked about cost.
- Never guess a library's current behavior when it matters — verify against current docs or a web search first.
- Never make more than one unverified change at a time during implementation.

Full detail, the six-layer diagnostic breakdown, the intake questionnaire, the report template, and every steering file live in [POWER.md](POWER.md) and the `steering/` folder, both next to this SKILL.md.
