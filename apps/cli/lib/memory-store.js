// File-backed JSON memory store at ~/.flo/memory/<namespace>.jsonl
// Append-only. Tombstones for deletes. No vector search yet — substring + tag scoring.
// Keeps flo standalone; doesn't depend on ruflo's AgentDB.

import { mkdir, readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const MEMORY_DIR = join(FLO_HOME, 'memory');

function nsPath(ns) {
  return join(MEMORY_DIR, `${sanitizeNs(ns)}.jsonl`);
}

function sanitizeNs(ns) {
  return String(ns || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

async function ensureDir() {
  if (!existsSync(MEMORY_DIR)) await mkdir(MEMORY_DIR, { recursive: true });
}

function newId() {
  return `${Date.now()}-${randomBytes(3).toString('hex')}`;
}

export async function storeEntry({ namespace = 'default', key, value, tags = [], metadata = {} }) {
  await ensureDir();
  const entry = {
    id: newId(),
    namespace: sanitizeNs(namespace),
    key: key ?? null,
    value: String(value ?? ''),
    tags: Array.isArray(tags) ? tags.map(String) : [],
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    createdAt: new Date().toISOString(),
    deleted: false,
  };
  await appendFile(nsPath(entry.namespace), JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

export async function deleteEntry({ namespace = 'default', id }) {
  await ensureDir();
  const tomb = { id, namespace: sanitizeNs(namespace), deleted: true, deletedAt: new Date().toISOString() };
  await appendFile(nsPath(tomb.namespace), JSON.stringify(tomb) + '\n', 'utf8');
}

async function readAllEntries(namespace) {
  const ns = sanitizeNs(namespace);
  const file = nsPath(ns);
  if (!existsSync(file)) return [];
  let raw = '';
  try { raw = await readFile(file, 'utf8'); } catch { return []; }
  const live = new Map();
  const tombstones = new Set();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.deleted) {
      tombstones.add(row.id);
      live.delete(row.id);
    } else if (!tombstones.has(row.id)) {
      live.set(row.id, row);
    }
  }
  return [...live.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listEntries({ namespace = 'default', limit = 50 } = {}) {
  const entries = await readAllEntries(namespace);
  return entries.slice(0, limit);
}

export async function getEntry({ namespace = 'default', id, key }) {
  const entries = await readAllEntries(namespace);
  if (id) return entries.find((e) => e.id === id) || null;
  if (key) return entries.find((e) => e.key === key) || null;
  return null;
}

// BM25 parameters. Reasonable defaults for short prose entries.
const BM25_K1 = 1.5;
const BM25_B = 0.75;

// Stopwords pruned aggressively — flo memory entries are short, every
// non-stopword carries signal. Plurals normalized with a simple suffix rule.
const STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','to','of','in','on','at','for','and','or','but',
  'with','from','by','as','it','its','this','that','these','those','i','you','we','they','he','she','him',
  'her','them','us','our','your','my','their','if','then','else','so','not','no','do','does','did','have',
  'has','had','will','would','can','could','should','may','might','must','shall','about','into','out','up','down',
]);

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t && t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

function stem(word) {
  // Tiny rule-based stemmer: drop common English suffixes. Cheap, no Porter
  // library needed for the cardinality flo deals with.
  if (word.length <= 3) return word;
  for (const suffix of ['ization', 'ational', 'tional', 'iveness', 'fulness', 'ousness']) {
    if (word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  for (const suffix of ['ization', 'ization', 'ations', 'ations']) {
    if (word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  for (const suffix of ['ing', 'ies', 'ied', 'ies', 'ies', 'ous', 'ive']) {
    if (word.endsWith(suffix) && word.length > suffix.length + 2) return word.slice(0, -suffix.length);
  }
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

function buildCorpusStats(entries) {
  // entries: pre-tokenized [{ id, tokens, tagTokens }]
  const docFreq = new Map();
  let totalLen = 0;
  for (const e of entries) {
    const unique = new Set(e.tokens);
    for (const t of unique) docFreq.set(t, (docFreq.get(t) || 0) + 1);
    totalLen += e.tokens.length;
  }
  const N = entries.length;
  const avgdl = N > 0 ? totalLen / N : 0;
  return { docFreq, N, avgdl };
}

function bm25Score(queryTokens, doc, stats) {
  if (!queryTokens.length || stats.N === 0) return 0;
  let score = 0;
  // Term frequency table for this doc
  const tf = new Map();
  for (const t of doc.tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const dl = doc.tokens.length || 1;
  for (const q of queryTokens) {
    const f = tf.get(q);
    if (!f) continue;
    const df = stats.docFreq.get(q) || 0;
    // BM25+ idf: log((N - df + 0.5) / (df + 0.5) + 1) — strictly positive
    const idf = Math.log((stats.N - df + 0.5) / (df + 0.5) + 1);
    const norm = 1 - BM25_B + BM25_B * (dl / (stats.avgdl || 1));
    const termScore = idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * norm));
    score += termScore;
  }
  return score;
}

export async function searchEntries({ namespace, query, tags = [], limit = 20 }) {
  const namespaces = namespace ? [namespace] : await listNamespaces();
  const queryTokens = tokenize(query);
  const wantTags = new Set(tags.map((t) => String(t).toLowerCase()));
  const out = [];

  for (const ns of namespaces) {
    const raw = await readAllEntries(ns);
    // Pre-tokenize every entry for IDF stats
    const docs = raw.map((e) => ({
      entry: e,
      tokens: tokenize(`${e.key || ''} ${e.value}`),
      tagSet: new Set((e.tags || []).map((t) => String(t).toLowerCase())),
    }));
    const stats = buildCorpusStats(docs);

    for (const doc of docs) {
      const tagOverlap = [...wantTags].filter((t) => doc.tagSet.has(t)).length;
      const tagBoost = tagOverlap > 0 ? 2 + tagOverlap * 0.5 : 0;
      const textScore = bm25Score(queryTokens, doc, stats);
      // Optional small key boost — exact key match is highly intentional
      const keyBoost = doc.entry.key && query && doc.entry.key.toLowerCase().includes(String(query).toLowerCase()) ? 1.5 : 0;
      const score = textScore + tagBoost + keyBoost;
      if (score <= 0) continue;
      out.push({ ...doc.entry, _score: Number(score.toFixed(4)) });
    }
  }
  out.sort((a, b) => b._score - a._score);
  return out.slice(0, limit);
}

// Exported for direct testing
export const _searchInternals = { tokenize, stem, buildCorpusStats, bm25Score };

export async function listNamespaces() {
  await ensureDir();
  const entries = await readdir(MEMORY_DIR);
  return entries
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace(/\.jsonl$/, ''));
}

export async function namespaceStats() {
  const names = await listNamespaces();
  const out = [];
  for (const ns of names) {
    const entries = await readAllEntries(ns);
    out.push({
      namespace: ns,
      count: entries.length,
      lastEntryAt: entries[0]?.createdAt || null,
    });
  }
  out.sort((a, b) => (a.lastEntryAt && b.lastEntryAt ? (a.lastEntryAt < b.lastEntryAt ? 1 : -1) : 0));
  return out;
}

export const _internal = { FLO_HOME, MEMORY_DIR, sanitizeNs };
