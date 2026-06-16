import { watch } from 'node:fs';
import { readdir, readFile, stat, rename, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';
import { homedir } from 'node:os';

const SETTLE_MS = 2000;
const HANDLED_DIR = '.processed';
const FAILED_DIR = '.failed';
const LOG_FILE = 'inbox.log';

const AUDIO_EXTS = new Set(['.m4a', '.wav', '.mp3', '.aiff', '.flac']);

export async function inboxCommand(args) {
  const [sub = 'help', ...rest] = args;
  if (sub === 'help' || sub === '--help' || sub === '-h') return printHelp();
  if (sub === 'watch') return watchCommand(rest);
  if (sub === 'status') return statusCommand(rest);
  console.error(`flo inbox: unknown subcommand '${sub}'`);
  console.error(`Available: watch, status, help`);
  process.exit(2);
}

function printHelp() {
  console.log(`flo inbox — foreground folder watcher

Usage:
  flo inbox watch <dir> [--once]
  flo inbox status [--dir <dir>]

Watch a folder. New files trigger handlers based on extension:
  .md            Parse frontmatter, log routing intent (to:/from:/subject:).
  .m4a .wav .mp3 Route to transcribe handler (stub — logs intent).
  *              Log as unhandled.

After handling, files move to <dir>/${HANDLED_DIR}/ (success) or <dir>/${FAILED_DIR}/.
All activity appended to <dir>/${LOG_FILE}.

Settle detection: 2000ms quiet window before processing.

Note: foreground only. No launchd plist generation yet (P2 work).
`);
}

async function watchCommand(args) {
  const parsed = parseArgs(args);
  if (!parsed.dir) {
    console.error(`flo inbox watch: missing <dir>`);
    console.error(`Usage: flo inbox watch <dir>`);
    process.exit(2);
  }
  const dir = resolve(parsed.dir.replace(/^~/, homedir()));
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
    process.stderr.write(`flo inbox: created ${dir}\n`);
  }
  await mkdir(join(dir, HANDLED_DIR), { recursive: true });
  await mkdir(join(dir, FAILED_DIR), { recursive: true });

  if (parsed.once) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && !e.name.startsWith('.') && e.name !== LOG_FILE) {
        await handle(dir, e.name);
      }
    }
    return;
  }

  process.stderr.write(`flo inbox: watching ${dir} (settle=${SETTLE_MS}ms). Ctrl-C to stop.\n`);
  const pending = new Map();
  watch(dir, async (event, filename) => {
    if (!filename) return;
    if (filename.startsWith('.')) return;
    const path = join(dir, filename);
    let st;
    try { st = await stat(path); } catch { return; }
    if (!st.isFile()) return;
    if (pending.has(filename)) clearTimeout(pending.get(filename));
    pending.set(filename, setTimeout(async () => {
      pending.delete(filename);
      await handle(dir, filename);
    }, SETTLE_MS));
  });
  // Also scan existing files at startup
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && !e.name.startsWith('.') && e.name !== LOG_FILE) {
      await handle(dir, e.name);
    }
  }
  // Stay alive
  await new Promise(() => {});
}

async function statusCommand(args) {
  const parsed = parseArgs(args);
  const dir = resolve((parsed.dir || './inbox').replace(/^~/, homedir()));
  if (!existsSync(dir)) {
    console.log(`flo inbox: no inbox at ${dir}`);
    return;
  }
  const pending = (await readdir(dir, { withFileTypes: true })).filter(e => e.isFile() && !e.name.startsWith('.') && e.name !== LOG_FILE);
  const processed = existsSync(join(dir, HANDLED_DIR))
    ? (await readdir(join(dir, HANDLED_DIR))).length : 0;
  const failed = existsSync(join(dir, FAILED_DIR))
    ? (await readdir(join(dir, FAILED_DIR))).length : 0;
  console.log(`flo inbox status: ${dir}`);
  console.log(`  pending: ${pending.length}`);
  console.log(`  processed: ${processed}`);
  console.log(`  failed: ${failed}`);
  if (pending.length) {
    console.log(`\nPending files:`);
    for (const e of pending.slice(0, 20)) console.log(`  - ${e.name}`);
    if (pending.length > 20) console.log(`  …and ${pending.length - 20} more`);
  }
  const logPath = join(dir, LOG_FILE);
  if (existsSync(logPath)) {
    const raw = await readFile(logPath, 'utf8');
    const tail = raw.trim().split('\n').slice(-5);
    console.log(`\nRecent log entries:`);
    for (const line of tail) console.log(`  ${line}`);
  }
}

async function handle(dir, filename) {
  const path = join(dir, filename);
  const ext = extname(filename).toLowerCase();
  const log = async (msg) => appendFile(join(dir, LOG_FILE), `${new Date().toISOString()} ${msg}\n`).catch(() => {});

  try {
    let action = '';
    if (ext === '.md') {
      const raw = await readFile(path, 'utf8');
      const fm = parseFrontmatter(raw);
      action = `md to=${fm.to || '?'} from=${fm.from || '?'} subject=${fm.subject || '?'}`;
    } else if (AUDIO_EXTS.has(ext)) {
      action = `audio transcribe(stub) file=${basename(path)} size=${(await stat(path)).size}`;
    } else {
      action = `unhandled ext=${ext} file=${basename(path)}`;
    }
    await log(`handled ${filename}: ${action}`);
    await rename(path, join(dir, HANDLED_DIR, filename));
    process.stderr.write(`flo inbox: ${filename} → ${action}\n`);
  } catch (err) {
    await log(`failed ${filename}: ${err.message}`);
    try { await rename(path, join(dir, FAILED_DIR, filename)); } catch {}
    process.stderr.write(`flo inbox: ${filename} FAILED: ${err.message}\n`);
  }
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

function parseArgs(args) {
  const out = { dir: null, once: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dir') out.dir = args[++i];
    else if (a === '--once') out.once = true;
    else if (!a.startsWith('--') && !out.dir) out.dir = a;
  }
  return out;
}
