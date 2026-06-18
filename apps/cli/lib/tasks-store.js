// flo tasks — persistent task tracker.
// Append-only event log at ~/.flo/tasks.jsonl. Each line is one event:
//   { id, op: 'create' | 'update' | 'delete', ts, ...patch }
// listTasks() folds events into current state. Survives session boundaries.

import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const TASKS_PATH = join(FLO_HOME, 'tasks.jsonl');

export const STATUSES = ['pending', 'in_progress', 'completed'];

async function ensureHome() {
  if (!existsSync(FLO_HOME)) await mkdir(FLO_HOME, { recursive: true });
}

function newId() {
  return `t-${Date.now()}-${randomBytes(2).toString('hex')}`;
}

async function appendEvent(event) {
  await ensureHome();
  await appendFile(TASKS_PATH, JSON.stringify(event) + '\n', 'utf8');
}

async function readEvents() {
  if (!existsSync(TASKS_PATH)) return [];
  let raw = '';
  try { raw = await readFile(TASKS_PATH, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return out;
}

export async function createTask({ subject, description, tags, owner, parent, status }) {
  if (!subject || !subject.trim()) throw new Error('createTask: subject is required');
  const id = newId();
  const now = new Date().toISOString();
  const event = {
    id,
    op: 'create',
    ts: now,
    subject: subject.trim(),
    description: description || null,
    tags: Array.isArray(tags) ? tags.map(String) : [],
    owner: owner || null,
    parent: parent || null,
    status: STATUSES.includes(status) ? status : 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await appendEvent(event);
  return materializeOne([event]);
}

export async function updateTask({ id, ...patch }) {
  if (!id) throw new Error('updateTask: id is required');
  if (patch.status && !STATUSES.includes(patch.status)) {
    throw new Error(`updateTask: invalid status '${patch.status}'. Valid: ${STATUSES.join(', ')}`);
  }
  const ts = new Date().toISOString();
  const event = { id, op: 'update', ts, ...patch, updatedAt: ts };
  await appendEvent(event);
  // Read full state to return updated record
  const tasks = await listAllTasks({ includeDeleted: false });
  return tasks.find((t) => t.id === id) || null;
}

export async function completeTask(id) {
  return updateTask({ id, status: 'completed', completedAt: new Date().toISOString() });
}

export async function deleteTask(id) {
  if (!id) throw new Error('deleteTask: id is required');
  await appendEvent({ id, op: 'delete', ts: new Date().toISOString() });
}

function materializeOne(events) {
  const map = new Map();
  for (const e of events) {
    if (e.op === 'delete') {
      map.delete(e.id);
      continue;
    }
    if (e.op === 'create') {
      const { op, ts, ...record } = e;
      map.set(e.id, record);
    } else if (e.op === 'update') {
      const existing = map.get(e.id);
      if (!existing) continue;
      const { op, ts, ...patch } = e;
      map.set(e.id, { ...existing, ...patch });
    }
  }
  return [...map.values()][0] || null;
}

export async function listAllTasks({ includeDeleted = false } = {}) {
  const events = await readEvents();
  const map = new Map();
  const tombstones = new Set();
  for (const e of events) {
    if (e.op === 'delete') {
      tombstones.add(e.id);
      if (!includeDeleted) map.delete(e.id);
      else if (map.has(e.id)) map.set(e.id, { ...map.get(e.id), _deleted: true });
      continue;
    }
    if (e.op === 'create') {
      const { op, ts, ...record } = e;
      map.set(e.id, record);
    } else if (e.op === 'update') {
      const existing = map.get(e.id);
      if (!existing) continue;
      const { op, ts, ...patch } = e;
      map.set(e.id, { ...existing, ...patch });
    }
  }
  return [...map.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function listTasks({ status, owner, tag, limit = 100 } = {}) {
  const all = await listAllTasks();
  return all
    .filter((t) => !status || t.status === status)
    .filter((t) => !owner || t.owner === owner)
    .filter((t) => !tag || (t.tags || []).includes(tag))
    .slice(0, limit);
}

export async function getTask(id) {
  const all = await listAllTasks();
  return all.find((t) => t.id === id) || null;
}

export async function taskCounts() {
  const all = await listAllTasks();
  const out = { total: all.length, pending: 0, in_progress: 0, completed: 0 };
  for (const t of all) {
    if (out[t.status] !== undefined) out[t.status]++;
  }
  return out;
}

export const _internal = { TASKS_PATH };
