// `flo statusline` — renders a single-line Claude Code status bar.
//
// Wire it up by setting in .claude/settings.json:
//   {
//     "statusLine": {
//       "type": "command",
//       "command": "sh -c 'exec flo statusline'"
//     }
//   }
//
// Outputs one line of ANSI-colored text showing:
//   myflo v<ver>  <cwd-basename>  git:<branch> +X ~Y ?Z  flo: Nm Mt Aa  claude code
//
// Reads ~/.flo/ counts directly without going through full materialize
// (each entry is a JSONL line; we count lines minus tombstones). Designed
// to finish in <100ms even on large stores.

import { readFile, stat, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');

// ANSI helpers — work in any terminal Claude Code uses.
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  brightMagenta: '\x1b[95m',
};

export async function statuslineCommand(args) {
  const json = args.includes('--json');
  const data = await collect();
  if (json) {
    process.stdout.write(JSON.stringify(data) + '\n');
    return;
  }
  process.stdout.write(render(data) + '\n');
}

async function collect() {
  const cwd = process.cwd();
  const [version, git, flo] = await Promise.all([
    detectFloVersion(),
    readGitStatus(cwd),
    readFloCounts(),
  ]);
  return { version, cwd: basename(cwd), git, flo };
}

function render({ version, cwd, git, flo }) {
  const brand = `${c.bold}${c.brightMagenta}▊ myflo v${version}${c.reset}`;
  const dirPart = `${c.dim}● ${c.reset}${c.cyan}${cwd}${c.reset}`;
  const parts = [brand, dirPart];

  if (git && git.branch) {
    const branch = `${c.blue}⏇ ${git.branch}${c.reset}`;
    const changes = renderGitChanges(git);
    parts.push(`${c.dim}│${c.reset}  ${branch}${changes ? ' ' + changes : ''}`);
  }

  if (flo && (flo.memory || flo.tasks || flo.agents)) {
    const m = flo.memory ? `${c.cyan}${flo.memory}m${c.reset}` : '';
    const t = flo.tasks ? `${c.yellow}${flo.tasks}t${c.reset}` : '';
    const a = flo.agents ? `${c.green}${flo.agents}a${c.reset}` : '';
    const segs = [m, t, a].filter(Boolean).join(' ');
    parts.push(`${c.dim}│${c.reset}  ${c.dim}flo:${c.reset} ${segs}`);
  }

  parts.push(`${c.dim}│${c.reset}  ${c.magenta}claude code${c.reset}`);
  return parts.join('  ');
}

function renderGitChanges(g) {
  const out = [];
  if (g.added) out.push(`${c.green}+${g.added}${c.reset}`);
  if (g.modified) out.push(`${c.yellow}~${g.modified}${c.reset}`);
  if (g.untracked) out.push(`${c.dim}?${g.untracked}${c.reset}`);
  return out.join('');
}

// Version detection: prefer the package this command is running from
// (works whether installed globally as @fuzeelogik/myflo or run from monorepo).
function detectFloVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    if (pkg.version) return pkg.version;
  } catch { /* fall through */ }
  return '1.0';
}

// git status via subprocess. Times out at 800ms — if git is slow, skip rather
// than hang the statusline.
function readGitStatus(cwd) {
  return new Promise((resolve) => {
    const p = spawn('git', ['status', '--porcelain=v1', '-b', '--no-ahead-behind'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 800,
    });
    let stdout = '';
    p.stdout.on('data', (b) => { stdout += b.toString(); });
    p.on('error', () => resolve(null));
    p.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const result = { branch: null, added: 0, modified: 0, untracked: 0 };
      for (const line of stdout.split('\n')) {
        if (!line) continue;
        if (line.startsWith('## ')) {
          const m = line.match(/## ([^.\s]+)/);
          result.branch = m ? m[1] : null;
          continue;
        }
        const code2 = line.slice(0, 2);
        if (code2 === '??') result.untracked++;
        else if (code2[0] === 'A' || code2[1] === 'A') result.added++;
        else if (code2[0] === 'M' || code2[1] === 'M' || code2[0] === 'D' || code2[1] === 'D') result.modified++;
        else result.modified++;
      }
      resolve(result);
    });
  });
}

async function readFloCounts() {
  if (!existsSync(FLO_HOME)) return { memory: 0, tasks: 0, agents: 0 };
  const [memory, tasks, agents] = await Promise.all([
    countMemoryEntries(),
    countPendingTasks(),
    countLiveAgents(),
  ]);
  return { memory, tasks, agents };
}

async function countMemoryEntries() {
  const memDir = join(FLO_HOME, 'memory');
  if (!existsSync(memDir)) return 0;
  let total = 0;
  try {
    const files = await readdir(memDir);
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const path = join(memDir, f);
      try {
        const raw = await readFile(path, 'utf8');
        // Count store events minus tombstone events
        let stores = 0, tombs = 0;
        for (const line of raw.split('\n')) {
          if (!line) continue;
          if (line.includes('"op":"store"')) stores++;
          else if (line.includes('"op":"delete"') || line.includes('"deleted":true')) tombs++;
        }
        total += Math.max(0, stores - tombs);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return total;
}

async function countPendingTasks() {
  const tasksPath = join(FLO_HOME, 'tasks.jsonl');
  if (!existsSync(tasksPath)) return 0;
  try {
    const raw = await readFile(tasksPath, 'utf8');
    // Materialize last status per task id
    const status = new Map();
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e.op === 'delete') { status.delete(e.id); continue; }
        if (e.status !== undefined) status.set(e.id, e.status);
        else if (e.op === 'create') status.set(e.id, e.status || 'pending');
      } catch { /* ignore */ }
    }
    let pending = 0;
    for (const s of status.values()) if (s === 'pending' || s === 'in_progress') pending++;
    return pending;
  } catch { return 0; }
}

async function countLiveAgents() {
  const agentsPath = join(FLO_HOME, 'agents.jsonl');
  if (!existsSync(agentsPath)) return 0;
  try {
    const raw = await readFile(agentsPath, 'utf8');
    const live = new Map();
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e.op === 'delete') { live.delete(e.id); continue; }
        if (e.op === 'spawn') live.set(e.id, e.status || 'idle');
        else if (e.op === 'update' && e.status !== undefined) live.set(e.id, e.status);
      } catch { /* ignore */ }
    }
    let alive = 0;
    for (const s of live.values()) if (s !== 'stopped') alive++;
    return alive;
  } catch { return 0; }
}
