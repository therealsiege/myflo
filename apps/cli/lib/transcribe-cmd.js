import { transcribe, transcribeAndSaveSidecar, detectTool } from './transcribe.js';

export async function transcribeCommand(args) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(`flo transcribe — local audio transcription

Detects mlx-whisper / openai-whisper / whisper-cpp at runtime and uses the
first available. No cloud calls.

Usage:
  flo transcribe <audio-file> [--save] [--model base|small|medium|large]
  flo transcribe --detect

Options:
  --save           Write a sidecar .txt next to the audio file.
  --model <name>   Whisper model (default: base; env FLO_WHISPER_MODEL).
  --detect         Just report which tool would be used.
  --json           JSON output.
  -h, --help       Show this help.

Audio formats: m4a, wav, mp3, aiff, flac (anything ffmpeg can decode).
`);
    return;
  }

  if (parsed.detect) {
    const tool = await detectTool();
    if (parsed.json) {
      console.log(JSON.stringify({ tool: tool?.name || null, binary: tool?.binary || null }));
    } else if (tool) {
      console.log(`flo transcribe: would use ${tool.name} (${tool.binary})`);
    } else {
      console.log(`flo transcribe: no tool available. Install one of: mlx-whisper, openai-whisper, whisper-cpp.`);
      process.exit(1);
    }
    return;
  }

  if (!parsed.file) {
    console.error(`flo transcribe: missing <audio-file>`);
    console.error(`Usage: flo transcribe <audio-file> [--save]`);
    process.exit(2);
  }

  const result = parsed.save
    ? await transcribeAndSaveSidecar(parsed.file, { model: parsed.model })
    : await transcribe(parsed.file, { model: parsed.model });

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.text) {
    if (parsed.save) {
      process.stderr.write(`flo transcribe: wrote ${result.sidecar}\n`);
    }
    console.log(result.text);
  } else {
    console.error(`flo transcribe: ${result.error}`);
    process.exit(1);
  }
}

function parseArgs(args) {
  const out = { help: false, file: null, save: false, json: false, detect: false, model: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--save') out.save = true;
    else if (a === '--json') out.json = true;
    else if (a === '--detect') out.detect = true;
    else if (a === '--model') out.model = args[++i];
    else if (!a.startsWith('--') && !out.file) out.file = a;
  }
  return out;
}
