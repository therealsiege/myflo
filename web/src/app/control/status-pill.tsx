"use client"

import { cn } from "@/lib/utils"

export type SiegeStatusMode = "idle" | "running" | "cap-reached" | "error"

export interface SiegeStatusPillProps {
  mode: SiegeStatusMode
  elapsedSec?: number | null
  className?: string
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `0m ${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}h ${mm}m ${s}s`
}

function modeLabel(mode: SiegeStatusMode, elapsedSec?: number | null): string {
  switch (mode) {
    case "running":
      return typeof elapsedSec === "number"
        ? `siege: running ${formatElapsed(elapsedSec)}`
        : "siege: running"
    case "cap-reached":
      return "siege: cap reached"
    case "error":
      return "siege: error"
    case "idle":
    default:
      return "siege: idle"
  }
}

const DOT_BY_MODE: Record<SiegeStatusMode, string> = {
  idle: "bg-muted-foreground/50",
  running: "bg-emerald-500",
  "cap-reached": "bg-amber-500",
  error: "bg-destructive",
}

const PILL_BY_MODE: Record<SiegeStatusMode, string> = {
  idle: "border-border bg-background/60 text-muted-foreground",
  running:
    "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300",
  "cap-reached":
    "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300",
  error: "border-destructive/30 bg-destructive/8 text-destructive",
}

export function SiegeStatusPill({
  mode,
  elapsedSec = null,
  className,
}: SiegeStatusPillProps) {
  const pulse = mode === "running" || mode === "cap-reached"
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-[0.12em]",
        PILL_BY_MODE[mode],
        className,
      )}
    >
      <span aria-hidden className="relative inline-flex">
        <span
          className={cn(
            "size-1.5 rounded-full",
            DOT_BY_MODE[mode],
            pulse && "animate-pulse",
          )}
        />
      </span>
      {modeLabel(mode, elapsedSec)}
    </span>
  )
}
