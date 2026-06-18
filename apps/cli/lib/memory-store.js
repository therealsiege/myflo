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

export async function searchEntries({ namespace, query, tags = [], limit = 20 }) {
  const namespaces = namespace ? [namespace] : await listNamespaces();
  const q = String(query || '').toLowerCase().trim();
  const wantTags = new Set(tags.map((t) => String(t).toLowerCase()));
  const out = [];
  for (const ns of namespaces) {
    const entries = await readAllEntries(ns);
    for (const e of entries) {
      const haystack = `${e.key || ''} ${e.value}`.toLowerCase();
      const tagSet = new Set((e.tags || []).map((t) => String(t).toLowerCase()));
      const tagOverlap = [...wantTags].filter((t) => tagSet.has(t)).length;
      const tagBoost = tagOverlap > 0 ? 5 + tagOverlap : 0;
      let score = tagBoost;
      if (q) {
        let qScore = 0;
        if (e.key && e.key.toLowerCase().includes(q)) qScore += 3;
        if (haystack.includes(q)) qScore += 1 + Math.min(haystack.split(q).length - 1, 4);
        // term breakdown for multi-word queries
        const terms = q.split(/\s+/).filter(Boolean);
        if (terms.length > 1) {
          const matched = terms.filter((t) => haystack.includes(t)).length;
          qScore += matched;
        }
        if (qScore === 0 && tagOverlap === 0) continue;
        score += qScore;
      } else if (tagOverlap === 0) {
        continue;
      }
      out.push({ ...e, _score: score });
    }
  }
  out.sort((a, b) => b._score - a._score);
  return out.slice(0, limit);
}

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
