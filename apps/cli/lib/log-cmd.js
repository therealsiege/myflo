// `flo log` — continuous activity tailer. Polls every N seconds and prints
// any events newer than the last seen timestamp.

// activity.js is on PR #35; if it's not present on this branch, `flo log`
// reports that gracefully instead of failing the whole CLI.
let collectActivity;
try {
  ({ collectActivity } = await import('./activity.js'));
} catch { /* activity module not available */ }

const POLL_MS = 2000;
const TYPE_GLYPH = {
  task: 'T', note: 'N', memory: 'M', inbox: 'I',
  transcript: 'A', terminal: '$', checkpoint: 'C',
};

export async function logCommand(args) {
  const opts = parseFlags(args);
  if (opts.help) return printHelp();

  if (!collectActivity) {
    console.error(`flo log: requires the activity module (not present on this branch).`);
    console.error(`This will work after PR #35 ('flo activity') merges to main.`);
    process.exit(1);
  }

  const intervalMs = (opts.interval || POLL_MS / 1000) * 1000;
  process.stderr.write(`flo log: tailing activity (every ${intervalMs}ms; Ctrl-C to stop)\n`);

  // Seed with the most recent event so we don't dump history at startup
  let cursor = Date.now();
  const initial = await collectActivity({ sinceMs: cursor - 60_000 });
  if (initial.length > 0) cursor = initial[0].ts;

  let stopped = false;
  process.on('SIGINT', () => { stopped = true; });
  process.on('SIGTERM', () => { stopped = true; });

  while (!stopped) {
    try {
      const events = await collectActivity({ sinceMs: cursor + 1, type: opts.type });
      if (events.length > 0) {
        // collectActivity returns newest-first; print oldest-first so tail reads naturally
        const sorted = [...events].sort((a, b) => a.ts - b.ts);
        for (const e of sorted) {
          const time = e.timestamp.replace('T', ' ').slice(0, 19);
          const glyph = TYPE_GLYPH[e.type] || '?';
          console.log(`${time}  ${glyph} ${e.type.padEnd(10)}  ${e.snippet}`);
        }
        cursor = events[0].ts;
      }
    } catch (err) {
      process.stderr.write(`flo log: error — ${err.message}\n`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function printHelp() {
  console.log(`flo log — tail activity events continuously

Usage:
  flo log [--type <type>] [--interval <seconds>]

  --type <t>          Filter (task / note / memory / inbox / transcript / terminal / checkpoint)
  --interval <s>      Poll interval (default: 2 seconds)
  -h, --help          Show this help

Press Ctrl-C to stop. Seeds with current time so old events don't dump on start.
`);
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--type') out.type = args[++i];
    else if (a === '--interval') out.interval = Number(args[++i]);
  }
  return out;
}
