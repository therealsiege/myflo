# flo — local-first developer workbench

Standalone CLI + MCP server + Next.js dashboard. Zero build step on the CLI. Pure ESM, Node ≥ 20. No cloud dependencies.

## Quick start

```bash
cd apps/cli && npm link              # makes `flo` available globally
flo setup                            # creates ~/.flo/, registers MCP, runs doctor
flo notes "First note with #flo"     # quick capture (BM25 search)
cd ../../web && pnpm dev --port 3030 # localhost:3030 — unified dashboard
```

`flo setup` is idempotent — safe to re-run. It creates `~/.flo/{memory,messages,logs}/`, initializes the inbox + terminal registries, and registers `flo` as an MCP server in `~/.claude/mcp.json` so Claude Code agents can call its tools.

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
| `flo memory store --value <text> [--key <k>] [--namespace <ns>] [--tags a,b]` | Append an entry to `~/.flo/memory/<ns>.jsonl`. |
| `flo memory search <query> [--namespace <ns>] [--tags a,b] [--limit N] [--json]` | Substring + tag search across namespaces. |
| `flo memory list [--namespace <ns>] [--json]` / `get` / `delete` / `namespaces` | Inspect and tombstone memory entries. |
| `flo messages list [<recipient>] [--json]` | List inbox-bridged messages by recipient. |
| `flo messages read <recipient> <filename>` / `archive` | Read or remove a mailbox file. |
| `flo transcripts list [--json] [--limit N]` | List sidecar `.txt` transcripts produced by audio inbox drops. |
| `flo doctor [--json]` | Quick health check: Node version, git, `.claude/`, checkpoints, MCP config, flo binary. |
| `flo mcp start` | Run as a stdio MCP server. Exposes 11 tools (see below). |
| `flo help` / `flo version` | Self-explanatory. |

## MCP usage

After `flo migrate`, the server appears in `~/.claude/mcp.json` and you can call its tools from Claude Code. **11 tools** registered:

- `flo_sessions_list({ limit? })` — Claude Code checkpoints
- `flo_guidance_audit({ scope? })` — capability dedup report
- `flo_memory_store({ value, key?, namespace?, tags?, metadata? })`
- `flo_memory_search({ query?, namespace?, tags?, limit? })`
- `flo_memory_list({ namespace?, limit? })`
- `flo_memory_namespaces({})`
- `flo_inbox_list({})` — registered inboxes with counts
- `flo_messages_list({})` — bridged messages by recipient
- `flo_swarm_status({})` — `.swarm/` state + q-learning summary
- `flo_transcribe({ file, model? })` — local audio transcription
- `flo_transcribe_detect({})` — which transcription tool is available

The repo's own `.claude/settings.json` already registers `flo` alongside the existing `claude-flow` server — both coexist.

## Web UI

The local command center at `web/` (Next.js 16, Tailwind v4, shadcn) exposes six flo panels:

- `/swarm` — `.swarm/state.json` + q-learning model summary
- `/memory` — namespace browser + substring search across `~/.flo/memory/`
- `/sessions` — table view of `.claude/checkpoints/`
- `/capabilities` — capability audit summary with duplicate ranking
- `/inbox` — registered inboxes with pending/processed/failed counts
- `/transcripts` — sidecar transcripts from inbox audio drops

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

- Vector embeddings on top of the memory store (currently substring-only).
- `flo session terminal-attach` for Ghostty/iTerm window restore (port of `a-team`).
- Web `/memory`, `/inbox`, `/plugins`, `/hooks` panels.
- Full v3/@claude-flow/* → packages/@myflo/* fork (currently `@myflo/{shared,memory,hooks}` are forked; the other ~22 packages still live under `v3/`).

## Status

- ✅ CLI: 9 commands working, 12/12 smoke tests passing.
- ✅ MCP server: stdio JSON-RPC, 2 tools registered (`flo_sessions_list`, `flo_guidance_audit`).
- ✅ Web: 5 flo panels (`/swarm`, `/memory`, `/sessions`, `/capabilities`, `/inbox`) alongside existing siege panels.
- ✅ Audio: real local transcription (auto-detects whisper / mlx-whisper / whisper-cpp).
- ✅ Inbox: registry in `~/.flo/inboxes.json` + macOS launchd installer.
- ✅ Memory: file-backed JSON store in `~/.flo/memory/` (substring + tag search, no vectors yet).
- ✅ Bridge: inbox `.md` drops with `to:` frontmatter write a mailbox file + memory entry — eagent-style cross-process comms.
- 🟡 v3 fork: 3 of ~25 packages copied with renamed manifests; rest still under `v3/@claude-flow/`.
