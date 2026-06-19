// flo agents store — append-only registry of named agents at ~/.flo/agents.jsonl.
// Does NOT spawn processes — Claude Code's Task tool does the actual execution.
// This is a coordination record: agents declare themselves, others discover them,
// heartbeats track liveness.

import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const AGENTS_PATH = join(FLO_HOME, 'agents.jsonl');

const HEALTH_STALE_MS = 5 * 60_000; // an agent without a heartbeat for 5min counts as 'stale'

export const STATUSES = ['idle', 'busy', 'completed', 'failed', 'stopped'];

async function ensureHome() {
  if (!existsSync(FLO_HOME)) await mkdir(FLO_HOME, { recursive: true });
}

function newId() {
  return `a-${Date.now()}-${randomBytes(2).toString('hex')}`;
}

async function appendEvent(event) {
  await ensureHome();
  await appendFile(AGENTS_PATH, JSON.stringify(event) + '\n', 'utf8');
}

async function readEvents() {
  if (!existsSync(AGENTS_PATH)) return [];
  let raw = '';
  try { raw = await readFile(AGENTS_PATH, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return out;
}

export async function spawnAgent({ type, name, role, tags, parent, metadata }) {
  if (!type) throw new Error('spawnAgent: type is required');
  const id = newId();
  const now = new Date().toISOString();
  const event = {
    id,
    op: 'spawn',
    ts: now,
    type: String(type),
    name: name || id,
    role: role || null,
    tags: Array.isArray(tags) ? tags.map(String) : [],
    parent: parent || null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    status: 'idle',
    spawnedAt: now,
    lastHeartbeat: now,
  };
  await appendEvent(event);
  return materializeOne([event]);
}

export async function updateAgent({ id, ...patch }) {
  if (!id) throw new Error('updateAgent: id is required');
  const ts = new Date().toISOString();
  const event = { id, op: 'update', ts, ...patch, lastHeartbeat: patch.lastHeartbeat || ts };
  await appendEvent(event);
  const all = await listAgents();
  return all.find((a) => a.id === id) || null;
}

export async function heartbeat(id) {
  return updateAgent({ id, lastHeartbeat: new Date().toISOString() });
}

export async function stopAgent(id) {
  return updateAgent({ id, status: 'stopped', stoppedAt: new Date().toISOString() });
}

export async function deleteAgent(id) {
  if (!id) throw new Error('deleteAgent: id is required');
  await appendEvent({ id, op: 'delete', ts: new Date().toISOString() });
}

function materializeOne(events) {
  const map = new Map();
  for (const e of events) {
    if (e.op === 'delete') {
      map.delete(e.id);
      continue;
    }
    if (e.op === 'spawn') {
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

export async function listAgents({ status, type, includeStopped = true } = {}) {
  const events = await readEvents();
  const map = new Map();
  for (const e of events) {
    if (e.op === 'delete') { map.delete(e.id); continue; }
    if (e.op === 'spawn') {
      const { op, ts, ...record } = e;
      map.set(e.id, record);
    } else if (e.op === 'update') {
      const existing = map.get(e.id);
      if (!existing) continue;
      const { op, ts, ...patch } = e;
      map.set(e.id, { ...existing, ...patch });
    }
  }
  let agents = [...map.values()];
  if (!includeStopped) agents = agents.filter((a) => a.status !== 'stopped');
  if (status) agents = agents.filter((a) => a.status === status);
  if (type) agents = agents.filter((a) => a.type === type);
  return agents.sort((a, b) => (a.spawnedAt < b.spawnedAt ? 1 : -1));
}

export async function getAgent(id) {
  const all = await listAgents();
  return all.find((a) => a.id === id) || null;
}

export async function agentHealth() {
  const agents = await listAgents({ includeStopped: false });
  const now = Date.now();
  return agents.map((a) => {
    const lastHb = a.lastHeartbeat ? Date.parse(a.lastHeartbeat) : 0;
    const ageMs = now - lastHb;
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      status: a.status,
      lastHeartbeat: a.lastHeartbeat,
      heartbeatAgeMs: ageMs,
      health: ageMs < HEALTH_STALE_MS ? 'healthy' : 'stale',
    };
  });
}

export const _internal = { AGENTS_PATH, HEALTH_STALE_MS };
