// In-process wrapper around auto-security.js's CLI-level scan flow, so the
// audit worker can collect findings programmatically. The CLI prints to stdout;
// here we collect into an array.
//
// Kept thin to avoid duplicating the secret-pattern regex set or the npm audit
// invocation logic — those still live in auto-security.js.

import { readdir, stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { _internal } from '../auto-security.js';

const { SECRET_PATTERNS } = _internal;

const TEXTUAL_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml', '.toml',
  '.env', '.envrc', '.sh', '.bash', '.zsh', '.fish', '.py', '.rb', '.go', '.rs',
  '.md', '.txt', '.conf', '.config', '.ini',
]);

export async function runScan(dir) {
  const findings = [];
  if (existsSync(join(dir, 'package.json'))) {
    const a = await runNpmAudit(dir);
    if (a && a.totalVulnerabilities > 0) {
      findings.push({
        ts: new Date().toISOString(),
        kind: 'npm-audit',
        file: join(dir, 'package.json'),
        projectDir: dir,
        total: a.totalVulnerabilities,
        severities: a.metadata,
        summary: `${a.totalVulnerabilities} npm vulnerabilities`,
      });
    }
  }
  await walkAndScan(dir, dir, 4, findings);
  return findings;
}

async function walkAndScan(rootDir, dir, depthRemaining, findings) {
  if (depthRemaining < 0) return;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist' || ent.name === 'build') continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkAndScan(rootDir, full, depthRemaining - 1, findings);
    } else if (ent.isFile()) {
      const ext = extname(full).toLowerCase();
      if (!TEXTUAL_EXT.has(ext) && !ent.name.startsWith('.env')) continue;
      try {
        const st = await stat(full);
        if (st.size > 500_000) continue;
      } catch { continue; }
      let body;
      try { body = await readFile(full, 'utf8'); } catch { continue; }
      if (body.length > 1_000_000) continue;
      const lines = body.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const { kind, re } of SECRET_PATTERNS) {
          if (re.test(lines[i])) {
            findings.push({
              ts: new Date().toISOString(),
              kind: 'secret-pattern',
              file: full,
              pattern: kind,
              line: i + 1,
              excerpt: lines[i].length > 200 ? lines[i].slice(0, 200) + '...' : lines[i],
              summary: `possible ${kind} in ${basename(full)}:${i + 1}`,
            });
            break;
          }
        }
      }
    }
  }
}

async function runNpmAudit(dir) {
  return new Promise((resolve) => {
    const p = spawn('npm', ['audit', '--json'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
    let stdout = '';
    p.stdout.on('data', (b) => { stdout += b.toString(); });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      try {
        const j = JSON.parse(stdout);
        const meta = j.metadata?.vulnerabilities || {};
        const total = Object.values(meta).reduce((a, b) => a + (Number(b) || 0), 0);
        resolve({ totalVulnerabilities: total, metadata: meta });
      } catch {
        resolve(null);
      }
    });
  });
}
