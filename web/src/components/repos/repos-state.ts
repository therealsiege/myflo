import type { RepoEntry, ReposConfig } from "@/lib/siege"

/**
 * Pure transforms over a ReposConfig. Each function returns a new config
 * that preserves `defaults` and any unknown top-level keys so the PATCH
 * to /api/siege/repos never silently drops user-authored metadata.
 */

export function toggleRepoEnabled(
  config: ReposConfig,
  name: string,
  enabled: boolean
): ReposConfig {
  return {
    ...config,
    repos: config.repos.map((repo) =>
      repo.name === name ? { ...repo, enabled } : repo
    ),
  }
}

export function removeRepo(config: ReposConfig, name: string): ReposConfig {
  return {
    ...config,
    repos: config.repos.filter((repo) => repo.name !== name),
  }
}

export function addRepo(config: ReposConfig, entry: RepoEntry): ReposConfig {
  return {
    ...config,
    repos: [...config.repos, entry],
  }
}

export function hasRepoNamed(config: ReposConfig, name: string): boolean {
  return config.repos.some((repo) => repo.name === name)
}

const REPO_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export interface RepoFormValues {
  name: string
  source: "issues" | "project"
  enabled: boolean
  filter: string
  projectOwner: string
  projectNumber: string
  column: string
  testDir: string
}

export interface RepoFormError {
  field:
    | "name"
    | "filter"
    | "projectOwner"
    | "projectNumber"
    | "column"
    | "testDir"
  message: string
}

export interface RepoFormResult {
  entry?: RepoEntry
  error?: RepoFormError
}

/**
 * Validate and normalize the dialog form values into a RepoEntry, mirroring
 * the server's assertReposConfig constraints. Returns the entry on success
 * or a single field-scoped error on failure.
 */
export function buildRepoEntry(values: RepoFormValues): RepoFormResult {
  const name = values.name.trim()
  if (!REPO_NAME_RE.test(name)) {
    return {
      error: {
        field: "name",
        message: 'name must be "owner/repo"',
      },
    }
  }

  const entry: RepoEntry = {
    name,
    source: values.source,
    enabled: values.enabled,
  }

  if (values.source === "issues") {
    const filter = values.filter.trim()
    if (filter.length === 0) {
      return {
        error: { field: "filter", message: "filter is required" },
      }
    }
    entry.filter = filter
  } else {
    const owner = values.projectOwner.trim()
    if (owner.length === 0) {
      return {
        error: {
          field: "projectOwner",
          message: "project owner is required",
        },
      }
    }
    const numberStr = values.projectNumber.trim()
    const numberVal = Number(numberStr)
    if (
      numberStr.length === 0 ||
      !Number.isInteger(numberVal) ||
      numberVal < 1
    ) {
      return {
        error: {
          field: "projectNumber",
          message: "project number must be a positive integer",
        },
      }
    }
    const column = values.column.trim()
    if (column.length === 0) {
      return {
        error: { field: "column", message: "column is required" },
      }
    }
    entry.project_owner = owner
    entry.project_number = numberVal
    entry.column = column
  }

  const testDir = values.testDir.trim()
  if (testDir.length > 0) {
    entry.test_dir = testDir
  }

  return { entry }
}

export const emptyRepoFormValues: RepoFormValues = {
  name: "",
  source: "issues",
  enabled: true,
  filter: "",
  projectOwner: "",
  projectNumber: "",
  column: "",
  testDir: "",
}
