import { readFile, readdir, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_DIR = '.swarm';
const CONSENSUS_FILE = 'consensus.jsonl';

export async function recordVote({ proposal, voter, vote, weight, metadata, dir = DEFAULT_DIR }) {
  if (!proposal) throw new Error('recordVote: proposal is required');
  if (!voter) throw new Error('recordVote: voter is required');
  const fullDir = resolve(dir);
  if (!existsSync(fullDir)) await mkdir(fullDir, { recursive: true });
  const event = {
    proposal: String(proposal),
    voter: String(voter),
    vote: String(vote ?? 'yes'),
    weight: typeof weight === 'number' ? weight : 1,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    ts: new Date().toISOString(),
  };
  await appendFile(join(fullDir, CONSENSUS_FILE), JSON.stringify(event) + '\n', 'utf8');
  return event;
}

export async function listVotes({ proposal, dir = DEFAULT_DIR } = {}) {
  const fullDir = resolve(dir);
  const path = join(fullDir, CONSENSUS_FILE);
  if (!existsSync(path)) return [];
  let raw = '';
  try { raw = await readFile(path, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (!proposal || row.proposal === proposal) out.push(row);
    } catch { /* skip */ }
  }
  return out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

export async function tallyVotes({ proposal, dir = DEFAULT_DIR }) {
  const votes = await listVotes({ proposal, dir });
  const byVoter = new Map();
  for (const v of votes) byVoter.set(v.voter, v);
  const final = [...byVoter.values()];
  const tally = {};
  let totalWeight = 0;
  for (const v of final) {
    tally[v.vote] = (tally[v.vote] || 0) + v.weight;
    totalWeight += v.weight;
  }
  return { proposal, totalVoters: final.length, totalWeight, tally };
}

export async function readSwarmState(dir = DEFAULT_DIR) {
  const fullDir = resolve(dir);
  if (!existsSync(fullDir)) return { available: false, dir: fullDir };

  const state = await safeReadJson(join(fullDir, 'state.json'));
  const qlearn = await safeReadJson(join(fullDir, 'q-learning-model.json'));

  // Compact q-learning summary — the full qTable can be huge.
  let qlearnSummary = null;
  if (qlearn) {
    const qStates = Object.keys(qlearn.qTable || {});
    qlearnSummary = {
      version: qlearn.version,
      encoderVersion: qlearn.encoderVersion,
      config: qlearn.config,
      stats: qlearn.stats,
      metadata: qlearn.metadata,
      stateCount: qStates.length,
      sampleStates: qStates.slice(0, 5).map((s) => ({
        state: s,
        visits: qlearn.qTable[s]?.visits ?? 0,
        topQ: Math.max(...(qlearn.qTable[s]?.qValues || [0])),
      })),
    };
  }

  return {
    available: true,
    dir: fullDir,
    state,
    qlearn: qlearnSummary,
  };
}

async function safeReadJson(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function swarmCommand(args) {
  const [sub = 'status', ...rest] = args;
  if (sub === 'status') return swarmStatusCommand(rest);
  if (sub === 'vote') return swarmVoteCommand(rest);
  if (sub === 'tally') return swarmTallyCommand(rest);
  if (sub === 'votes') return swarmVotesCommand(rest);
  if (sub === 'help' || sub === '--help' || sub === '-h') return printSwarmHelp();
  console.error(`flo swarm: unknown subcommand '${sub}'`);
  console.error(`Available: status, vote, tally, votes, help`);
  process.exit(2);
}

function printSwarmHelp() {
  console.log(`flo swarm — coordination + lightweight consensus

Usage:
  flo swarm status [--dir <path>] [--json]
  flo swarm vote <proposal> --voter <id> [--vote yes|no|abstain] [--weight N] [--json]
  flo swarm tally <proposal> [--json]
  flo swarm votes [<proposal>] [--json]

State files under .swarm/ in the current project:
  state.json            — populated by 'npx ruflo swarm init' (read-only here)
  q-learning-model.json — read-only
  consensus.jsonl       — append-only votes (last vote per voter wins)
`);
}

async function swarmVoteCommand(args) {
  let proposal, voter, vote = 'yes', weight, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--voter') voter = args[++i];
    else if (a === '--vote') vote = args[++i];
    else if (a === '--weight') weight = Number(args[++i]);
    else if (a === '--json') json = true;
    else if (!a.startsWith('--') && !proposal) proposal = a;
  }
  if (!proposal) { console.error(`flo swarm vote: missing <proposal>`); process.exit(2); }
  if (!voter) { console.error(`flo swarm vote: missing --voter <id>`); process.exit(2); }
  const event = await recordVote({ proposal, voter, vote, weight });
  if (json) console.log(JSON.stringify(event));
  else console.log(`flo swarm vote: ${voter} voted '${vote}' on '${proposal}' (weight ${event.weight})`);
}

async function swarmTallyCommand(args) {
  let proposal, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') json = true;
    else if (!a.startsWith('--') && !proposal) proposal = a;
  }
  if (!proposal) { console.error(`flo swarm tally: missing <proposal>`); process.exit(2); }
  const result = await tallyVotes({ proposal });
  if (json) console.log(JSON.stringify(result));
  else {
    console.log(`flo swarm tally for '${proposal}':`);
    console.log(`  voters: ${result.totalVoters}, total weight: ${result.totalWeight}`);
    for (const [vote, weight] of Object.entries(result.tally)) {
      console.log(`  ${vote}: ${weight}`);
    }
  }
}

async function swarmVotesCommand(args) {
  let proposal, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') json = true;
    else if (!a.startsWith('--') && !proposal) proposal = a;
  }
  const votes = await listVotes({ proposal });
  if (json) { console.log(JSON.stringify(votes, null, 2)); return; }
  if (!votes.length) { console.log(`flo swarm votes: none${proposal ? ' for ' + proposal : ''}`); return; }
  console.log(`when                 proposal              voter            vote    weight`);
  console.log(`-------------------  --------------------  ---------------  ------  ------`);
  for (const v of votes) {
    const when = v.ts.replace('T', ' ').slice(0, 19);
    const p = v.proposal.padEnd(20).slice(0, 20);
    const voter = v.voter.padEnd(15).slice(0, 15);
    const vote = v.vote.padEnd(6).slice(0, 6);
    console.log(`${when}  ${p}  ${voter}  ${vote}  ${v.weight}`);
  }
}

export async function swarmStatusCommand(args) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(`flo swarm status — read .swarm/ state

Usage:
  flo swarm status [--dir <path>] [--json]
`);
    return;
  }
  const result = await readSwarmState(parsed.dir);
  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.available) {
    console.log(`flo swarm: no .swarm/ directory at ${result.dir}`);
    return;
  }
  console.log(`flo swarm status: ${result.dir}`);
  if (result.state) {
    console.log(`  id:        ${result.state.swarmId}`);
    console.log(`  objective: ${result.state.objective}`);
    console.log(`  strategy:  ${result.state.strategy}`);
    console.log(`  status:    ${result.state.status}`);
    console.log(`  agents:    ${result.state.agents}`);
    if (result.state.agentPlan?.length) {
      console.log(`  plan:`);
      for (const p of result.state.agentPlan) {
        console.log(`    - ${p.count}× ${p.role} (${p.type}): ${p.purpose}`);
      }
    }
  }
  if (result.qlearn) {
    console.log(`  q-learning:`);
    console.log(`    states:   ${result.qlearn.stateCount}`);
    console.log(`    steps:    ${result.qlearn.stats?.stepCount ?? 0}`);
    console.log(`    epsilon:  ${result.qlearn.stats?.epsilon?.toFixed(4) ?? '—'}`);
    console.log(`    avg TD:   ${result.qlearn.stats?.avgTDError?.toFixed(4) ?? '—'}`);
  }
}

function parseArgs(args) {
  const out = { help: false, dir: DEFAULT_DIR, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dir') out.dir = args[++i];
    else if (a === '--json') out.json = true;
  }
  return out;
}
