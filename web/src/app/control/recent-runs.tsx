import Link from "next/link"
import { ArrowRightIcon, HistoryIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

import type { SiegeRunSummary } from "./types"

export interface SiegeRecentRunsProps {
  runs: SiegeRunSummary[]
  loadError?: string | null
}

function formatStamp(stamp: string): string {
  // stamp = YYYYMMDD-HHMMSS → "HH:MM:SS"
  if (stamp.length !== 15) return stamp
  return `${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}`
}

const OUTCOME_VARIANTS: Record<
  string,
  "default" | "secondary" | "outline" | "destructive" | "ghost"
> = {
  done: "default",
  pr_opened: "default",
  changes_pushed: "default",
  pushed: "default",
  skipped: "ghost",
  no_changes: "ghost",
  blocked: "destructive",
  failed: "destructive",
  error: "destructive",
}

function outcomeVariant(status: string): "default" | "secondary" | "outline" | "destructive" | "ghost" {
  return OUTCOME_VARIANTS[status] ?? "outline"
}

export function SiegeRecentRuns({ runs, loadError }: SiegeRecentRunsProps) {
  const hasRuns = runs.length > 0

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card ring-1 ring-foreground/10">
      <header className="flex items-baseline justify-between gap-3 px-4 pt-3.5">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground">
          recent runs
        </p>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
          last {runs.length === 0 ? 5 : runs.length}
        </span>
      </header>

      {loadError ? (
        <p className="mx-4 mb-4 rounded-md bg-destructive/[0.06] px-3 py-2 font-mono text-[0.7rem] tracking-tight text-destructive ring-1 ring-destructive/20">
          {loadError}
        </p>
      ) : hasRuns ? (
        <ul className="flex flex-col">
          {runs.map((run, idx) => (
            <li
              key={run.stamp}
              className={cn(
                "border-foreground/[0.07]",
                idx !== runs.length - 1 && "border-b",
              )}
            >
              <Link
                href={`/control/runs/${run.stamp}`}
                className="group/run flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[0.78rem] tracking-tight text-foreground">
                      {run.date}
                    </span>
                    <span className="font-mono text-[0.7rem] tracking-tight text-muted-foreground">
                      {formatStamp(run.stamp)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(run.outcomes).length > 0 ? (
                      Object.entries(run.outcomes).map(([status, count]) => (
                        <Badge
                          key={status}
                          variant={outcomeVariant(status)}
                          className="h-[18px] px-1.5 font-mono text-[0.6rem] tracking-[0.14em] uppercase"
                        >
                          {status} · {count}
                        </Badge>
                      ))
                    ) : (
                      <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                        no items
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                    {run.itemCount} {run.itemCount === 1 ? "item" : "items"}
                  </span>
                  <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover/run:text-foreground" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mx-4 mb-4 flex flex-col items-center gap-2 rounded-lg bg-muted/40 py-10 text-center">
          <HistoryIcon className="size-5 text-muted-foreground/60" />
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
            no runs yet
          </p>
          <p className="max-w-[32ch] text-xs leading-relaxed text-muted-foreground">
            Past runs appear here. Start a run to populate this list.
          </p>
        </div>
      )}
    </section>
  )
}
