// Reads ~/.flo/messages/<recipient>/ mailbox files written by the inbox bridge.

import { readdir, readFile, stat, unlink, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const MAILBOX_ROOT = join(FLO_HOME, 'messages');

export async function messagesCommand(args) {
  const [sub = 'help', ...rest] = args;
  if (sub === 'help' || sub === '--help' || sub === '-h') return printHelp();
  if (sub === 'list') return listCommand(rest);
  if (sub === 'read') return readCommand(rest);
  if (sub === 'archive') return archiveCommand(rest);
  console.error(`flo messages: unknown subcommand '${sub}'`);
  console.error(`Available: list, read, archive, help`);
  process.exit(2);
}

function printHelp() {
  console.log(`flo messages — mailbox reader for inbox-bridged markdown drops

Usage:
  flo messages list [<recipient>] [--json]
  flo messages read <recipient> <filename> [--json]
  flo messages archive <recipient> <filename>

Mailboxes live at ~/.flo/messages/<recipient>/. The inbox watcher writes
into them when a .md drop has 'to: <recipient>' in its frontmatter.
`);
}

async function listRecipients() {
  if (!existsSync(MAILBOX_ROOT)) return [];
  const entries = await readdir(MAILBOX_ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listMessages(recipient) {
  const dir = join(MAILBOX_ROOT, recipient);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const path = join(dir, name);
    try {
      const st = await stat(path);
      out.push({ recipient, filename: name, path, size: st.size, mtime: st.mtimeMs });
    } catch {}
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

async function listCommand(args) {
  const json = args.includes('--json');
  const recipient = args.find((a) => !a.startsWith('--'));
  if (recipient) {
    const msgs = await listMessages(recipient);
    if (json) { console.log(JSON.stringify(msgs, null, 2)); return; }
    if (!msgs.length) { console.log(`flo messages: no messages for '${recipient}'`); return; }
    for (const m of msgs) {
      console.log(`${m.filename}  (${m.size}b, ${new Date(m.mtime).toISOString()})`);
    }
    return;
  }
  // No recipient: list all
  const recipients = await listRecipients();
  const summary = [];
  for (const r of recipients) {
    const msgs = await listMessages(r);
    summary.push({ recipient: r, count: msgs.length });
  }
  if (json) { console.log(JSON.stringify(summary, null, 2)); return; }
  if (!summary.length) { console.log(`flo messages: no mailboxes yet`); return; }
  console.log(`recipient                count`);
  console.log(`-----------------------  -----`);
  for (const s of summary) {
    console.log(`${s.recipient.padEnd(23).slice(0, 23)}  ${String(s.count).padStart(5)}`);
  }
}

async function readCommand(args) {
  const json = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length < 2) {
    console.error(`flo messages read: usage: flo messages read <recipient> <filename>`);
    process.exit(2);
  }
  const [recipient, filename] = positional;
  const path = join(MAILBOX_ROOT, recipient, filename);
  if (!existsSync(path)) { console.error(`flo messages read: not found: ${path}`); process.exit(1); }
  const raw = await readFile(path, 'utf8');
  if (json) { console.log(JSON.stringify({ recipient, filename, content: raw })); return; }
  console.log(raw);
}

async function archiveCommand(args) {
  const [recipient, filename] = args.filter((a) => !a.startsWith('--'));
  if (!recipient || !filename) {
    console.error(`flo messages archive: usage: flo messages archive <recipient> <filename>`);
    process.exit(2);
  }
  const path = join(MAILBOX_ROOT, recipient, filename);
  if (!existsSync(path)) { console.error(`flo messages archive: not found: ${path}`); process.exit(1); }
  await unlink(path);
  console.log(`flo messages archive: removed ${filename}`);
}

export async function listAllMailboxes() {
  const recipients = await listRecipients();
  const out = [];
  for (const r of recipients) {
    out.push({ recipient: r, messages: await listMessages(r) });
  }
  return out;
}

// Write a message to a recipient's mailbox. Used by agent coordination to
// notify leads when work completes. Markdown body with frontmatter.
export async function sendMessageToMailbox({ to, from, summary, message }) {
  if (!to) throw new Error('sendMessageToMailbox: `to` is required');
  const dir = join(MAILBOX_ROOT, String(to).replace(/[^a-zA-Z0-9_-]/g, '_'));
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const ts = new Date();
  const stamp = ts.toISOString().replace(/[:.]/g, '-');
  const slug = String(summary || 'message').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'msg';
  const filename = `${stamp}-${slug}.md`;
  const body = [
    '---',
    `to: ${to}`,
    from ? `from: ${from}` : null,
    `ts: ${ts.toISOString()}`,
    summary ? `summary: ${summary}` : null,
    '---',
    '',
    message || '',
    '',
  ].filter((l) => l !== null).join('\n');
  await writeFile(join(dir, filename), body, 'utf8');
  return { to, from, filename, path: join(dir, filename) };
}
