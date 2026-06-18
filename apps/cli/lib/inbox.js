import { watch } from 'node:fs';
import { readdir, readFile, stat, rename, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { transcribeAndSaveSidecar } from './transcribe.js';
import { addInbox, removeInbox, listInboxes } from './inbox-registry.js';
import { installLaunchAgent, uninstallLaunchAgent, listInstalledAgents } from './inbox-install.js';
import { storeEntry } from './memory-store.js';
import { writeFile, copyFile } from 'node:fs/promises';

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
  if (sub === 'add') return addCommand(rest);
  if (sub === 'list') return listCommand(rest);
  if (sub === 'remove') return removeCommand(rest);
  if (sub === 'install') return installCommand(rest);
  if (sub === 'uninstall') return uninstallCommand(rest);
  console.error(`flo inbox: unknown subcommand '${sub}'`);
  console.error(`Available: watch, status, add, list, remove, install, uninstall, help`);
  process.exit(2);
}

function printHelp() {
  console.log(`flo inbox — folder watcher + registry + launchd installer

Usage:
  flo inbox watch <dir> [--once]
  flo inbox status [--dir <dir>]
  flo inbox add <dir> [--slug <name>]      Register an inbox in ~/.flo/inboxes.json
  flo inbox list [--json]                  List registered inboxes
  flo inbox remove <slug>                  Remove from registry (does not delete files)
  flo inbox install <slug> [--interval N]  macOS: install a launchd agent that runs
                                           'flo inbox watch <dir> --once' every N seconds
                                           (default 30). Idempotent.
  flo inbox uninstall <slug>               macOS: remove the launchd agent

File handling (extension-based):
  .md            Parse frontmatter (to:/from:/subject:), log routing intent.
  .m4a .wav .mp3 Local transcription via whisper/mlx-whisper, sidecar .txt written.
  *              Logged as unhandled.

After handling, files move to <dir>/${HANDLED_DIR}/ (success) or <dir>/${FAILED_DIR}/.
All activity appended to <dir>/${LOG_FILE}.

Settle detection: 2000ms quiet window before processing.
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
      const body = raw.replace(/^---[\s\S]*?---\r?\n?/, '');
      const bridge = await bridgeMarkdownMessage({ filename, fm, body });
      action = `md to=${fm.to || '?'} from=${fm.from || '?'} subject=${fm.subject || '?'}`;
      if (bridge.mailbox) action += ` mailbox=${bridge.mailbox}`;
      if (bridge.memoryId) action += ` memory=${bridge.memoryId}`;
    } else if (AUDIO_EXTS.has(ext)) {
      const size = (await stat(path)).size;
      process.stderr.write(`flo inbox: transcribing ${basename(path)} (${size}b)…\n`);
      const result = await transcribeAndSaveSidecar(path);
      if (result.text) {
        action = `audio transcribed tool=${result.tool} chars=${result.text.length} sidecar=${basename(result.sidecar)}`;
      } else {
        action = `audio transcribe-failed tool=${result.tool || 'none'} error=${result.error}`;
      }
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

function safeRecipient(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

async function bridgeMarkdownMessage({ filename, fm, body }) {
  const out = { mailbox: null, memoryId: null };
  const recipient = safeRecipient(fm.to);
  if (!recipient) return out; // No 'to:' → just log, no routing
  try {
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { mkdir } = await import('node:fs/promises');
    const floHome = process.env.FLO_HOME || join(homedir(), '.flo');
    const mailboxDir = join(floHome, 'messages', recipient);
    await mkdir(mailboxDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const from = safeRecipient(fm.from) || 'unknown';
    const mailboxPath = join(mailboxDir, `${ts}-${from}-${filename}`);
    await writeFile(mailboxPath, `---\nto: ${recipient}\nfrom: ${from}\nsubject: ${fm.subject || ''}\nreceivedAt: ${new Date().toISOString()}\nsource: ${filename}\n---\n${body}`, 'utf8');
    out.mailbox = mailboxPath;
  } catch { /* non-critical */ }
  try {
    const entry = await storeEntry({
      namespace: 'inbox',
      key: `msg:${recipient}:${Date.now()}`,
      value: body.trim(),
      tags: [`to:${recipient}`, fm.from ? `from:${safeRecipient(fm.from)}` : 'from:unknown'],
      metadata: { to: recipient, from: fm.from || null, subject: fm.subject || null, source: filename },
    });
    out.memoryId = entry.id;
  } catch { /* non-critical */ }
  return out;
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

async function addCommand(args) {
  let dir = null, slug = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slug') slug = args[++i];
    else if (!args[i].startsWith('--') && !dir) dir = args[i];
  }
  if (!dir) {
    console.error(`flo inbox add: missing <dir>`);
    console.error(`Usage: flo inbox add <dir> [--slug <name>]`);
    process.exit(2);
  }
  const entry = await addInbox({ dir, slug });
  console.log(`flo inbox add: registered '${entry.slug}' → ${entry.dir}`);
}

async function listCommand(args) {
  const json = args.includes('--json');
  const entries = await listInboxes();
  if (json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  if (!entries.length) {
    console.log(`flo inbox: no inboxes registered. Use 'flo inbox add <dir>' to add one.`);
    return;
  }
  console.log(`slug                  pending  processed  failed  dir`);
  console.log(`--------------------  -------  ---------  ------  ---`);
  for (const e of entries) {
    const slug = (e.slug || '?').padEnd(20).slice(0, 20);
    const pending = String(e.pending ?? 0).padStart(7);
    const processed = String(e.processed ?? 0).padStart(9);
    const failed = String(e.failed ?? 0).padStart(6);
    const exists = e.exists === false ? ' (missing)' : '';
    console.log(`${slug}  ${pending}  ${processed}  ${failed}  ${e.dir}${exists}`);
  }
}

async function removeCommand(args) {
  const slug = args[0];
  if (!slug) {
    console.error(`flo inbox remove: missing <slug>`);
    console.error(`Usage: flo inbox remove <slug>`);
    process.exit(2);
  }
  const removed = await removeInbox(slug);
  if (removed) console.log(`flo inbox remove: removed '${slug}'`);
  else { console.error(`flo inbox remove: no inbox with slug '${slug}'`); process.exit(1); }
}

async function installCommand(args) {
  if (args.includes('--list')) {
    const list = await listInstalledAgents();
    if (!list.length) { console.log(`flo inbox install: no agents installed`); return; }
    for (const a of list) console.log(`  ${a.slug}\t${a.plistPath}`);
    return;
  }
  let slug = null, interval = 30;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--interval') interval = Number(args[++i]);
    else if (!args[i].startsWith('--') && !slug) slug = args[i];
  }
  if (!slug) {
    console.error(`flo inbox install: missing <slug>`);
    console.error(`Usage: flo inbox install <slug> [--interval <seconds>]`);
    console.error(`       flo inbox install --list`);
    process.exit(2);
  }
  const result = await installLaunchAgent({ slug, interval });
  console.log(`flo inbox install: installed '${result.label}'`);
  console.log(`  plist: ${result.plistPath}`);
  console.log(`  watches: ${result.dir} every ${result.interval}s`);
  console.log(`  load with: launchctl bootstrap gui/$(id -u) ${result.plistPath}`);
}

async function uninstallCommand(args) {
  const slug = args[0];
  if (!slug) {
    console.error(`flo inbox uninstall: missing <slug>`);
    console.error(`Usage: flo inbox uninstall <slug>`);
    process.exit(2);
  }
  const result = await uninstallLaunchAgent({ slug });
  if (result.removed) console.log(`flo inbox uninstall: removed ${result.plistPath}`);
  else { console.error(`flo inbox uninstall: nothing to remove for '${slug}'`); process.exit(1); }
}
