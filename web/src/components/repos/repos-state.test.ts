import { describe, expect, it } from "vitest"

import type { ReposConfig } from "@/lib/siege"

import {
  addRepo,
  buildRepoEntry,
  emptyRepoFormValues,
  hasRepoNamed,
  removeRepo,
  toggleRepoEnabled,
} from "./repos-state"

const BASE: ReposConfig = {
  $schema: "./repos.schema.json",
  _comment: "fixture comment",
  defaults: {
    model: "claude-opus-4-7",
    label_ok: "overnight-ok",
  },
  repos: [
    {
      name: "therealsiege/myflo",
      source: "issues",
      enabled: true,
      filter: "label:overnight-ok state:open",
      test_dir: "web",
      _note: "primary",
    },
    {
      name: "openloop/example-repo",
      source: "issues",
      enabled: false,
      filter: "label:overnight-ok state:open",
    },
    {
      name: "openloop/with-project",
      source: "project",
      enabled: false,
      project_owner: "openloop",
      project_number: 7,
      column: "Overnight Ready",
    },
  ],
}

describe("toggleRepoEnabled", () => {
  it("flips the named repo's enabled flag", () => {
    const next = toggleRepoEnabled(BASE, "openloop/example-repo", true)
    expect(next.repos[1].enabled).toBe(true)
  })

  it("returns a new object and does not mutate input", () => {
    const next = toggleRepoEnabled(BASE, "therealsiege/myflo", false)
    expect(next).not.toBe(BASE)
    expect(next.repos).not.toBe(BASE.repos)
    expect(BASE.repos[0].enabled).toBe(true)
    expect(next.repos[0].enabled).toBe(false)
  })

  it("preserves defaults and unknown top-level keys", () => {
    const next = toggleRepoEnabled(BASE, "therealsiege/myflo", false)
    expect(next.defaults).toEqual(BASE.defaults)
    expect(next.$schema).toBe("./repos.schema.json")
    expect(next._comment).toBe("fixture comment")
  })

  it("preserves unknown keys on the touched repo", () => {
    const next = toggleRepoEnabled(BASE, "therealsiege/myflo", false)
    expect(next.repos[0]._note).toBe("primary")
    expect(next.repos[0].test_dir).toBe("web")
  })

  it("ignores names that do not match any repo", () => {
    const next = toggleRepoEnabled(BASE, "nope/missing", true)
    expect(next.repos).toEqual(BASE.repos)
  })
})

describe("removeRepo", () => {
  it("drops the named repo and preserves the rest", () => {
    const next = removeRepo(BASE, "openloop/example-repo")
    expect(next.repos).toHaveLength(2)
    expect(next.repos.find((r) => r.name === "openloop/example-repo")).toBeUndefined()
  })

  it("preserves defaults and unknown top-level keys", () => {
    const next = removeRepo(BASE, "therealsiege/myflo")
    expect(next.defaults).toEqual(BASE.defaults)
    expect(next._comment).toBe("fixture comment")
  })
})

describe("addRepo", () => {
  it("appends the new repo", () => {
    const next = addRepo(BASE, {
      name: "openloop/new",
      source: "issues",
      enabled: true,
      filter: "state:open",
    })
    expect(next.repos).toHaveLength(4)
    expect(next.repos[3].name).toBe("openloop/new")
  })

  it("preserves all existing repos and metadata", () => {
    const next = addRepo(BASE, {
      name: "openloop/new",
      source: "issues",
      enabled: true,
      filter: "state:open",
    })
    expect(next.repos.slice(0, 3)).toEqual(BASE.repos)
    expect(next.defaults).toEqual(BASE.defaults)
  })
})

describe("hasRepoNamed", () => {
  it("returns true for an existing repo name", () => {
    expect(hasRepoNamed(BASE, "therealsiege/myflo")).toBe(true)
  })

  it("returns false for an unknown name", () => {
    expect(hasRepoNamed(BASE, "nope/missing")).toBe(false)
  })
})

describe("buildRepoEntry", () => {
  it("rejects names that are not 'owner/repo'", () => {
    const result = buildRepoEntry({
      ...emptyRepoFormValues,
      name: "no-slash",
      filter: "state:open",
    })
    expect(result.entry).toBeUndefined()
    expect(result.error?.field).toBe("name")
  })

  it("builds an issues entry with a filter", () => {
    const result = buildRepoEntry({
      ...emptyRepoFormValues,
      name: "owner/repo",
      source: "issues",
      enabled: true,
      filter: "label:overnight-ok state:open",
      testDir: "web",
    })
    expect(result.error).toBeUndefined()
    expect(result.entry).toEqual({
      name: "owner/repo",
      source: "issues",
      enabled: true,
      filter: "label:overnight-ok state:open",
      test_dir: "web",
    })
  })

  it("rejects an issues entry without a filter", () => {
    const result = buildRepoEntry({
      ...emptyRepoFormValues,
      name: "owner/repo",
      source: "issues",
      filter: "   ",
    })
    expect(result.error?.field).toBe("filter")
  })

  it("builds a project entry with owner, number, and column", () => {
    const result = buildRepoEntry({
      ...emptyRepoFormValues,
      name: "owner/repo",
      source: "project",
      enabled: false,
      projectOwner: "owner",
      projectNumber: "12",
      column: "Overnight Ready",
    })
    expect(result.error).toBeUndefined()
    expect(result.entry).toEqual({
      name: "owner/repo",
      source: "project",
      enabled: false,
      project_owner: "owner",
      project_number: 12,
      column: "Overnight Ready",
    })
  })

  it("rejects a project entry with a non-positive number", () => {
    const result = buildRepoEntry({
      ...emptyRepoFormValues,
      name: "owner/repo",
      source: "project",
      projectOwner: "owner",
      projectNumber: "0",
      column: "Overnight Ready",
    })
    expect(result.error?.field).toBe("projectNumber")
  })

  it("omits test_dir when blank", () => {
    const result = buildRepoEntry({
      ...emptyRepoFormValues,
      name: "owner/repo",
      source: "issues",
      filter: "state:open",
    })
    expect(result.entry).not.toHaveProperty("test_dir")
  })
})
