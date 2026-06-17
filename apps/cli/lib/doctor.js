import { existsSync } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHECKS = [
  { name: 'node>=20', run: checkNode },
  { name: 'git', run: checkGit },
  { name: '.claude/ project', run: checkProjectClaude },
  { name: '.claude/checkpoints', run: checkCheckpoints },
  { name: '~/.claude/mcp.json', run: checkMcp },
  { name: 'flo bin resolvable', run: checkFloBin },
];

export async function doctor(args) {
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`flo doctor — quick health check

Usage:
  flo doctor [--json]
`);
    return;
  }
  const json = args.includes('--json');
  const results = [];
  for (const c of CHECKS) {
    try {
      const r = await c.run();
      results.push({ name: c.name, ok: r.ok, message: r.message });
    } catch (err) {
      results.push({ name: c.name, ok: false, message: err.message });
    }
  }
  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  const longest = Math.max(...results.map(r => r.name.length));
  for (const r of results) {
    const pad = r.name.padEnd(longest);
    const status = r.ok ? 'PASS' : 'FAIL';
    console.log(`  ${pad}  ${status}  ${r.message}`);
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\nflo doctor: ${results.length - failed}/${results.length} checks passed.`);
  if (failed) process.exit(1);
}

async function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) return { ok: true, message: process.versions.node };
  return { ok: false, message: `Node ${process.versions.node} (need >=20)` };
}

async function checkGit() {
  try {
    const v = execFileSync('git', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return { ok: true, message: v };
  } catch {
    return { ok: false, message: 'git not on PATH' };
  }
}

async function checkProjectClaude() {
  const p = join(process.cwd(), '.claude');
  if (existsSync(p)) {
    const st = await stat(p);
    if (st.isDirectory()) return { ok: true, message: p };
  }
  return { ok: false, message: `${p} not found (not in a Claude Code project?)` };
}

async function checkCheckpoints() {
  const p = join(process.cwd(), '.claude', 'checkpoints');
  if (!existsSync(p)) return { ok: false, message: 'no checkpoints dir (sessions not yet captured)' };
  return { ok: true, message: p };
}

async function checkMcp() {
  const p = join(homedir(), '.claude', 'mcp.json');
  if (!existsSync(p)) return { ok: false, message: `${p} missing (run 'flo migrate')` };
  try {
    const raw = await readFile(p, 'utf8');
    const parsed = JSON.parse(raw);
    const servers = Object.keys(parsed.mcpServers || {});
    const hasFlo = servers.includes('flo');
    return {
      ok: true,
      message: `servers=[${servers.join(',')}]${hasFlo ? '' : " (run 'flo migrate' to register flo)"}`,
    };
  } catch (err) {
    return { ok: false, message: `parse error: ${err.message}` };
  }
}

async function checkFloBin() {
  const p = new URL('../bin/flo.js', import.meta.url).pathname;
  if (existsSync(p)) return { ok: true, message: p };
  return { ok: false, message: `expected ${p}` };
}
