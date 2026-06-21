// Daemon state — read/write ~/.flo/daemon/state.json with safe defaults.
//
// Tracks which workers are enabled, their schedule (duration string like "1h"),
// last-run timestamp + result, and the daemon's own pid/start time. The
// scheduler reads this file every tick to decide what to run.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
export const DAEMON_DIR = join(FLO_HOME, 'daemon');
export const STATE_PATH = join(DAEMON_DIR, 'state.json');
export const PID_PATH = join(DAEMON_DIR, 'daemon.pid');
export const LOG_PATH = join(DAEMON_DIR, 'daemon.log');

const DEFAULT_STATE = {
  version: 1,
  daemon: { pid: null, startedAt: null },
  workers: {
    // Real workers
    audit:       { enabled: true,  schedule: '1h',  lastRun: null, lastResult: null },
    document:    { enabled: true,  schedule: '2h',  lastRun: null, lastResult: null },
    testgaps:    { enabled: true,  schedule: '4h',  lastRun: null, lastResult: null },
    // Stub workers — interface exists, body returns "not implemented"
    optimize:    { enabled: false, schedule: '30m', lastRun: null, lastResult: null },
    deepdive:    { enabled: false, schedule: '4h',  lastRun: null, lastResult: null },
    refactor:    { enabled: false, schedule: '6h',  lastRun: null, lastResult: null },
    benchmark:   { enabled: false, schedule: '24h', lastRun: null, lastResult: null },
    ultralearn:  { enabled: false, schedule: '1h',  lastRun: null, lastResult: null },
    predict:     { enabled: false, schedule: '1h',  lastRun: null, lastResult: null },
    consolidate: { enabled: false, schedule: '2h',  lastRun: null, lastResult: null },
    map:         { enabled: false, schedule: '1h',  lastRun: null, lastResult: null },
  },
};

export async function ensureDir() {
  if (!existsSync(DAEMON_DIR)) await mkdir(DAEMON_DIR, { recursive: true });
}

export async function readState() {
  await ensureDir();
  if (!existsSync(STATE_PATH)) return structuredClone(DEFAULT_STATE);
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Merge defaults so we pick up new workers added in newer versions
    const merged = { ...DEFAULT_STATE, ...parsed };
    merged.workers = { ...DEFAULT_STATE.workers, ...(parsed.workers || {}) };
    for (const k of Object.keys(merged.workers)) {
      merged.workers[k] = { ...DEFAULT_STATE.workers[k], ...merged.workers[k] };
    }
    return merged;
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export async function writeState(state) {
  await ensureDir();
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// Mutate via callback then persist
export async function updateState(mutator) {
  const state = await readState();
  await mutator(state);
  await writeState(state);
  return state;
}

// Parse a schedule like "30s", "5m", "2h", "1d" → milliseconds.
export function parseSchedule(s) {
  const m = String(s || '').trim().match(/^(\d+)\s*([smhd])$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return n * mult;
}
