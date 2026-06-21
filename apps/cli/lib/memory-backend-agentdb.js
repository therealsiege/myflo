// AgentDB-backed memory adapter. Wraps @fuzeelogik/myflo-memory's UnifiedMemoryService
// + SqlJsBackend to expose the same API as memory-store.js's JSONL backend:
//   storeEntry, searchEntries, listEntries, getEntry, deleteEntry,
//   listNamespaces, namespaceStats
//
// Backend: SqlJsBackend (pure WASM SQLite, no native deps — works on any
// Node 20+ runtime). Vector search is degraded gracefully when no embedding
// generator is configured (returns FTS5 / keyword results only).

import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const DB_PATH = join(FLO_HOME, 'agentdb.sqlite');

let _backend = null;

async function locateSqlJsWasm() {
  // sql.js ships its WASM as a file. By default it tries to fetch from
  // sql.js.org which fails offline. Point it at the bundled file.
  // sql.js is a transitive dep of @fuzeelogik/myflo-memory, so we resolve via that
  // package's location (createRequire from the memory module URL).
  const { createRequire } = await import('node:module');
  try {
    // Resolve @fuzeelogik/myflo-memory's package.json to find its location
    const memoryPkgUrl = import.meta.resolve('@fuzeelogik/myflo-memory/package.json');
    const req = createRequire(memoryPkgUrl);
    const sqlJsMain = req.resolve('sql.js');
    return sqlJsMain.replace(/sql-wasm\.js$/, 'sql-wasm.wasm');
  } catch {
    return null;
  }
}

async function getBackend() {
  if (_backend) return _backend;
  if (!existsSync(FLO_HOME)) await mkdir(FLO_HOME, { recursive: true });
  // Dynamic import keeps the heavy module out of the load path for the JSONL
  // codepath. @fuzeelogik/myflo-memory is an optionalDependency — npm installs
  // it by default but doesn't fail the install if e.g. better-sqlite3 native
  // compile fails. If it's missing entirely, fall back gracefully.
  let SqlJsBackend;
  try {
    ({ SqlJsBackend } = await import('@fuzeelogik/myflo-memory'));
  } catch (err) {
    throw new Error(
      `agentdb backend requires @fuzeelogik/myflo-memory to be installed. ` +
      `Install it: npm install @fuzeelogik/myflo-memory. ` +
      `Or stick with the default jsonl backend (unset FLO_MEMORY_BACKEND). ` +
      `Underlying error: ${err.message}`
    );
  }
  const wasmPath = await locateSqlJsWasm();
  // autoPersistInterval: 0 disables the setInterval that holds the Node event
  // loop open. We persist explicitly after each write so a one-shot CLI invocation
  // can exit cleanly.
  _backend = new SqlJsBackend({ databasePath: DB_PATH, wasmPath, autoPersistInterval: 0 });
  await _backend.initialize();
  return _backend;
}

function sanitizeNs(ns) {
  return String(ns || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function newId() {
  return `${Date.now()}-${randomBytes(3).toString('hex')}`;
}

// Map flo-shape entry to @fuzeelogik/myflo-memory MemoryEntry. SqlJsBackend binds every
// field via positional ?-params, so undefined is fatal — we provide every
// expected field with a sensible default.
function toBackendEntry({ namespace = 'default', key, value, tags = [], metadata = {} }) {
  const id = newId();
  const ns = sanitizeNs(namespace);
  const now = Date.now();
  return {
    id,
    key: key || id,
    content: String(value ?? ''),
    type: 'semantic',
    namespace: ns,
    tags: Array.isArray(tags) ? tags.map(String) : [],
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    ownerId: null,
    accessLevel: 'private',
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    version: 1,
    references: [],
    accessCount: 0,
    lastAccessedAt: now,
  };
}

// Map backend MemoryEntry to the shape callers expect
function fromBackendEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    namespace: entry.namespace,
    key: entry.key && entry.key !== entry.id ? entry.key : null,
    value: entry.content || '',
    tags: entry.tags || [],
    metadata: entry.metadata || {},
    createdAt: entry.createdAt
      ? new Date(typeof entry.createdAt === 'number' ? entry.createdAt : Date.parse(entry.createdAt)).toISOString()
      : new Date().toISOString(),
    deleted: false,
  };
}

// Public API mirrors memory-store.js (JSONL backend)

export async function storeEntry(input) {
  const backend = await getBackend();
  const entry = toBackendEntry(input);
  await backend.store(entry);
  await backend.persist();
  return fromBackendEntry(entry);
}

export async function deleteEntry({ id }) {
  if (!id) return;
  const backend = await getBackend();
  await backend.delete(id);
  await backend.persist();
}

export async function getEntry({ namespace = 'default', id, key }) {
  const backend = await getBackend();
  if (id) {
    const entry = await backend.get(id);
    return fromBackendEntry(entry);
  }
  if (key) {
    const entry = await backend.getByKey(sanitizeNs(namespace), key);
    return fromBackendEntry(entry);
  }
  return null;
}

export async function listEntries({ namespace = 'default', limit = 50 } = {}) {
  const backend = await getBackend();
  const entries = await backend.query({
    namespace: sanitizeNs(namespace),
    limit,
  });
  return entries
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit)
    .map(fromBackendEntry);
}

export async function searchEntries({ namespace, query = '', tags = [], limit = 20 }) {
  const backend = await getBackend();
  const ns = namespace ? sanitizeNs(namespace) : undefined;
  const wantTags = new Set(tags.map((t) => String(t).toLowerCase()));

  // Use FTS5 keyword search when a query string is provided (real BM25 ranking
  // from SQLite). Without a query, fall back to a namespace scan + tag filter.
  let candidates = [];
  if (query) {
    try {
      // SqlJsBackend.searchKeyword returns SearchResult[] (entry + score)
      const searchResults = await backend.searchKeyword(query, Math.max(limit * 3, 50));
      candidates = searchResults
        .map((r) => ({ entry: r.entry || r, score: r.score ?? 1 }))
        .filter(({ entry }) => !ns || entry.namespace === ns);
    } catch {
      // FTS5 not available in this sql.js build — fall through to scan
    }
  }

  if (candidates.length === 0) {
    const scan = await backend.query({ namespace: ns, limit: 1000 });
    const q = String(query || '').toLowerCase();
    candidates = scan
      .map((entry) => {
        const tagSet = new Set((entry.tags || []).map((t) => String(t).toLowerCase()));
        const tagOverlap = [...wantTags].filter((t) => tagSet.has(t)).length;
        const haystack = `${entry.key || ''} ${entry.content || ''}`.toLowerCase();
        let score = tagOverlap * 2;
        if (q && haystack.includes(q)) score += 1 + Math.min(haystack.split(q).length - 1, 4);
        if (q) {
          const terms = q.split(/\s+/).filter(Boolean);
          if (terms.length > 1) {
            const matched = terms.filter((t) => haystack.includes(t)).length;
            score += matched;
          }
        }
        if (score <= 0 && !wantTags.size) return null;
        if (wantTags.size && tagOverlap === 0 && !q) return null;
        return { entry, score };
      })
      .filter(Boolean);
  }

  // Apply tag boost (post-FTS) and re-sort
  for (const c of candidates) {
    const tagSet = new Set((c.entry.tags || []).map((t) => String(t).toLowerCase()));
    const tagOverlap = [...wantTags].filter((t) => tagSet.has(t)).length;
    if (tagOverlap > 0) c.score += 2 + tagOverlap * 0.5;
  }
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry, score }) => ({ ...fromBackendEntry(entry), _score: Number(score.toFixed(4)) }));
}

export async function listNamespaces() {
  const backend = await getBackend();
  return await backend.listNamespaces();
}

export async function namespaceStats() {
  const backend = await getBackend();
  const namespaces = await backend.listNamespaces();
  const out = [];
  for (const ns of namespaces) {
    const count = await backend.count(ns);
    // Fetch most recent entry in this namespace for lastEntryAt
    const latest = await backend.query({ namespace: ns, limit: 1 });
    const lastTs = latest[0]?.createdAt || null;
    out.push({
      namespace: ns,
      count,
      lastEntryAt: lastTs ? new Date(lastTs).toISOString() : null,
    });
  }
  out.sort((a, b) => (a.lastEntryAt && b.lastEntryAt ? (a.lastEntryAt < b.lastEntryAt ? 1 : -1) : 0));
  return out;
}

export const _internal = { FLO_HOME, DB_PATH, getBackend };
