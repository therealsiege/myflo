# flo — local-first developer workbench

Standalone CLI + MCP server. Zero build step. Pure ESM, Node ≥ 20.

## Install (from the repo)

```bash
node apps/cli/bin/flo.js --help
```

Or link it globally:

```bash
cd apps/cli && npm link
flo --help
```

## Commands

| Command | What it does |
|---|---|
| `flo guidance audit [--scope all\|user\|project] [--json] [--out file]` | Scan `~/.claude/{skills,commands,agents}/` and project `.claude/` for duplicate, undescribed, or orphan capabilities. Markdown report by default, JSON with `--json`. |
| `flo migrate [--dry-run] [--mcp-path PATH]` | Register `flo` as an MCP server in `~/.claude/mcp.json`. Idempotent. Backs up the existing file before writing. |
| `flo sessions list [--limit N] [--json]` | List Claude Code session checkpoints from `.claude/checkpoints/` in the current project. |
| `flo inbox watch <dir> [--once]` | Foreground folder watcher. `.md` drops parse frontmatter (`to:`/`from:`/`subject:`). Audio (`.m4a` `.wav` `.mp3`) is transcribed locally via whisper/mlx-whisper and a sidecar `.txt` is written next to the audio file. Processed files move to `<dir>/.processed/`. Activity logged to `<dir>/inbox.log`. |
| `flo inbox status [--dir <dir>]` | Show pending/processed/failed counts and the last few log entries. |
| `flo inbox add <dir> [--slug <name>]` | Register an inbox in `~/.flo/inboxes.json`. Idempotent. |
| `flo inbox list [--json]` | List registered inboxes with pending/processed/failed counts. |
| `flo inbox remove <slug>` | Remove from registry (does not delete files). |
| `flo inbox install <slug> [--interval N]` | **macOS**: generate `~/Library/LaunchAgents/io.myflo.inbox.<slug>.plist` that runs `flo inbox watch --once` every N seconds (default 30). Doesn't auto-load; prints `launchctl bootstrap` command. |
| `flo inbox uninstall <slug>` | **macOS**: remove the launch agent plist. |
| `flo transcribe <file> [--save] [--model base\|small\|medium\|large]` | Local audio transcription (whisper / mlx-whisper / whisper-cpp — detected at runtime, no cloud). `--save` writes sidecar `.txt`. `--detect` reports which tool would be used. |
| `flo swarm status [--json]` | Read `.swarm/state.json` + `.swarm/q-learning-model.json` and render objective/agents/q-learning stats. |
| `flo doctor [--json]` | Quick health check: Node version, git, `.claude/`, checkpoints, MCP config, flo binary. |
| `flo mcp start` | Run as a stdio MCP server. Exposes two tools: `flo_sessions_list` and `flo_guidance_audit`. |
| `flo help` / `flo version` | Self-explanatory. |

## MCP usage

After `flo migrate`, the server appears in `~/.claude/mcp.json` and you can call its tools from Claude Code. Tools:

- `flo_sessions_list({ limit?: number })`
- `flo_guidance_audit({ scope?: "all" | "user" | "project" })`

The repo's own `.claude/settings.json` already registers `flo` alongside the existing `claude-flow` server — both coexist.

## Web UI

The local command center at `web/` (Next.js 16, Tailwind v4, shadcn) exposes two flo panels:

- `/swarm` — `.swarm/state.json` + q-learning model summary
- `/sessions` — table view of `.claude/checkpoints/`
- `/capabilities` — capability audit summary with duplicate ranking
- `/inbox` — registered inboxes with pending/processed/failed counts

```bash
cd web && pnpm install && pnpm dev --port 3030
```

Then open <http://localhost:3030/sessions> or <http://localhost:3030/capabilities>.

The web pages call `flo` as a subprocess via `web/src/lib/flo.ts` (uses `execFile` with an arg array; no shell interpolation).

## Smoke test

```bash
bash apps/cli/tests/smoke.sh
```

Exercises every command end-to-end against an ephemeral temp directory.

## Roadmap

- `eagent` inbox-bridge that routes markdown drops to in-process Claude Code agents via `SendMessage`.
- `flo session terminal-attach` for Ghostty/iTerm window restore (port of `a-team`).
- Web `/memory`, `/inbox`, `/plugins`, `/hooks` panels.
- Full v3/@claude-flow/* → packages/@myflo/* fork (currently `@myflo/{shared,memory,hooks}` are forked; the other ~22 packages still live under `v3/`).

## Status

- ✅ CLI: 9 commands working, 12/12 smoke tests passing.
- ✅ MCP server: stdio JSON-RPC, 2 tools registered (`flo_sessions_list`, `flo_guidance_audit`).
- ✅ Web: 4 flo panels (`/swarm`, `/sessions`, `/capabilities`, `/inbox`) alongside existing siege panels.
- ✅ Audio: real local transcription (auto-detects whisper / mlx-whisper / whisper-cpp).
- ✅ Inbox: registry in `~/.flo/inboxes.json` + macOS launchd installer.
- 🟡 v3 fork: 3 of ~25 packages copied with renamed manifests; rest still under `v3/@claude-flow/`.
