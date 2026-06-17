@AGENTS.md

# MyFlo — Local Command Center for siege + flo

`web/` is a Next.js app that surfaces local agent + workbench state as a localhost-only UI. It hosts two coexisting domains:

1. **siege** — the overnight autonomous-agents system, surfacing `~/.siege/` config/logs/reports.
2. **flo** — the local-first developer workbench (`apps/cli/`), surfacing checkpoints, capability audits, and (planned) memory/inbox/swarm panels by subprocessing the `flo` CLI.

Both share the same `AppShell` + `AppSidebar`. The sidebar groups nav into "siege" routes (Repos/Queue/Control/Reports/Config) and "flo" routes (Sessions/Capabilities/…). Server-only helpers live next to each other under `src/lib/` (`siege.ts`, `flo.ts`, `gh.ts`).

## What this app does
- Reads/writes `~/.siege/repos.json`, `~/.siege/config.yml`, `~/.siege/skills.yml`
- Reads run logs from `~/.siege/logs/YYYY-MM-DD/`
- Reads morning reports from `~/Desktop/siege-*.md`
- Shells out to `gh` CLI for GitHub issue/PR data
- Triggers `~/.siege/bin/{start,kill,report}` and tails their logs
- Subprocesses the `flo` CLI (`apps/cli/bin/flo.js`) for sessions, capability audit, inbox, doctor
- Runs locally on `localhost:3000` — no auth, no remote deploys

## Tech
- Next.js 16 (App Router) — **NOT** Next 15. Read `node_modules/next/dist/docs/` before relying on training-data API knowledge.
- TypeScript, Tailwind v4, shadcn/ui (slate base)
- pnpm
- Server actions / API routes for filesystem + shell access (never expose to client)

## Project conventions
- Server-only filesystem helpers in `src/lib/siege.ts`
- Server-only flo-CLI subprocess helpers in `src/lib/flo.ts`
- Server-only `gh` CLI helpers in `src/lib/gh.ts`
- Route handlers in `src/app/api/*/route.ts` (siege under `/api/siege/`, flo under `/api/flo/`)
- UI primitives in `src/components/ui/` (shadcn — already installed: button, card, badge, tabs, separator, scroll-area, dialog, input, label, switch, sonner)
- Match Tailwind v4 syntax. Don't reintroduce v3 `tailwind.config.js`-isms.

## Hard rules for agents working here
- Stay inside `web/` (and `apps/cli/` if widening a flo capability requires a CLI change first — note this in the PR).
- Never run `pnpm add` for packages the plan doesn't list.
- Never modify `package.json` scripts beyond what the issue asks.
- All filesystem reads of `~/.siege/` go through `src/lib/siege.ts` with path validation (no symlink escapes).
- All `gh` shell-outs go through `src/lib/gh.ts`. Validate args. No string interpolation into shell.
- All `flo` shell-outs go through `src/lib/flo.ts` using `execFile` with an arg array — never `exec` with a shell string.
- `pnpm build` must pass before declaring done.
