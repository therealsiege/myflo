import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReposConfig } from "@/lib/siege";
import type { IssuesAcrossReposResult } from "@/lib/gh";

const {
  readReposMock,
  getLastAttemptMock,
  listIssuesAcrossReposMock,
} = vi.hoisted(() => ({
  readReposMock: vi.fn(),
  getLastAttemptMock: vi.fn(),
  listIssuesAcrossReposMock: vi.fn(),
}));

vi.mock("@/lib/siege", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/siege")>("@/lib/siege");
  return {
    ...actual,
    readRepos: readReposMock,
    getLastAttempt: getLastAttemptMock,
  };
});

vi.mock("@/lib/gh", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/gh")>("@/lib/gh");
  return {
    ...actual,
    listIssuesAcrossRepos: listIssuesAcrossReposMock,
  };
});

import { GET } from "./route";

const REPOS: ReposConfig = {
  defaults: {},
  repos: [
    {
      name: "owner/a",
      source: "issues",
      enabled: true,
      filter: "label:overnight-ok state:open",
    },
    {
      name: "owner/disabled",
      source: "issues",
      enabled: false,
    },
    {
      name: "owner/project",
      source: "project",
      enabled: true,
      project_owner: "owner",
      project_number: 1,
    },
    {
      name: "owner/b",
      source: "issues",
      enabled: true,
    },
  ],
};

beforeEach(() => {
  readReposMock.mockReset();
  getLastAttemptMock.mockReset();
  listIssuesAcrossReposMock.mockReset();
});

describe("GET /api/siege/queue", () => {
  it("returns merged + sorted queue across enabled issues repos", async () => {
    readReposMock.mockResolvedValue(REPOS);
    const acrossResult: IssuesAcrossReposResult = {
      items: [
        {
          repo: "owner/a",
          issues: [
            {
              number: 12,
              title: "feature",
              body: "",
              url: "https://gh/owner/a/issues/12",
              labels: [
                { name: "overnight-ok", color: "00ff00" },
                { name: "siege:frontend", color: "112233" },
                { name: "siege:impeccable", color: "445566" },
              ],
              assignees: [],
              state: "OPEN",
            },
            {
              number: 7,
              title: "bug",
              body: "",
              url: "https://gh/owner/a/issues/7",
              labels: [{ name: "bug", color: "ff0000" }],
              assignees: [],
              state: "OPEN",
            },
          ],
          openSiegeIssueNumbers: [12],
        },
        {
          repo: "owner/b",
          issues: [
            {
              number: 1,
              title: "first",
              body: "",
              url: "https://gh/owner/b/issues/1",
              labels: [],
              assignees: [],
              state: "OPEN",
            },
          ],
          openSiegeIssueNumbers: [],
        },
      ],
      errors: [],
    };
    listIssuesAcrossReposMock.mockResolvedValue(acrossResult);
    getLastAttemptMock.mockImplementation(
      async (repo: string, n: number) => {
        if (repo === "owner/a" && n === 7) {
          return { date: "2026-06-02", stamp: "20260602-180000", status: "merged" };
        }
        return null;
      },
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      fetchedAt: string;
      errors: unknown[];
    };

    expect(body.errors).toEqual([]);
    expect(typeof body.fetchedAt).toBe("string");
    expect(body.items).toHaveLength(3);

    // Sorted by repo, then number
    expect(body.items.map((i) => `${i.repo}#${i.number}`)).toEqual([
      "owner/a#7",
      "owner/a#12",
      "owner/b#1",
    ]);

    const item12 = body.items.find((i) => i.number === 12)!;
    expect(item12.siegeLabels).toEqual([
      "siege:frontend",
      "siege:impeccable",
    ]);
    expect(item12.hasOpenSiegePR).toBe(true);
    expect(item12.lastAttempt).toBeNull();

    const item7 = body.items.find((i) => i.number === 7)!;
    expect(item7.siegeLabels).toEqual([]);
    expect(item7.hasOpenSiegePR).toBe(false);
    expect(item7.lastAttempt).toEqual({
      date: "2026-06-02",
      stamp: "20260602-180000",
      status: "merged",
    });
  });

  it("skips disabled and project-source repos when fanning out", async () => {
    readReposMock.mockResolvedValue(REPOS);
    listIssuesAcrossReposMock.mockResolvedValue({ items: [], errors: [] });
    getLastAttemptMock.mockResolvedValue(null);

    await GET();

    expect(listIssuesAcrossReposMock).toHaveBeenCalledTimes(1);
    const repos = listIssuesAcrossReposMock.mock.calls[0][0] as Array<{
      repo: string;
      search?: string;
    }>;
    expect(repos.map((r) => r.repo)).toEqual(["owner/a", "owner/b"]);
    expect(repos[0].search).toBe("label:overnight-ok state:open");
    expect(repos[1].search).toBeUndefined();
  });

  it("propagates per-repo errors from the gh fan-out", async () => {
    readReposMock.mockResolvedValue(REPOS);
    listIssuesAcrossReposMock.mockResolvedValue({
      items: [],
      errors: [{ repo: "owner/a", message: "rate limited" }],
    });

    const res = await GET();
    const body = (await res.json()) as {
      items: unknown[];
      errors: Array<{ repo: string; message: string }>;
    };
    expect(body.items).toEqual([]);
    expect(body.errors).toEqual([{ repo: "owner/a", message: "rate limited" }]);
  });

  it("returns 500 when reading repos.json fails", async () => {
    readReposMock.mockRejectedValue(new Error("ENOENT: missing repos.json"));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/ENOENT/);
    expect(listIssuesAcrossReposMock).not.toHaveBeenCalled();
  });

  it("treats getLastAttempt failures as null lastAttempt rather than failing the request", async () => {
    readReposMock.mockResolvedValue(REPOS);
    listIssuesAcrossReposMock.mockResolvedValue({
      items: [
        {
          repo: "owner/a",
          issues: [
            {
              number: 1,
              title: "t",
              body: "",
              url: "u",
              labels: [],
              assignees: [],
              state: "OPEN",
            },
          ],
          openSiegeIssueNumbers: [],
        },
      ],
      errors: [],
    });
    getLastAttemptMock.mockRejectedValue(new Error("disk error"));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ lastAttempt: unknown }> };
    expect(body.items[0].lastAttempt).toBeNull();
  });
});
