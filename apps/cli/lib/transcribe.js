// Audio transcription dispatcher.
// Detects available local tools at runtime and picks the best one.
// Preference order:
//   1. mlx-whisper  (M-series Apple Silicon optimized; ~5x faster on M-chips)
//   2. whisper      (OpenAI reference CLI; pip install openai-whisper)
//   3. whisper-cpp  (cross-platform C impl)
// No cloud calls. Local-only, defensive posture.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, dirname } from 'node:path';

const execFileAsync = promisify(execFile);

const TOOLS = [
  {
    name: 'mlx-whisper',
    binary: 'mlx-whisper',
    args: (audioPath, outDir, model) => [audioPath, '--model', `mlx-community/whisper-${model}-mlx`, '--output-dir', outDir, '--output-format', 'txt'],
    txtFilename: (audioPath) => basename(audioPath).replace(/\.[^.]+$/, '.txt'),
  },
  {
    name: 'whisper',
    binary: 'whisper',
    args: (audioPath, outDir, model) => [audioPath, '--model', model, '--output_dir', outDir, '--output_format', 'txt', '--verbose', 'False'],
    txtFilename: (audioPath) => basename(audioPath).replace(/\.[^.]+$/, '.txt'),
  },
  {
    name: 'whisper-cpp',
    binary: 'whisper-cpp',
    args: (audioPath, outDir) => ['-f', audioPath, '-otxt', '-of', join(outDir, basename(audioPath).replace(/\.[^.]+$/, ''))],
    txtFilename: (audioPath) => basename(audioPath).replace(/\.[^.]+$/, '.txt'),
  },
];

/**
 * Detect the first installed transcription tool.
 * Returns the tool spec or null.
 */
export async function detectTool() {
  for (const tool of TOOLS) {
    try {
      const { stdout } = await execFileAsync('which', [tool.binary]);
      if (stdout.trim()) return tool;
    } catch { /* not installed */ }
  }
  return null;
}

/**
 * Transcribe an audio file. Returns { text, tool, error }.
 * Never throws — failures are reported in the result so the inbox can log+continue.
 */
export async function transcribe(audioPath, opts = {}) {
  const model = opts.model || process.env.FLO_WHISPER_MODEL || 'base';
  const tool = opts.tool || await detectTool();
  if (!tool) {
    return {
      text: null,
      tool: null,
      error: 'no transcription tool found; install one of: mlx-whisper, openai-whisper, whisper-cpp',
    };
  }
  if (!existsSync(audioPath)) {
    return { text: null, tool: tool.name, error: `audio file not found: ${audioPath}` };
  }
  const outDir = await mkdtemp(join(tmpdir(), 'flo-transcribe-'));
  try {
    const args = tool.args(audioPath, outDir, model);
    await execFileAsync(tool.binary, args, {
      timeout: opts.timeoutMs || 5 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const txtPath = join(outDir, tool.txtFilename(audioPath));
    if (!existsSync(txtPath)) {
      return { text: null, tool: tool.name, error: `transcript file not produced at ${txtPath}` };
    }
    const text = await readFile(txtPath, 'utf8');
    return { text: text.trim(), tool: tool.name, error: null };
  } catch (err) {
    return {
      text: null,
      tool: tool.name,
      error: err.message || String(err),
    };
  }
}

/**
 * Convenience: transcribe + save a sidecar .txt next to the original audio file.
 */
export async function transcribeAndSaveSidecar(audioPath, opts = {}) {
  const result = await transcribe(audioPath, opts);
  if (result.text) {
    const sidecar = audioPath + '.txt';
    const { writeFile } = await import('node:fs/promises');
    await writeFile(sidecar, result.text + '\n', 'utf8');
    result.sidecar = sidecar;
  }
  return result;
}
