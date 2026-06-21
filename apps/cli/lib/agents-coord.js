// Agent coordination — auto-assign + complete-with-training + topology view.
//
// Builds on top of agents-store.js (named-agent registry) and tasks-store.js
// (shared task queue) to deliver the ruflo-style agentTeams flow:
//
//   1. Lead spawns N child agents under itself with `flo agents spawn ... --parent <lead>`
//   2. Lead creates pending tasks with `flo tasks create ... [--parent <task>]`
//   3. Each child agent loops: `flo agents auto-assign --by <self-id>` to claim next pending
//   4. On finish: `flo agents complete-task <task-id> --by <self-id>` —
//      marks task complete, stores success pattern in flo memory,
//      sends a message to the parent (lead) agent's mailbox.
//
// Atomicity caveat: append-only event log + materialize is optimistic. Two
// agents calling auto-assign at the exact same moment can both think they
// won. Cooperative agents in practice don't race; documented as a known limit.

import { listTasks, updateTask, getTask } from './tasks-store.js';
import { listAgents, updateAgent, getAgent } from './agents-store.js';
import { storeEntry } from './memory-store.js';
import { sendMessageToMailbox } from './messages.js';

export async function autoAssign({ agentId }) {
  if (!agentId) throw new Error('autoAssign: agentId is required');
  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`autoAssign: unknown agent ${agentId}`);
  const pending = await listTasks({ status: 'pending', limit: 50 });
  // Filter: tasks not yet owned by anyone
  const unowned = pending.filter((t) => !t.owner);
  if (!unowned.length) return { claimed: false, reason: 'no pending unowned tasks' };
  // Pick oldest by createdAt (FIFO fairness)
  const target = unowned.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
  await updateTask({ id: target.id, owner: agentId, status: 'in_progress' });
  // Verify we own it (optimistic check)
  const reread = await getTask(target.id);
  if (reread?.owner !== agentId) {
    return { claimed: false, reason: 'race lost', taskId: target.id, actualOwner: reread?.owner };
  }
  return { claimed: true, task: reread };
}

export async function completeTask({ taskId, agentId, result }) {
  if (!taskId) throw new Error('completeTask: taskId is required');
  if (!agentId) throw new Error('completeTask: agentId is required');
  const task = await getTask(taskId);
  if (!task) throw new Error(`completeTask: unknown task ${taskId}`);
  if (task.owner && task.owner !== agentId) {
    throw new Error(`completeTask: task ${taskId} is owned by ${task.owner}, not ${agentId}`);
  }
  await updateTask({ id: taskId, status: 'completed' });
  // Train pattern memory: store the (subject, result) pair under 'patterns' namespace
  try {
    await storeEntry({
      namespace: 'patterns',
      key: `task-success:${taskId}`,
      value: `task "${task.subject}" completed by ${agentId}${result ? `: ${String(result).slice(0, 500)}` : ''}`,
      tags: ['task-completion', task.owner || 'unknown', ...(task.tags || [])],
      metadata: { taskId, agentId, completedAt: new Date().toISOString(), result },
    });
  } catch { /* memory store is best-effort */ }
  // Notify lead (parent of agent) via mailbox
  const agent = await getAgent(agentId);
  const leadId = agent?.parent;
  let notified = false;
  if (leadId) {
    try {
      await sendMessageToMailbox({
        to: leadId,
        from: agentId,
        summary: `task ${taskId} completed`,
        message: `Task "${task.subject}" completed.${result ? `\n\nResult: ${String(result).slice(0, 2000)}` : ''}`,
      });
      notified = true;
    } catch { /* mailbox is best-effort */ }
  }
  return { completed: true, taskId, leadNotified: notified, pattern: 'stored' };
}

// Hierarchical-mesh topology: render the parent/child tree of agents.
export async function topology() {
  const agents = await listAgents();
  const byId = new Map(agents.map((a) => [a.id, a]));
  const roots = agents.filter((a) => !a.parent || !byId.has(a.parent));
  function render(node, depth = 0) {
    const children = agents.filter((a) => a.parent === node.id);
    return {
      id: node.id,
      name: node.name || node.id,
      type: node.type,
      status: node.status,
      tags: node.tags || [],
      depth,
      children: children.map((c) => render(c, depth + 1)),
    };
  }
  return roots.map((r) => render(r));
}

// CLI surface ────────────────────────────────────────────────────────────────

export async function autoAssignCmd(args) {
  const idx = args.indexOf('--by');
  const agentId = idx > -1 ? args[idx + 1] : null;
  const json = args.includes('--json');
  if (!agentId) {
    console.error('flo agents auto-assign: --by <agent-id> is required');
    process.exit(2);
  }
  const result = await autoAssign({ agentId });
  if (json) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return; }
  if (result.claimed) {
    console.log(`✓ ${agentId} claimed task ${result.task.id}: ${result.task.subject}`);
  } else {
    console.log(`= ${agentId} found no task to claim (${result.reason})`);
  }
}

export async function completeTaskCmd(args) {
  let taskId = null;
  let agentId = null;
  let result = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--by') agentId = args[++i];
    else if (args[i] === '--result') result = args[++i];
    else if (args[i] === '--json') json = true;
    else if (!taskId && !args[i].startsWith('--')) taskId = args[i];
  }
  if (!taskId || !agentId) {
    console.error('flo agents complete-task: <task-id> and --by <agent-id> are required');
    process.exit(2);
  }
  try {
    const out = await completeTask({ taskId, agentId, result });
    if (json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
    console.log(`✓ task ${taskId} completed by ${agentId}`);
    console.log(`  pattern: ${out.pattern}`);
    console.log(`  lead notified: ${out.leadNotified}`);
  } catch (err) {
    console.error(`flo agents complete-task: ${err.message}`);
    process.exit(1);
  }
}

export async function topologyCmd(args) {
  const json = args.includes('--json');
  const tree = await topology();
  if (json) { process.stdout.write(JSON.stringify(tree, null, 2) + '\n'); return; }
  if (!tree.length) { console.log('(no agents yet)'); return; }
  for (const root of tree) renderText(root, 0);
}

function renderText(node, depth) {
  const indent = '  '.repeat(depth);
  const status = node.status || 'unknown';
  const tags = node.tags?.length ? ` [${node.tags.join(',')}]` : '';
  console.log(`${indent}${depth === 0 ? '◉' : '├'} ${node.name} (${node.type}, ${status})${tags}`);
  for (const child of node.children) renderText(child, depth + 1);
}
