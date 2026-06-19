// `flo export` / `flo import` — portable ~/.flo backup.
// Uses Node's stream APIs + a tiny tar-like JSON-bundle format so we don't
// pull in any tar library. Easy to unpack from any language.
//
// Bundle format (.flo.json.gz):
//   gzipped JSON: { manifest: {version, exportedAt, source}, files: [
//     { path: "memory/notes.jsonl", content: "<base64>", size, mtime },
//     ...
//   ]}

import { createGzip, createGunzip } from 'node:zlib';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { homedir } from 'node:os';
import { join, resolve, dirname, sep, normalize } from 'node:path';
import { Readable } from 'node:stream';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const BUNDLE_VERSION = 1;

export async function exportCommand(args) {
  const opts = parseFlags(args);
  if (opts.help) return printExportHelp();
  const outPath = opts.out || `flo-export-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.flo.json.gz`;

  if (!existsSync(FLO_HOME)) {
    console.error(`flo export: no ~/.flo directory at ${FLO_HOME}`);
    process.exit(1);
  }

  const files = await collectFiles(FLO_HOME, '');
  const bundle = {
    manifest: {
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      source: FLO_HOME,
      fileCount: files.length,
      totalBytes: files.reduce((s, f) => s + f.size, 0),
    },
    files,
  };

  const json = JSON.stringify(bundle);
  await pipeline(
    Readable.from(json),
    createGzip({ level: 9 }),
    createWriteStream(resolve(outPath)),
  );
  const outStat = await stat(resolve(outPath));
  console.log(`flo export: wrote ${outPath}`);
  console.log(`  ${files.length} files, ${bundle.manifest.totalBytes} bytes uncompressed, ${outStat.size} bytes compressed`);
}

export async function importCommand(args) {
  const opts = parseFlags(args);
  if (opts.help) return printImportHelp();
  const inPath = opts.positional[0];
  if (!inPath) {
    console.error(`flo import: missing <bundle>`);
    console.error(`Usage: flo import <bundle.flo.json.gz> [--target <dir>] [--force]`);
    process.exit(2);
  }
  if (!existsSync(inPath)) {
    console.error(`flo import: file not found: ${inPath}`);
    process.exit(1);
  }
  const target = resolve((opts.target || FLO_HOME).replace(/^~/, homedir()));

  // Stream-decode the gzipped JSON
  const chunks = [];
  await pipeline(
    createReadStream(inPath),
    createGunzip(),
    async function* sink(source) {
      for await (const chunk of source) chunks.push(Buffer.from(chunk));
    },
  );
  const text = Buffer.concat(chunks).toString('utf8');
  let bundle;
  try { bundle = JSON.parse(text); } catch (err) {
    console.error(`flo import: bundle is not valid JSON — ${err.message}`);
    process.exit(1);
  }

  if (!bundle?.manifest?.version) {
    console.error(`flo import: invalid bundle (no manifest)`);
    process.exit(1);
  }
  if (bundle.manifest.version > BUNDLE_VERSION) {
    console.error(`flo import: bundle version ${bundle.manifest.version} exceeds supported ${BUNDLE_VERSION}`);
    process.exit(1);
  }

  console.log(`flo import: ${bundle.files.length} files from bundle ${bundle.manifest.exportedAt}`);
  if (opts.dryRun) {
    for (const f of bundle.files.slice(0, 10)) console.log(`  would write: ${f.path}`);
    if (bundle.files.length > 10) console.log(`  …and ${bundle.files.length - 10} more`);
    return;
  }

  if (existsSync(target) && !opts.force) {
    const existing = (await readdir(target)).filter((n) => !n.startsWith('.')).length;
    if (existing > 0) {
      console.error(`flo import: target ${target} is non-empty. Use --force to overwrite.`);
      process.exit(1);
    }
  }
  await mkdir(target, { recursive: true });

  for (const f of bundle.files) {
    // Path safety: must be a relative path inside target, no traversal
    const rel = normalize(f.path);
    if (rel.startsWith('..') || rel.startsWith(sep) || rel.includes('\0')) {
      console.error(`flo import: refusing unsafe path '${f.path}' — skipped`);
      continue;
    }
    const fullPath = join(target, rel);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, Buffer.from(f.content, 'base64'));
  }
  console.log(`flo import: extracted ${bundle.files.length} files to ${target}`);
}

async function collectFiles(root, relPrefix) {
  const out = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const full = join(root, e.name);
    const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...await collectFiles(full, rel));
    } else if (e.isFile()) {
      const st = await stat(full);
      const buf = await readFile(full);
      out.push({
        path: rel,
        size: st.size,
        mtime: st.mtimeMs,
        content: buf.toString('base64'),
      });
    }
  }
  return out;
}

function printExportHelp() {
  console.log(`flo export — bundle ~/.flo/ into a portable .flo.json.gz file

Usage:
  flo export [--out <path>]

Default output filename: flo-export-<timestamp>.flo.json.gz
Format: gzipped JSON {manifest, files[]} with base64 content. No native deps,
portable across platforms.
`);
}

function printImportHelp() {
  console.log(`flo import — restore a flo export bundle

Usage:
  flo import <bundle.flo.json.gz> [--target <dir>] [--force] [--dry-run]

By default extracts to ~/.flo. Refuses to overwrite a non-empty target unless
--force. Path traversal in bundle entries is blocked.
`);
}

function parseFlags(args) {
  const out = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--out') out.out = args[++i];
    else if (a === '--target') out.target = args[++i];
    else if (a === '--force') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (!a.startsWith('--')) out.positional.push(a);
  }
  return out;
}
