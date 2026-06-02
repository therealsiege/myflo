@AGENTS.md

# MyFlo — Local Command Center for siege/RuFlo

`web/` is a Next.js app that surfaces `~/.siege/` configuration and run state as a local-only UI. It is the command center for the overnight autonomous-agents system (a.k.a. siege).

## What this app does
- Reads/writes `~/.siege/repos.json`, `~/.siege/config.yml`, `~/.siege/skills.yml`
- Reads run logs from `~/.siege/logs/YYYY-MM-DD/`
- Reads morning reports from `~/Desktop/siege-*.md`
- Shells out to `gh` CLI for GitHub issue/PR data
- Triggers `~/.siege/bin/{start,kill,report}` and tails their logs
- Runs locally on `localhost:3000` — no auth, no remote deploys

## Tech
- Next.js 16 (App Router) — **NOT** Next 15. Read `node_modules/next/dist/docs/` before relying on training-data API knowledge.
- TypeScript, Tailwind v4, shadcn/ui (slate base)
- pnpm
- Server actions / API routes for filesystem + shell access (never expose to client)

## Project conventions
- Server-only filesystem helpers in `src/lib/siege.ts`
- Server-only `gh` CLI helpers in `src/lib/gh.ts`
- Route handlers in `src/app/api/*/route.ts`
- UI primitives in `src/components/ui/` (shadcn — already installed: button, card, badge, tabs, separator, scroll-area, dialog, input, label, switch, sonner)
- Match Tailwind v4 syntax. Don't reintroduce v3 `tailwind.config.js`-isms.

## Hard rules for siege agents working here
- Stay inside `web/`. Don't modify files outside it.
- Never run `pnpm add` for packages the plan doesn't list.
- Never modify `package.json` scripts beyond what the issue asks.
- All filesystem reads of `~/.siege/` go through `src/lib/siege.ts` with path validation (no symlink escapes).
- All `gh` shell-outs go through `src/lib/gh.ts`. Validate args. No string interpolation into shell.
- `pnpm build` must pass before declaring done.
