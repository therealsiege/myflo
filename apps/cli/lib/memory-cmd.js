import {
  storeEntry,
  searchEntries,
  listEntries,
  getEntry,
  deleteEntry,
  namespaceStats,
  listNamespaces,
} from './memory-store.js';

export async function memoryCommand(args) {
  const [sub = 'help', ...rest] = args;
  if (sub === 'help' || sub === '--help' || sub === '-h') return printHelp();
  if (sub === 'store') return storeCommand(rest);
  if (sub === 'search') return searchCommand(rest);
  if (sub === 'list') return listCommand(rest);
  if (sub === 'get') return getCommand(rest);
  if (sub === 'delete') return deleteCommand(rest);
  if (sub === 'namespaces' || sub === 'ns') return namespacesCommand(rest);
  console.error(`flo memory: unknown subcommand '${sub}'`);
  console.error(`Available: store, search, list, get, delete, namespaces, help`);
  process.exit(2);
}

function printHelp() {
  console.log(`flo memory — file-backed JSON store at ~/.flo/memory/

Usage:
  flo memory store --value <text> [--key <k>] [--namespace <ns>] [--tags a,b]
  flo memory search <query> [--namespace <ns>] [--tags a,b] [--limit N] [--json]
  flo memory list [--namespace <ns>] [--limit N] [--json]
  flo memory get [--id <id> | --key <key>] [--namespace <ns>]
  flo memory delete --id <id> [--namespace <ns>]
  flo memory namespaces [--json]

Storage: append-only JSONL per namespace. Deletes use tombstones (history preserved).
Search: substring + tag scoring. No vector embeddings yet.
`);
}

function parseFlags(args) {
  const out = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') out.json = true;
    else if (a === '--namespace' || a === '-n') out.namespace = args[++i];
    else if (a === '--key' || a === '-k') out.key = args[++i];
    else if (a === '--value' || a === '-v') out.value = args[++i];
    else if (a === '--id') out.id = args[++i];
    else if (a === '--tags') out.tags = (args[++i] || '').split(',').map((t) => t.trim()).filter(Boolean);
    else if (a === '--limit') out.limit = Number(args[++i]);
    else if (!a.startsWith('--')) out.positional.push(a);
  }
  return out;
}

async function storeCommand(args) {
  const opts = parseFlags(args);
  if (!opts.value && opts.positional.length === 0) {
    console.error(`flo memory store: missing --value (or positional text)`);
    process.exit(2);
  }
  const value = opts.value ?? opts.positional.join(' ');
  const entry = await storeEntry({
    namespace: opts.namespace,
    key: opts.key,
    value,
    tags: opts.tags,
  });
  if (opts.json) console.log(JSON.stringify(entry));
  else console.log(`flo memory store: ${entry.namespace}/${entry.id} (${value.length} chars)`);
}

async function searchCommand(args) {
  const opts = parseFlags(args);
  const query = opts.positional.join(' ');
  if (!query && (!opts.tags || !opts.tags.length)) {
    console.error(`flo memory search: missing query or --tags`);
    process.exit(2);
  }
  const results = await searchEntries({
    namespace: opts.namespace,
    query,
    tags: opts.tags || [],
    limit: opts.limit || 20,
  });
  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  if (!results.length) { console.log(`flo memory search: 0 results`); return; }
  for (const r of results) {
    const head = r.value.split('\n')[0].slice(0, 80);
    console.log(`[score=${r._score}] ${r.namespace}/${r.id} ${r.key ? `(${r.key})` : ''}`);
    console.log(`  ${head}${r.value.length > 80 ? '…' : ''}`);
    if (r.tags?.length) console.log(`  tags: ${r.tags.join(', ')}`);
  }
}

async function listCommand(args) {
  const opts = parseFlags(args);
  const entries = await listEntries({
    namespace: opts.namespace || 'default',
    limit: opts.limit || 50,
  });
  if (opts.json) { console.log(JSON.stringify(entries, null, 2)); return; }
  if (!entries.length) {
    console.log(`flo memory list: no entries in ${opts.namespace || 'default'}`);
    return;
  }
  for (const e of entries) {
    const head = e.value.split('\n')[0].slice(0, 80);
    console.log(`${e.id}  ${e.key ?? '—'}  ${head}${e.value.length > 80 ? '…' : ''}`);
  }
}

async function getCommand(args) {
  const opts = parseFlags(args);
  const e = await getEntry({ namespace: opts.namespace, id: opts.id, key: opts.key });
  if (!e) { console.error(`flo memory get: not found`); process.exit(1); }
  if (opts.json) console.log(JSON.stringify(e, null, 2));
  else console.log(e.value);
}

async function deleteCommand(args) {
  const opts = parseFlags(args);
  if (!opts.id) {
    console.error(`flo memory delete: missing --id`);
    process.exit(2);
  }
  await deleteEntry({ namespace: opts.namespace, id: opts.id });
  console.log(`flo memory delete: tombstoned ${opts.namespace || 'default'}/${opts.id}`);
}

async function namespacesCommand(args) {
  const opts = parseFlags(args);
  const stats = await namespaceStats();
  if (opts.json) { console.log(JSON.stringify(stats, null, 2)); return; }
  if (!stats.length) { console.log(`flo memory: no namespaces yet`); return; }
  console.log(`namespace                count   last entry`);
  console.log(`-----------------------  ------  --------------------`);
  for (const s of stats) {
    const ns = s.namespace.padEnd(23).slice(0, 23);
    const count = String(s.count).padStart(6);
    const last = s.lastEntryAt ? s.lastEntryAt.slice(0, 19).replace('T', ' ') : '—';
    console.log(`${ns}  ${count}  ${last}`);
  }
}
