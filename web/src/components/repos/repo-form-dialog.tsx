"use client"

import * as React from "react"
import { PlusIcon } from "lucide-react"

import type { RepoEntry } from "@/lib/siege"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  buildRepoEntry,
  emptyRepoFormValues,
  type RepoFormError,
  type RepoFormValues,
} from "./repos-state"

export interface RepoFormDialogProps {
  onSubmit: (entry: RepoEntry) => Promise<{ ok: true } | { ok: false; message: string }>
  existingNames: string[]
}

function SourceTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-7 flex-1 rounded-md font-mono text-[0.65rem] uppercase tracking-[0.18em]",
        active
          ? "bg-background text-foreground shadow-xs ring-1 ring-foreground/10"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Button>
  )
}

function FieldError({ message }: { message: string }) {
  return (
    <p className="font-mono text-[0.7rem] tracking-tight text-destructive">
      {message}
    </p>
  )
}

export function RepoFormDialog({ onSubmit, existingNames }: RepoFormDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState<RepoFormValues>(emptyRepoFormValues)
  const [error, setError] = React.useState<RepoFormError | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next)
    if (!next) {
      setValues(emptyRepoFormValues)
      setError(null)
      setSubmitting(false)
    }
  }, [])

  const update = React.useCallback(
    <K extends keyof RepoFormValues>(key: K, value: RepoFormValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }))
      setError((prev) => (prev?.field === key ? null : prev))
    },
    []
  )

  const onFieldChange =
    (key: keyof Omit<RepoFormValues, "source" | "enabled">) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      update(key, event.target.value)
    }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    const result = buildRepoEntry(values)
    if (result.error || !result.entry) {
      setError(result.error ?? null)
      return
    }

    if (existingNames.includes(result.entry.name)) {
      setError({
        field: "name",
        message: `"${result.entry.name}" already exists`,
      })
      return
    }

    setSubmitting(true)
    const outcome = await onSubmit(result.entry)
    setSubmitting(false)
    if (outcome.ok) {
      handleOpenChange(false)
    } else {
      setError({ field: "name", message: outcome.message })
    }
  }

  const isIssues = values.source === "issues"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="default" size="sm">
            <PlusIcon data-icon="inline-start" />
            Add repo
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add repository</DialogTitle>
          <DialogDescription>
            Appended to <span className="font-mono">~/.siege/repos.json</span>{" "}
            on save.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="repo-name" className="text-xs">
              Name
            </Label>
            <Input
              id="repo-name"
              placeholder="owner/repo"
              autoComplete="off"
              spellCheck={false}
              value={values.name}
              onChange={onFieldChange("name")}
              aria-invalid={error?.field === "name" ? true : undefined}
              className="font-mono text-[0.82rem]"
            />
            {error?.field === "name" && <FieldError message={error.message} />}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium leading-none">Source</span>
            <div className="flex h-9 items-center gap-1 rounded-lg bg-muted/60 p-1">
              <SourceTab
                active={isIssues}
                onClick={() => update("source", "issues")}
              >
                Issues
              </SourceTab>
              <SourceTab
                active={!isIssues}
                onClick={() => update("source", "project")}
              >
                Project
              </SourceTab>
            </div>
          </div>

          {isIssues ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="repo-filter" className="text-xs">
                Issue filter
              </Label>
              <Input
                id="repo-filter"
                placeholder="label:overnight-ok state:open"
                autoComplete="off"
                spellCheck={false}
                value={values.filter}
                onChange={onFieldChange("filter")}
                aria-invalid={error?.field === "filter" ? true : undefined}
                className="font-mono text-[0.82rem]"
              />
              {error?.field === "filter" && (
                <FieldError message={error.message} />
              )}
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_5rem] gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="repo-project-owner" className="text-xs">
                  Project owner
                </Label>
                <Input
                  id="repo-project-owner"
                  placeholder="owner"
                  autoComplete="off"
                  spellCheck={false}
                  value={values.projectOwner}
                  onChange={onFieldChange("projectOwner")}
                  aria-invalid={
                    error?.field === "projectOwner" ? true : undefined
                  }
                  className="font-mono text-[0.82rem]"
                />
                {error?.field === "projectOwner" && (
                  <FieldError message={error.message} />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="repo-project-number" className="text-xs">
                  Number
                </Label>
                <Input
                  id="repo-project-number"
                  placeholder="7"
                  inputMode="numeric"
                  autoComplete="off"
                  value={values.projectNumber}
                  onChange={onFieldChange("projectNumber")}
                  aria-invalid={
                    error?.field === "projectNumber" ? true : undefined
                  }
                  className="font-mono text-[0.82rem]"
                />
                {error?.field === "projectNumber" && (
                  <FieldError message={error.message} />
                )}
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="repo-column" className="text-xs">
                  Column
                </Label>
                <Input
                  id="repo-column"
                  placeholder="Overnight Ready"
                  autoComplete="off"
                  spellCheck={false}
                  value={values.column}
                  onChange={onFieldChange("column")}
                  aria-invalid={error?.field === "column" ? true : undefined}
                />
                {error?.field === "column" && (
                  <FieldError message={error.message} />
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="repo-test-dir" className="text-xs">
              Test directory{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="repo-test-dir"
              placeholder="web"
              autoComplete="off"
              spellCheck={false}
              value={values.testDir}
              onChange={onFieldChange("testDir")}
              className="font-mono text-[0.82rem]"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
            <div className="flex flex-col">
              <span className="text-xs font-medium">Enabled</span>
              <span className="text-[0.7rem] text-muted-foreground">
                Included in the overnight run
              </span>
            </div>
            <Switch
              id="repo-enabled"
              checked={values.enabled}
              onCheckedChange={(checked) =>
                update("enabled", checked === true)
              }
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Add repository"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
