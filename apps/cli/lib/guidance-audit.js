import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, relative, sep } from 'node:path';

const KINDS = ['skills', 'commands', 'agents'];

export async function guidanceAudit(args) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(`flo guidance audit — capability dedup report

Usage:
  flo guidance audit [--out <file>] [--json] [--scope user|project|all]

Options:
  --out <file>    Write markdown report to file (default: stdout).
  --json          Output JSON instead of markdown.
  --scope <s>     Restrict scope (user, project, all). Default: all.
  --quiet         Suppress progress lines on stderr.
  -h, --help      Show this help.
`);
    return;
  }

  const scopes = collectScopes(parsed.scope);
  const records = [];
  for (const scope of scopes) {
    for (const kind of KINDS) {
      const dir = join(scope.root, kind);
      if (!existsSync(dir)) continue;
      const found = await scanCapabilityDir(dir, kind, scope.label);
      records.push(...found);
    }
  }

  if (!parsed.quiet) {
    process.stderr.write(`flo guidance audit: scanned ${records.length} capabilities across ${scopes.length} scope(s)\n`);
  }

  const report = analyze(records);

  if (parsed.json) {
    const out = JSON.stringify({ records, ...report }, null, 2);
    if (parsed.out) await writeOut(parsed.out, out);
    else console.log(out);
    return;
  }

  const md = renderMarkdown(records, report);
  if (parsed.out) await writeOut(parsed.out, md);
  else console.log(md);
}

function parseArgs(args) {
  const out = { scope: 'all', json: false, quiet: false, help: false, out: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--json') out.json = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--scope') out.scope = args[++i];
    else if (a === '--out') out.out = args[++i];
  }
  return out;
}

function collectScopes(scope) {
  const scopes = [];
  if (scope === 'all' || scope === 'user') {
    scopes.push({ label: 'user', root: join(homedir(), '.claude') });
  }
  if (scope === 'all' || scope === 'project') {
    scopes.push({ label: 'project', root: join(process.cwd(), '.claude') });
  }
  return scopes;
}

async function scanCapabilityDir(dir, kind, scope) {
  const records = [];
  const walk = async (current) => {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = join(current, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const ext = e.name.split('.').pop();
        if (!['md', 'yaml', 'yml', 'json'].includes(ext)) continue;
        records.push(await inspectFile(full, kind, scope, dir));
      }
    }
  };
  await walk(dir);
  return records;
}

async function inspectFile(path, kind, scope, kindRoot) {
  let content = '';
  try { content = await readFile(path, 'utf8'); } catch {}
  const fm = parseFrontmatter(content);
  const name = fm.name || basename(path).replace(/\.(md|ya?ml|json)$/i, '');
  return {
    name,
    kind,
    scope,
    path,
    relPath: relative(kindRoot, path),
    description: fm.description || '',
    tags: Array.isArray(fm.tags) ? fm.tags : (typeof fm.tags === 'string' ? fm.tags.split(',').map(t => t.trim()) : []),
    bytes: content.length,
  };
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, '');
    }
    fm[key] = val;
  }
  return fm;
}

function analyze(records) {
  const byName = new Map();
  for (const r of records) {
    const key = `${r.kind}:${r.name}`;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(r);
  }
  const duplicates = [];
  for (const [key, list] of byName) {
    if (list.length > 1) duplicates.push({ key, name: list[0].name, kind: list[0].kind, count: list.length, occurrences: list });
  }
  const missingDescription = records.filter(r => !r.description);
  const scopeHistogram = {};
  const kindHistogram = {};
  for (const r of records) {
    scopeHistogram[r.scope] = (scopeHistogram[r.scope] || 0) + 1;
    const k = `${r.scope}:${r.kind}`;
    kindHistogram[k] = (kindHistogram[k] || 0) + 1;
  }
  return { duplicates, missingDescription, scopeHistogram, kindHistogram, total: records.length };
}

function renderMarkdown(records, report) {
  const lines = [];
  lines.push(`# flo guidance audit`);
  lines.push('');
  lines.push(`Scanned **${report.total}** capabilities.`);
  lines.push('');
  lines.push(`## Scope distribution`);
  lines.push('');
  lines.push('| Scope | Count |');
  lines.push('|---|---|');
  for (const [scope, count] of Object.entries(report.scopeHistogram).sort()) {
    lines.push(`| ${scope} | ${count} |`);
  }
  lines.push('');
  lines.push(`## Kind × scope`);
  lines.push('');
  lines.push('| Scope:kind | Count |');
  lines.push('|---|---|');
  for (const [k, count] of Object.entries(report.kindHistogram).sort()) {
    lines.push(`| ${k} | ${count} |`);
  }
  lines.push('');
  lines.push(`## Duplicates (${report.duplicates.length})`);
  lines.push('');
  if (!report.duplicates.length) {
    lines.push('_No duplicates detected._');
  } else {
    for (const dup of report.duplicates.sort((a, b) => b.count - a.count)) {
      lines.push(`### \`${dup.kind}/${dup.name}\` (${dup.count} copies)`);
      lines.push('');
      for (const o of dup.occurrences) {
        lines.push(`- \`${o.scope}\` — ${o.path}${o.description ? '  \n  > ' + o.description : ''}`);
      }
      lines.push('');
    }
  }
  lines.push(`## Missing description (${report.missingDescription.length})`);
  lines.push('');
  if (!report.missingDescription.length) {
    lines.push('_All capabilities have descriptions._');
  } else {
    for (const r of report.missingDescription.slice(0, 100)) {
      lines.push(`- \`${r.scope}/${r.kind}/${r.name}\` — ${r.path}`);
    }
    if (report.missingDescription.length > 100) {
      lines.push(`- _…and ${report.missingDescription.length - 100} more._`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

async function writeOut(path, content) {
  const parent = path.split(sep).slice(0, -1).join(sep);
  if (parent && !existsSync(parent)) await mkdir(parent, { recursive: true });
  await writeFile(path, content, 'utf8');
  process.stderr.write(`flo guidance audit: wrote ${path}\n`);
}
