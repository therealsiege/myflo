// `flo edit` — open memory entries, notes, or tasks in $EDITOR.
// Writes the content to a tmpfile, invokes the editor, then applies the result.
// Memory/note edits create a new entry (the old one stays in history via the
// append-only log + tombstone pattern); task edits use updateTask.

import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { getEntry, storeEntry, deleteEntry } from './memory-store.js';
import { getTask, updateTask } from './tasks-store.js';

export async function editCommand(args) {
  const [kind = 'help', ...rest] = args;
  if (kind === 'help' || kind === '--help' || kind === '-h') return printHelp();
  if (kind === 'memory' || kind === 'note') return editMemory(kind, rest);
  if (kind === 'task') return editTask(rest);
  console.error(`flo edit: unknown kind '${kind}'. Try: memory, note, task`);
  process.exit(2);
}

function printHelp() {
  console.log(`flo edit — open in \$EDITOR (defaults to vim)

Usage:
  flo edit memory <id>              # edit memory entry by id
  flo edit memory --key <key> [--namespace <ns>]
  flo edit note <id>                # alias of: flo edit memory <id> (in 'notes' ns)
  flo edit task <id>                # edit a task's subject + description

Memory/note edits create a new entry (the old one is tombstoned but still in
the history log). Task edits update the existing task event log.

\$EDITOR is honored; falls back to vim, then nano.
`);
}

function pickEditor() {
  if (process.env.EDITOR) return process.env.EDITOR;
  if (process.env.VISUAL) return process.env.VISUAL;
  // Reasonable fallbacks
  return 'vim';
}

async function openInEditor(initialContent) {
  const dir = await mkdtemp(join(tmpdir(), 'flo-edit-'));
  const path = join(dir, 'flo-edit.md');
  await writeFile(path, initialContent, 'utf8');
  const editor = pickEditor();
  // Parse simple "editor +line" / "editor --wait" forms by splitting on whitespace.
  // Shell expansion isn't supported (we pass an arg array to spawn, never a shell string).
  const parts = editor.split(/\s+/);
  await new Promise((resolve, reject) => {
    const proc = spawn(parts[0], [...parts.slice(1), path], { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`editor exited ${code}`)));
  });
  const updated = await readFile(path, 'utf8');
  return { path, original: initialContent, updated };
}

function parseFlags(args) {
  const out = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--namespace') out.namespace = args[++i];
    else if (a === '--key') out.key = args[++i];
    else if (!a.startsWith('--')) out.positional.push(a);
  }
  return out;
}

async function editMemory(kind, args) {
  const opts = parseFlags(args);
  let namespace = opts.namespace || (kind === 'note' ? 'notes' : 'default');
  const id = opts.positional[0];
  let entry;
  if (id) {
    entry = await getEntry({ namespace, id });
  } else if (opts.key) {
    entry = await getEntry({ namespace, key: opts.key });
  } else {
    console.error(`flo edit ${kind}: need <id> or --key`);
    process.exit(2);
  }
  if (!entry) {
    console.error(`flo edit ${kind}: not found in namespace '${namespace}'`);
    process.exit(1);
  }
  const { updated } = await openInEditor(entry.value);
  if (updated.trim() === entry.value.trim()) {
    console.log(`flo edit ${kind}: no changes`);
    return;
  }
  const next = await storeEntry({
    namespace: entry.namespace,
    key: entry.key,
    value: updated,
    tags: entry.tags,
    metadata: { ...entry.metadata, editedFrom: entry.id, editedAt: new Date().toISOString() },
  });
  await deleteEntry({ namespace: entry.namespace, id: entry.id });
  console.log(`flo edit ${kind}: ${entry.id} → ${next.id} (${updated.length} chars)`);
}

async function editTask(args) {
  const id = args[0];
  if (!id) {
    console.error(`flo edit task: missing <id>`);
    process.exit(2);
  }
  const task = await getTask(id);
  if (!task) { console.error(`flo edit task: no task ${id}`); process.exit(1); }
  const body = `# subject (first line) and optional description (below)
${task.subject}
${task.description ? '\n' + task.description : ''}
`;
  const { updated } = await openInEditor(body);
  const lines = updated.split('\n');
  // Skip the comment line if user kept it
  const firstReal = lines.findIndex((l) => l && !l.startsWith('#'));
  const newSubject = (firstReal >= 0 ? lines[firstReal] : '').trim();
  const newDesc = firstReal >= 0
    ? lines.slice(firstReal + 1).join('\n').trim() || null
    : null;
  if (!newSubject) {
    console.error(`flo edit task: empty subject — refused`);
    process.exit(1);
  }
  if (newSubject === task.subject && (newDesc || '') === (task.description || '')) {
    console.log(`flo edit task: no changes`);
    return;
  }
  const next = await updateTask({ id, subject: newSubject, description: newDesc });
  console.log(`flo edit task: ${next.id} updated`);
}
