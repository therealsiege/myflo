import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function printHelp() {
  console.log(`flo — local-first developer workbench for Claude Code

Usage:
  flo <command> [subcommand] [options]
  flo <command> --help                 Show subcommand-level help

CAPTURE
  notes "<text>" [--tags a,b]          Append a quick note to ~/.flo/notes.jsonl
  tasks {create|list|update|complete|delete|get|counts}
                                       Persistent task tracker. \`tasks create\`
                                       takes --subject --description --tags --owner
                                       --parent --status. \`list\` supports
                                       --status --owner --tag --limit --json.
  memory {store|search|list|namespaces|get|delete}
                                       Key/value memory. BM25 default; opt into
                                       FTS5/HNSW via FLO_MEMORY_BACKEND=agentdb.
  messages {list|read|archive} [recipient]
                                       Mailbox reader for inbox-bridged drops
                                       and inter-agent notifications.
  edit {memory|note|task} <id>         Open record in \$EDITOR.

AUDIO + INBOX
  transcribe <file> [--save|--detect]  Local whisper/mlx-whisper/whisper-cpp.
  inbox {add|watch|status|install|uninstall}
                                       Folder watchers + macOS launchd installer
                                       for transcripts + markdown routing.
  transcripts list [--since 7d]        Sidecar .txt files from audio drops.

RECALL + CAPABILITIES
  activity list [--since 7d] [--type X]
                                       Chronological cross-subsystem timeline.
  log                                  Live tail of the activity feed.
  guidance audit [--out file.md]       Find duplicate/orphan/no-description
                                       skills/commands/agents in ~/.claude/.
  sessions list                        Claude Code checkpoints.

COORDINATION
  agents {spawn|list|get|update|heartbeat|stop|delete|health}
                                       Named-agent registry. spawn takes --name
                                       --role --tags --parent. (Records state;
                                       Claude Code's Task tool spawns processes.)
  agents auto-assign --by <agent>      Atomically claim next pending task.
  agents complete-task <id> --by <agent> [--result <s>]
                                       Mark complete + store success pattern +
                                       notify lead via mailbox.
  swarm {status|vote|tally|votes}      Weighted-quorum consensus (.swarm/).
  swarm topology [--json]              Render parent/child agent tree.
  swarm orchestrate "<subject>" --into N [--owner <agent>]
                                       Decompose a task into N pending subtasks.
  session terminal-{add|restore|list|...}
                                       Ghostty/iTerm window restore.

BACKGROUND WORKERS
  daemon {start|stop|status|log|trigger|workers}
                                       Scheduler that fires workers on intervals.
                                       \`start --foreground\` for fg; otherwise
                                       detaches. State at ~/.flo/daemon/.
  daemon workers {list|enable|disable} 11 workers: audit, document, testgaps
                                       (real, enabled); optimize, deepdive,
                                       refactor, benchmark, ultralearn, predict,
                                       consolidate, map (stubs, disabled).

AUTO-ON-EDIT
  adr {list|show|draft}                Architecture Decision Records drafted
                                       from post-edit heuristics (schema,
                                       migration, api-route, infra, package,
                                       ci, auth, security).
  security {scan|findings} [--dir .]   npm audit + 11 secret-pattern detectors
                                       (AWS, GitHub, Slack, Stripe, OpenAI,
                                       Anthropic, PEM, JWT, generic).

MCP + PLUMBING
  mcp start                            stdio MCP server. 22 tools for Claude Code.
  setup                                One-time onboarding (registers MCP, builds
                                       ~/.flo/, runs doctor).
  doctor                               Health check.
  migrate                              Register flo in ~/.claude/mcp.json (additive).
  replace ruflo [--dry-run]            Strip ruflo from configs + run
                                       \`claude mcp remove\`. Backs up first.
  hook <event>                         Claude Code hook dispatcher. \`post-edit\`
                                       also runs auto-ADR + auto-security.
  export / import                      Full ~/.flo/ state snapshot.
  completions {bash|zsh|fish}          Shell tab completion.

  help, -h, --help                     Show this help.
  version, -v, --version               Show flo version.

ENVIRONMENT
  FLO_HOME=<path>                      Override ~/.flo
  FLO_MEMORY_BACKEND=agentdb|jsonl     Memory backend (default: jsonl)
  FLO_DEBUG=1                          Print stack traces on error
  FLO_DISABLE_AUTO_ADR=1               Skip auto-ADR in post-edit hook
  FLO_DISABLE_AUTO_SECURITY=1          Skip auto-security in post-edit hook

DOCS
  https://myflo.dev  ·  https://github.com/therealsiege/myflo
`);
}

export function printVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    console.log(`flo ${pkg.version}`);
  } catch {
    console.log('flo (unknown version)');
  }
}
