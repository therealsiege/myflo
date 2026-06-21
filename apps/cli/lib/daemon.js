// flo daemon — long-running scheduler that fires background workers on
// configured intervals.
//
// Commands:
//   flo daemon start [--foreground|--fg]   Spawn the daemon (detached by default)
//   flo daemon stop                        Kill the running daemon
//   flo daemon status                      Show pid, uptime, enabled workers, last runs
//   flo daemon trigger <name>              Run a worker once on demand (no daemon needed)
//   flo daemon workers list                List all available workers
//   flo daemon workers enable <name>       Mark a worker enabled for scheduled runs
//   flo daemon workers disable <name>      Mark a worker disabled
//   flo daemon log [--tail N]              Tail the daemon log (default: 50 lines)
//
// Storage: ~/.flo/daemon/{state.json,daemon.pid,daemon.log}
// Persistence across reboots is not handled — use macOS launchd or Linux
// systemd to autostart `flo daemon start`. A future `flo daemon install`
// command would generate the unit/plist.

import { writeFile, readFile, appendFile, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  readState, writeState, updateState, parseSchedule,
  DAEMON_DIR, STATE_PATH, PID_PATH, LOG_PATH, ensureDir,
} from './daemon-state.js';
import { listWorkers, runWorker } from './daemon-workers/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FLO_BIN = join(__dirname, '..', 'bin', 'flo.js');

export async function daemonCommand(args) {
  const [sub = 'help', ...rest] = args;
  switch (sub) {
    case 'start':   return daemonStart(rest);
    case 'stop':    return daemonStop(rest);
    case 'status':  return daemonStatus(rest);
    case 'trigger': return daemonTrigger(rest);
    case 'workers': return daemonWorkers(rest);
    case 'log':     return daemonLog(rest);
    case 'tick':    return daemonTick(rest); // internal — used by --foreground loop
    case 'help':
    case '--help':
    case '-h':
      return daemonHelp();
    default:
      console.error(`flo daemon: unknown subcommand '${sub}'`);
      daemonHelp();
      process.exit(2);
  }
}

function daemonHelp() {
  console.log(`flo daemon — background worker scheduler

Usage:
  flo daemon start [--foreground|--fg] [--interval 30s]
  flo daemon stop
  flo daemon status [--json]
  flo daemon trigger <name>              Run a worker once on demand
  flo daemon workers list [--json]
  flo daemon workers enable <name>
  flo daemon workers disable <name>
  flo daemon log [--tail N]

Workers ship enabled by default: audit (1h), document (2h), testgaps (4h).
Stubs (disabled by default): optimize, deepdive, refactor, benchmark,
ultralearn, predict, consolidate, map.

Daemon state lives in ~/.flo/daemon/{state.json,daemon.pid,daemon.log}.
For autostart across reboots, wrap \`flo daemon start --foreground\` in
a launchd plist (macOS) or systemd unit (Linux).`);
}

async function daemonStart(args) {
  await ensureDir();
  const fg = args.includes('--foreground') || args.includes('--fg');
  const intervalIdx = args.indexOf('--interval');
  const interval = intervalIdx > -1 ? args[intervalIdx + 1] : '30s';
  const intervalMs = parseSchedule(interval) || 30_000;

  if (await isDaemonRunning()) {
    console.error('flo daemon: already running (see `flo daemon status` to inspect)');
    process.exit(1);
  }

  if (fg) {
    return runForeground(intervalMs);
  }
  // Detach: spawn a child with the same flo binary and --foreground, detached
  const child = spawn(process.execPath, [FLO_BIN, 'daemon', 'start', '--foreground', '--interval', interval], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  // Wait briefly for the child to write its pidfile
  await new Promise((r) => setTimeout(r, 250));
  if (await isDaemonRunning()) {
    const state = await readState();
    console.log(`✓ flo daemon started — pid ${state.daemon.pid}`);
    console.log(`  state:  ${STATE_PATH}`);
    console.log(`  log:    ${LOG_PATH}`);
    console.log(`  tick:   ${interval}`);
  } else {
    console.error('flo daemon: failed to start (check log)');
    process.exit(1);
  }
}

async function runForeground(intervalMs) {
  // Write pidfile
  await writeFile(PID_PATH, String(process.pid), 'utf8');
  await updateState((s) => {
    s.daemon.pid = process.pid;
    s.daemon.startedAt = new Date().toISOString();
  });
  await logLine(`daemon: started pid=${process.pid} interval=${intervalMs}ms`);

  let stopping = false;
  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    await logLine(`daemon: received ${sig}, shutting down`);
    try { await unlink(PID_PATH); } catch { /* ignore */ }
    await updateState((s) => { s.daemon.pid = null; });
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Main loop
  while (!stopping) {
    try { await tickOnce(); } catch (err) { await logLine(`tick error: ${err.message}`); }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function daemonTick() {
  // Single tick — invoked manually for testing
  await tickOnce();
}

async function tickOnce() {
  const state = await readState();
  const now = Date.now();
  for (const [name, w] of Object.entries(state.workers)) {
    if (!w.enabled) continue;
    const intervalMs = parseSchedule(w.schedule);
    if (!intervalMs) continue;
    const lastRun = w.lastRun ? new Date(w.lastRun).getTime() : 0;
    if (now - lastRun < intervalMs) continue;
    await dispatchWorker(name);
  }
}

async function dispatchWorker(name) {
  await logLine(`worker:${name} starting`);
  const start = Date.now();
  let result = null;
  let error = null;
  try {
    result = await runWorker(name, { projectDir: process.cwd() });
  } catch (err) {
    error = err.message;
  }
  const elapsed = Date.now() - start;
  await updateState((s) => {
    if (!s.workers[name]) return;
    s.workers[name].lastRun = new Date().toISOString();
    s.workers[name].lastResult = error
      ? { ok: false, error, elapsedMs: elapsed }
      : { ...result, elapsedMs: elapsed };
  });
  await logLine(`worker:${name} ${error ? `failed (${error})` : `ok — ${result?.summary || ''}`} (${elapsed}ms)`);
}

async function daemonStop() {
  if (!await isDaemonRunning()) {
    console.log('flo daemon: not running');
    return;
  }
  const pid = parseInt(await readFile(PID_PATH, 'utf8'), 10);
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`✓ sent SIGTERM to pid ${pid}`);
  } catch (err) {
    console.error(`flo daemon stop: ${err.message}`);
    process.exit(1);
  }
}

async function daemonStatus(args) {
  const json = args.includes('--json');
  const state = await readState();
  const running = await isDaemonRunning();
  if (json) {
    process.stdout.write(JSON.stringify({ running, ...state }, null, 2) + '\n');
    return;
  }
  if (!running) {
    console.log('flo daemon: not running');
  } else {
    const started = state.daemon.startedAt;
    const uptime = started ? humanDuration(Date.now() - new Date(started).getTime()) : '?';
    console.log(`flo daemon: running (pid ${state.daemon.pid}, uptime ${uptime})`);
  }
  console.log('');
  console.log('Workers:');
  const widths = { name: 12, sched: 6, run: 24 };
  for (const [name, w] of Object.entries(state.workers)) {
    const status = w.enabled ? 'on ' : 'off';
    const last = w.lastRun
      ? `${new Date(w.lastRun).toISOString().slice(0, 16).replace('T', ' ')}  ${w.lastResult?.ok ? 'ok' : 'fail'}`
      : 'never';
    console.log(`  ${status}  ${name.padEnd(widths.name)} ${(w.schedule || '?').padEnd(widths.sched)} ${last}`);
  }
}

async function daemonTrigger(args) {
  const name = args[0];
  if (!name) { console.error('flo daemon trigger: missing worker name'); process.exit(2); }
  await ensureDir();
  console.log(`flo daemon trigger ${name}: running once...`);
  await dispatchWorker(name);
  const state = await readState();
  const w = state.workers[name];
  if (!w) { console.error(`unknown worker: ${name}`); process.exit(1); }
  console.log(`Result: ${JSON.stringify(w.lastResult, null, 2)}`);
}

async function daemonWorkers(args) {
  const [sub = 'list', ...rest] = args;
  switch (sub) {
    case 'list':    return workersList(rest);
    case 'enable':  return workersToggle(rest[0], true);
    case 'disable': return workersToggle(rest[0], false);
    default:
      console.error(`flo daemon workers: unknown subcommand '${sub}'`);
      process.exit(2);
  }
}

async function workersList(args) {
  const json = args.includes('--json');
  const state = await readState();
  const meta = listWorkers();
  const merged = meta.map((m) => ({
    ...m,
    enabled: state.workers[m.name]?.enabled ?? false,
    schedule: state.workers[m.name]?.schedule || null,
    lastRun: state.workers[m.name]?.lastRun || null,
  }));
  if (json) { process.stdout.write(JSON.stringify(merged, null, 2) + '\n'); return; }
  for (const w of merged) {
    const tag = w.stub ? '(stub)' : '       ';
    const status = w.enabled ? 'on ' : 'off';
    console.log(`  ${status} ${tag}  ${w.name.padEnd(12)} ${(w.schedule || '?').padEnd(6)}  ${w.description}`);
  }
}

async function workersToggle(name, enabled) {
  if (!name) { console.error('flo daemon workers: missing worker name'); process.exit(2); }
  const state = await readState();
  if (!state.workers[name]) { console.error(`unknown worker: ${name}`); process.exit(1); }
  state.workers[name].enabled = enabled;
  await writeState(state);
  console.log(`✓ ${name} ${enabled ? 'enabled' : 'disabled'}`);
}

async function daemonLog(args) {
  const tailIdx = args.indexOf('--tail');
  const n = tailIdx > -1 ? parseInt(args[tailIdx + 1], 10) || 50 : 50;
  if (!existsSync(LOG_PATH)) { console.log('(daemon log empty — daemon hasn\'t run yet)'); return; }
  const raw = await readFile(LOG_PATH, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines.slice(-n)) console.log(line);
}

async function logLine(msg) {
  await ensureDir();
  const line = `${new Date().toISOString()}  ${msg}\n`;
  try { await appendFile(LOG_PATH, line, 'utf8'); } catch { /* ignore */ }
}

async function isDaemonRunning() {
  if (!existsSync(PID_PATH)) return false;
  try {
    const pid = parseInt(await readFile(PID_PATH, 'utf8'), 10);
    if (!pid) return false;
    process.kill(pid, 0); // signal 0 = check existence
    return true;
  } catch {
    // pidfile stale — clean up
    try { await unlink(PID_PATH); } catch { /* ignore */ }
    return false;
  }
}

function humanDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
