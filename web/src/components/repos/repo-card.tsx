"use client"

import * as React from "react"
import { ArrowUpRight, FilterIcon, KanbanSquareIcon, Trash2Icon } from "lucide-react"

import type { RepoEntry } from "@/lib/siege"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

export interface RepoCardProps {
  repo: RepoEntry
  pending: boolean
  onToggle: (repo: RepoEntry, next: boolean) => void
  onRemove: (repo: RepoEntry) => void
}

function githubUrl(name: string): string {
  return `https://github.com/${name}`
}

function MetaLine({
  icon: Icon,
  label,
  value,
  mono = true,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline gap-2.5 text-xs">
      <span
        title={label}
        aria-label={label}
        className="mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70"
      >
        <Icon className="size-3.5" />
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-foreground/80",
          mono && "font-mono text-[0.72rem] tracking-tight"
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

export function RepoCard({ repo, pending, onToggle, onRemove }: RepoCardProps) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const id = React.useId()
  const switchId = `${id}-enabled`

  const isProject = repo.source === "project"
  const isEnabled = repo.enabled === true

  const projectMeta = [
    repo.project_owner,
    repo.project_number !== undefined ? `#${repo.project_number}` : null,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <article
      data-enabled={isEnabled || undefined}
      data-pending={pending || undefined}
      className={cn(
        "group/repo relative flex flex-col gap-4 overflow-hidden rounded-xl bg-card p-4 text-sm text-card-foreground ring-1 ring-foreground/10 transition-all",
        "hover:ring-foreground/20",
        "data-[pending]:opacity-80",
        !isEnabled && "opacity-65 saturate-[0.85]"
      )}
    >
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <a
            href={githubUrl(repo.name)}
            target="_blank"
            rel="noreferrer"
            className="group/link inline-flex items-baseline gap-1.5 truncate font-mono text-[0.78rem] tracking-tight text-foreground hover:text-foreground"
            title={`Open ${repo.name} on GitHub`}
          >
            <span className="truncate">{repo.name}</span>
            <ArrowUpRight className="size-3 shrink-0 -translate-y-px text-muted-foreground/60 transition-all group-hover/link:-translate-y-0.5 group-hover/link:translate-x-px group-hover/link:text-foreground" />
          </a>
          <Badge
            variant="outline"
            className={cn(
              "h-[18px] gap-1.5 border-foreground/15 px-1.5 font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground"
            )}
          >
            {isProject ? "project" : "issues"}
          </Badge>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${repo.name}`}
          disabled={pending}
          onClick={() => setConfirmOpen(true)}
          className="-mt-1 -mr-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon />
        </Button>
      </header>

      <div className="flex min-w-0 flex-col gap-2">
        {isProject ? (
          <>
            <MetaLine
              icon={KanbanSquareIcon}
              label="Project"
              value={projectMeta || "no project"}
            />
            <MetaLine
              icon={FilterIcon}
              label="Column"
              value={repo.column ?? "no column"}
            />
          </>
        ) : (
          <MetaLine
            icon={FilterIcon}
            label="Filter"
            value={(repo.filter as string) ?? "no filter"}
          />
        )}

        {typeof repo.test_dir === "string" && repo.test_dir.length > 0 && (
          <div className="flex items-baseline gap-2.5 pt-0.5">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground/70">
              tests
            </span>
            <span className="truncate font-mono text-[0.72rem] tracking-tight text-foreground/80">
              {repo.test_dir}
            </span>
          </div>
        )}
      </div>

      <Separator className="bg-foreground/[0.07]" />

      <footer className="flex items-center justify-between gap-3">
        <label
          htmlFor={switchId}
          className="flex cursor-pointer items-center gap-2 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground"
        >
          <span aria-hidden className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full transition-colors",
                isEnabled
                  ? "bg-primary"
                  : "bg-muted-foreground/40"
              )}
            />
            <span>{isEnabled ? "enabled" : "disabled"}</span>
          </span>
        </label>
        <Switch
          id={switchId}
          checked={isEnabled}
          disabled={pending}
          aria-label={`Toggle ${repo.name}`}
          onCheckedChange={(checked) => onToggle(repo, checked === true)}
        />
      </footer>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove repository?</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-foreground">{repo.name}</span>{" "}
              will be removed from <span className="font-mono">repos.json</span>
              . You can re-add it later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false)
                onRemove(repo)
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}
