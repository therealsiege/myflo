// `flo replace ruflo` — cutover script.
// Removes ruflo / claude-flow entries from ~/.claude/mcp.json and project
// .claude/settings.json mcpServers blocks, AND shells out to
// `claude mcp remove <name>` for entries the Claude CLI itself manages
// (e.g. ones registered via `claude mcp add` that don't live in those files).
// Idempotent. Backs up json files before writing.

import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const USER_MCP = join(homedir(), '.claude', 'mcp.json');
const PROJECT_SETTINGS = join(process.cwd(), '.claude', 'settings.json');

const RUFLO_KEYS = ['ruflo', 'claude-flow'];

export async function replaceCommand(args) {
  const opts = parseFlags(args);
  if (opts.help) return printHelp();
  if (opts.positional[0] && opts.positional[0] !== 'ruflo') {
    console.error(`flo replace: only 'ruflo' is supported (got '${opts.positional[0]}')`);
    process.exit(2);
  }

  console.log(`flo replace ruflo — removing ruflo / claude-flow MCP entries`);
  console.log('');

  const targets = [
    { label: 'user-global', path: USER_MCP },
    { label: 'project', path: PROJECT_SETTINGS },
  ];

  for (const { label, path } of targets) {
    if (!existsSync(path)) {
      console.log(`- ${label}: ${path} not present, skipping`);
      continue;
    }
    let raw, parsed;
    try {
      raw = await readFile(path, 'utf8');
      parsed = JSON.parse(raw);
    } catch (err) {
      console.log(`× ${label}: failed to parse ${path}: ${err.message}`);
      continue;
    }
    const result = removeRufloFrom(parsed);
    if (!result.changed) {
      console.log(`= ${label}: no ruflo entries found in ${path}`);
      continue;
    }
    if (opts.dryRun) {
      console.log(`# ${label}: would remove keys ${result.removed.join(', ')} from ${path}`);
      continue;
    }
    const backup = `${path}.flo-bak.${Date.now()}`;
    await copyFile(path, backup);
    await writeFile(path, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    console.log(`✓ ${label}: removed [${result.removed.join(', ')}] from ${path} (backup: ${backup})`);
  }

  // Phase 2: ask Claude CLI itself to remove any ruflo/claude-flow servers it
  // tracks. This catches entries registered via `claude mcp add` that don't
  // live in mcp.json or settings.json (e.g. user/local scope state the CLI
  // keeps elsewhere). The flo replace ruflo command was previously a no-op
  // for users in this state — see #1 on the v1.0.1 premortem.
  const claudePath = await whichClaudeCli();
  if (!claudePath) {
    console.log('');
    console.log('- claude CLI not on PATH — skipping `claude mcp remove` step.');
    console.log('  (Files were cleaned above; that is usually enough.)');
  } else {
    console.log('');
    console.log(`Running \`claude mcp remove\` for each known ruflo name...`);
    for (const name of RUFLO_KEYS) {
      if (opts.dryRun) {
        console.log(`# would run: claude mcp remove "${name}"`);
        continue;
      }
      const res = await runClaudeMcpRemove(claudePath, name);
      if (res.removed) {
        console.log(`✓ claude mcp remove "${name}" — removed from ${res.scope || 'config'}`);
      } else if (res.notFound) {
        console.log(`= claude mcp remove "${name}" — not registered, skipping`);
      } else {
        console.log(`× claude mcp remove "${name}" — failed: ${res.error}`);
      }
    }
  }

  console.log('');
  console.log('Done. Restart Claude Code to pick up the change.');
  console.log("If you need to roll back, the .flo-bak.* file is your snapshot.");
}

async function whichClaudeCli() {
  return new Promise((resolve) => {
    const p = spawn('which', ['claude'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (b) => { out += b.toString(); });
    p.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    p.on('error', () => resolve(null));
  });
}

async function runClaudeMcpRemove(claudePath, name) {
  return new Promise((resolve) => {
    const p = spawn(claudePath, ['mcp', 'remove', name], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (b) => { stdout += b.toString(); });
    p.stderr.on('data', (b) => { stderr += b.toString(); });
    p.on('close', (code) => {
      const combined = (stdout + stderr).toLowerCase();
      if (code === 0) {
        const scopeMatch = stdout.match(/from\s+(\w+)\s+config/i);
        resolve({ removed: true, scope: scopeMatch?.[1] || null });
      } else if (/no.*server.*found|not.*found|does not exist/.test(combined)) {
        resolve({ notFound: true });
      } else {
        resolve({ error: (stderr || stdout).trim().slice(0, 200) || `exit ${code}` });
      }
    });
    p.on('error', (err) => resolve({ error: err.message }));
  });
}

function removeRufloFrom(obj) {
  const removed = [];
  // mcpServers block
  if (obj.mcpServers && typeof obj.mcpServers === 'object') {
    for (const k of Object.keys(obj.mcpServers)) {
      const val = obj.mcpServers[k];
      const args = (val && val.args) ? val.args.join(' ') : '';
      const cmd = val ? `${val.command || ''} ${args}` : '';
      if (RUFLO_KEYS.includes(k) || /ruflo|claude-flow/.test(cmd)) {
        delete obj.mcpServers[k];
        removed.push(`mcpServers.${k}`);
      }
    }
  }
  // enabledMcpjsonServers array
  if (Array.isArray(obj.enabledMcpjsonServers)) {
    const before = obj.enabledMcpjsonServers.length;
    obj.enabledMcpjsonServers = obj.enabledMcpjsonServers.filter((s) => !RUFLO_KEYS.includes(s));
    if (obj.enabledMcpjsonServers.length < before) {
      removed.push(`enabledMcpjsonServers (${before - obj.enabledMcpjsonServers.length} entries)`);
    }
  }
  // permissions.allow — strip mcp__claude-flow__* / mcp__ruflo__*
  if (obj.permissions && Array.isArray(obj.permissions.allow)) {
    const before = obj.permissions.allow.length;
    obj.permissions.allow = obj.permissions.allow.filter(
      (entry) => !/mcp__(claude-flow|ruflo)/.test(entry)
    );
    if (obj.permissions.allow.length < before) {
      removed.push(`permissions.allow (${before - obj.permissions.allow.length} entries)`);
    }
  }
  return { changed: removed.length > 0, removed };
}

function printHelp() {
  console.log(`flo replace ruflo — cutover from ruflo MCP server to flo

Usage:
  flo replace ruflo [--dry-run]

Removes ruflo / claude-flow entries from:
  ~/.claude/mcp.json                       (user-global MCP servers)
  ./.claude/settings.json                  (project mcpServers + permissions)

Specifically removes:
  - mcpServers.{ruflo,claude-flow}
  - mcpServers.* whose command/args contain 'ruflo' or 'claude-flow'
  - enabledMcpjsonServers entries that match
  - permissions.allow entries matching 'mcp__ruflo__*' or 'mcp__claude-flow__*'

Both files are backed up to <path>.flo-bak.<ts> before being rewritten.

Also runs \`claude mcp remove ruflo\` and \`claude mcp remove claude-flow\`
to catch entries the Claude CLI tracks outside those files (registered via
\`claude mcp add\`). Silently skipped if the claude CLI isn't on PATH.

Idempotent. Re-running on a clean config is a no-op.

This complements 'flo migrate', which only ADDED the flo entry. Run that first
to register flo, then 'flo replace ruflo' to remove the old server entry.
`);
}

function parseFlags(args) {
  const out = { positional: [] };
  for (const a of args) {
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (!a.startsWith('--')) out.positional.push(a);
  }
  return out;
}
