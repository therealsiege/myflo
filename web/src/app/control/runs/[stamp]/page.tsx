import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { getRunDetail, RunNotFoundError, type RunItemDetail } from "@/lib/siege"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const RUN_STAMP_RE = /^\d{8}-\d{6}$/

interface RunPageProps {
  params: Promise<{ stamp: string }>
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

function outcomeVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" | "ghost" {
  return OUTCOME_VARIANTS[status] ?? "outline"
}

export default async function RunDetailPage({ params }: RunPageProps) {
  const { stamp } = await params

  if (!RUN_STAMP_RE.test(stamp)) notFound()

  let detail
  try {
    detail = await getRunDetail(stamp)
  } catch (err) {
    if (err instanceof RunNotFoundError) notFound()
    const message = err instanceof Error ? err.message : "failed to load run"
    return (
      <section className="px-6 py-10 md:px-10 md:py-14">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-xl bg-destructive/[0.04] p-5 ring-1 ring-destructive/20">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-destructive/80">
            run {stamp}
          </p>
          <h2 className="text-base font-medium tracking-tight text-foreground">
            Could not load run
          </h2>
          <p className="font-mono text-[0.78rem] leading-relaxed text-destructive">
            {message}
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="px-6 py-10 md:px-10 md:py-14">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <Link
          href="/control"
          className="group inline-flex w-fit items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3 transition-transform group-hover:-translate-x-0.5" />
          back to control
        </Link>

        <header className="flex flex-col gap-2">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            run · {stamp}
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            {detail.items.length}{" "}
            {detail.items.length === 1 ? "item" : "items"}
          </h2>
          <p
            className="max-w-prose truncate font-mono text-[0.7rem] leading-relaxed text-muted-foreground"
            title={detail.logDir}
          >
            {detail.logDir}
          </p>
        </header>

        {detail.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/40 py-12 text-center">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
              no items
            </p>
            <p className="max-w-[40ch] text-sm leading-relaxed text-muted-foreground">
              This run did not record any item results.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.items.map((item) => (
              <li key={`${item.repo}#${item.issue}`}>
                <RunItemRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function RunItemRow({ item }: { item: RunItemDetail }) {
  const ts = item.ts ? new Date(item.ts) : null
  return (
    <article className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[0.72rem] tracking-tight text-muted-foreground">
              {item.repo}
            </span>
            <span className="font-mono text-[0.78rem] text-foreground">
              #{item.issue}
            </span>
          </div>
          <p className="truncate text-sm text-foreground">{item.title}</p>
        </div>
        <div className="flex items-center gap-2">
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-1 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              github
              <ExternalLinkIcon className="size-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
            </a>
          )}
          <Badge
            variant={outcomeVariant(item.status)}
            className={cn(
              "h-[20px] gap-1.5 px-2 font-mono text-[0.62rem] tracking-[0.16em] uppercase",
            )}
          >
            {item.status || "unknown"}
          </Badge>
        </div>
      </header>

      <dl className="grid gap-x-4 gap-y-1 text-[0.72rem] sm:grid-cols-2">
        <Meta label="stage" value={item.stage || "—"} mono />
        <Meta label="branch" value={item.branch || "—"} mono />
        <Meta label="reason" value={item.reason || "—"} />
        <Meta
          label="finished"
          value={ts ? ts.toLocaleString() : "—"}
        />
      </dl>
    </article>
  )
}

function Meta({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 truncate text-foreground/80",
          mono && "font-mono text-[0.72rem] tracking-tight",
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}
