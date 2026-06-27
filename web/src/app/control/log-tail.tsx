"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import { ScrollIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface SiegeLogTailProps {
  lines: string[]
  path: string | null
  updatedAt: string | null
  loading: boolean
  errorMessage: string | null
  autoScroll: boolean
}

function shortPath(p: string): string {
  if (!p.startsWith("/")) return p
  const segs = p.split("/")
  if (segs.length <= 5) return p
  return `…/${segs.slice(-4).join("/")}`
}

export function SiegeLogTail({
  lines,
  path,
  updatedAt,
  loading,
  errorMessage,
  autoScroll,
}: SiegeLogTailProps) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!autoScroll) return
    const el = viewportRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [autoScroll, lines])

  const hasLines = lines.length > 0
  const showEmpty = !loading && !hasLines && errorMessage === null

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card ring-1 ring-foreground/10">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3.5">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground">
            live tail
          </p>
          {path !== null && (
            <p
              className="max-w-full truncate font-mono text-[0.7rem] tracking-tight text-foreground/70"
              title={path}
            >
              {shortPath(path)}
            </p>
          )}
        </div>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
          {updatedAt !== null
            ? new Date(updatedAt).toLocaleTimeString()
            : loading
              ? "loading…"
              : "no data"}
        </span>
      </header>

      {errorMessage !== null && (
        <p className="mx-4 rounded-md bg-destructive/[0.06] px-3 py-2 font-mono text-[0.7rem] tracking-tight text-destructive ring-1 ring-destructive/20">
          {errorMessage}
        </p>
      )}

      {showEmpty ? (
        <div className="mx-4 mb-4 flex flex-col items-center gap-2 rounded-lg bg-muted/40 py-10 text-center">
          <ScrollIcon className="size-5 text-muted-foreground/60" />
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
            no log yet
          </p>
          <p className="max-w-[28ch] text-xs leading-relaxed text-muted-foreground">
            Start a run to stream output here.
          </p>
        </div>
      ) : (
        <ScrollAreaPrimitive.Root className="relative mx-4 mb-4 h-[420px] rounded-lg bg-muted/30 ring-1 ring-foreground/[0.06]">
          <ScrollAreaPrimitive.Viewport
            ref={viewportRef}
            className="size-full rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
          >
            <pre
              className={cn(
                "px-4 py-3 font-mono text-[0.72rem] leading-relaxed text-foreground/90",
                "whitespace-pre-wrap break-words",
              )}
            >
              {hasLines ? lines.join("\n") : " "}
            </pre>
          </ScrollAreaPrimitive.Viewport>
          <ScrollAreaPrimitive.Scrollbar
            orientation="vertical"
            className="flex h-full w-2.5 touch-none border-l border-l-transparent p-px transition-colors select-none"
          >
            <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
          </ScrollAreaPrimitive.Scrollbar>
        </ScrollAreaPrimitive.Root>
      )}
    </div>
  )
}
