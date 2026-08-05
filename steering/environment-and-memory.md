# Environment Awareness & Persistent Memory

Read this file **first**, before any other steering file, on every engagement. It governs Phase 0 — the step that makes this skill self-aware of its surroundings and self-improving across sessions, instead of starting from zero every time.

## The one rule that makes this safe to open-source

**This skill's own package directory (wherever `vibe-performance/` is installed) is read-only reference material. Never write discovered facts, reports, or state into it.**

All memory this skill creates lives in a `.vibe-performance/` folder inside the **project being optimized** — the same convention as `.kiro/`, `.cursor/`, `.claude/`, `.github/`. This is what lets one shared, open-sourced skill install cleanly be used across many unrelated projects by many different engineers without their memory colliding or leaking into each other. If you ever find yourself about to write a discovered fact into the skill's own installed directory, stop — that's the wrong location.

## Phase 0 — Environment & Memory Bootstrap

Run this before Phase 1 (Intake) on every engagement, every session. It's cheap (mostly file existence checks) and it's what prevents the skill from re-discovering the same facts, re-asking the same questions, or contradicting a decision already made in a prior session.

### Step 1 — Check for existing memory first

```
Does <project-root>/.vibe-performance/ exist?
├─ Yes → Read INDEX.md, STATE.md, and learnings.md before doing anything else.
│        This is prior context — treat it as trustworthy but re-verify anything
│        version-sensitive if enough time has passed (see "staleness" below).
└─ No  → Run the full environment scan (Step 2) and create the folder (Step 3).
```

**Staleness check:** if `INDEX.md` has a "Last verified" date older than ~30 days, or the engagement's Phase 1 stack fingerprint disagrees with what's recorded, treat the recorded facts as a starting hypothesis to re-confirm, not ground truth. Note the discrepancy in the report rather than silently overwriting history.

### Step 2 — Scan the environment (only needed once per project, then maintained incrementally)

The goal: know what tools, rules, and prior context already exist around this codebase so the skill works *with* them instead of duplicating or contradicting them. Check for all of the following — this list is intentionally IDE-agnostic because this skill will run inside many different tools:

**Agent instruction/steering files (any that exist):**
- `.kiro/steering/*.md`, `.kiro/hooks/*.json`, `.kiro/specs/`
- `.cursor/rules/*.mdc`, legacy `.cursorrules`
- `CLAUDE.md`, `.claude/settings.json`, `.claude/agents/`
- `.windsurf/rules`, `.windsurfrules`
- `.github/copilot-instructions.md`
- `AGENTS.md` (a growing cross-tool convention some teams use as a single instruction file read by multiple agents)
- `.continue/config.json`

**MCP server configs (any that exist) — these tell you what tools are already available without needing to ask the user:**
- `.kiro/settings/mcp.json`, `~/.kiro/settings/mcp.json`
- `.cursor/mcp.json`
- `.mcp.json` (Claude Code project-level), Claude Desktop's `claude_desktop_config.json`
- Any other `mcp.json`/`mcp_config.json` at the project root

Specifically flag if any of these are present, since they change what's possible in later phases:
- A **database MCP** (Supabase, Postgres, or similar) → means Phase 3 (Measure) can query live, not just read code
- A **docs/library MCP** (Context7 or similar) → means Phase 1's "verify against current docs" step should use it first
- A **browser/Playwright MCP** → means Phase 3 can measure real page-load timing instead of only static analysis
- A **cloud/infra MCP** (AWS, Cloudflare, or similar) → means Phase 4's infrastructure layer can be checked live (connection limits, autoscaling config) instead of inferred from IaC files alone

**Other skills/powers already installed** — read their names/descriptions (don't necessarily activate them) so this skill doesn't reinvent something a sibling skill already owns (e.g., a project-specific "database-safety" skill that already encodes migration rules this skill should defer to, not override).

**Existing hooks** (`PostToolUse`, `PreToolUse`, etc.) — if a hook already fires on file writes or DB migrations, respect it; don't design a workflow that fights an existing automation.

**Repo-level signals** (covered in more depth by `discovery-and-intake.md`'s auto-discovery, cross-reference rather than duplicate): `package.json`, framework config files, migration directories, CI workflows.

### Step 3 — Create or update `.vibe-performance/`

```
<project-root>/.vibe-performance/
├── INDEX.md              — environment scan results + stack fingerprint (the "what exists here" file)
├── STATE.md              — current stage, active engagement, task checklist (the "where are we" file)
├── learnings.md          — append-only log of confirmed, durable facts (the "what we know for sure" file)
└── reports/
    └── {engagement-slug}.md   — one living file per investigation (see measurement-and-reporting.md)
```

Tell the user this folder was created (or is being read) and that it's safe to commit to version control if the team wants shared context, or gitignore it if they'd rather keep it local/ephemeral — that's a team preference this skill doesn't impose either way. Mention it once, don't ask permission for the folder itself (it's a low-risk, easily-deleted convenience file, not a destructive action) — but do ask before adding it to `.gitignore` on the team's behalf if the project doesn't already ignore dotfolders like it.

## `INDEX.md` — template

```markdown
# Vibe Performance — Project Index

Last verified: YYYY-MM-DD

## Stack Fingerprint
- Framework: [e.g. Next.js 15.2, App Router]
- Data layer: [e.g. Supabase (Postgres) via @supabase/ssr, no ORM]
- Auth: [e.g. Supabase Auth, JWT-based]
- Query/cache: [e.g. TanStack Query v5]
- Hosting: [e.g. Vercel] / [e.g. AWS ECS Fargate behind ALB]
- Cache/queue infra: [e.g. Upstash Redis, QStash] / [none detected]

## Available Tools (discovered this session/prior sessions)
| Tool | Type | Relevant for |
|---|---|---|
| [e.g. supabase MCP] | Database MCP | Live query measurement (Phase 3), schema inspection |
| [e.g. context7 MCP] | Docs MCP | Version verification (Phase 1) |
| [e.g. playwright MCP] | Browser MCP | Real page-load measurement (Phase 3) |

## Existing Project Conventions to Respect
- [e.g. "Migrations must go through db/migrations/, never direct SQL" — from CLAUDE.md]
- [e.g. "A pre-commit hook runs lint — don't bypass it"]

## Prior Engagements
| Date | Slug | Status | Report |
|---|---|---|---|
| YYYY-MM-DD | [engagement-slug] | Resolved / Monitoring / Abandoned | `reports/[slug].md` |
```

Update the Stack Fingerprint and Available Tools sections whenever Phase 1 (in `discovery-and-intake.md` / `POWER.md`) discovers something new or contradicts what's recorded. Append to Prior Engagements at the close of every engagement — this is what lets a future session (or a different engineer, or a different agent tool entirely) see "we already investigated the dashboard slowness in March, here's what we found" instead of starting cold.

## `STATE.md` — template

This is the single tracker for "where is the current engagement in the method" — one file, updated in place, never forked into report-v1/report-v2/final-report sprawl.

```markdown
# Current Engagement State

Slug: [engagement-slug]
Started: YYYY-MM-DD
Stage: [Intake | Fingerprint | Measuring | Diagnosing | Reported-Awaiting-Approval | Implementing | Verifying | Closed]

## Task Checklist (derived from the report's findings once Phase 5 is reached)
- [ ] Finding 1: [short title] — Not started
- [ ] Finding 2: [short title] — Not started
- [x] Finding 3: [short title] — Done, verified 12% faster (see report)

## Notes carried between turns
[Anything mid-investigation worth remembering if this session gets interrupted —
e.g. "waiting on user to confirm staging DB access", "confirmed via EXPLAIN this is
an RLS issue, not an index issue, still need to check option 3 from database-query-optimization.md §6"]
```

Update `Stage` every time the engagement moves to a new phase. This is what prevents the "did we already report on this, or are we still measuring?" confusion that happens when an engagement spans multiple sessions or gets picked up by a different agent/engineer partway through.

## `learnings.md` — the self-learning log

**Not everything belongs here.** This file is for durable, reusable facts — the kind that would save real time if known before starting the next investigation. It is explicitly not a session transcript or a change log (that's what `reports/` and git history are for).

**Record here:**
- A confirmed library/framework behavior that mattered and might not be obvious from docs alone (e.g., "Next.js 15.2 here: `fetch` is NOT cached by default in this project's config — confirmed by testing, not just reading docs")
- A gotcha specific to this codebase that would bite the next investigation (e.g., "the `orders` table's RLS policy has 4 OR'd SECURITY DEFINER calls — always EXPLAIN as authenticated role here, superuser numbers are meaningless")
- A decision and its reasoning, when it deviated from the default pattern in this skill's other steering files (e.g., "chose NOT to add Redis for X because query cost was already <5ms — see database-query-optimization.md's cost guidance")
- A dead end — something tried that didn't help, so it isn't retried blindly next time

**Do NOT record:**
- Routine "I ran EXPLAIN and it was fine" notes with nothing surprising
- Anything already obvious from reading the code
- A blow-by-blow narrative of a single session — summarize the durable takeaway only, in one entry, not a diary

**Format (append-only, newest at top):**
```markdown
## [One-line summary] (YYYY-MM-DD)
[2-5 sentences: what was found, why it matters for future work, and where the fuller
detail lives if someone needs it (a specific report file, a specific commit).]
```

Before writing a new entry, skim existing entries for the same topic — if this is the second or third time the same class of fact has come up, that's a signal it might belong in a permanent project-level rule (a `CLAUDE.md`/`.cursor/rules` entry, or similar) rather than staying buried in a log. Surface that suggestion to the user rather than deciding it unilaterally.

## Bootstrapping a brand-new project (no prior `.vibe-performance/`)

On the very first engagement for a project, Phase 0 doubles as the moment to build the initial `INDEX.md` from scratch via the environment scan (Step 2 above), then proceed straight into Phase 1 (Intake) using what was just discovered to make the intake questions sharper (e.g., skip asking "what's your data layer" if the scan already found a Supabase config — confirm it instead of asking blind).
