// `flo transcripts list` — surface sidecar .txt files produced by audio
// transcription (inbox watcher or standalone `flo transcribe --save`).

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { listInboxes } from './inbox-registry.js';

const AUDIO_EXTS = new Set(['.m4a', '.wav', '.mp3', '.aiff', '.flac']);

export async function transcriptsCommand(args) {
  const [sub = 'list', ...rest] = args;
  if (sub === 'help' || sub === '--help' || sub === '-h') return printHelp();
  if (sub === 'list') return listCommand(rest);
  console.error(`flo transcripts: unknown subcommand '${sub}'`);
  console.error(`Available: list, help`);
  process.exit(2);
}

function printHelp() {
  console.log(`flo transcripts — list sidecar transcripts from registered inboxes

Usage:
  flo transcripts list [--json] [--limit N]

Scans every registered inbox's .processed/ folder for audio files whose
sidecar .txt was written next to them by the inbox watcher.
`);
}

async function listCommand(args) {
  let json = false, limit = 50;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') json = true;
    else if (args[i] === '--limit') limit = Number(args[++i]);
  }
  const transcripts = await collectTranscripts(limit);
  if (json) { console.log(JSON.stringify(transcripts, null, 2)); return; }
  if (!transcripts.length) {
    console.log(`flo transcripts: none found. Audio drops in registered inboxes will produce transcripts here.`);
    return;
  }
  console.log(`when                 inbox             file                              chars  snippet`);
  console.log(`-------------------  ----------------  --------------------------------  -----  ----------------`);
  for (const t of transcripts) {
    const when = new Date(t.mtime).toISOString().slice(0, 19).replace('T', ' ');
    const inbox = (t.inboxSlug || '?').padEnd(16).slice(0, 16);
    const file = (t.audioFilename || '?').padEnd(32).slice(0, 32);
    const chars = String(t.chars).padStart(5);
    const snippet = (t.snippet || '').slice(0, 60);
    console.log(`${when}  ${inbox}  ${file}  ${chars}  ${snippet}`);
  }
}

export async function collectTranscripts(limit = 200) {
  const inboxes = await listInboxes();
  const transcripts = [];
  for (const inbox of inboxes) {
    if (!inbox.exists) continue;
    const dirs = [join(inbox.dir, '.processed'), inbox.dir];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      let entries;
      try { entries = await readdir(dir); } catch { continue; }
      for (const name of entries) {
        const ext = extname(name).toLowerCase();
        if (!AUDIO_EXTS.has(ext)) continue;
        const audioPath = join(dir, name);
        const sidecar = audioPath + '.txt';
        if (!existsSync(sidecar)) continue;
        try {
          const [audioStat, txt] = await Promise.all([
            stat(audioPath),
            readFile(sidecar, 'utf8'),
          ]);
          const sidecarStat = await stat(sidecar);
          transcripts.push({
            inboxSlug: inbox.slug,
            inboxDir: inbox.dir,
            audioPath,
            audioFilename: basename(audioPath),
            sidecarPath: sidecar,
            audioBytes: audioStat.size,
            mtime: sidecarStat.mtimeMs,
            chars: txt.length,
            snippet: txt.trim().slice(0, 160).replace(/\s+/g, ' '),
            fullText: txt,
          });
        } catch { /* skip */ }
      }
    }
  }
  transcripts.sort((a, b) => b.mtime - a.mtime);
  return transcripts.slice(0, limit);
}
