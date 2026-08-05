#!/usr/bin/env node
'use strict';

/**
 * Vibe Performance — installer CLI.
 *
 * Design goal: one command, no confusion, works with the real auto-trigger
 * mechanism of every major AI coding tool — not a fake pointer that only
 * loads when a user manually types #filename.
 *
 *   pnpm dlx vibe-performance init     — detect your AI tool(s), install
 *   pnpm dlx vibe-performance status   — show what's installed
 *   pnpm dlx vibe-performance update   — refresh skill content (memory untouched)
 *   pnpm dlx vibe-performance remove   — uninstall (memory kept unless --purge-memory)
 *
 *   (npx and yarn dlx work identically — this CLI has no preference of its own
 *   at runtime. It only prefers pnpm when PRINTING suggested follow-up commands,
 *   matching whatever package manager the project/machine actually uses.)
 *
 * How it works — the Agent Skills open standard (agentskills.io):
 *   Every major AI coding tool (Kiro, Cursor, Claude Code, Windsurf, VS Code
 *   Copilot, Google Antigravity) now auto-discovers "Skills": a folder with a
 *   SKILL.md file whose `description` frontmatter field is semantically
 *   matched against what the user types. This is what makes "use Vibe
 *   Performance" or "why is my dashboard slow" actually auto-trigger the
 *   skill, instead of requiring the user to manually reference a file.
 *
 *   Each tool scans its OWN directory for this, so this installer copies the
 *   full skill bundle (SKILL.md + POWER.md + steering/) into every skill
 *   directory that tool actually uses:
 *     - .agents/skills/vibe-performance/   — the open-standard default.
 *       Read natively by Cursor, VS Code/Copilot, Google Antigravity, and any
 *       other Agent-Skills-compliant tool. Always installed.
 *     - .kiro/skills/vibe-performance/     — only if .kiro/ exists
 *     - .claude/skills/vibe-performance/   — only if CLAUDE.md or .claude/ exists
 *     - .windsurf/skills/vibe-performance/ — only if .windsurf/ or .windsurfrules exists
 *     - .cursor/skills/vibe-performance/   — only if .cursor/ exists (belt-and-
 *       suspenders alongside .agents/skills/, since Cursor's forum confirms it
 *       scans both paths)
 *
 *   These are full copies, not symlinks (symlinks are unreliable cross-platform,
 *   especially on Windows without admin/developer mode). `update` refreshes
 *   every installed copy at once, so there's nothing to keep in sync by hand.
 *
 *   A pointer block is also upserted into AGENTS.md — the emerging universal
 *   fallback read by tools that don't yet do Agent-Skills discovery (Codex,
 *   Aider, Zed, Gemini CLI, Amazon Q, and similar).
 *
 *   A per-project memory folder (.vibe-performance/) is scaffolded so the
 *   skill has somewhere to record what it learns about THIS codebase.
 *   This is never touched by `update`, and only removed by `remove
 *   --purge-memory`.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PACKAGE_ROOT = path.join(__dirname, '..');
const CWD = process.cwd();

// ── package manager detection ───────────────────────────────────────────
//
// This CLI has zero dependencies and never shells out to a package manager
// itself — there's nothing for pnpm/npm to do differently here. What DOES
// matter is which runner command we print back to the user, so the commands
// we suggest (`update`, `remove`, etc.) match whatever they're already using
// in this project, and default to pnpm (preferred) over npm when the project
// gives no signal either way.

function commandExists(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectRunner() {
  // 1. Trust the project's own lockfile first — it's the strongest signal.
  if (exists(path.join(CWD, 'pnpm-lock.yaml'))) return 'pnpm dlx';
  if (exists(path.join(CWD, 'yarn.lock'))) return 'yarn dlx';
  if (exists(path.join(CWD, 'package-lock.json'))) return 'npx';
  // 2. No lockfile (fresh project, or not a Node project at all) — prefer
  //    pnpm if it's actually installed on this machine, since it's faster
  //    and more disk-efficient. Fall back to npx, which ships with Node.
  if (commandExists('pnpm')) return 'pnpm dlx';
  return 'npx';
}

const MEMORY_DIR = path.join(CWD, '.vibe-performance');

const START_MARKER = '<!-- vibe-performance:start -->';
const END_MARKER = '<!-- vibe-performance:end -->';

const AGENTS_MD_POINTER = [
  '### Vibe Performance',
  '',
  'For ANY performance, scalability, database-optimization, caching, or DSA-grounded',
  'speed work on this project, read and fully follow:',
  '',
  '```',
  '.agents/skills/vibe-performance/POWER.md',
  '```',
  '',
  'Start at Phase 0 (read `.agents/skills/vibe-performance/steering/environment-and-memory.md`',
  'first, every session) — never jump straight to editing code for a performance request.',
  '',
  '(If your tool supports the Agent Skills standard — SKILL.md discovery — this is already',
  'wired in automatically via `.agents/skills/vibe-performance/SKILL.md` and does not need',
  'this pointer to trigger. This block exists for tools that read AGENTS.md directly instead.)',
].join('\n');

// ── small fs helpers ────────────────────────────────────────────────────────

function exists(p) {
  return fs.existsSync(p);
}

function ensureDirSync(p) {
  fs.mkdirSync(p, { recursive: true });
}

function log(icon, msg) {
  console.log(`${icon} ${msg}`);
}

function writeFileIfAbsent(filePath, content) {
  if (exists(filePath)) return false;
  ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

/** Insert a marked block into an existing (or new) file, exactly once. */
function upsertMarkedBlock(filePath, body) {
  const block = `${START_MARKER}\n${body}\n${END_MARKER}`;
  if (!exists(filePath)) {
    ensureDirSync(path.dirname(filePath));
    fs.writeFileSync(filePath, `${block}\n`, 'utf8');
    return 'created';
  }
  const current = fs.readFileSync(filePath, 'utf8');
  if (current.includes(START_MARKER)) {
    const re = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`, 'm');
    const next = current.replace(re, block);
    fs.writeFileSync(filePath, next, 'utf8');
    return 'updated';
  }
  const sep = current.endsWith('\n') ? '\n' : '\n\n';
  fs.writeFileSync(filePath, `${current}${sep}${block}\n`, 'utf8');
  return 'appended';
}

/** Remove a previously-inserted marked block. Returns true if something was removed. */
function removeMarkedBlock(filePath) {
  if (!exists(filePath)) return false;
  const current = fs.readFileSync(filePath, 'utf8');
  if (!current.includes(START_MARKER)) return false;
  const re = new RegExp(`\\n?${START_MARKER}[\\s\\S]*?${END_MARKER}\\n?`, 'm');
  const next = current.replace(re, '\n');
  if (next.trim().length === 0) {
    fs.unlinkSync(filePath);
  } else {
    fs.writeFileSync(filePath, next, 'utf8');
  }
  return true;
}

/** Copy SKILL.md + POWER.md + steering/ into a skill directory. */
function copySkillBundle(destDir) {
  ensureDirSync(destDir);
  fs.copyFileSync(path.join(PACKAGE_ROOT, 'SKILL.md'), path.join(destDir, 'SKILL.md'));
  fs.copyFileSync(path.join(PACKAGE_ROOT, 'POWER.md'), path.join(destDir, 'POWER.md'));
  fs.cpSync(path.join(PACKAGE_ROOT, 'steering'), path.join(destDir, 'steering'), { recursive: true });
}

// ── skill install targets ───────────────────────────────────────────────────
//
// `always: true` targets are installed unconditionally (the open-standard
// default). Conditional targets install only if the tool is already in use
// in this project — installing a `.claude/skills/` folder into a project that
// doesn't use Claude Code would just be clutter.

const SKILL_TARGETS = [
  {
    id: 'Agent Skills standard (.agents/skills/) — Cursor, Copilot, Antigravity, and compliant tools',
    dir: path.join(CWD, '.agents', 'skills', 'vibe-performance'),
    always: true,
  },
  {
    id: 'Kiro',
    dir: path.join(CWD, '.kiro', 'skills', 'vibe-performance'),
    detect: () => exists(path.join(CWD, '.kiro')),
  },
  {
    id: 'Claude Code',
    dir: path.join(CWD, '.claude', 'skills', 'vibe-performance'),
    detect: () => exists(path.join(CWD, '.claude')) || exists(path.join(CWD, 'CLAUDE.md')),
  },
  {
    id: 'Windsurf',
    dir: path.join(CWD, '.windsurf', 'skills', 'vibe-performance'),
    detect: () => exists(path.join(CWD, '.windsurf')) || exists(path.join(CWD, '.windsurfrules')),
  },
  {
    id: 'Cursor (dedicated path)',
    dir: path.join(CWD, '.cursor', 'skills', 'vibe-performance'),
    detect: () => exists(path.join(CWD, '.cursor')),
  },
];

const AGENTS_MD_TARGET = path.join(CWD, 'AGENTS.md');

// ── memory scaffold ─────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

const INDEX_TEMPLATE = `# Vibe Performance — Project Index

Last verified: ${TODAY}

## Stack Fingerprint
- Framework: [not yet fingerprinted — filled in during Phase 2 of the next engagement]
- Data layer: [ ]
- Auth: [ ]
- Query/cache: [ ]
- Hosting: [ ]
- Cache/queue infra: [ ]

## Available Tools (discovered this session/prior sessions)
| Tool | Type | Relevant for |
|---|---|---|

## Existing Project Conventions to Respect

## Prior Engagements
| Date | Slug | Status | Report |
|---|---|---|---|
`;

const STATE_TEMPLATE = `# Current Engagement State

Slug: (none — no active engagement)
Stage: Idle

## Task Checklist

## Notes carried between turns
`;

const LEARNINGS_TEMPLATE = `# Vibe Performance — Learnings Log

Durable, reusable facts about this project only. See
.agents/skills/vibe-performance/steering/environment-and-memory.md
for what belongs here (and what doesn't).

<!-- Newest entries go at the top -->
`;

function scaffoldMemory() {
  const created = [];
  if (writeFileIfAbsent(path.join(MEMORY_DIR, 'INDEX.md'), INDEX_TEMPLATE)) created.push('INDEX.md');
  if (writeFileIfAbsent(path.join(MEMORY_DIR, 'STATE.md'), STATE_TEMPLATE)) created.push('STATE.md');
  if (writeFileIfAbsent(path.join(MEMORY_DIR, 'learnings.md'), LEARNINGS_TEMPLATE)) created.push('learnings.md');
  ensureDirSync(path.join(MEMORY_DIR, 'reports'));
  return created;
}

// ── commands ─────────────────────────────────────────────────────────────

function cmdInit() {
  console.log('Vibe Performance — installing into this project...\n');

  for (const t of SKILL_TARGETS) {
    const shouldInstall = t.always || (t.detect && t.detect());
    if (!shouldInstall) continue;
    const already = exists(path.join(t.dir, 'SKILL.md'));
    copySkillBundle(t.dir);
    log('✔', `${t.id}: ${path.relative(CWD, t.dir)} (${already ? 'refreshed' : 'installed'})`);
  }

  const agentsResult = upsertMarkedBlock(AGENTS_MD_TARGET, AGENTS_MD_POINTER);
  log('✔', `AGENTS.md fallback pointer: ${agentsResult}`);

  const createdMemFiles = scaffoldMemory();
  if (createdMemFiles.length > 0) {
    log('✔', `Project memory created at .vibe-performance/ (${createdMemFiles.join(', ')})`);
  } else {
    log('ℹ', '.vibe-performance/ already existed — left as-is.');
  }

  console.log('\nDone. Next step:');
  console.log('  Open your AI agent in this project and say something like:');
  console.log('  "Use Vibe Performance to check why the dashboard is slow."');
  console.log('\nIf your tool supports Agent Skills (Kiro, Cursor, Claude Code, Windsurf,');
  console.log('VS Code/Copilot, Antigravity), it should pick this up automatically from');
  console.log('the description you just typed. If it doesn\'t, try: "read POWER.md in the');
  console.log('vibe-performance skill and follow it."');
  console.log(`\nTo refresh or remove later: ${detectRunner()} vibe-performance update|remove`);
}

function cmdUpdate() {
  const installedTargets = SKILL_TARGETS.filter((t) => exists(path.join(t.dir, 'SKILL.md')));

  if (installedTargets.length === 0) {
    log('✖', `Vibe Performance is not installed here yet. Run \`${detectRunner()} vibe-performance init\` first.`);
    process.exitCode = 1;
    return;
  }

  for (const t of installedTargets) {
    copySkillBundle(t.dir);
    log('✔', `Refreshed ${path.relative(CWD, t.dir)}`);
  }
  log('ℹ', '.vibe-performance/ (your project memory) was not touched.');
}

function cmdStatus() {
  console.log('Vibe Performance — status for this project\n');

  for (const t of SKILL_TARGETS) {
    const installed = exists(path.join(t.dir, 'SKILL.md'));
    const relevant = t.always || (t.detect && t.detect());
    if (!relevant && !installed) continue; // don't clutter status with irrelevant tools
    log(installed ? '✔' : '✖', `${t.id} — ${installed ? 'installed' : 'NOT installed'} (${path.relative(CWD, t.dir)})`);
  }

  const hasAgentsPointer = exists(AGENTS_MD_TARGET) && fs.readFileSync(AGENTS_MD_TARGET, 'utf8').includes(START_MARKER);
  log(hasAgentsPointer ? '✔' : 'ℹ', `AGENTS.md fallback pointer ${hasAgentsPointer ? 'present' : 'not present'}`);

  if (exists(MEMORY_DIR)) {
    log('✔', '.vibe-performance/ memory folder present');
    const indexPath = path.join(MEMORY_DIR, 'INDEX.md');
    if (exists(indexPath)) {
      const match = fs.readFileSync(indexPath, 'utf8').match(/Last verified:\s*(.+)/);
      if (match) log(' ', `  Last verified: ${match[1].trim()}`);
    }
  } else {
    log('✖', '.vibe-performance/ memory folder not found');
  }
}

function cmdRemove(args) {
  const purgeMemory = args.includes('--purge-memory');

  for (const t of SKILL_TARGETS) {
    if (!exists(t.dir)) continue;
    fs.rmSync(t.dir, { recursive: true, force: true });
    log('✔', `Removed ${path.relative(CWD, t.dir)}`);
  }

  if (removeMarkedBlock(AGENTS_MD_TARGET)) {
    log('✔', 'Removed pointer block from AGENTS.md');
  }

  if (purgeMemory) {
    if (exists(MEMORY_DIR)) {
      fs.rmSync(MEMORY_DIR, { recursive: true, force: true });
      log('✔', 'Removed .vibe-performance/ (project memory) — --purge-memory was set');
    }
  } else if (exists(MEMORY_DIR)) {
    log('ℹ', '.vibe-performance/ (project memory) was kept. Re-run with --purge-memory to delete it too.');
  }
}

function cmdHelp() {
  const runner = detectRunner();
  console.log(`Vibe Performance — CLI

Usage:
  ${runner} vibe-performance init             Install into this project (detects your AI tool)
  ${runner} vibe-performance status           Show what's currently installed
  ${runner} vibe-performance update           Refresh skill content (project memory is untouched)
  ${runner} vibe-performance remove [--purge-memory]
                                         Uninstall. Keeps .vibe-performance/ (memory)
                                         unless --purge-memory is passed.

(Works the same with npx, pnpm dlx, or yarn dlx — shown above using ${runner}
 based on this project's lockfile or what's installed on this machine.)

Learn more: https://github.com/rishabhchauhan/vibe-performance
`);
}

// ── entry point ──────────────────────────────────────────────────────────

const [, , command, ...rest] = process.argv;

switch (command) {
  case 'init':
    cmdInit();
    break;
  case 'update':
    cmdUpdate();
    break;
  case 'status':
    cmdStatus();
    break;
  case 'remove':
  case 'uninstall':
    cmdRemove(rest);
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    cmdHelp();
    break;
  default:
    console.log(`Unknown command: ${command}\n`);
    cmdHelp();
    process.exitCode = 1;
}
