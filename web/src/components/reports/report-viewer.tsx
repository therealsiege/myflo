"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Skeleton } from "@/components/ui/skeleton";

type ViewerState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; body: string }
  | { kind: "error"; message: string };

interface ReportViewerProps {
  filename: string | null;
  date: string | null;
}

const DATE_LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatLongLabel(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return null;
  }
  return DATE_LABEL_FMT.format(new Date(Date.UTC(y, m - 1, d)));
}

export function ReportViewer({ filename, date }: ReportViewerProps) {
  const [state, setState] = useState<ViewerState>(
    filename === null ? { kind: "idle" } : { kind: "loading" },
  );

  useEffect(() => {
    if (filename === null) {
      setState({ kind: "idle" });
      return;
    }

    let cancelled = false;
    setState({ kind: "loading" });

    fetch(`/api/siege/reports/${encodeURIComponent(filename)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          let message = `failed to load report (HTTP ${res.status})`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) message = j.error;
          } catch {
            // body was not JSON
          }
          setState({ kind: "error", message });
          return;
        }
        const body = await res.text();
        if (cancelled) return;
        setState({ kind: "ready", body });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "network error";
        setState({ kind: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, [filename]);

  if (state.kind === "idle") {
    return <ReportEmpty />;
  }

  const longLabel = formatLongLabel(date);

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
          {filename ?? "report"}
        </p>
        {longLabel ? (
          <h2 className="text-xl font-medium tracking-tight text-foreground">
            {longLabel}
          </h2>
        ) : null}
      </header>

      {state.kind === "loading" ? <ReportSkeleton /> : null}

      {state.kind === "error" ? (
        <div className="flex flex-col gap-2 rounded-md bg-destructive/[0.06] p-4 ring-1 ring-destructive/20">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-destructive/80">
            could not read report
          </p>
          <p className="font-mono text-[0.78rem] leading-relaxed text-destructive">
            {state.message}
          </p>
        </div>
      ) : null}

      {state.kind === "ready" ? (
        <div className="report-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.body}</ReactMarkdown>
        </div>
      ) : null}
    </article>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-4 h-4 w-1/2" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

function ReportEmpty() {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-start justify-center gap-3">
      <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
        reports
      </p>
      <h2 className="text-2xl font-medium tracking-tight text-foreground">
        Pick a night to read.
      </h2>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Each entry on the left is a post-mortem from{" "}
        <span className="font-mono">~/.siege/bin/report</span>: what shipped,
        what stalled, what needs a human. Latest is on top.
      </p>
    </div>
  );
}
