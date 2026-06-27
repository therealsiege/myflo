"use client"

import * as React from "react"
import { FolderGit2 } from "lucide-react"
import { toast } from "sonner"

import type { RepoEntry, ReposConfig } from "@/lib/siege"
import { RepoCard } from "./repo-card"
import { RepoFormDialog } from "./repo-form-dialog"
import { addRepo, removeRepo, toggleRepoEnabled } from "./repos-state"

export interface ReposGridProps {
  initial: ReposConfig
}

async function patchConfig(
  next: ReposConfig
): Promise<{ ok: true } | { ok: false; message: string }> {
  let res: Response
  try {
    res = await fetch("/api/siege/repos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    })
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "network error",
    }
  }

  if (res.ok) return { ok: true }

  let message = `request failed (${res.status})`
  try {
    const data = (await res.json()) as { error?: string }
    if (typeof data.error === "string" && data.error.length > 0) {
      message = data.error
    }
  } catch {
    // keep generic message
  }
  return { ok: false, message }
}

export function ReposGrid({ initial }: ReposGridProps) {
  const [config, setConfig] = React.useState<ReposConfig>(initial)
  const [pendingByName, setPendingByName] = React.useState<Set<string>>(
    () => new Set()
  )
  const configRef = React.useRef(config)
  React.useEffect(() => {
    configRef.current = config
  }, [config])

  const setPending = React.useCallback(
    (name: string | null, on: boolean) => {
      setPendingByName((prev) => {
        const next = new Set(prev)
        if (name === null) {
          if (!on) next.clear()
          return next
        }
        if (on) next.add(name)
        else next.delete(name)
        return next
      })
    },
    []
  )

  const mutate = React.useCallback(
    async (
      transform: (current: ReposConfig) => ReposConfig,
      opts: {
        pendingKey: string | null
        successMsg: string
        errorPrefix: string
      }
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      const prev = configRef.current
      const next = transform(prev)
      configRef.current = next
      setConfig(next)
      if (opts.pendingKey) setPending(opts.pendingKey, true)

      const result = await patchConfig(next)

      if (opts.pendingKey) setPending(opts.pendingKey, false)

      if (result.ok) {
        toast.success(opts.successMsg)
        return { ok: true }
      }

      configRef.current = prev
      setConfig(prev)
      toast.error(`${opts.errorPrefix}: ${result.message}`)
      return { ok: false, message: result.message }
    },
    [setPending]
  )

  const handleToggle = React.useCallback(
    (repo: RepoEntry, nextEnabled: boolean) => {
      void mutate((current) => toggleRepoEnabled(current, repo.name, nextEnabled), {
        pendingKey: repo.name,
        successMsg: `${repo.name} ${nextEnabled ? "enabled" : "disabled"}`,
        errorPrefix: `Failed to update ${repo.name}`,
      })
    },
    [mutate]
  )

  const handleRemove = React.useCallback(
    (repo: RepoEntry) => {
      void mutate((current) => removeRepo(current, repo.name), {
        pendingKey: repo.name,
        successMsg: `${repo.name} removed`,
        errorPrefix: `Failed to remove ${repo.name}`,
      })
    },
    [mutate]
  )

  const handleAdd = React.useCallback(
    async (entry: RepoEntry) => {
      return mutate((current) => addRepo(current, entry), {
        pendingKey: null,
        successMsg: `${entry.name} added`,
        errorPrefix: `Failed to add ${entry.name}`,
      })
    },
    [mutate]
  )

  const existingNames = React.useMemo(
    () => config.repos.map((r) => r.name),
    [config.repos]
  )

  const hasRepos = config.repos.length > 0

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            repos
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            Repositories
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            siege watches {config.repos.length}{" "}
            {config.repos.length === 1 ? "repository" : "repositories"} from{" "}
            <span className="font-mono text-foreground/70">
              ~/.siege/repos.json
            </span>
            . Toggle inclusion in the next overnight run.
          </p>
        </div>
        <RepoFormDialog onSubmit={handleAdd} existingNames={existingNames} />
      </header>

      {hasRepos ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {config.repos.map((repo) => (
            <li key={repo.name} className="contents">
              <RepoCard
                repo={repo}
                pending={pendingByName.has(repo.name)}
                onToggle={handleToggle}
                onRemove={handleRemove}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          existingNames={existingNames}
          onSubmit={handleAdd}
        />
      )}
    </div>
  )
}

function EmptyState({
  onSubmit,
  existingNames,
}: {
  onSubmit: (entry: RepoEntry) => Promise<{ ok: true } | { ok: false; message: string }>
  existingNames: string[]
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 rounded-xl bg-card px-6 py-12 text-center ring-1 ring-foreground/10">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted/70 text-muted-foreground">
        <FolderGit2 className="size-5" />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground">
          no repos yet
        </p>
        <h3 className="text-base font-medium tracking-tight text-foreground">
          Point siege at a repository
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Add an entry to{" "}
          <span className="font-mono">~/.siege/repos.json</span> to start
          triaging issues overnight.
        </p>
      </div>
      <RepoFormDialog onSubmit={onSubmit} existingNames={existingNames} />
    </div>
  )
}
