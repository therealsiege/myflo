// `flo notes` — quick capture wrapper over memory store. Defaults to the
// `notes` namespace and auto-derives tags from #hashtags and trailing
// "tags: a,b,c" lines so notes stay searchable without ceremony.

import { storeEntry, listEntries, searchEntries } from './memory-store.js';

export async function notesCommand(args) {
  const [sub = 'help', ...rest] = args;
  if (sub === 'help' || sub === '--help' || sub === '-h') return printHelp();
  if (sub === 'list') return listCmd(rest);
  if (sub === 'search') return searchCmd(rest);
  // Default: treat all args as note text
  return addCmd(args);
}

function printHelp() {
  console.log(`flo notes — quick markdown capture wrapped over flo memory

Usage:
  flo notes <text>                  Capture a note in ~/.flo/memory/notes.jsonl
  flo notes "Body with #hashtag and trailing tags:"
  flo notes list [--limit N] [--json]
  flo notes search <query> [--limit N] [--json]

Auto-tagging:
  - Inline #hashtags are extracted as tags
  - Trailing 'tags: a, b, c' line is parsed and merged
  - Always tagged 'note'

Notes live in the 'notes' namespace; cross-namespace search via 'flo memory'.
`);
}

function parseFlags(args) {
  const out = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--limit') out.limit = Number(args[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--key') out.key = args[++i];
    else if (a === '--tags') out.extraTags = (args[++i] || '').split(',').map(t => t.trim()).filter(Boolean);
    else if (!a.startsWith('--')) out.positional.push(a);
  }
  return out;
}

function deriveTags(text) {
  const tags = new Set(['note']);
  // #hashtags
  for (const m of text.matchAll(/#([a-zA-Z0-9_-]+)/g)) {
    tags.add(m[1].toLowerCase());
  }
  // trailing "tags: a, b" line
  const trailing = text.match(/^tags:\s*(.+)$/im);
  if (trailing) {
    for (const t of trailing[1].split(',')) {
      const v = t.trim().replace(/^["']|["']$/g, '');
      if (v) tags.add(v.toLowerCase());
    }
  }
  return [...tags];
}

async function addCmd(args) {
  const opts = parseFlags(args);
  const text = opts.positional.join(' ').trim();
  if (!text) {
    console.error(`flo notes: missing <text>`);
    console.error(`Usage: flo notes "<text>"  (use 'flo notes help' for more)`);
    process.exit(2);
  }
  const tags = deriveTags(text);
  if (opts.extraTags) for (const t of opts.extraTags) if (!tags.includes(t)) tags.push(t);
  const entry = await storeEntry({
    namespace: 'notes',
    key: opts.key || null,
    value: text,
    tags,
    metadata: { capturedAt: new Date().toISOString() },
  });
  if (opts.json) console.log(JSON.stringify(entry));
  else console.log(`flo notes: ${entry.id} (${text.length} chars, tags: ${tags.join(', ')})`);
}

async function listCmd(args) {
  const opts = parseFlags(args);
  const entries = await listEntries({ namespace: 'notes', limit: opts.limit || 50 });
  if (opts.json) { console.log(JSON.stringify(entries, null, 2)); return; }
  if (!entries.length) { console.log(`flo notes: nothing yet`); return; }
  for (const e of entries) {
    const head = e.value.split('\n')[0].slice(0, 70);
    console.log(`${e.createdAt.slice(0, 19).replace('T', ' ')}  ${e.id}  ${head}${e.value.length > 70 ? '…' : ''}`);
  }
}

async function searchCmd(args) {
  const opts = parseFlags(args);
  const query = opts.positional.join(' ');
  if (!query) {
    console.error(`flo notes search: missing query`);
    process.exit(2);
  }
  const results = await searchEntries({ namespace: 'notes', query, limit: opts.limit || 20 });
  if (opts.json) { console.log(JSON.stringify(results, null, 2)); return; }
  if (!results.length) { console.log(`flo notes search: 0 results`); return; }
  for (const r of results) {
    const head = r.value.split('\n')[0].slice(0, 70);
    console.log(`[${r._score}] ${r.id}  ${head}${r.value.length > 70 ? '…' : ''}`);
  }
}
