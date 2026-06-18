# myflo

A local-first developer workbench. CLI + MCP server + Next.js dashboard. Everything lives on disk under `~/.flo/`. No cloud dependencies.

Forked from [ruflo](https://github.com/ruvnet/claude-flow) for the runtime substrate (multi-agent swarm, AgentDB, hooks). The `flo` CLI on top is ours.

## Quick start

```bash
cd apps/cli && npm link        # `flo` becomes globally available
flo setup                      # one-time onboarding (idempotent)
flo notes "First note #flo"    # quick capture
cd ../../web && pnpm dev --port 3030   # open http://localhost:3030
```

`flo setup` creates `~/.flo/{memory,messages,logs}/`, initializes the inbox + terminal registries, registers `flo` as an MCP server in `~/.claude/mcp.json`, and runs a health check.

## What's in here

| Path | What it is |
|---|---|
| `apps/cli/` | The `flo` CLI — pure ESM Node, zero build step |
| `apps/cli/lib/mcp-server.js` | stdio MCP server exposing flo capabilities to Claude Code agents |
| `web/` | Next.js 16 dashboard (Tailwind v4, shadcn). 9 panels |
| `packages/@myflo/{shared,memory,hooks}/` | Forked from `@claude-flow/*` — fork-point markers, not wired in yet |
| `v3/@claude-flow/*` | Upstream ruflo source. Still the runtime for swarm/AgentDB primitives |
| `plugins/` | Native plugins inherited from ruflo |
| `.claude/` | Hooks, agents, skills, settings for Claude Code in this repo |

## CLI surface

`flo --help` lists everything. The shape:

- **Capture**: `flo notes`, `flo memory`, `flo tasks`, `flo messages`
- **Watch**: `flo inbox` (folder watcher + macOS launchd installer), `flo log` (live activity tail)
- **Recall**: `flo memory search` (BM25), `flo guidance audit` (capability dedup across `~/.claude/`), `flo activity` (cross-subsystem timeline)
- **Audio**: `flo transcribe` (local whisper/mlx-whisper, no cloud)
- **Sessions**: `flo sessions list` (Claude Code checkpoints), `flo session terminal-*` (a-team-style window restore for Ghostty/iTerm/Terminal)
- **Swarm**: `flo swarm status` (reads `.swarm/state.json`)
- **Plumbing**: `flo setup`, `flo doctor`, `flo migrate`, `flo mcp start`, `flo completions {bash,zsh,fish}`, `flo edit {memory,note,task}`, `flo export` / `flo import`

Storage convention: every persistent surface lives under `~/.flo/`. Files are append-only JSON / JSONL where reasonable, so history survives mistakes.

## Web dashboard

`cd web && pnpm dev --port 3030`. Routes:

- `/` — aggregated overview
- `/activity` — chronological feed across every subsystem
- `/swarm` — q-learning + active swarm state
- `/memory` — namespace browser + search
- `/tasks` — 3-column board (pending / in_progress / completed)
- `/sessions` — Claude Code checkpoints
- `/capabilities` — `~/.claude/` audit (duplicates, missing descriptions)
- `/inbox` — registered folder watchers
- `/transcripts` — sidecar `.txt` files from audio drops

The web app subprocesses the `flo` CLI for everything. Server-only calls use `execFile` with an arg array — no shell, no injection surface.

## MCP integration

`flo migrate` (or `flo setup`) registers `flo` as an MCP server in `~/.claude/mcp.json`. Restart Claude Code and 16 tools become callable from any agent: `flo_memory_*`, `flo_tasks_*`, `flo_inbox_list`, `flo_messages_list`, `flo_swarm_status`, `flo_transcribe`, `flo_sessions_list`, `flo_guidance_audit`, `flo_transcribe_detect`.

## Run the smoke suite

```bash
bash apps/cli/tests/smoke.sh
```

Exercises every CLI command end-to-end against an ephemeral `FLO_HOME`. The same suite runs on every PR via `.github/workflows/flo-smoke.yml` (Ubuntu + macOS matrix).

## Status

This is v0.x — usable, not yet published to npm. The CLI runs from a `npm link` in `apps/cli/`. Forked `@myflo/*` packages sit alongside the still-active `v3/@claude-flow/*` runtime; consolidating those is a future chore, not a current blocker.

## License

MIT. Forked from ruflo (also MIT) by [@ruvnet](https://github.com/ruvnet).
