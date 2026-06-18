// `flo session terminal-attach` — port of nigelglenday/a-team.
// Tracks named terminal sessions (cwd + title + app) in ~/.flo/terminals.json
// and uses AppleScript on macOS to open them in Ghostty/iTerm/Terminal.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const REGISTRY_PATH = join(FLO_HOME, 'terminals.json');

const VALID_APPS = ['ghostty', 'iterm', 'terminal'];

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'terminal';
}

async function ensureHome() {
  if (!existsSync(FLO_HOME)) await mkdir(FLO_HOME, { recursive: true });
}

export async function loadRegistry() {
  await ensureHome();
  if (!existsSync(REGISTRY_PATH)) return { version: 1, terminals: [] };
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.terminals)) {
      return { version: 1, terminals: [] };
    }
    return parsed;
  } catch {
    return { version: 1, terminals: [] };
  }
}

export async function saveRegistry(reg) {
  await ensureHome();
  await writeFile(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n', 'utf8');
}

export async function addTerminal({ slug, cwd, title, app = 'ghostty', command }) {
  if (!VALID_APPS.includes(app)) {
    throw new Error(`unknown app '${app}'. Valid: ${VALID_APPS.join(', ')}`);
  }
  const reg = await loadRegistry();
  const resolvedCwd = resolve(cwd.replace(/^~/, homedir()));
  const finalSlug = slugify(slug || title || `term-${reg.terminals.length + 1}`);
  let unique = finalSlug;
  let n = 1;
  while (reg.terminals.find((t) => t.slug === unique)) {
    unique = `${finalSlug}-${++n}`;
  }
  const entry = {
    slug: unique,
    cwd: resolvedCwd,
    title: title || unique,
    app,
    command: command || null,
    createdAt: new Date().toISOString(),
  };
  reg.terminals.push(entry);
  await saveRegistry(reg);
  return entry;
}

export async function removeTerminal(slug) {
  const reg = await loadRegistry();
  const before = reg.terminals.length;
  reg.terminals = reg.terminals.filter((t) => t.slug !== slug);
  await saveRegistry(reg);
  return before - reg.terminals.length > 0;
}

export async function listTerminals() {
  const reg = await loadRegistry();
  return reg.terminals;
}

function escapeAppleScriptString(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function applescriptFor({ app, cwd, title, command }) {
  const escCwd = escapeAppleScriptString(cwd);
  const escTitle = escapeAppleScriptString(title);
  const cmdPart = command
    ? `${escapeAppleScriptString(command)}`
    : '';
  if (app === 'ghostty') {
    // Ghostty does not have first-class AppleScript support; use `open` on the
    // app and an osascript that focuses it, then type via System Events. Most
    // users prefer the simpler `open -a Ghostty .` approach via `open`.
    return null; // caller falls back to `open` flow
  }
  if (app === 'iterm') {
    const tellCmd = command
      ? `set command to "cd \\"${escCwd}\\" && ${cmdPart}"`
      : `set command to "cd \\"${escCwd}\\""`;
    return [
      'tell application "iTerm2"',
      '  activate',
      '  create window with default profile',
      '  tell current session of current window',
      `    ${tellCmd}`,
      '    write text command',
      `    set name to "${escTitle}"`,
      '  end tell',
      'end tell',
    ].join('\n');
  }
  if (app === 'terminal') {
    const tellCmd = command
      ? `do script "cd \\"${escCwd}\\" && ${cmdPart}"`
      : `do script "cd \\"${escCwd}\\""`;
    return [
      'tell application "Terminal"',
      '  activate',
      `  set newTab to ${tellCmd}`,
      `  set custom title of newTab to "${escTitle}"`,
      'end tell',
    ].join('\n');
  }
  return null;
}

async function openGhostty({ cwd, command }) {
  // Ghostty CLI accepts --working-directory and -e for command. Fall back to
  // `open -a Ghostty <cwd>` if the binary isn't on PATH.
  try {
    const args = ['--working-directory', cwd];
    if (command) args.push('-e', command);
    await execFileAsync('ghostty', args);
    return;
  } catch {
    await execFileAsync('open', ['-na', 'Ghostty', '--args', '--working-directory', cwd]);
  }
}

export async function restoreTerminal(entry) {
  if (process.platform !== 'darwin') {
    throw new Error(`terminal-attach restore is macOS-only (current: ${process.platform})`);
  }
  if (entry.app === 'ghostty') {
    await openGhostty({ cwd: entry.cwd, command: entry.command });
    return;
  }
  const script = applescriptFor(entry);
  if (!script) throw new Error(`no AppleScript path for app '${entry.app}'`);
  await execFileAsync('osascript', ['-e', script], { timeout: 30_000 });
}

export async function restoreAll() {
  const terminals = await listTerminals();
  const results = [];
  for (const t of terminals) {
    try {
      await restoreTerminal(t);
      results.push({ slug: t.slug, ok: true });
    } catch (err) {
      results.push({ slug: t.slug, ok: false, error: err.message });
    }
  }
  return results;
}

export async function sessionCommand(args) {
  const [sub = 'help', ...rest] = args;
  if (sub === 'help' || sub === '--help' || sub === '-h') return printHelp();
  if (sub === 'terminal-add') return addCmd(rest);
  if (sub === 'terminal-list') return listCmd(rest);
  if (sub === 'terminal-remove') return removeCmd(rest);
  if (sub === 'terminal-restore') return restoreCmd(rest);
  console.error(`flo session: unknown subcommand '${sub}'`);
  console.error(`Available: terminal-add, terminal-list, terminal-remove, terminal-restore, help`);
  process.exit(2);
}

function printHelp() {
  console.log(`flo session — registered terminal windows (a-team port, macOS)

Usage:
  flo session terminal-add <slug> [--cwd <path>] [--title <s>] [--app ghostty|iterm|terminal] [--command <cmd>]
  flo session terminal-list [--json]
  flo session terminal-remove <slug>
  flo session terminal-restore [<slug> | --all]

Registry: ~/.flo/terminals.json. Each entry records cwd, title, target app,
and an optional command to run on attach.

Defaults: --cwd is the current directory, --app is ghostty, --title is the slug.

Supported apps:
  - ghostty   uses the ghostty CLI (or 'open -a Ghostty' fallback)
  - iterm     drives iTerm2 via AppleScript
  - terminal  drives macOS Terminal.app via AppleScript
`);
}

function parseFlags(args) {
  const out = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--cwd') out.cwd = args[++i];
    else if (a === '--title') out.title = args[++i];
    else if (a === '--app') out.app = args[++i];
    else if (a === '--command') out.command = args[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--all') out.all = true;
    else if (!a.startsWith('--')) out.positional.push(a);
  }
  return out;
}

async function addCmd(args) {
  const opts = parseFlags(args);
  const slug = opts.positional[0];
  if (!slug) {
    console.error(`flo session terminal-add: missing <slug>`);
    process.exit(2);
  }
  const entry = await addTerminal({
    slug,
    cwd: opts.cwd || process.cwd(),
    title: opts.title,
    app: opts.app || 'ghostty',
    command: opts.command,
  });
  console.log(`flo session terminal-add: registered '${entry.slug}' (${entry.app}) → ${entry.cwd}`);
}

async function listCmd(args) {
  const opts = parseFlags(args);
  const terminals = await listTerminals();
  if (opts.json) { console.log(JSON.stringify(terminals, null, 2)); return; }
  if (!terminals.length) { console.log(`flo session: no terminals registered`); return; }
  console.log(`slug                  app        title                 cwd`);
  console.log(`--------------------  ---------  --------------------  ---`);
  for (const t of terminals) {
    const slug = (t.slug || '?').padEnd(20).slice(0, 20);
    const app = (t.app || '?').padEnd(9).slice(0, 9);
    const title = (t.title || '?').padEnd(20).slice(0, 20);
    console.log(`${slug}  ${app}  ${title}  ${t.cwd}`);
  }
}

async function removeCmd(args) {
  const opts = parseFlags(args);
  const slug = opts.positional[0];
  if (!slug) { console.error(`flo session terminal-remove: missing <slug>`); process.exit(2); }
  const removed = await removeTerminal(slug);
  if (removed) console.log(`flo session terminal-remove: removed '${slug}'`);
  else { console.error(`flo session terminal-remove: no terminal with slug '${slug}'`); process.exit(1); }
}

async function restoreCmd(args) {
  const opts = parseFlags(args);
  if (opts.all || !opts.positional.length) {
    const results = await restoreAll();
    for (const r of results) {
      console.log(`  ${r.ok ? 'OK ' : 'FAIL'}  ${r.slug}${r.error ? ` — ${r.error}` : ''}`);
    }
    const failed = results.filter((r) => !r.ok).length;
    if (failed) process.exit(1);
    return;
  }
  const slug = opts.positional[0];
  const terminals = await listTerminals();
  const entry = terminals.find((t) => t.slug === slug);
  if (!entry) { console.error(`flo session terminal-restore: no terminal '${slug}'`); process.exit(1); }
  await restoreTerminal(entry);
  console.log(`flo session terminal-restore: launched '${entry.slug}' (${entry.app})`);
}
