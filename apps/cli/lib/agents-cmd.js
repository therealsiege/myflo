import {
  spawnAgent,
  updateAgent,
  stopAgent,
  deleteAgent,
  listAgents,
  getAgent,
  agentHealth,
  heartbeat,
  STATUSES,
} from './agents-store.js';

export async function agentsCommand(args) {
  const [sub = 'help', ...rest] = args;
  if (sub === 'help' || sub === '--help' || sub === '-h') return printHelp();
  if (sub === 'spawn') return spawnCmd(rest);
  if (sub === 'list') return listCmd(rest);
  if (sub === 'get' || sub === 'show') return getCmd(rest);
  if (sub === 'update') return updateCmd(rest);
  if (sub === 'heartbeat' || sub === 'hb') return hbCmd(rest);
  if (sub === 'stop') return stopCmd(rest);
  if (sub === 'delete' || sub === 'rm') return deleteCmd(rest);
  if (sub === 'health') return healthCmd(rest);
  console.error(`flo agents: unknown subcommand '${sub}'`);
  console.error(`Available: spawn, list, get, update, heartbeat, stop, delete, health, help`);
  process.exit(2);
}

function printHelp() {
  console.log(`flo agents — coordination registry for named Claude Code agents

Usage:
  flo agents spawn <type> [--name <name>] [--role <s>] [--tags a,b] [--parent <id>]
  flo agents list [--status idle|busy|completed|failed|stopped] [--type <t>] [--json]
  flo agents get <id> [--json]
  flo agents update <id> [--status <s>] [--name <n>] [--role <s>]
  flo agents heartbeat <id>
  flo agents stop <id>
  flo agents delete <id>
  flo agents health [--json]                 # heartbeat-age view of live agents

Stores append-only events at ~/.flo/agents.jsonl. Does NOT spawn a process —
Claude Code's Task tool does that. This is a coordination record so multiple
agents can discover each other.
`);
}

function parseFlags(args) {
  const out = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') out.json = true;
    else if (a === '--name') out.name = args[++i];
    else if (a === '--role') out.role = args[++i];
    else if (a === '--tags') out.tags = (args[++i] || '').split(',').map((t) => t.trim()).filter(Boolean);
    else if (a === '--parent') out.parent = args[++i];
    else if (a === '--status') out.status = args[++i];
    else if (a === '--type') out.type = args[++i];
    else if (!a.startsWith('--')) out.positional.push(a);
  }
  return out;
}

async function spawnCmd(args) {
  const opts = parseFlags(args);
  const type = opts.positional[0];
  if (!type) { console.error(`flo agents spawn: missing <type>`); process.exit(2); }
  const agent = await spawnAgent({
    type,
    name: opts.name,
    role: opts.role,
    tags: opts.tags,
    parent: opts.parent,
  });
  if (opts.json) console.log(JSON.stringify(agent));
  else console.log(`flo agents spawn: ${agent.id} (${agent.type})${agent.name !== agent.id ? ' name=' + agent.name : ''}`);
}

async function listCmd(args) {
  const opts = parseFlags(args);
  const agents = await listAgents({ status: opts.status, type: opts.type });
  if (opts.json) { console.log(JSON.stringify(agents, null, 2)); return; }
  if (!agents.length) { console.log(`flo agents: none registered`); return; }
  console.log(`status      id                      type           name`);
  console.log(`----------  ----------------------  -------------  ----`);
  for (const a of agents) {
    const sts = (a.status || '?').padEnd(10).slice(0, 10);
    const id = a.id.padEnd(22).slice(0, 22);
    const type = (a.type || '?').padEnd(13).slice(0, 13);
    console.log(`${sts}  ${id}  ${type}  ${a.name || ''}`);
  }
}

async function getCmd(args) {
  const opts = parseFlags(args);
  const id = opts.positional[0];
  if (!id) { console.error(`flo agents get: missing <id>`); process.exit(2); }
  const agent = await getAgent(id);
  if (!agent) { console.error(`flo agents get: no agent ${id}`); process.exit(1); }
  if (opts.json) console.log(JSON.stringify(agent, null, 2));
  else {
    console.log(`${agent.id}`);
    console.log(`type:           ${agent.type}`);
    console.log(`name:           ${agent.name}`);
    console.log(`status:         ${agent.status}`);
    if (agent.role) console.log(`role:           ${agent.role}`);
    if (agent.tags?.length) console.log(`tags:           ${agent.tags.join(', ')}`);
    if (agent.parent) console.log(`parent:         ${agent.parent}`);
    console.log(`spawnedAt:      ${agent.spawnedAt}`);
    console.log(`lastHeartbeat:  ${agent.lastHeartbeat}`);
  }
}

async function updateCmd(args) {
  const opts = parseFlags(args);
  const id = opts.positional[0];
  if (!id) { console.error(`flo agents update: missing <id>`); process.exit(2); }
  const patch = {};
  if (opts.status !== undefined) {
    if (!STATUSES.includes(opts.status)) {
      console.error(`flo agents update: invalid status '${opts.status}'. Valid: ${STATUSES.join(', ')}`);
      process.exit(2);
    }
    patch.status = opts.status;
  }
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.role !== undefined) patch.role = opts.role;
  if (Object.keys(patch).length === 0) {
    console.error(`flo agents update: nothing to change`);
    process.exit(2);
  }
  const agent = await updateAgent({ id, ...patch });
  if (!agent) { console.error(`flo agents update: no agent ${id}`); process.exit(1); }
  console.log(`flo agents update: ${agent.id} status=${agent.status}`);
}

async function hbCmd(args) {
  const id = args[0];
  if (!id) { console.error(`flo agents heartbeat: missing <id>`); process.exit(2); }
  const agent = await heartbeat(id);
  if (!agent) { console.error(`flo agents heartbeat: no agent ${id}`); process.exit(1); }
  console.log(`flo agents heartbeat: ${agent.id} at ${agent.lastHeartbeat}`);
}

async function stopCmd(args) {
  const id = args[0];
  if (!id) { console.error(`flo agents stop: missing <id>`); process.exit(2); }
  const agent = await stopAgent(id);
  if (!agent) { console.error(`flo agents stop: no agent ${id}`); process.exit(1); }
  console.log(`flo agents stop: ${agent.id} stopped`);
}

async function deleteCmd(args) {
  const id = args[0];
  if (!id) { console.error(`flo agents delete: missing <id>`); process.exit(2); }
  await deleteAgent(id);
  console.log(`flo agents delete: tombstoned ${id}`);
}

async function healthCmd(args) {
  const opts = parseFlags(args);
  const health = await agentHealth();
  if (opts.json) { console.log(JSON.stringify(health, null, 2)); return; }
  if (!health.length) { console.log(`flo agents health: no live agents`); return; }
  console.log(`health   id                      heartbeat age   name`);
  console.log(`-------  ----------------------  --------------  ----`);
  for (const h of health) {
    const tag = (h.health || '?').padEnd(7).slice(0, 7);
    const id = h.id.padEnd(22).slice(0, 22);
    const ageS = Math.round(h.heartbeatAgeMs / 1000);
    console.log(`${tag}  ${id}  ${String(ageS).padStart(8)}s    ${h.name || ''}`);
  }
}
