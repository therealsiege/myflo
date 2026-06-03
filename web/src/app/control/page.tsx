import { listRecentRuns, type RunSummary } from "@/lib/siege"

import { SiegeControlClient } from "./control-client"
import type { SiegeRunSummary } from "./types"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const INITIAL_RUNS = 5

async function loadInitialRuns(): Promise<{
  runs: SiegeRunSummary[]
  error: string | null
}> {
  try {
    const runs = await listRecentRuns(INITIAL_RUNS)
    return { runs: runs.map(toSummary), error: null }
  } catch (err) {
    return {
      runs: [],
      error: err instanceof Error ? err.message : "failed to list runs",
    }
  }
}

function toSummary(r: RunSummary): SiegeRunSummary {
  return {
    date: r.date,
    stamp: r.stamp,
    logDir: r.logDir,
    itemCount: r.itemCount,
    outcomes: r.outcomes,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  }
}

export default async function ControlPage() {
  const { runs, error } = await loadInitialRuns()

  return (
    <section className="px-6 py-10 md:px-10 md:py-14">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            control
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            Operating console
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Start, stop, and tail siege runs. Status polls{" "}
            <span className="font-mono text-foreground/70">/api/siege/status</span>{" "}
            every 3s; the log tail polls{" "}
            <span className="font-mono text-foreground/70">
              /api/siege/log-tail
            </span>{" "}
            every 2s.
          </p>
        </header>

        <SiegeControlClient initialRuns={runs} initialRunsError={error} />
      </div>
    </section>
  )
}
