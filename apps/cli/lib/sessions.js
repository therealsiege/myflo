import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_DIR = '.claude/checkpoints';

export async function sessionsList(args) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(`flo sessions list — list Claude Code checkpoints

Usage:
  flo sessions list [--dir <path>] [--limit <n>] [--json]

Options:
  --dir <path>    Checkpoints directory (default: ${DEFAULT_DIR}).
  --limit <n>     Max checkpoints to show (default: 25).
  --json          Output JSON.
  -h, --help      Show this help.
`);
    return;
  }
  const records = await readCheckpoints(parsed.dir, parsed.limit);
  if (parsed.json) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }
  if (!records.length) {
    console.log(`flo sessions: no checkpoints found in ${parsed.dir}`);
    return;
  }
  console.log(`tag                                  type        file`);
  console.log(`-----------------------------------  ----------  ----`);
  for (const r of records) {
    const tag = (r.tag || '(no-tag)').padEnd(36).slice(0, 36);
    const type = (r.type || '').padEnd(10).slice(0, 10);
    console.log(`${tag}  ${type}  ${r.file || ''}`);
  }
  console.log(`\n${records.length} checkpoint(s).`);
}

export async function readCheckpoints(dir = DEFAULT_DIR, limit = 25) {
  const fullDir = resolve(dir);
  if (!existsSync(fullDir)) return [];
  const entries = await readdir(fullDir);
  const records = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const path = join(fullDir, name);
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw);
      const st = await stat(path);
      records.push({
        id: name.replace(/\.json$/, ''),
        path,
        mtime: st.mtimeMs,
        tag: parsed.tag,
        timestamp: parsed.timestamp,
        type: parsed.type,
        file: parsed.file,
        branch: parsed.branch,
      });
    } catch {
      // skip malformed
    }
  }
  records.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return records.slice(0, limit);
}

function parseArgs(args) {
  const out = { help: false, dir: DEFAULT_DIR, limit: 25, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dir') out.dir = args[++i];
    else if (a === '--limit') out.limit = Number(args[++i]);
    else if (a === '--json') out.json = true;
  }
  return out;
}
