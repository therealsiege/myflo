#!/usr/bin/env node
import { run } from '../lib/main.js';

run(process.argv.slice(2)).catch((err) => {
  console.error(`flo: ${err.message || err}`);
  if (process.env.FLO_DEBUG) console.error(err.stack);
  process.exit(1);
});
