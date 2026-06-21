// Audit worker — runs npm audit + secret scan across the project tree.
// Wraps the same machinery `flo security scan` uses.

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { _internal as secInternal, ensureDir } from '../auto-security.js';

export default {
  name: 'audit',
  description: 'Run npm audit + secret pattern scan across the project',
  async run({ projectDir }) {
    const dir = projectDir || process.cwd();
    await ensureDir();
    // Defer to the security module's exported scan. Capture findings count
    // by invoking the same code path the CLI uses, in --json mode but in-process.
    const { runScan } = await import('./_scan-helper.js');
    const findings = await runScan(dir);
    return {
      ok: true,
      summary: findings.length === 0
        ? 'audit: clean'
        : `audit: ${findings.length} finding(s)`,
      findingCount: findings.length,
      findingsByKind: groupByKind(findings),
    };
  },
};

function groupByKind(findings) {
  const out = {};
  for (const f of findings) out[f.kind] = (out[f.kind] || 0) + 1;
  return out;
}
