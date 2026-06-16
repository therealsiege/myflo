import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export async function migrate(args) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(`flo migrate — register flo in ~/.claude/mcp.json

Adds (or updates) an mcpServers.flo entry pointing at the flo CLI mcp endpoint.
Leaves any existing ruflo/claude-flow entries intact — flo coexists, it does
not overwrite. Idempotent. Backs up first.

Usage:
  flo migrate [--mcp-path <path>] [--dry-run]

Options:
  --mcp-path <path>   Override default ~/.claude/mcp.json location.
  --dry-run           Print the diff without writing.
  -h, --help          Show this help.
`);
    return;
  }

  const mcpPath = parsed.mcpPath || join(homedir(), '.claude', 'mcp.json');
  let existing = { mcpServers: {} };
  let raw = '';
  if (existsSync(mcpPath)) {
    raw = await readFile(mcpPath, 'utf8');
    try { existing = JSON.parse(raw); } catch (e) {
      throw new Error(`failed to parse ${mcpPath}: ${e.message}`);
    }
    if (!existing.mcpServers) existing.mcpServers = {};
  } else {
    process.stderr.write(`flo migrate: no existing config at ${mcpPath}, creating fresh\n`);
  }

  const desired = {
    command: 'node',
    args: [resolveFloBinPath(), 'mcp', 'start'],
    env: { FLO_MCP: '1' },
  };

  const before = JSON.stringify(existing.mcpServers.flo || null);
  existing.mcpServers.flo = desired;
  const after = JSON.stringify(existing.mcpServers.flo);

  if (before === after) {
    console.log(`flo migrate: already up to date (${mcpPath})`);
    return;
  }

  const next = JSON.stringify(existing, null, 2) + '\n';

  if (parsed.dryRun) {
    console.log(`# flo migrate (DRY RUN)`);
    console.log(`# would write to: ${mcpPath}`);
    console.log(next);
    return;
  }

  await mkdir(join(homedir(), '.claude'), { recursive: true });
  if (raw) {
    const backup = `${mcpPath}.flo-bak.${Date.now()}`;
    await copyFile(mcpPath, backup);
    process.stderr.write(`flo migrate: backed up to ${backup}\n`);
  }
  await writeFile(mcpPath, next, 'utf8');
  console.log(`flo migrate: registered 'flo' MCP server at ${mcpPath}`);
}

function parseArgs(args) {
  const out = { help: false, dryRun: false, mcpPath: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--mcp-path') out.mcpPath = args[++i];
  }
  return out;
}

function resolveFloBinPath() {
  const fromEnv = process.env.FLO_BIN;
  if (fromEnv) return fromEnv;
  return new URL('../bin/flo.js', import.meta.url).pathname;
}
