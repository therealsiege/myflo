import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_DIR = '.swarm';

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
