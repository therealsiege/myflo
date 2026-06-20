// `flo hook <event>` — Claude Code hook dispatcher.
// Replaces .claude/helpers/hook-handler.cjs (and friends) with a single
// canonical entrypoint. Each event takes whatever env vars Claude Code
// supplies, does the corresponding flo work (memory store, task event,
// activity log), and exits 0. Hooks are best-effort and never fail loudly
// — a hook crashing should not break the user's Claude Code session.

import { appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { storeEntry } from './memory-store.js';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const HOOK_LOG = join(FLO_HOME, 'logs', 'hooks.jsonl');

const EVENTS = [
  'pre-task', 'post-task', 'pre-edit', 'post-edit',
  'pre-command', 'post-command', 'pre-bash', 'post-bash',
  'session-start', 'session-end', 'session-restore',
  'route', 'notify', 'pretrain', 'compact-manual', 'compact-auto',
  'subagent-stop', 'stop',
];

export async function hookCommand(args) {
  const [event = 'help', ...rest] = args;
  if (event === 'help' || event === '--help' || event === '-h' || event === 'list') {
    return printHelp();
  }
  // Hooks should NEVER fail the Claude Code session — wrap everything.
  try {
    await ensureLogDir();
    await logEvent(event, rest);
    if (event === 'post-task' || event === 'post-edit') {
      await maybeRecordOutcome(event, rest);
    }
    if (event === 'route') {
      // Print empty string — Claude Code's hook protocol expects stdout to be
      // injected as user-facing context. Routing recommendations go to memory
      // instead; the agent can call flo_memory_search if it wants them.
      process.stdout.write('');
    }
    process.exit(0);
  } catch (err) {
    // Best-effort: log to stderr but exit 0 so we don't block Claude Code
    process.stderr.write(`flo hook ${event}: ${err.message || err}\n`);
    process.exit(0);
  }
}

function printHelp() {
  console.log(`flo hook — Claude Code hook dispatcher

Usage:
  flo hook <event> [args...]

Events:
  ${EVENTS.join(', ')}

All events append a record to ~/.flo/logs/hooks.jsonl. Some events also write
to flo memory (post-task / post-edit outcomes). Hooks are best-effort —
a crash never fails the Claude Code session.

Wire up by adding to .claude/settings.json hooks:
  {
    "hooks": {
      "PreToolUse": [{
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "node \${CLAUDE_PROJECT_DIR}/apps/cli/bin/flo.js hook pre-bash",
          "timeout": 5000
        }]
      }]
    }
  }
`);
}

async function ensureLogDir() {
  const dir = join(FLO_HOME, 'logs');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function logEvent(event, args) {
  const record = {
    event,
    ts: new Date().toISOString(),
    args,
    env: collectEnv(),
    pid: process.pid,
  };
  await appendFile(HOOK_LOG, JSON.stringify(record) + '\n', 'utf8');
}

// Pull the env vars Claude Code typically provides; ignore the rest
function collectEnv() {
  const wanted = [
    'CLAUDE_PROJECT_DIR', 'CLAUDE_TOOL_NAME', 'CLAUDE_HOOK_EVENT',
    'CLAUDE_SESSION_ID', 'CLAUDE_FILE_PATHS', 'CLAUDE_COMMAND',
    'CLAUDE_NOTIFICATION', 'CLAUDE_MESSAGE',
  ];
  const out = {};
  for (const k of wanted) if (process.env[k]) out[k] = process.env[k];
  return out;
}

// If Claude Code provides task / edit context via env, mirror into memory so
// flo's activity feed picks it up. Otherwise it's a quiet no-op.
async function maybeRecordOutcome(event, args) {
  const env = collectEnv();
  const tool = env.CLAUDE_TOOL_NAME;
  const files = env.CLAUDE_FILE_PATHS;
  if (!tool && !files && !args.length) return;
  const summary = [tool, files, args.join(' ')].filter(Boolean).join(' / ').slice(0, 200);
  try {
    await storeEntry({
      namespace: 'hooks',
      key: `${event}:${Date.now()}`,
      value: summary || event,
      tags: [event, tool || 'unknown'].filter(Boolean),
      metadata: { ...env, event, args },
    });
  } catch {
    // jsonl store fails silently; that's fine
  }
}

export const _internal = { HOOK_LOG, EVENTS };
