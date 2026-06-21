// Auto-ADR — heuristic detector + draft generator for Architecture Decision Records.
//
// Runs on post-edit hook: looks at the edited path, decides if the change is
// architecturally significant (schema, migration, route, infra, package change),
// and if so drops a draft ADR markdown file in ~/.flo/adr/ that the user can
// promote into their project's docs/adr/ later.
//
// No LLM — preserves the "no cloud" principle. Just templates + heuristics.

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const ADR_DIR = join(FLO_HOME, 'adr');

// Files / paths that suggest architectural significance.
const TRIGGER_PATTERNS = [
  { kind: 'schema',        pattern: /(\bschema\b|\.prisma$|\.sql$|drizzle.*config|knexfile)/i },
  { kind: 'migration',     pattern: /(migrations?\/|\bmigrate\b)/i },
  { kind: 'api-route',     pattern: /(\bapi\/|\broutes?\/|app\/api\/|pages\/api\/|\bcontrollers?\/)/i },
  { kind: 'infra',         pattern: /(terraform|cloudformation|\.tf$|Dockerfile|docker-compose|k8s|kubernetes|helm)/i },
  { kind: 'package',       pattern: /(^|\/)(package|pnpm-workspace|tsconfig)\.json$|\.npmrc$/ },
  { kind: 'ci',            pattern: /\.github\/workflows\/.*\.ya?ml$|\.gitlab-ci\.yml$|\.circleci\//i },
  { kind: 'auth',          pattern: /(auth|session|jwt|oauth|saml|sso)/i },
  { kind: 'security',      pattern: /(\.env\.|secrets?\/|crypto|cipher|hash)/i },
];

function classify(filePath) {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, '/');
  for (const { kind, pattern } of TRIGGER_PATTERNS) {
    if (pattern.test(normalized)) return kind;
  }
  return null;
}

function nextIdFrom(existingIds) {
  if (!existingIds.length) return 'ADR-001';
  const max = existingIds
    .map((id) => parseInt((id.match(/ADR-(\d+)/) || [])[1] || '0', 10))
    .reduce((a, b) => Math.max(a, b), 0);
  return `ADR-${String(max + 1).padStart(3, '0')}`;
}

async function listAdrIds() {
  if (!existsSync(ADR_DIR)) return [];
  const files = await readdir(ADR_DIR);
  return files.filter((f) => /^ADR-\d+/.test(f)).sort();
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50) || 'untitled';
}

function template({ id, kind, filePath, ts, projectDir }) {
  const fileBase = basename(filePath);
  return `# ${id}: ${kind} change in ${fileBase}

- **Status**: draft
- **Date**: ${ts.toISOString().slice(0, 10)}
- **Category**: ${kind}
- **Files**: \`${filePath}\`
${projectDir ? `- **Project**: \`${projectDir}\`\n` : ''}
## Context

A file matching the \`${kind}\` heuristic was edited. flo flagged this as
potentially architecturally significant. Replace this section with the actual
motivation: what problem is the change solving, what constraints made it
necessary?

## Decision

Describe what was decided. Keep it short — one paragraph or a bullet list of
the concrete choice made (e.g. "use JWT refresh tokens with 1h sliding expiry").

## Consequences

What becomes easier or harder as a result of this change? List both positive
and negative consequences honestly.

## Alternatives considered

Other paths that were rejected, with one-line reasons.

---

_Drafted automatically by flo (auto-ADR heuristic). Edit / promote to your
project's docs/adr/ directory, or delete if not significant._
`;
}

export async function maybeDraftAdr({ filePath, tool, projectDir }) {
  const kind = classify(filePath);
  if (!kind) return null;
  if (!existsSync(ADR_DIR)) await mkdir(ADR_DIR, { recursive: true });
  const existing = await listAdrIds();
  const id = nextIdFrom(existing);
  const ts = new Date();
  const slug = slugify(`${kind}-${basename(filePath || '')}`);
  const fileName = `${id}-${slug}.md`;
  const fullPath = join(ADR_DIR, fileName);
  if (existsSync(fullPath)) return null; // belt and suspenders
  const body = template({ id, kind, filePath, ts, projectDir });
  await writeFile(fullPath, body, 'utf8');
  return { id, kind, path: fullPath };
}

// CLI surface ────────────────────────────────────────────────────────────────

export async function adrCommand(args) {
  const [sub = 'list', ...rest] = args;
  switch (sub) {
    case 'list':   return adrList(rest);
    case 'show':   return adrShow(rest);
    case 'draft':  return adrDraft(rest);
    case 'help':
    case '--help':
    case '-h':
      return adrHelp();
    default:
      console.error(`flo adr: unknown subcommand '${sub}'`);
      adrHelp();
      process.exit(2);
  }
}

function adrHelp() {
  console.log(`flo adr — Architecture Decision Records drafted from edit-hook heuristics

Usage:
  flo adr list                              List drafted ADRs in ~/.flo/adr/
  flo adr show <id>                         Print one ADR by ID (e.g. ADR-001)
  flo adr draft --file <path> [--kind X]    Manually draft an ADR for a given file

When the post-edit hook fires on a file matching one of the trigger patterns
(schema, migration, api-route, infra, package, ci, auth, security), flo writes
a draft ADR to ~/.flo/adr/. Edit and promote into your project's docs/adr/.

No LLM is invoked. The draft is template-based — the reasoning sections are
prompts for you to fill in.`);
}

async function adrList(args) {
  const json = args.includes('--json');
  if (!existsSync(ADR_DIR)) {
    if (json) process.stdout.write('[]\n'); else console.log('(no ADRs yet)');
    return;
  }
  const files = (await readdir(ADR_DIR)).filter((f) => /^ADR-\d+.*\.md$/.test(f)).sort();
  if (json) {
    const out = await Promise.all(files.map(async (f) => {
      const body = await readFile(join(ADR_DIR, f), 'utf8');
      const title = (body.match(/^# (ADR-\d+:.*)$/m) || [])[1] || f;
      return { id: (f.match(/^ADR-\d+/) || [])[0], file: f, title, path: join(ADR_DIR, f) };
    }));
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  if (!files.length) { console.log('(no ADRs yet)'); return; }
  for (const f of files) {
    const body = await readFile(join(ADR_DIR, f), 'utf8');
    const title = (body.match(/^# (.*)$/m) || [])[1] || f;
    console.log(`  ${title}\n    ${join(ADR_DIR, f)}`);
  }
}

async function adrShow(args) {
  const id = args[0];
  if (!id) { console.error('flo adr show: missing <id>'); process.exit(2); }
  if (!existsSync(ADR_DIR)) { console.error(`no ADRs in ${ADR_DIR}`); process.exit(1); }
  const files = (await readdir(ADR_DIR)).filter((f) => f.startsWith(id));
  if (!files.length) { console.error(`flo adr show: no ADR matching '${id}'`); process.exit(1); }
  const body = await readFile(join(ADR_DIR, files[0]), 'utf8');
  process.stdout.write(body);
}

async function adrDraft(args) {
  let file = null;
  let kind = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = args[++i];
    else if (args[i] === '--kind') kind = args[++i];
  }
  if (!file) { console.error('flo adr draft: --file <path> is required'); process.exit(2); }
  // Force the kind classifier OR allow override
  const result = await maybeDraftAdr({ filePath: file, tool: 'manual', projectDir: process.cwd() });
  if (!result) {
    console.error(`flo adr draft: '${file}' doesn't match any trigger pattern. Pass --kind to override (not yet supported).`);
    process.exit(1);
  }
  console.log(`✓ drafted ${result.id} (${result.kind}): ${result.path}`);
}

export const _internal = { classify, nextIdFrom, slugify, ADR_DIR };
