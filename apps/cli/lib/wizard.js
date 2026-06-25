// `flo wizard` — interactive guided setup that covers everything flo can
// set up: memory backend, MCP registration, ruflo cutover, statusline,
// post-edit hooks (auto-ADR + auto-security), background workers + their
// launchd autostart, inbox folder watchers, shell completions.
//
// Non-TTY (CI / piped stdin) → prints what would run and exits cleanly.
// All actions are reported up front; nothing executes until the user confirms.
// Zero dependencies (uses node:readline). ANSI colors but degrades cleanly.

import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, copyFile, mkdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const USER_MCP = join(homedir(), '.claude', 'mcp.json');
const PROJECT_SETTINGS = join(process.cwd(), '.claude', 'settings.json');
const __dirname = dirname(fileURLToPath(import.meta.url));
const FLO_BIN = join(__dirname, '..', 'bin', 'flo.js');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
  red: '\x1b[31m', magenta: '\x1b[35m',
};
const ok = (s) => `${c.green}✓${c.reset} ${s}`;
const warn = (s) => `${c.yellow}!${c.reset} ${s}`;
const fail = (s) => `${c.red}✗${c.reset} ${s}`;
const muted = (s) => `${c.dim}${s}${c.reset}`;

export async function wizardCommand(args) {
  const nonInteractive = !process.stdin.isTTY || args.includes('--non-interactive');
  if (args.includes('--help') || args.includes('-h')) return printHelp();

  console.log('');
  console.log(`${c.bold}${c.magenta}▊ flo wizard${c.reset}  ${muted('— interactive setup for myflo')}`);
  console.log('');
  console.log(muted('Walks you through everything flo can configure. Answer each prompt, then'));
  console.log(muted('approve the summary before any changes hit disk. Skip any section you don\'t need.'));
  console.log('');

  // ── Detect current state up front so prompts are informed ─────────────
  const detect = await detectState();
  if (detect.length) {
    console.log(`${c.dim}Detected:${c.reset}`);
    for (const d of detect) console.log(`  ${d}`);
    console.log('');
  }

  if (nonInteractive) {
    console.log(warn(`Non-interactive mode (no TTY). For a guided setup, run \`flo wizard\` in a real terminal.`));
    console.log(`In the meantime, the equivalent commands are:`);
    console.log(`  flo setup`);
    console.log(`  flo replace ruflo            # if ruflo is registered`);
    console.log(`  flo daemon start             # if you want bg workers`);
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const plan = { steps: [] };

  try {
    // 1. Core directories + MCP registration ─────────────────────────────
    if (await ask(rl, `Set up core directories + register flo as an MCP server?`, true)) {
      plan.steps.push({ id: 'setup', label: 'Run flo setup (creates ~/.flo/, registers MCP)' });
    }

    // 2. ruflo cutover ───────────────────────────────────────────────────
    if (detect.some((d) => d.includes('ruflo'))) {
      if (await ask(rl, `Remove ruflo / claude-flow entries from settings + run claude mcp remove?`, true)) {
        plan.steps.push({ id: 'replace-ruflo', label: 'Run flo replace ruflo (idempotent, backed up first)' });
      }
    }

    // 3. Memory backend ──────────────────────────────────────────────────
    const backend = await chooseOne(rl, 'Memory backend?', [
      { key: 'jsonl', label: 'jsonl', desc: 'Default — pure JS, BM25 search, zero deps' },
      { key: 'agentdb', label: 'agentdb', desc: 'HNSW/FTS5 via @fuzeelogik/myflo-memory (~30MB extra)' },
      { key: 'skip', label: 'skip', desc: 'Leave memory backend unset' },
    ], 'jsonl');
    if (backend !== 'skip') {
      plan.steps.push({
        id: 'memory-backend',
        label: backend === 'jsonl'
          ? `Append \`export FLO_MEMORY_BACKEND=jsonl\` suggestion to wizard summary`
          : `Set FLO_MEMORY_BACKEND=agentdb in shell rc (you'll see the line to add)`,
        backend,
      });
    }

    // 4. Statusline ──────────────────────────────────────────────────────
    if (existsSync(PROJECT_SETTINGS)) {
      if (await ask(rl, `Point this project's Claude Code status line at \`flo statusline\`?`, true)) {
        plan.steps.push({ id: 'statusline', label: `Set .claude/settings.json statusLine.command → \`sh -c 'exec flo statusline'\`` });
      }
    }

    // 5. Post-edit hooks ─────────────────────────────────────────────────
    if (existsSync(PROJECT_SETTINGS)) {
      if (await ask(rl, `Wire flo into post-edit hook (auto-ADR + auto-security)?`, true)) {
        plan.steps.push({ id: 'post-edit-hook', label: `Add post-edit hook → \`node $(which flo) hook post-edit\` in .claude/settings.json` });
      }
    }

    // 6. Daemon ──────────────────────────────────────────────────────────
    if (await ask(rl, `Enable background workers (daemon)?`, false)) {
      const workers = await chooseMulti(rl, 'Which workers?', [
        { key: 'audit', label: 'audit (1h) — npm audit + secret scan', default: true },
        { key: 'document', label: 'document (2h) — auto API docs from JSDoc', default: true },
        { key: 'testgaps', label: 'testgaps (4h) — find src files without tests', default: true },
      ]);
      plan.steps.push({ id: 'daemon-start', label: `Start \`flo daemon\` with enabled: ${workers.join(', ')}`, workers });

      if (platform() === 'darwin') {
        if (await ask(rl, `macOS launchd autostart for the daemon at login?`, false)) {
          plan.steps.push({ id: 'launchd-install', label: `Write LaunchAgent ~/Library/LaunchAgents/dev.myflo.daemon.plist + load it` });
        }
      }
    }

    // 7. Inbox watcher ───────────────────────────────────────────────────
    if (await ask(rl, `Set up a folder watcher (for voice memos / markdown drops)?`, false)) {
      const dir = await prompt(rl, `  watch path?`, join(homedir(), 'voice-memos'));
      const slug = await prompt(rl, `  short name (slug)?`, 'memos');
      plan.steps.push({ id: 'inbox-add', label: `Register inbox watcher: ${slug} → ${dir}`, dir, slug });
      if (platform() === 'darwin' && await ask(rl, `  Install macOS launchd watcher (runs every 30s)?`, true)) {
        plan.steps.push({ id: 'inbox-install', label: `Install launchd plist for inbox '${slug}'`, slug });
      }
    }

    // 8. Shell completions ───────────────────────────────────────────────
    const compShells = await chooseMulti(rl, 'Install shell tab completion for?', [
      { key: 'bash', label: 'bash', default: false },
      { key: 'zsh', label: 'zsh', default: process.env.SHELL?.includes('zsh') ?? false },
      { key: 'fish', label: 'fish', default: process.env.SHELL?.includes('fish') ?? false },
    ]);
    if (compShells.length) {
      plan.steps.push({ id: 'completions', label: `Print shell completion install commands for: ${compShells.join(', ')}`, shells: compShells });
    }

    // ── Summary + confirm ─────────────────────────────────────────────────
    console.log('');
    console.log(`${c.bold}Summary${c.reset}`);
    if (!plan.steps.length) {
      console.log(muted('  (no changes selected)'));
      console.log('');
      console.log(`Bye!`);
      return;
    }
    for (let i = 0; i < plan.steps.length; i++) {
      console.log(`  ${c.dim}${i + 1}.${c.reset} ${plan.steps[i].label}`);
    }
    console.log('');
    if (!await ask(rl, `${c.bold}Apply these changes?${c.reset}`, true)) {
      console.log(muted('No changes made. Bye!'));
      return;
    }
    console.log('');

    // ── Execute ───────────────────────────────────────────────────────────
    for (const step of plan.steps) {
      try { await execute(step); }
      catch (err) { console.log(fail(`${step.id}: ${err.message}`)); }
    }
    console.log('');
    console.log(ok(`Done. Restart Claude Code to pick up any settings.json changes.`));
  } finally {
    rl.close();
  }
}

function printHelp() {
  console.log(`flo wizard — interactive guided setup

Usage:
  flo wizard [--non-interactive]

Walks through 8 sections in order, each skippable:
  1. Core directories + MCP registration (\`flo setup\`)
  2. ruflo cutover (if detected)
  3. Memory backend choice (jsonl vs agentdb)
  4. Status line → \`flo statusline\`
  5. Post-edit hook → auto-ADR + auto-security
  6. Background workers daemon + macOS launchd autostart
  7. Inbox folder watcher + launchd installer
  8. Shell tab completions

Shows a summary before making any changes. Cancel anytime with Ctrl-C.
For scripted use, run the individual commands directly (flo setup, flo
replace ruflo, flo daemon start, etc.) — \`flo wizard\` is for humans.
`);
}

// ─── Detection ────────────────────────────────────────────────────────────
async function detectState() {
  const lines = [];
  if (existsSync(FLO_HOME)) lines.push(ok(`${FLO_HOME} exists`));
  else lines.push(muted(`~/.flo/ not yet created`));
  if (existsSync(USER_MCP)) {
    try {
      const j = JSON.parse(await readFile(USER_MCP, 'utf8'));
      const names = Object.keys(j.mcpServers || {});
      if (names.includes('flo')) lines.push(ok(`flo registered in ~/.claude/mcp.json`));
      if (names.includes('ruflo') || names.includes('claude-flow'))
        lines.push(warn(`ruflo / claude-flow still in ~/.claude/mcp.json`));
    } catch { /* ignore */ }
  }
  if (await claudeCliHasRuflo()) lines.push(warn(`ruflo registered via \`claude mcp\` (claude CLI sees it)`));
  if (existsSync(PROJECT_SETTINGS)) lines.push(ok(`project .claude/settings.json present (cwd: ${process.cwd()})`));
  return lines;
}

async function claudeCliHasRuflo() {
  return new Promise((resolve) => {
    const p = spawn('claude', ['mcp', 'get', 'ruflo'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    let out = '';
    p.stdout.on('data', (b) => { out += b.toString(); });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0 && /scope|status/i.test(out)));
  });
}

// ─── Prompt helpers ───────────────────────────────────────────────────────
function prompt(rl, question, defaultValue) {
  return new Promise((resolve) => {
    const suffix = defaultValue ? ` ${c.dim}[${defaultValue}]${c.reset} ` : ' ';
    rl.question(`${question}${suffix}`, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function ask(rl, question, defaultYes = true) {
  const hint = defaultYes ? `${c.dim}[Y/n]${c.reset}` : `${c.dim}[y/N]${c.reset}`;
  const ans = (await prompt(rl, `${question} ${hint}`, '')).toLowerCase();
  if (!ans) return defaultYes;
  return ans === 'y' || ans === 'yes';
}

async function chooseOne(rl, question, options, defaultKey) {
  console.log(`${question}`);
  for (let i = 0; i < options.length; i++) {
    const marker = options[i].key === defaultKey ? '*' : ' ';
    console.log(`  ${marker} ${i + 1}. ${c.bold}${options[i].label}${c.reset} ${muted('— ' + options[i].desc)}`);
  }
  const defaultIdx = options.findIndex((o) => o.key === defaultKey) + 1;
  const ans = (await prompt(rl, `  pick`, String(defaultIdx))).trim();
  const idx = parseInt(ans, 10);
  if (idx >= 1 && idx <= options.length) return options[idx - 1].key;
  // allow keyword match
  const byKey = options.find((o) => o.key === ans || o.label === ans);
  return byKey ? byKey.key : defaultKey;
}

async function chooseMulti(rl, question, options) {
  console.log(`${question}`);
  const enabled = new Set(options.filter((o) => o.default).map((o) => o.key));
  for (let i = 0; i < options.length; i++) {
    const mark = enabled.has(options[i].key) ? c.green + '✓' + c.reset : muted('·');
    console.log(`  ${mark} ${i + 1}. ${options[i].label}`);
  }
  const ans = (await prompt(rl, `  comma-separated indices to toggle, or Enter to accept defaults`, '')).trim();
  if (ans) {
    for (const tok of ans.split(/[,\s]+/)) {
      const idx = parseInt(tok, 10);
      if (idx >= 1 && idx <= options.length) {
        const k = options[idx - 1].key;
        if (enabled.has(k)) enabled.delete(k); else enabled.add(k);
      }
    }
  }
  return [...enabled];
}

// ─── Execution ────────────────────────────────────────────────────────────
async function execute(step) {
  switch (step.id) {
    case 'setup':           return execSetup();
    case 'replace-ruflo':   return execReplaceRuflo();
    case 'memory-backend':  return execMemoryBackend(step);
    case 'statusline':      return execStatusline();
    case 'post-edit-hook':  return execPostEditHook();
    case 'daemon-start':    return execDaemonStart(step);
    case 'launchd-install': return execLaunchdInstall();
    case 'inbox-add':       return execInboxAdd(step);
    case 'inbox-install':   return execInboxInstall(step);
    case 'completions':     return execCompletions(step);
    default:                console.log(warn(`unknown step: ${step.id}`));
  }
}

function runFlo(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [FLO_BIN, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
  });
}

async function execSetup() { await runFlo(['setup']); }

async function execReplaceRuflo() { await runFlo(['replace', 'ruflo']); }

async function execMemoryBackend({ backend }) {
  console.log(ok(`Memory backend: ${backend}`));
  console.log(`  Add to your shell rc:  ${c.bold}export FLO_MEMORY_BACKEND=${backend}${c.reset}`);
  if (backend === 'agentdb') {
    const installed = await checkPackageInstalled('@fuzeelogik/myflo-memory');
    if (!installed) {
      console.log(`  ${warn('@fuzeelogik/myflo-memory not installed globally')}`);
      console.log(`  Install: ${c.bold}npm install -g @fuzeelogik/myflo-memory${c.reset}`);
    } else {
      console.log(ok('@fuzeelogik/myflo-memory installed — agentdb backend ready'));
    }
  }
}

async function execStatusline() {
  const settings = JSON.parse(await readFile(PROJECT_SETTINGS, 'utf8'));
  await copyFile(PROJECT_SETTINGS, `${PROJECT_SETTINGS}.flo-bak.${Date.now()}`);
  settings.statusLine = { type: 'command', command: "sh -c 'exec flo statusline'" };
  await writeFile(PROJECT_SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  console.log(ok(`statusLine.command → \`sh -c 'exec flo statusline'\` (backup written)`));
}

async function execPostEditHook() {
  const settings = JSON.parse(await readFile(PROJECT_SETTINGS, 'utf8'));
  await copyFile(PROJECT_SETTINGS, `${PROJECT_SETTINGS}.flo-bak.${Date.now()}`);
  settings.hooks ??= {};
  settings.hooks.PostToolUse ??= [];
  const entry = {
    matcher: 'Write|Edit|MultiEdit',
    hooks: [{ type: 'command', command: `node $(which flo) hook post-edit`, timeout: 10000 }],
  };
  // dedupe: replace any existing entry with same matcher whose hook command mentions flo
  const filtered = settings.hooks.PostToolUse.filter(
    (e) => !(e.matcher === entry.matcher && JSON.stringify(e.hooks || []).includes('flo'))
  );
  filtered.push(entry);
  settings.hooks.PostToolUse = filtered;
  await writeFile(PROJECT_SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  console.log(ok(`PostToolUse hook → flo hook post-edit (auto-ADR + auto-security on Write/Edit)`));
}

async function execDaemonStart({ workers }) {
  for (const w of workers) {
    try { await runFlo(['daemon', 'workers', 'enable', w]); }
    catch { /* already enabled is fine */ }
  }
  await runFlo(['daemon', 'start']);
}

async function execLaunchdInstall() {
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'dev.myflo.daemon.plist');
  const floBin = await whichFlo();
  if (!floBin) throw new Error(`couldn't locate \`flo\` on PATH`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>dev.myflo.daemon</string>
  <key>ProgramArguments</key> <array><string>${floBin}</string><string>daemon</string><string>start</string><string>--foreground</string></array>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <true/>
  <key>StandardOutPath</key>  <string>${join(FLO_HOME, 'daemon', 'launchd.out.log')}</string>
  <key>StandardErrorPath</key><string>${join(FLO_HOME, 'daemon', 'launchd.err.log')}</string>
</dict>
</plist>
`;
  await mkdir(dirname(plistPath), { recursive: true });
  await writeFile(plistPath, plist, 'utf8');
  console.log(ok(`wrote ${plistPath}`));
  console.log(`  Load: ${c.bold}launchctl load -w ${plistPath}${c.reset}`);
  console.log(`  Unload: ${c.bold}launchctl unload ${plistPath}${c.reset}`);
}

async function execInboxAdd({ dir, slug }) { await runFlo(['inbox', 'add', dir, '--slug', slug]); }
async function execInboxInstall({ slug }) { await runFlo(['inbox', 'install', slug]); }

async function execCompletions({ shells }) {
  console.log(ok(`Completion install commands:`));
  for (const sh of shells) {
    if (sh === 'bash') console.log(`  ${c.bold}flo completions bash >> ~/.bashrc${c.reset}`);
    if (sh === 'zsh')  console.log(`  ${c.bold}flo completions zsh >> ~/.zshrc${c.reset}`);
    if (sh === 'fish') console.log(`  ${c.bold}flo completions fish > ~/.config/fish/completions/flo.fish${c.reset}`);
  }
}

async function whichFlo() {
  return new Promise((resolve) => {
    const p = spawn('which', ['flo'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (b) => { out += b.toString(); });
    p.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    p.on('error', () => resolve(null));
  });
}

async function checkPackageInstalled(name) {
  return new Promise((resolve) => {
    const p = spawn('npm', ['ls', '-g', '--depth=0', name], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    let out = '';
    p.stdout.on('data', (b) => { out += b.toString(); });
    p.on('close', (code) => resolve(code === 0 && out.includes(name)));
    p.on('error', () => resolve(false));
  });
}
