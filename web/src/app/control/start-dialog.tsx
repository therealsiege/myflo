"use client"

import * as React from "react"
import { Loader2Icon, PlayIcon } from "lucide-react"

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

import type { SiegeStartFormValues, SiegeStartPayload } from "./types"

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

const EMPTY_VALUES: SiegeStartFormValues = {
  dryRun: false,
  maxItems: "",
  repos: "",
}

type FieldError = { field: "maxItems" | "repos"; message: string } | null

function buildPayload(values: SiegeStartFormValues): {
  payload?: SiegeStartPayload
  error?: FieldError
} {
  const payload: SiegeStartPayload = {}
  if (values.dryRun) payload.dryRun = true

  const max = values.maxItems.trim()
  if (max.length > 0) {
    const n = Number(max)
    if (!Number.isInteger(n) || n < 1) {
      return { error: { field: "maxItems", message: "must be a positive integer" } }
    }
    payload.maxItems = n
  }

  const reposRaw = values.repos.trim()
  if (reposRaw.length > 0) {
    const repos = reposRaw
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
    if (repos.length === 0) {
      return { error: { field: "repos", message: "no valid repo names" } }
    }
    for (const r of repos) {
      if (!REPO_RE.test(r)) {
        return {
          error: { field: "repos", message: `invalid repo: "${r}" (expected owner/name)` },
        }
      }
    }
    payload.repos = repos
  }

  return { payload }
}

export interface SiegeStartDialogProps {
  disabled: boolean
  inFlight: boolean
  onSubmit: (payload: SiegeStartPayload) => Promise<{ ok: boolean }>
}

export function SiegeStartDialog({
  disabled,
  inFlight,
  onSubmit,
}: SiegeStartDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState<SiegeStartFormValues>(EMPTY_VALUES)
  const [error, setError] = React.useState<FieldError>(null)

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next)
    if (!next) {
      setValues(EMPTY_VALUES)
      setError(null)
    }
  }, [])

  const update = <K extends keyof SiegeStartFormValues>(
    key: K,
    value: SiegeStartFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setError((prev) => (prev && prev.field === key ? null : prev))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (inFlight) return
    const { payload, error: err } = buildPayload(values)
    if (err) {
      setError(err)
      return
    }
    const result = await onSubmit(payload ?? {})
    if (result.ok) handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={disabled || inFlight}
          >
            {inFlight ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            Start
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start siege</DialogTitle>
          <DialogDescription>
            Spawns <span className="font-mono">~/.siege/bin/start</span> in the
            background and waits for a pid file.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
            <div className="flex flex-col">
              <span className="text-xs font-medium">Dry run</span>
              <span className="text-[0.7rem] text-muted-foreground">
                Plan items without making changes
              </span>
            </div>
            <Switch
              id="start-dry-run"
              checked={values.dryRun}
              onCheckedChange={(checked) => update("dryRun", checked === true)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="start-max-items" className="text-xs">
              Max items{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="start-max-items"
              placeholder="3"
              inputMode="numeric"
              autoComplete="off"
              value={values.maxItems}
              onChange={(e) => update("maxItems", e.target.value)}
              aria-invalid={error?.field === "maxItems" ? true : undefined}
              className="font-mono text-[0.82rem]"
            />
            {error?.field === "maxItems" && (
              <p className="font-mono text-[0.7rem] tracking-tight text-destructive">
                {error.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="start-repos" className="text-xs">
              Repos{" "}
              <span className="font-normal text-muted-foreground">
                (optional, comma-separated)
              </span>
            </Label>
            <Input
              id="start-repos"
              placeholder="owner/repo, owner/other"
              autoComplete="off"
              spellCheck={false}
              value={values.repos}
              onChange={(e) => update("repos", e.target.value)}
              aria-invalid={error?.field === "repos" ? true : undefined}
              className="font-mono text-[0.82rem]"
            />
            {error?.field === "repos" && (
              <p className="font-mono text-[0.7rem] tracking-tight text-destructive">
                {error.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={inFlight}>
              {inFlight ? (
                <>
                  <Loader2Icon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                  Starting…
                </>
              ) : (
                "Start siege"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { buildPayload as _buildStartPayloadForTest }
