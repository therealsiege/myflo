import { Suspense } from "react";

import { readDesktopReports, type DesktopReport } from "@/lib/siege";
import { ReportList } from "@/components/reports/report-list";
import { ReportViewer } from "@/components/reports/report-viewer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE_QUERY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface PageProps {
  searchParams: Promise<{ date?: string | string[] }>;
}

function resolveSelectedDate(
  raw: string | string[] | undefined,
  reports: DesktopReport[],
): string | null {
  const dateRaw = Array.isArray(raw) ? raw[0] : raw;
  if (!dateRaw || !DATE_QUERY_RE.test(dateRaw)) return null;
  return reports.some((r) => r.date === dateRaw) ? dateRaw : null;
}

async function ReportsView({ searchParams }: PageProps) {
  let reports: DesktopReport[] = [];
  let readError: string | null = null;
  try {
    reports = await readDesktopReports();
  } catch (err) {
    readError = err instanceof Error ? err.message : "failed to read reports";
  }

  const params = await searchParams;
  const selectedDate = resolveSelectedDate(params.date, reports);
  const selected =
    selectedDate === null
      ? null
      : reports.find((r) => r.date === selectedDate) ?? null;

  if (readError !== null) {
    return <ReportsError message={readError} />;
  }

  return (
    <div className="grid min-h-[calc(100svh-3.5rem)] grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-b border-border md:border-b-0 md:border-r">
        <div className="flex h-14 items-center px-4">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground">
            reports
          </p>
          {reports.length > 0 ? (
            <span className="ml-auto font-mono text-[0.65rem] tracking-[0.05em] text-muted-foreground/70">
              {reports.length}
            </span>
          ) : null}
        </div>
        <ScrollArea className="h-[calc(100svh-7rem)] md:h-[calc(100svh-7rem)]">
          <ReportList reports={reports} selectedDate={selectedDate} />
        </ScrollArea>
      </aside>

      <section className="min-w-0 px-6 py-10 md:px-10 md:py-12">
        <div className="mx-auto w-full max-w-[68ch]">
          <ReportViewer
            filename={selected?.filename ?? null}
            date={selected?.date ?? null}
          />
        </div>
      </section>
    </div>
  );
}

function ReportsError({ message }: { message: string }) {
  return (
    <section className="px-6 py-10 md:px-10 md:py-14">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 rounded-xl bg-destructive/[0.04] p-5 ring-1 ring-destructive/20">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-destructive/80">
          reports
        </p>
        <h2 className="text-base font-medium tracking-tight text-foreground">
          Could not read <span className="font-mono">~/Desktop</span>
        </h2>
        <p className="font-mono text-[0.78rem] leading-relaxed text-destructive">
          {message}
        </p>
      </div>
    </section>
  );
}

function ReportsLoadingSkeleton() {
  return (
    <div className="grid min-h-[calc(100svh-3.5rem)] grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-b border-border md:border-b-0 md:border-r">
        <div className="flex h-14 items-center px-4">
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="flex flex-col gap-2 px-4 py-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5 py-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </aside>
      <section className="px-6 py-10 md:px-10 md:py-12">
        <div className="mx-auto flex w-full max-w-[68ch] flex-col gap-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-7 w-72" />
          <Skeleton className="mt-6 h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </section>
    </div>
  );
}

export default function ReportsPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<ReportsLoadingSkeleton />}>
      <ReportsView searchParams={searchParams} />
    </Suspense>
  );
}
