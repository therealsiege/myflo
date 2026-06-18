// `flo activity` — cross-subsystem event timeline.
// Aggregates: task events, memory writes (all namespaces), inbox messages,
// transcripts, terminal session adds, Claude Code checkpoints.
// Returns chronologically-sorted events with type / source / snippet.

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { listInboxes } from './inbox-registry.js';
import { listAllMailboxes } from './messages.js';
import { collectTranscripts } from './transcripts.js';
import { readCheckpoints } from './sessions.js';

// terminal-attach is optional — only available once PR #31 lands.
let loadTerminalRegistry;
try {
  ({ loadRegistry: loadTerminalRegistry } = await import('./terminal-attach.js'));
} catch { /* not available; activity will skip terminal events */ }

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const MEMORY_DIR = join(FLO_HOME, 'memory');
const TASKS_PATH = join(FLO_HOME, 'tasks.jsonl');

const TYPES = ['task', 'note', 'memory', 'inbox', 'transcript', 'terminal', 'checkpoint'];

export async function activityCommand(args) {
  const [sub = 'list', ...rest] = args;
  if (sub === 'help' || sub === '--help' || sub === '-h') return printHelp();
  if (sub === 'list') return listCmd(rest);
  console.error(`flo activity: unknown subcommand '${sub}'`);
  console.error(`Available: list, help`);
  process.exit(2);
}

function printHelp() {
  console.log(`flo activity — cross-subsystem event timeline

Usage:
  flo activity list [--since <duration>] [--type <type>] [--limit N] [--json]

  --since 7d / 24h / 30m   Only events newer than this
  --type <t>               Filter by event type:
                             ${TYPES.join(', ')}
  --limit N                Cap results (default: 100)
  --json                   JSON output

Sources (each event has source + timestamp + snippet):
  task        ~/.flo/tasks.jsonl (created/updated/completed/deleted events)
  note        ~/.flo/memory/notes.jsonl (memory store with #note auto-tag)
  memory      every other ~/.flo/memory/<ns>.jsonl
  inbox       ~/.flo/messages/<recipient>/ mailbox files
  transcript  sidecar .txt files in registered inboxes' .processed/
  terminal    ~/.flo/terminals.json (creation timestamps)
  checkpoint  .claude/checkpoints/ (Claude Code session checkpoints)
`);
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--since') out.since = args[++i];
    else if (a === '--type') out.type = args[++i];
    else if (a === '--limit') out.limit = Number(args[++i]);
    else if (a === '--json') out.json = true;
  }
  return out;
}

function parseSince(s) {
  if (!s) return 0;
  const m = String(s).match(/^(\d+)\s*(s|m|h|d|w)?$/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = (m[2] || 'd').toLowerCase();
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[unit] || 86_400_000;
  return Date.now() - n * mult;
}

export async function collectActivity({ sinceMs = 0, type } = {}) {
  const events = [];
  const wantAll = !type;

  if (wantAll || type === 'task') {
    if (existsSync(TASKS_PATH)) {
      try {
        const raw = await readFile(TASKS_PATH, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
          if (!line.trim()) continue;
          let row;
          try { row = JSON.parse(line); } catch { continue; }
          const ts = Date.parse(row.ts || row.createdAt || 0);
          if (ts < sinceMs) continue;
          let snippet = row.subject || '';
          const op = row.op || (row.deleted ? 'delete' : 'create');
          events.push({
            type: 'task',
            kind: op,
            id: row.id,
            ts,
            timestamp: new Date(ts).toISOString(),
            snippet: snippet || (op === 'update' ? `status → ${row.status || '?'}` : ''),
            source: 'tasks.jsonl',
          });
        }
      } catch { /* skip */ }
    }
  }

  if ((wantAll || type === 'memory' || type === 'note') && existsSync(MEMORY_DIR)) {
    try {
      const files = await readdir(MEMORY_DIR);
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const ns = f.replace(/\.jsonl$/, '');
        const isNote = ns === 'notes';
        if (type === 'note' && !isNote) continue;
        if (type === 'memory' && isNote) continue;
        let raw = '';
        try { raw = await readFile(join(MEMORY_DIR, f), 'utf8'); } catch { continue; }
        for (const line of raw.split(/\r?\n/)) {
          if (!line.trim()) continue;
          let row;
          try { row = JSON.parse(line); } catch { continue; }
          if (row.deleted) continue;
          const ts = Date.parse(row.createdAt || 0);
          if (!ts || ts < sinceMs) continue;
          const snippet = (row.value || '').split('\n')[0].slice(0, 100);
          events.push({
            type: isNote ? 'note' : 'memory',
            kind: 'store',
            id: row.id,
            ts,
            timestamp: new Date(ts).toISOString(),
            snippet,
            source: `memory/${ns}`,
            namespace: ns,
            tags: row.tags || [],
          });
        }
      }
    } catch { /* skip */ }
  }

  if (wantAll || type === 'inbox') {
    try {
      const mailboxes = await listAllMailboxes();
      for (const mb of mailboxes) {
        for (const m of (mb.messages || [])) {
          if (m.mtime < sinceMs) continue;
          events.push({
            type: 'inbox',
            kind: 'message',
            id: m.path,
            ts: m.mtime,
            timestamp: new Date(m.mtime).toISOString(),
            snippet: `${mb.recipient} ← ${m.filename}`,
            source: `messages/${mb.recipient}`,
          });
        }
      }
    } catch { /* skip */ }
  }

  if (wantAll || type === 'transcript') {
    try {
      const ts_list = await collectTranscripts(500);
      for (const t of ts_list) {
        if (t.mtime < sinceMs) continue;
        events.push({
          type: 'transcript',
          kind: 'transcribe',
          id: t.sidecarPath,
          ts: t.mtime,
          timestamp: new Date(t.mtime).toISOString(),
          snippet: `${t.audioFilename} (${t.chars} chars): ${t.snippet.slice(0, 80)}`,
          source: `inbox/${t.inboxSlug}`,
        });
      }
    } catch { /* skip */ }
  }

  if (wantAll || type === 'terminal') {
    try {
      const reg = await loadTerminalRegistry();
      for (const t of reg.terminals || []) {
        const ts = Date.parse(t.createdAt || 0);
        if (!ts || ts < sinceMs) continue;
        events.push({
          type: 'terminal',
          kind: 'add',
          id: t.slug,
          ts,
          timestamp: new Date(ts).toISOString(),
          snippet: `${t.slug} (${t.app}) → ${t.cwd}`,
          source: 'terminals.json',
        });
      }
    } catch { /* skip */ }
  }

  if (wantAll || type === 'checkpoint') {
    try {
      const checkpoints = await readCheckpoints(undefined, 200);
      for (const c of checkpoints) {
        if (c.mtime < sinceMs) continue;
        events.push({
          type: 'checkpoint',
          kind: c.type || 'edit',
          id: c.id,
          ts: c.mtime,
          timestamp: c.timestamp || new Date(c.mtime).toISOString(),
          snippet: c.file || c.tag || '',
          source: '.claude/checkpoints',
        });
      }
    } catch { /* skip */ }
  }

  events.sort((a, b) => b.ts - a.ts);
  return events;
}

async function listCmd(args) {
  const opts = parseFlags(args);
  if (opts.type && !TYPES.includes(opts.type)) {
    console.error(`flo activity: unknown --type '${opts.type}'. Valid: ${TYPES.join(', ')}`);
    process.exit(2);
  }
  const sinceMs = parseSince(opts.since);
  let events = await collectActivity({ sinceMs, type: opts.type });
  events = events.slice(0, opts.limit || 100);
  if (opts.json) { console.log(JSON.stringify(events, null, 2)); return; }
  if (!events.length) { console.log(`flo activity: no events${opts.since ? ` since ${opts.since}` : ''}`); return; }
  for (const e of events) {
    const time = e.timestamp.replace('T', ' ').slice(0, 19);
    const type = e.type.padEnd(10).slice(0, 10);
    const kind = (e.kind || '').padEnd(9).slice(0, 9);
    console.log(`${time}  ${type} ${kind}  ${e.snippet}`);
  }
  console.log(`\n${events.length} event(s).`);
}
