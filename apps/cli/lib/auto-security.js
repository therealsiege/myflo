// Auto-Security — `npm audit` runner + secret scanner.
//
// Runs on post-edit hook for relevant file types:
//   - package.json / lockfile edits → `npm audit --json` against the project
//   - source edits → grep for obvious secret patterns (API keys, tokens, .env leaks)
//
// Findings written to ~/.flo/security/findings.jsonl. CLI surface:
//   flo security scan [--dir .]           Run audit + secret scan on demand
//   flo security findings [--since 7d]    List recent findings
//
// No external API. `npm audit` consults its local lockfile only. Secret patterns
// are simple regex (won't catch sophisticated leaks but catches common mistakes).

import { mkdir, appendFile, readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { spawn } from 'node:child_process';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const SEC_DIR = join(FLO_HOME, 'security');
const FINDINGS_LOG = join(SEC_DIR, 'findings.jsonl');

// Patterns that suggest a secret. Conservative — false positives are annoying
// but missed leaks are worse, so we err toward flagging.
const SECRET_PATTERNS = [
  { kind: 'aws-access-key',     re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'aws-secret-key',     re: /(?<![A-Za-z0-9])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9])(?=.*aws|.*secret)/i },
  { kind: 'github-token',       re: /\bghp_[A-Za-z0-9]{36}\b|\bghs_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{82}\b/ },
  { kind: 'slack-token',        re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/ },
  { kind: 'stripe-key',         re: /\bsk_(test|live)_[A-Za-z0-9]{20,}\b/ },
  { kind: 'openai-key',         re: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { kind: 'anthropic-key',      re: /\bsk-ant-(api|admin)\d+-[A-Za-z0-9_-]{30,}\b/ },
  { kind: 'private-key-pem',    re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { kind: 'jwt-literal',        re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { kind: 'generic-password',   re: /(password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i },
  { kind: 'generic-secret',     re: /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-/=]{20,}['"]/i },
];

// File extensions worth scanning (text formats). Binary / generated files skipped.
const TEXTUAL_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml', '.toml',
  '.env', '.envrc', '.sh', '.bash', '.zsh', '.fish', '.py', '.rb', '.go', '.rs',
  '.md', '.txt', '.conf', '.config', '.ini',
]);

const PKG_FILE_RE = /(^|\/)(package(-lock)?|pnpm-lock|yarn\.lock)\.(json|yaml)$/;

export async function ensureDir() {
  if (!existsSync(SEC_DIR)) await mkdir(SEC_DIR, { recursive: true });
}

async function appendFinding(finding) {
  await ensureDir();
  await appendFile(FINDINGS_LOG, JSON.stringify(finding) + '\n', 'utf8');
}

// Run on every post-edit hook. Returns array of findings (may be empty).
export async function maybeScanEdit({ filePath, projectDir }) {
  const findings = [];
  if (!filePath) return findings;
  // npm audit on package.json / lockfile edits
  if (PKG_FILE_RE.test(filePath)) {
    const dir = projectDir || process.cwd();
    const audit = await runNpmAudit(dir);
    if (audit && audit.totalVulnerabilities > 0) {
      const finding = {
        ts: new Date().toISOString(),
        kind: 'npm-audit',
        file: filePath,
        projectDir: dir,
        total: audit.totalVulnerabilities,
        severities: audit.metadata,
        summary: `${audit.totalVulnerabilities} npm vulnerabilities after edit`,
      };
      await appendFinding(finding);
      findings.push(finding);
    }
  }
  // Secret scan on text files
  if (TEXTUAL_EXT.has(extname(filePath).toLowerCase()) || basename(filePath).startsWith('.env')) {
    const hits = await scanFileForSecrets(filePath);
    for (const hit of hits) {
      const finding = {
        ts: new Date().toISOString(),
        kind: 'secret-pattern',
        file: filePath,
        pattern: hit.kind,
        line: hit.line,
        excerpt: hit.excerpt,
        summary: `possible ${hit.kind} in ${basename(filePath)}:${hit.line}`,
      };
      await appendFinding(finding);
      findings.push(finding);
    }
  }
  return findings;
}

async function scanFileForSecrets(filePath) {
  if (!existsSync(filePath)) return [];
  let body;
  try {
    body = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  if (body.length > 1_000_000) return []; // skip huge files (likely generated)
  const lines = body.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { kind, re } of SECRET_PATTERNS) {
      if (re.test(line)) {
        hits.push({
          kind,
          line: i + 1,
          excerpt: line.length > 200 ? line.slice(0, 200) + '...' : line,
        });
        break; // one hit per line is enough
      }
    }
  }
  return hits;
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

// CLI surface ────────────────────────────────────────────────────────────────

export async function securityCommand(args) {
  const [sub = 'help', ...rest] = args;
  switch (sub) {
    case 'scan':     return securityScan(rest);
    case 'findings': return securityFindings(rest);
    case 'help':
    case '--help':
    case '-h':
      return securityHelp();
    default:
      console.error(`flo security: unknown subcommand '${sub}'`);
      securityHelp();
      process.exit(2);
  }
}

function securityHelp() {
  console.log(`flo security — local-first security audit

Usage:
  flo security scan [--dir <path>]          Run npm audit + secret scan on the dir tree
  flo security findings [--since 7d|24h]    Show recent findings from ~/.flo/security/

Findings are appended to ~/.flo/security/findings.jsonl by:
  - explicit \`flo security scan\` runs
  - automatic post-edit hook (package.json / source file edits)

Secret-pattern detection covers AWS keys, GitHub/Slack/Stripe/OpenAI/Anthropic
tokens, PEM private keys, JWT literals, generic password/api_key assignments.

No network calls. npm audit consults the local lockfile only.`);
}

async function securityScan(args) {
  let dir = process.cwd();
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') dir = args[++i];
    else if (args[i] === '--json') json = true;
  }
  const findings = [];
  // npm audit if a package.json is in the dir
  if (existsSync(join(dir, 'package.json'))) {
    const a = await runNpmAudit(dir);
    if (a && a.totalVulnerabilities > 0) {
      const f = {
        ts: new Date().toISOString(), kind: 'npm-audit',
        file: join(dir, 'package.json'), projectDir: dir,
        total: a.totalVulnerabilities, severities: a.metadata,
        summary: `${a.totalVulnerabilities} npm vulnerabilities`,
      };
      await appendFinding(f); findings.push(f);
    }
  }
  // walk the dir tree for secret scanning (cap depth to avoid node_modules etc)
  await walkAndScan(dir, dir, 4, findings);
  if (json) {
    process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
  } else {
    if (!findings.length) {
      console.log(`✓ no security findings in ${dir}`);
    } else {
      console.log(`Found ${findings.length} security finding(s):`);
      for (const f of findings) {
        console.log(`  [${f.kind}] ${f.summary}`);
        if (f.file && f.line) console.log(`    ${f.file}:${f.line}`);
        else if (f.file) console.log(`    ${f.file}`);
      }
    }
  }
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
      // also skip huge files
      try {
        const st = await stat(full);
        if (st.size > 500_000) continue;
      } catch { continue; }
      const hits = await scanFileForSecrets(full);
      for (const hit of hits) {
        const f = {
          ts: new Date().toISOString(), kind: 'secret-pattern',
          file: full, pattern: hit.kind, line: hit.line, excerpt: hit.excerpt,
          summary: `possible ${hit.kind} in ${basename(full)}:${hit.line}`,
        };
        await appendFinding(f); findings.push(f);
      }
    }
  }
}

async function securityFindings(args) {
  let since = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since') since = args[++i];
    else if (args[i] === '--json') json = true;
  }
  if (!existsSync(FINDINGS_LOG)) {
    if (json) process.stdout.write('[]\n'); else console.log('(no findings yet)');
    return;
  }
  const raw = await readFile(FINDINGS_LOG, 'utf8');
  let items = raw.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  if (since) {
    const cutoff = parseSince(since);
    if (cutoff) items = items.filter((f) => new Date(f.ts).getTime() >= cutoff);
  }
  if (json) {
    process.stdout.write(JSON.stringify(items, null, 2) + '\n');
    return;
  }
  if (!items.length) { console.log('(no findings in window)'); return; }
  for (const f of items.slice(-50)) {
    const when = new Date(f.ts).toISOString().slice(0, 16).replace('T', ' ');
    console.log(`  ${when}  [${f.kind}]  ${f.summary}`);
  }
}

function parseSince(s) {
  const m = String(s).match(/^(\d+)([smhd])$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return Date.now() - n * mult;
}

export const _internal = { SECRET_PATTERNS, classify: null, SEC_DIR, FINDINGS_LOG };
