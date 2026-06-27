import { Suspense } from "react"

import { readRepos } from "@/lib/siege"
import { ReposGrid } from "@/components/repos/repos-grid"
import { Skeleton } from "@/components/ui/skeleton"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function ReposGridLoader() {
  let config
  try {
    config = await readRepos()
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return <ReposError message={message} />
  }
  return <ReposGrid initial={config} />
}

function ReposError({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-destructive/[0.04] p-5 ring-1 ring-destructive/20">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-destructive/80">
        repos.json
      </p>
      <h2 className="text-base font-medium tracking-tight text-foreground">
        Could not read{" "}
        <span className="font-mono">~/.siege/repos.json</span>
      </h2>
      <p className="font-mono text-[0.78rem] leading-relaxed text-destructive">
        {message}
      </p>
    </div>
  )
}

function ReposLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </header>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-14" />
              </div>
              <Skeleton className="size-7 rounded-md" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <div className="flex items-center justify-between pt-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-[18px] w-8 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ReposPage() {
  return (
    <section className="px-6 py-10 md:px-10 md:py-14">
      <div className="mx-auto flex max-w-6xl flex-col">
        <Suspense fallback={<ReposLoadingSkeleton />}>
          <ReposGridLoader />
        </Suspense>
      </div>
    </section>
  )
}
