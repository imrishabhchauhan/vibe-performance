# Vibe Performance

[![npm version](https://img.shields.io/npm/v/vibe-performance.svg)](https://www.npmjs.com/package/vibe-performance)
[![license](https://img.shields.io/npm/l/vibe-performance.svg)](./LICENSE)

**A discovery-first, DSA-grounded performance & scalability skill for AI coding agents.** Current release: `v1.0.2`.

Works with Kiro, Cursor, Claude Code, Windsurf, GitHub Copilot, and any other agentic coding tool that reads project-level instruction files. One command installs it into whichever tool you're already using.

## Contents

- [Why this exists](#why-this-exists)
- [What it actually is](#what-it-actually-is)
- [Who it's for](#who-its-for)
- [Installation](#installation)
- [CLI reference](#cli-reference)
- [The 7 phases](#the-7-phases)
- [Non-negotiables](#non-negotiables)
- [FAQ](#faq)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [License](#license)

```bash
pnpm dlx vibe-performance init
# or: npx vibe-performance init
# or: yarn dlx vibe-performance init
```

That's it. No config, no account, no API key. Use whichever of the three you already have — they all fetch the exact same package from npm and behave identically. The CLI's own follow-up suggestions (`update`, `remove`) will match your project's actual package manager automatically.

---

## Why this exists

Most "make it faster" work goes one of two ways:

- **Cargo-culting** — copying a tip from a blog post without measuring whether it applies here, or
- **Guessing** — rewriting something because it *feels* slow, with no before/after number to prove it helped.

Vibe Performance forces a different sequence. It's built around one rule: **an AI agent should never edit code as its first response to a performance complaint.** Instead, it scans the project, asks (or auto-discovers) what's actually going on, measures the current state, diagnoses the root cause in terms of its actual complexity shape (an O(n²) lookup, a missing index, a waterfall of sequential requests), and writes a report — and only *then*, after you approve it, implements one change at a time, re-measuring after each.

It also treats **cost** as part of "performance," not a separate concern. A fix that makes something faster by throwing more infrastructure at it is flagged as a cost tradeoff, explicitly, every time — never slipped in silently.

## What it actually is

There's no separate AI, no hidden service, no sub-agent architecture. It's:

1. **A methodology document** (`POWER.md`) — a 7-phase process (Environment & Memory Bootstrap → Intake → Stack Fingerprint → Measure → Diagnose → Report → Implement).
2. **Nine steering files** — focused reference material for each performance domain (database queries, caching with a cache audit, CPU hot loops and data layout, frontend rendering, infrastructure/scaling, auth & realtime, plus the intake questionnaire, environment/memory rules, and measurement/reporting standards). The agent loads only the files relevant to the diagnosed problem, not all nine at once.
3. **A `SKILL.md`** following the open [Agent Skills standard](https://agentskills.io) — this is what makes the skill auto-trigger when you say "use Vibe Performance" or describe a slow page, instead of requiring you to manually reference a file.
4. **A tiny installer CLI** — detects which AI tool(s) you're using and installs the skill into each one's actual discovery path.

When you ask your AI agent to use Vibe Performance, it's the *same agent you're already talking to* — Kiro, Cursor, Claude, whichever — just now following a much more rigorous playbook than its default "sure, let me fix that" instinct.

### Why this actually auto-triggers (and what changed)

Every major AI coding tool — Kiro, Cursor, Claude Code, Windsurf, VS Code/Copilot, Google Antigravity — has converged on the same mechanism for this: a folder with a `SKILL.md` file, whose `description` field gets semantically matched against what you type. This is the **Agent Skills** open standard, and each tool scans its own directory for it:

| Tool | Directory this installer writes to |
|---|---|
| Kiro | `.kiro/skills/vibe-performance/` |
| Claude Code | `.claude/skills/vibe-performance/` |
| Windsurf | `.windsurf/skills/vibe-performance/` |
| Cursor, VS Code/Copilot, Google Antigravity, and any other compliant tool | `.agents/skills/vibe-performance/` (always installed — this is the open-standard default path) |

`init` installs into every path that's relevant for your project — the `.agents/skills/` copy always, and the tool-specific ones only if that tool is already in use (no point cluttering a Next.js-only project with a `.claude/skills/` folder if you've never opened Claude Code there). A fallback pointer is also written into `AGENTS.md` for tools that read that file directly instead of doing Skill discovery (Codex, Aider, Zed, Gemini CLI, Amazon Q, and similar).

## Who it's for

Engineers working on full-stack apps built on some combination of:

- **Next.js** (App Router or Pages Router)
- **Supabase** (Postgres, Auth, Realtime, Storage) **or AWS RDS** (Postgres/MySQL via Drizzle, Prisma, or raw SQL)
- **TanStack Query**
- **Better Auth**, Supabase Auth, or NextAuth
- **Redis**
- **QStash**, SQS, or cron-based background jobs
- **AWS ECS + ALB**, Vercel, or similar hosting

If your stack only overlaps partially, the underlying patterns (missing index, N+1 query, unbounded select, render-blocking bundle) still apply — the skill just skips the steering files that don't match your setup.

---

## Installation

```bash
pnpm dlx vibe-performance init
```

This does three things, in your **current project directory** (not globally, not touching anything outside the project):

| Step | What happens |
|---|---|
| 1 | Installs the full skill bundle (`SKILL.md` + `POWER.md` + `steering/`) into `.agents/skills/vibe-performance/` (always) and into `.kiro/skills/`, `.claude/skills/`, `.windsurf/skills/`, `.cursor/skills/` — but only for the tool directories that already exist in your project, so it doesn't clutter a project with folders for tools you don't use. |
| 2 | Writes a small fallback pointer into `AGENTS.md` for tools that read that file directly instead of doing Skill discovery. |
| 3 | Scaffolds a `.vibe-performance/` folder in your project — this is where the skill keeps its memory of *this specific codebase* (stack fingerprint, past engagement reports, durable learnings) across sessions. |

Each installed copy is a full copy, not a symlink (symlinks are unreliable cross-platform, especially on Windows without admin/developer mode) — `update` refreshes every installed copy at once, so there's nothing to keep in sync by hand.

### After installing

Open your AI agent in the project and just ask it something like:

> "Use Vibe Performance to check why the dashboard is slow."

The agent reads `.agents/skills/vibe-performance/POWER.md`, starts at Phase 0, and takes it from there — asking you a few questions before it touches any code.

---

## CLI reference

```bash
pnpm dlx vibe-performance init              # install into the current project
pnpm dlx vibe-performance status            # show what's currently installed
pnpm dlx vibe-performance update            # refresh skill content (memory untouched)
pnpm dlx vibe-performance remove            # uninstall (keeps .vibe-performance/ memory)
pnpm dlx vibe-performance remove --purge-memory   # uninstall AND delete project memory
```

(`npx` and `yarn dlx` work identically in place of `pnpm dlx` above.)

`init` and `update` are both idempotent — running them again never duplicates anything or overwrites content you didn't ask it to touch. `remove` only ever deletes the skill directories it created and the pointer block it added to `AGENTS.md`; if you had existing content in `AGENTS.md` before installing, only the Vibe Performance block is stripped out — the rest of your file is left exactly as it was.

---

## The 7 phases

| Phase | What happens |
|---|---|
| 0 — Environment & Memory Bootstrap | Reads `.vibe-performance/` if it already exists (prior context from earlier sessions); otherwise scans the project's existing agent rules, MCP servers, other skills, and hooks, and creates it. |
| 1 — Intake | Asks what's slow, what the stack is, what scale it needs to handle, and how cost-sensitive the project is — or auto-discovers these if the user can't answer confidently. |
| 2 — Stack Fingerprint | Confirms exact versions of the framework, DB client/ORM, query layer, and auth library — caching and pooling behavior changes across versions, so this is verified against current docs, not assumed from memory. |
| 3 — Measure | Takes a real baseline under realistic conditions (not a warm dev cache, not an empty table) — multiple samples, real auth session, real network hop. |
| 4 — Diagnose | Works through six layers in order (database & query → caching & data layer → frontend rendering → infrastructure & scaling → auth & realtime → measurement gaps), naming the complexity shape of each finding. |
| 5 — Report | Writes a living report with root cause, fix approach (with stack-specific variants), expected impact, cost impact, effort, and reversibility for each finding — **then stops and waits for approval.** No code is touched here. |
| 6 — Implement | One approved change at a time, re-measured immediately after. If a change doesn't move the number it was supposed to move, the process stops and re-diagnoses rather than stacking another speculative fix on top. |

Full detail on every phase lives in [`POWER.md`](./POWER.md) and the [`steering/`](./steering) files.

## Non-negotiables

These are the hard rules the skill enforces on itself, regardless of which AI tool is running it:

1. Never write its own discovered facts into its own installed package directory — all memory lives in the project's `.vibe-performance/` folder.
2. Never edit code as the first action on a performance request.
3. Never claim an improvement without a before/after number, taken under comparable conditions.
4. Never recommend a fix that increases infrastructure cost without saying so explicitly.
5. Never optimize for the demo dataset — row counts and concurrency targets are established before deciding whether a fix matters.
6. Never guess at a library's current behavior when a recommendation depends on version-specific behavior.
7. Never make more than one unverified change at a time during implementation.
8. Always state confidence — "confirmed via EXPLAIN ANALYZE as the real authenticated caller" is a different claim than "should help, haven't measured."
9. Never let the report or memory files fork into multiple copies — one living report per engagement, updated in place.

---

## FAQ

**Does this send any of my code anywhere?**
No. Everything runs locally, inside whichever AI agent you're already using in your own environment. The CLI itself only reads and writes files in your project directory — it makes no network calls.

**Does this require an account, API key, or subscription?**
No. It's a set of markdown instruction files plus a small Node CLI. There's nothing to sign up for.

**What if I use more than one AI tool on the same project?**
`init` detects every tool directory it finds (e.g. both `.kiro/` and `.cursor/`) and installs a full copy of the skill into each one's actual discovery path, plus the universal `.agents/skills/` copy. `update` refreshes every installed copy in one command, so there's nothing to keep in sync by hand even though there are multiple physical copies on disk.

**Will `update` overwrite my project's memory of past performance work?**
No. `update` only refreshes the installed skill copies (the methodology itself). `.vibe-performance/` (your project's stack fingerprint, report history, and learnings) is never touched by `update` — only `remove --purge-memory` deletes it, and that's opt-in.

**Is this Next.js/Supabase-only?**
No. It's written to be stack-agnostic at the pattern level (a missing index is a missing index anywhere) and stack-specific at the implementation level (Supabase vs. RDS get different concrete steps where they actually differ).

---

## Changelog

**1.0.4**: The caching guide now starts with an audit of the caches a project already has (what slow work each one hides, how it is invalidated, hit rate, whether a redesign makes it unnecessary) and treats a new cache as the last fix, not the first. `POWER.md` no longer lists a cache layer as an early quick fix. New steering file `cpu-hot-loops-and-data-layout.md` for CPU-bound hot loops found by a profiler (flat arrays, structure of arrays, bitsets, preallocation), used only when a profile points there.

**1.0.3**: `SKILL.md` now points to `POWER.md` and `steering/` by their place next to `SKILL.md`, not by the fixed `.agents/skills/vibe-performance/` path. The skill now works from any install location: `.claude/skills/`, a user skills folder, or as a Claude Code plugin from the `vibe-skills` marketplace (`claude plugin marketplace add imrishabhchauhan/vibe-dev-practices`, then `claude plugin install vibe-performance@vibe-skills`). No method change.

**1.0.2** — Fixes a broken GitHub URL: `package.json`, `SKILL.md`'s metadata frontmatter, and the CLI's help text pointed to `github.com/rishabhchauhan/vibe-performance` (missing the leading `i`, a 404), corrected to `imrishabhchauhan`. Adds a `bugs` URL to `package.json`. Restructures README with badges and a table of contents. No skill behaviour changed.

**1.0.1 and earlier** — See [GitHub releases](https://github.com/imrishabhchauhan/vibe-performance/releases) and commit history for the initial release.

## Contributing

Issues and PRs are welcome at [github.com/imrishabhchauhan/vibe-performance](https://github.com/imrishabhchauhan/vibe-performance). If you've found a pattern that's genuinely missing from the steering files, or a recommendation that's gone stale against a library's current docs, that's exactly the kind of contribution this project needs.

## License

[MIT](./LICENSE) © Rishabh Chauhan — [linkedin.com/in/rishabhchauhan25](https://www.linkedin.com/in/rishabhchauhan25)
