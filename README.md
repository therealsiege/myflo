# myflo

Local-first developer workbench for Claude Code. CLI + MCP server + Next.js dashboard. Everything lives on disk under `~/.flo/`. No cloud. No API keys.

[![npm](https://img.shields.io/npm/v/@fuzeelogik/myflo.svg?label=npm%20%40fuzeelogik%2Fmyflo)](https://www.npmjs.com/package/@fuzeelogik/myflo)
[![smoke](https://github.com/therealsiege/myflo/actions/workflows/flo-smoke.yml/badge.svg)](https://github.com/therealsiege/myflo/actions/workflows/flo-smoke.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

→ **Site:** https://myflo-tau.vercel.app (myflo.dev pending DNS)

## Install

```bash
npm install -g @fuzeelogik/myflo
flo setup
```

Or one-shot:

```bash
npx @fuzeelogik/myflo setup
```

`flo setup` creates `~/.flo/{memory,messages,logs}/`, initializes `~/.flo/{inboxes,terminals}.json`, registers `flo` as an MCP server in `~/.claude/mcp.json`, and runs `flo doctor`.

## What's in here

| Path | What it is |
|---|---|
| `apps/cli/` | The `flo` CLI — pure ESM Node, zero build step. Publishes as `@fuzeelogik/myflo` on npm. |
| `apps/cli/lib/mcp-server.js` | stdio MCP server exposing 22 flo tools to Claude Code agents. |
| `apps/site/` | Static landing page (deployed to Vercel as myflo.dev). |
| `web/` | Next.js 16 dashboard (Tailwind v4, shadcn). 9 panels. |
| `packages/@myflo/{shared,memory,hooks}/` | Forked from ruflo's `@claude-flow/*`. `@myflo/memory` is opt-in via `FLO_MEMORY_BACKEND=agentdb` (monorepo-only — not published to npm yet). |
| `.claude/` | Hooks, agents, skills, settings for Claude Code in this repo. |

## CLI surface (27 commands, 22 MCP tools)

`flo --help` lists everything. Grouped by purpose:

- **Capture**: `flo notes`, `flo memory`, `flo tasks`, `flo messages`
- **Watch**: `flo inbox` (folder watcher + macOS launchd installer), `flo log` (live activity tail)
- **Recall**: `flo memory search` (BM25 default, FTS5 via `FLO_MEMORY_BACKEND=agentdb`), `flo guidance audit` (`~/.claude/` capability dedup), `flo activity` (cross-subsystem timeline)
- **Coordinate**: `flo agents` (named-agent registry), `flo swarm vote/tally`, `flo session terminal-*` (Ghostty/iTerm window restore)
- **Audio**: `flo transcribe` (local whisper/mlx-whisper/whisper-cpp, no cloud)
- **Sessions**: `flo sessions list` (Claude Code checkpoints)
- **Hooks**: `flo hook <event>` — best-effort Claude Code hook dispatcher
- **Plumbing**: `flo setup`, `flo doctor`, `flo migrate`, `flo replace ruflo` (cutover), `flo mcp start`, `flo completions {bash,zsh,fish}`, `flo edit {memory,note,task}`, `flo export` / `flo import`

Storage convention: every persistent surface lives under `~/.flo/`. Files are append-only JSON / JSONL where reasonable, so history survives mistakes.

## Web dashboard

```bash
cd web && pnpm dev --port 3030
```

Routes: `/` (overview), `/activity`, `/swarm`, `/memory`, `/tasks`, `/sessions`, `/capabilities`, `/inbox`, `/transcripts`.

The web app subprocesses the `flo` CLI for everything. Server-only calls use `execFile` with an arg array — no shell, no injection surface.

## Replacing ruflo

```bash
flo migrate                  # adds flo to ~/.claude/mcp.json (idempotent)
# … verify flo tools work via Claude Code …
flo replace ruflo --dry-run  # preview what would be removed
flo replace ruflo            # removes ruflo / claude-flow entries from
                             # ~/.claude/mcp.json + project .claude/settings.json
                             # AND shells out to `claude mcp remove` for entries
                             # the Claude CLI tracks elsewhere
                             # (backs up <path>.flo-bak.<ts> first)
```

Then restart Claude Code.

## Develop

```bash
pnpm install
bash apps/cli/tests/smoke.sh   # 44 tests against an ephemeral FLO_HOME
```

Same suite runs on every PR via `.github/workflows/flo-smoke.yml` (Ubuntu + macOS).

## Releasing

Tag-driven publish:

```bash
# bump apps/cli/package.json version
# bump apps/site/index.html footer
# commit + push
git tag -a vX.Y.Z -m "..." main
git push origin vX.Y.Z   # triggers .github/workflows/npm-publish.yml
```

Workflow runs `pnpm install --frozen-lockfile`, builds `@myflo/memory`, runs smoke, guards against `workspace:*` leaking into install-path deps, publishes, verifies. Then write release notes with `gh release create vX.Y.Z`.

To deprecate a broken version: GitHub Actions → "npm deprecate" → Run workflow → version + message.

## License

MIT. Forked from [ruflo](https://github.com/ruvnet/claude-flow) (also MIT) by [@ruvnet](https://github.com/ruvnet). The flo CLI on top is ours.
