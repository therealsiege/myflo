import Link from "next/link";

import type { DesktopReport } from "@/lib/siege";
import { cn } from "@/lib/utils";

const DATE_LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return isoDate;
  }
  // Construct as UTC to avoid local-timezone day-shift on display.
  const utc = new Date(Date.UTC(y, m - 1, d));
  return DATE_LABEL_FMT.format(utc);
}

interface ReportListProps {
  reports: DesktopReport[];
  selectedDate: string | null;
}

export function ReportList({ reports, selectedDate }: ReportListProps) {
  if (reports.length === 0) {
    return (
      <div className="px-3 py-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground/70">
          no reports yet
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Reports appear here after{" "}
          <span className="font-mono">~/.siege/bin/report</span> writes them
          to <span className="font-mono">~/Desktop</span>.
        </p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col">
      {reports.map((report, idx) => {
        const active = report.date === selectedDate;
        const label = formatLabel(report.date);
        return (
          <li key={report.filename}>
            <Link
              href={{ pathname: "/reports", query: { date: report.date } }}
              aria-current={active ? "page" : undefined}
              data-active={active || undefined}
              data-latest={idx === 0 || undefined}
              className={cn(
                "group/report flex flex-col gap-1 px-4 py-3 text-left transition-colors",
                "hover:bg-muted/60",
                "focus-visible:bg-muted focus-visible:outline-none",
                "data-[active]:bg-muted",
              )}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "font-mono text-[0.72rem] tracking-[0.05em] text-muted-foreground",
                    "group-data-[active]/report:text-foreground",
                  )}
                >
                  {report.date}
                </span>
                {idx === 0 ? (
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-muted-foreground/80">
                    latest
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  "text-sm leading-tight text-foreground/85",
                  "group-data-[active]/report:font-medium group-data-[active]/report:text-foreground",
                )}
              >
                {label}
              </span>
              <span className="font-mono text-[0.65rem] tracking-[0.05em] text-muted-foreground/70">
                {formatBytes(report.bytes)}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
