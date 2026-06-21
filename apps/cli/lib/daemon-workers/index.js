// Worker registry. Each worker is a module that default-exports
//   { name, description, async run({ projectDir, log }): { ok, summary, ...details } }
// Adding a new worker = dropping a new file in this dir + registering here.

import auditWorker from './audit.js';
import documentWorker from './document.js';
import testgapsWorker from './testgaps.js';
import { stubWorker } from './_stub.js';

const STUBS = ['optimize', 'deepdive', 'refactor', 'benchmark', 'ultralearn', 'predict', 'consolidate', 'map'];

const registry = new Map();
function register(w) { registry.set(w.name, w); }
register(auditWorker);
register(documentWorker);
register(testgapsWorker);
for (const name of STUBS) register(stubWorker(name));

export function listWorkers() {
  return [...registry.values()].map((w) => ({
    name: w.name,
    description: w.description,
    stub: w.stub === true,
  }));
}

export function getWorker(name) {
  return registry.get(name) || null;
}

export async function runWorker(name, ctx) {
  const w = getWorker(name);
  if (!w) throw new Error(`unknown worker: ${name}`);
  return await w.run(ctx);
}
