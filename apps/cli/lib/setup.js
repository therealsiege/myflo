// `flo setup` — single-command onboarding.
// Creates ~/.flo home, registers flo as an MCP server, runs doctor, prints next steps.
// Idempotent. Safe to re-run.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { migrate } from './migrate.js';
import { doctor } from './doctor.js';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');

export async function setupCommand(args) {
  const opts = parseArgs(args);
  if (opts.help) return printHelp();

  console.log(`flo setup — onboarding for ${FLO_HOME}`);
  console.log('');

  // 1. Ensure ~/.flo exists with the expected subtree
  const dirs = ['memory', 'messages', 'logs'];
  await mkdir(FLO_HOME, { recursive: true });
  for (const d of dirs) await mkdir(join(FLO_HOME, d), { recursive: true });
  console.log(`✓ ~/.flo/ created (memory, messages, logs)`);

  // 2. Touch registry files so they're discoverable from day one
  for (const f of ['inboxes.json', 'terminals.json']) {
    const path = join(FLO_HOME, f);
    if (!existsSync(path)) {
      await writeFile(path, JSON.stringify({ version: 1, [f.replace('.json', '')]: [] }, null, 2) + '\n', 'utf8');
    }
  }
  console.log(`✓ ~/.flo/inboxes.json and terminals.json initialized`);

  // 3. Register flo as an MCP server in ~/.claude/mcp.json
  if (!opts.skipMcp) {
    try {
      await migrate(opts.dryRun ? ['--dry-run'] : []);
      console.log(`✓ MCP server registered at ~/.claude/mcp.json (key: 'flo')`);
    } catch (err) {
      console.log(`× MCP registration failed: ${err.message}`);
    }
  } else {
    console.log(`- MCP registration skipped (--skip-mcp)`);
  }

  // 4. Health check
  console.log('');
  console.log('Running flo doctor:');
  console.log('');
  try {
    await doctor([]);
  } catch { /* doctor exits non-zero on any FAIL; that's informational */ }

  // 5. Print next steps
  console.log('');
  console.log('---');
  console.log('Next steps:');
  console.log('  flo guidance audit --out ~/Desktop/flo-audit.md   # find capability dupes');
  console.log('  flo inbox add ~/Downloads/inbox                   # register an inbox');
  console.log('  flo notes "First note with #flo #setup"           # quick capture');
  console.log('  flo tasks create "Try the web UI" --tags ui       # persistent task');
  console.log('  cd web && pnpm dev --port 3030                    # localhost dashboard');
  console.log('');
  console.log('Restart Claude Code to pick up the flo MCP server.');
}

function printHelp() {
  console.log(`flo setup — single-command onboarding

Usage:
  flo setup [--skip-mcp] [--dry-run]

Idempotent. Re-running is safe — creates anything missing, leaves the rest.
Steps:
  1. Create ~/.flo/{memory,messages,logs}/
  2. Initialize ~/.flo/{inboxes,terminals}.json
  3. Register flo as MCP server in ~/.claude/mcp.json
  4. Run health check
  5. Print next-step suggestions
`);
}

function parseArgs(args) {
  const out = {};
  for (const a of args) {
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--skip-mcp') out.skipMcp = true;
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}
