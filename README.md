# myflo

Local-first developer workbench. CLI + MCP server + Next.js dashboard. Everything lives on disk under `~/.flo/`. No cloud dependencies. Designed to replace ruflo for daily Claude Code work.

## Quick start

Once `npx myflo init` is published to npm (Phase 6 in flight), this becomes:

```bash
npx myflo init
flo notes "First note #flo"
flo --help
```

Today, from a checkout:

```bash
cd apps/cli && npm link        # `flo` becomes globally available
flo setup                      # one-time onboarding (idempotent)
flo notes "First note #flo"    # quick capture
cd ../../web && pnpm dev --port 3030   # open http://localhost:3030
```

## What's in here

| Path | What it is |
|---|---|
| `apps/cli/` | The `flo` CLI — pure ESM Node, zero build step. Publishes as `myflo` on npm. |
| `apps/cli/lib/mcp-server.js` | stdio MCP server exposing 22 flo tools to Claude Code agents. |
| `web/` | Next.js 16 dashboard (Tailwind v4, shadcn). 9 panels. |
| `packages/@myflo/{shared,memory,hooks}/` | Forked from ruflo's `@claude-flow/*`. `@myflo/memory` is wired into `flo memory` via `FLO_MEMORY_BACKEND=agentdb`. |
| `plugins/` | Native plugins inherited from ruflo (some still ruflo-prefixed; cleanup in progress). |
| `.claude/` | Hooks, agents, skills, settings for Claude Code in this repo. |

The `v3/@claude-flow/*` tree was deleted in Phase 3 — flo runs entirely on `apps/cli/` + `packages/@myflo/`.

## CLI surface (27 commands, 22 MCP tools)

`flo --help` lists everything. Grouped by purpose:

- **Capture**: `flo notes`, `flo memory`, `flo tasks`, `flo messages`
- **Watch**: `flo inbox` (folder watcher + macOS launchd installer), `flo log` (live activity tail)
- **Recall**: `flo memory search` (BM25 default, FTS5 via `FLO_MEMORY_BACKEND=agentdb`), `flo guidance audit` (`~/.claude/` capability dedup), `flo activity` (cross-subsystem timeline)
- **Coordinate**: `flo agents` (named-agent registry), `flo swarm vote/tally`, `flo session terminal-*` (Ghostty/iTerm window restore)
- **Audio**: `flo transcribe` (local whisper/mlx-whisper, no cloud)
- **Sessions**: `flo sessions list` (Claude Code checkpoints)
- **Hooks**: `flo hook <event>` — replaces ruflo's `.claude/helpers/*.cjs` shim layer
- **Plumbing**: `flo setup`, `flo doctor`, `flo migrate`, `flo replace ruflo` (cutover), `flo mcp start`, `flo completions {bash,zsh,fish}`, `flo edit {memory,note,task}`, `flo export` / `flo import`

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

`flo migrate` registers `flo` alongside any existing ruflo entry in `~/.claude/mcp.json`. Once you've verified flo works, run `flo replace ruflo` to remove the ruflo entry. Both files are backed up first.

22 MCP tools registered: `flo_memory_*` (4), `flo_tasks_*` (5), `flo_agent_*` (4), `flo_swarm_*` (3), `flo_inbox_list`, `flo_messages_list`, `flo_transcribe(_detect)`, `flo_sessions_list`, `flo_guidance_audit`.

## Replacing ruflo

```bash
flo migrate                  # adds flo to ~/.claude/mcp.json (idempotent)
# … verify flo tools work via Claude Code …
flo replace ruflo --dry-run  # preview what would be removed
flo replace ruflo            # remove ruflo / claude-flow entries
                             # backs up <path>.flo-bak.<ts> first
```

## Run the smoke suite

```bash
bash apps/cli/tests/smoke.sh
```

Exercises every CLI command end-to-end against an ephemeral `FLO_HOME`. **43 tests, all green.** Same suite runs on every PR via `.github/workflows/flo-smoke.yml` (Ubuntu + macOS matrix).

## Status

**v1.0.0-rc.1** — feature-complete for the ruflo-replacement plan. Phases 1-7 landed:

1. ✅ AgentDB-backed memory via `@myflo/memory`
2. ✅ 10 ported MCP tools (agents, swarm vote/tally)
3. ✅ `v3/@claude-flow/*` tree deleted
4. ✅ `flo hook <event>` replaces `.claude/helpers/*.cjs`
5. ✅ `flo replace ruflo` cutover command
6. 🟡 npm publish (this version is rc.1; needs a clean `npm publish` from `apps/cli/`)
7. ✅ README + plugins audit

## License

MIT. Forked from [ruflo](https://github.com/ruvnet/claude-flow) (also MIT) by [@ruvnet](https://github.com/ruvnet).
