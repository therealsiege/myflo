import {
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  listTasks,
  getTask,
  taskCounts,
  STATUSES,
} from './tasks-store.js';

export async function tasksCommand(args) {
  const [sub = 'help', ...rest] = args;
  if (sub === 'help' || sub === '--help' || sub === '-h') return printHelp();
  if (sub === 'create' || sub === 'add') return createCmd(rest);
  if (sub === 'list') return listCmd(rest);
  if (sub === 'update') return updateCmd(rest);
  if (sub === 'complete' || sub === 'done') return completeCmd(rest);
  if (sub === 'delete' || sub === 'rm') return deleteCmd(rest);
  if (sub === 'get' || sub === 'show') return getCmd(rest);
  if (sub === 'counts' || sub === 'count') return countsCmd(rest);
  console.error(`flo tasks: unknown subcommand '${sub}'`);
  console.error(`Available: create, list, update, complete, delete, get, counts, help`);
  process.exit(2);
}

function printHelp() {
  console.log(`flo tasks — persistent task tracker (~/.flo/tasks.jsonl)

Usage:
  flo tasks create <subject> [--description <s>] [--tags a,b] [--owner <name>] [--parent <id>] [--status pending|in_progress|completed]
  flo tasks list [--status <s>] [--owner <name>] [--tag <t>] [--limit N] [--json]
  flo tasks update <id> [--subject <s>] [--description <s>] [--tags a,b] [--owner <name>] [--status <s>]
  flo tasks complete <id>
  flo tasks delete <id>
  flo tasks get <id>
  flo tasks counts [--json]

Status transitions: pending → in_progress → completed. Storage is append-only
event log; deletes are tombstones, history is preserved.
`);
}

function parseFlags(args) {
  const out = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') out.json = true;
    else if (a === '--description') out.description = args[++i];
    else if (a === '--tags') out.tags = (args[++i] || '').split(',').map((t) => t.trim()).filter(Boolean);
    else if (a === '--tag') out.tag = args[++i];
    else if (a === '--owner') out.owner = args[++i];
    else if (a === '--parent') out.parent = args[++i];
    else if (a === '--status') out.status = args[++i];
    else if (a === '--subject') out.subject = args[++i];
    else if (a === '--limit') out.limit = Number(args[++i]);
    else if (!a.startsWith('--')) out.positional.push(a);
  }
  return out;
}

async function createCmd(args) {
  const opts = parseFlags(args);
  const subject = opts.subject || opts.positional.join(' ');
  if (!subject) { console.error(`flo tasks create: missing <subject>`); process.exit(2); }
  const task = await createTask({
    subject,
    description: opts.description,
    tags: opts.tags,
    owner: opts.owner,
    parent: opts.parent,
    status: opts.status,
  });
  if (opts.json) console.log(JSON.stringify(task));
  else console.log(`flo tasks create: ${task.id} — ${task.subject}`);
}

async function listCmd(args) {
  const opts = parseFlags(args);
  const tasks = await listTasks({
    status: opts.status,
    owner: opts.owner,
    tag: opts.tag,
    limit: opts.limit || 100,
  });
  if (opts.json) { console.log(JSON.stringify(tasks, null, 2)); return; }
  if (!tasks.length) { console.log(`flo tasks: nothing matches`); return; }
  const stsW = 13, idW = 20;
  console.log(`status         id                    subject`);
  console.log(`-------------  --------------------  -------`);
  for (const t of tasks) {
    const sts = (t.status || '?').padEnd(stsW).slice(0, stsW);
    const id = (t.id || '?').padEnd(idW).slice(0, idW);
    const tagStr = t.tags?.length ? `  [${t.tags.join(',')}]` : '';
    console.log(`${sts}  ${id}  ${t.subject}${tagStr}`);
  }
}

async function updateCmd(args) {
  const opts = parseFlags(args);
  const id = opts.positional[0];
  if (!id) { console.error(`flo tasks update: missing <id>`); process.exit(2); }
  const patch = {};
  for (const k of ['subject', 'description', 'tags', 'owner', 'status']) {
    if (opts[k] !== undefined) patch[k] = opts[k];
  }
  if (Object.keys(patch).length === 0) {
    console.error(`flo tasks update: nothing to change`);
    process.exit(2);
  }
  const task = await updateTask({ id, ...patch });
  if (!task) { console.error(`flo tasks update: no task ${id}`); process.exit(1); }
  if (opts.json) console.log(JSON.stringify(task));
  else console.log(`flo tasks update: ${task.id} → status=${task.status}`);
}

async function completeCmd(args) {
  const opts = parseFlags(args);
  const id = opts.positional[0];
  if (!id) { console.error(`flo tasks complete: missing <id>`); process.exit(2); }
  const task = await completeTask(id);
  if (!task) { console.error(`flo tasks complete: no task ${id}`); process.exit(1); }
  console.log(`flo tasks complete: ${task.id} — ${task.subject}`);
}

async function deleteCmd(args) {
  const opts = parseFlags(args);
  const id = opts.positional[0];
  if (!id) { console.error(`flo tasks delete: missing <id>`); process.exit(2); }
  await deleteTask(id);
  console.log(`flo tasks delete: tombstoned ${id}`);
}

async function getCmd(args) {
  const opts = parseFlags(args);
  const id = opts.positional[0];
  if (!id) { console.error(`flo tasks get: missing <id>`); process.exit(2); }
  const task = await getTask(id);
  if (!task) { console.error(`flo tasks get: no task ${id}`); process.exit(1); }
  if (opts.json) console.log(JSON.stringify(task, null, 2));
  else {
    console.log(`${task.id}`);
    console.log(`subject:     ${task.subject}`);
    console.log(`status:      ${task.status}`);
    if (task.tags?.length) console.log(`tags:        ${task.tags.join(', ')}`);
    if (task.owner) console.log(`owner:       ${task.owner}`);
    if (task.parent) console.log(`parent:      ${task.parent}`);
    console.log(`createdAt:   ${task.createdAt}`);
    console.log(`updatedAt:   ${task.updatedAt}`);
    if (task.completedAt) console.log(`completedAt: ${task.completedAt}`);
    if (task.description) { console.log(`\n${task.description}`); }
  }
}

async function countsCmd(args) {
  const opts = parseFlags(args);
  const c = await taskCounts();
  if (opts.json) console.log(JSON.stringify(c));
  else console.log(`flo tasks counts: total=${c.total} pending=${c.pending} in_progress=${c.in_progress} completed=${c.completed}`);
}
