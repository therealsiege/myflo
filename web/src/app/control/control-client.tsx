"use client"

import * as React from "react"
import { AlertCircleIcon, HashIcon, KeyRoundIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"

import { SiegeKillControls } from "./kill-controls"
import { SiegeLogTail } from "./log-tail"
import { SiegeRecentRuns } from "./recent-runs"
import { SiegeStartDialog } from "./start-dialog"
import { SiegeStatusPill, type SiegeStatusMode } from "./status-pill"
import type {
  SiegeLogTailBody,
  SiegeRunSummary,
  SiegeStartPayload,
  SiegeStatusBody,
} from "./types"

const STATUS_POLL_MS = 3_000
const LOG_POLL_MS = 2_000
const RUNS_REFRESH_MS = 30_000
const RECENT_RUNS_LIMIT = 5

interface ControlClientProps {
  initialRuns: SiegeRunSummary[]
  initialRunsError: string | null
}

function deriveMode(
  status: SiegeStatusBody | null,
  statusError: string | null,
): SiegeStatusMode {
  if (statusError !== null) return "error"
  if (status === null) return "idle"
  if (status.running) return "running"
  if (status.capReached) return "cap-reached"
  return "idle"
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init })
  if (!res.ok) {
    let message = `request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (typeof body.error === "string" && body.error.length > 0) {
        message = body.error
      }
    } catch {
      // keep generic message
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export function SiegeControlClient({
  initialRuns,
  initialRunsError,
}: ControlClientProps) {
  const [status, setStatus] = React.useState<SiegeStatusBody | null>(null)
  const [statusError, setStatusError] = React.useState<string | null>(null)
  const [log, setLog] = React.useState<SiegeLogTailBody | null>(null)
  const [logError, setLogError] = React.useState<string | null>(null)
  const [logLoading, setLogLoading] = React.useState(true)
  const [runs, setRuns] = React.useState<SiegeRunSummary[]>(initialRuns)
  const [runsError, setRunsError] = React.useState<string | null>(
    initialRunsError,
  )

  const [starting, setStarting] = React.useState(false)
  const [killingGraceful, setKillingGraceful] = React.useState(false)
  const [killingForce, setKillingForce] = React.useState(false)

  const lastRunStampRef = React.useRef<string | null>(
    initialRuns.length > 0 ? initialRuns[0].stamp : null,
  )

  // status polling
  React.useEffect(() => {
    let cancelled = false

    const tick = async () => {
      try {
        const body = await fetchJson<SiegeStatusBody>("/api/siege/status")
        if (cancelled) return
        setStatus(body)
        setStatusError(null)
      } catch (err) {
        if (cancelled) return
        setStatusError(err instanceof Error ? err.message : "status failed")
      }
    }
    void tick()
    const id = setInterval(tick, STATUS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // log-tail polling
  React.useEffect(() => {
    let cancelled = false

    const tick = async () => {
      try {
        const body = await fetchJson<SiegeLogTailBody>(
          "/api/siege/log-tail?lines=200",
        )
        if (cancelled) return
        setLog(body)
        setLogError(null)
      } catch (err) {
        if (cancelled) return
        setLogError(err instanceof Error ? err.message : "log fetch failed")
      } finally {
        if (!cancelled) setLogLoading(false)
      }
    }
    void tick()
    const id = setInterval(tick, LOG_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const refreshRuns = React.useCallback(async () => {
    try {
      const body = await fetchJson<{ runs: SiegeRunSummary[] }>(
        "/api/siege/runs",
      )
      setRuns(body.runs.slice(0, RECENT_RUNS_LIMIT))
      setRunsError(null)
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : "runs fetch failed")
    }
  }, [])

  // background refresh of runs every 30s
  React.useEffect(() => {
    const id = setInterval(() => {
      void refreshRuns()
    }, RUNS_REFRESH_MS)
    return () => clearInterval(id)
  }, [refreshRuns])

  // refresh runs whenever a new run stamp appears in /status (run just started/ended)
  React.useEffect(() => {
    const stamp = status?.latestRun?.stamp ?? null
    if (stamp !== null && stamp !== lastRunStampRef.current) {
      lastRunStampRef.current = stamp
      void refreshRuns()
    }
  }, [status?.latestRun?.stamp, refreshRuns])

  const handleStart = React.useCallback(
    async (payload: SiegeStartPayload): Promise<{ ok: boolean }> => {
      setStarting(true)
      try {
        await fetchJson<{ runStamp: string; logDir: string; pids: number[] }>(
          "/api/siege/start",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        )
        toast.success("siege started")
        // refresh immediately
        void refreshRuns()
        return { ok: true }
      } catch (err) {
        toast.error(
          `failed to start siege: ${err instanceof Error ? err.message : "unknown error"}`,
        )
        return { ok: false }
      } finally {
        setStarting(false)
      }
    },
    [refreshRuns],
  )

  const handleKill = React.useCallback(
    async (force: boolean): Promise<{ ok: boolean }> => {
      if (force) setKillingForce(true)
      else setKillingGraceful(true)
      try {
        const result = await fetchJson<{
          killed: number[]
          method: "graceful" | "force" | "noop"
        }>("/api/siege/kill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        })
        if (result.method === "noop") {
          toast.message("siege was not running")
        } else {
          toast.success(
            `siege ${result.method === "force" ? "force-killed" : "killed"} (${result.killed.length} pid${result.killed.length === 1 ? "" : "s"})`,
          )
        }
        return { ok: true }
      } catch (err) {
        toast.error(
          `failed to kill siege: ${err instanceof Error ? err.message : "unknown error"}`,
        )
        return { ok: false }
      } finally {
        if (force) setKillingForce(false)
        else setKillingGraceful(false)
      }
    },
    [],
  )

  const mode = deriveMode(status, statusError)
  const running = status?.running === true
  const elapsedSec = status?.elapsedSec ?? null
  const currentItem = status?.currentItem ?? null

  return (
    <div className="flex flex-col gap-6">
      <StatusBanner
        mode={mode}
        elapsedSec={elapsedSec}
        currentItem={currentItem}
        statusError={statusError}
        ghAuth={status?.ghAuth ?? null}
        onStart={handleStart}
        onKill={handleKill}
        starting={starting}
        killingGraceful={killingGraceful}
        killingForce={killingForce}
        running={running}
      />

      <SiegeLogTail
        lines={log?.lines ?? []}
        path={log?.path ?? null}
        updatedAt={log?.updatedAt ?? null}
        loading={logLoading}
        errorMessage={logError}
        autoScroll={running}
      />

      <SiegeRecentRuns runs={runs} loadError={runsError} />
    </div>
  )
}

interface StatusBannerProps {
  mode: SiegeStatusMode
  elapsedSec: number | null
  currentItem: SiegeStatusBody["currentItem"]
  statusError: string | null
  ghAuth: SiegeStatusBody["ghAuth"] | null
  onStart: (payload: SiegeStartPayload) => Promise<{ ok: boolean }>
  onKill: (force: boolean) => Promise<{ ok: boolean }>
  starting: boolean
  killingGraceful: boolean
  killingForce: boolean
  running: boolean
}

function StatusBanner({
  mode,
  elapsedSec,
  currentItem,
  statusError,
  ghAuth,
  onStart,
  onKill,
  starting,
  killingGraceful,
  killingForce,
  running,
}: StatusBannerProps) {
  const showGhWarning = ghAuth !== null && ghAuth.authenticated === false

  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10",
        mode === "running" && "ring-emerald-500/20",
        mode === "cap-reached" && "ring-amber-500/30",
        mode === "error" && "ring-destructive/30",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <SiegeStatusPill mode={mode} elapsedSec={elapsedSec} />
          {currentItem !== null && (
            <p className="flex items-baseline gap-1.5 font-mono text-[0.78rem] tracking-tight text-foreground/80">
              <HashIcon
                className="size-3 shrink-0 -translate-y-px text-muted-foreground/60"
                aria-hidden
              />
              <span>#{currentItem.issue}</span>
              <span className="truncate text-foreground">
                {currentItem.title}
              </span>
            </p>
          )}
          {statusError !== null && (
            <p className="flex items-start gap-1.5 font-mono text-[0.7rem] tracking-tight text-destructive">
              <AlertCircleIcon
                className="size-3 shrink-0 translate-y-0.5"
                aria-hidden
              />
              {statusError}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SiegeStartDialog
            disabled={running || mode === "error"}
            inFlight={starting}
            onSubmit={onStart}
          />
          <SiegeKillControls
            disabled={!running}
            killingGraceful={killingGraceful}
            killingForce={killingForce}
            onKill={onKill}
          />
        </div>
      </div>

      {showGhWarning && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/[0.06] px-3 py-2 font-mono text-[0.7rem] tracking-tight text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300">
          <KeyRoundIcon className="size-3.5 shrink-0 translate-y-px" aria-hidden />
          <span>
            <span className="font-medium">gh</span> not authenticated — run{" "}
            <span className="font-mono">gh auth login</span> before starting a
            run.
          </span>
        </p>
      )}
    </section>
  )
}
