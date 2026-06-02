import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReposConfig } from "@/lib/siege";

const { readReposMock, writeReposMock } = vi.hoisted(() => ({
  readReposMock: vi.fn(),
  writeReposMock: vi.fn(),
}));

vi.mock("@/lib/siege", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/siege")>("@/lib/siege");
  return {
    ...actual,
    readRepos: readReposMock,
    writeRepos: writeReposMock,
  };
});

import { GET, PATCH } from "./route";

const FIXTURE: ReposConfig = {
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
    },
  ],
};

function patch(body: unknown, opts: { rawBody?: string } = {}): Request {
  const init: RequestInit = {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: opts.rawBody ?? JSON.stringify(body),
  };
  return new Request("http://localhost/api/siege/repos", init);
}

beforeEach(() => {
  readReposMock.mockReset();
  writeReposMock.mockReset();
});

describe("GET /api/siege/repos", () => {
  it("returns the parsed config on success", async () => {
    readReposMock.mockResolvedValue(FIXTURE);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FIXTURE);
    expect(readReposMock).toHaveBeenCalledTimes(1);
  });

  it("returns 500 with error message when read fails", async () => {
    readReposMock.mockRejectedValue(new Error("ENOENT: missing repos.json"));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/ENOENT/);
    expect(writeReposMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/siege/repos", () => {
  it("writes a valid config and returns ok", async () => {
    writeReposMock.mockResolvedValue(undefined);
    const res = await PATCH(patch(FIXTURE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(writeReposMock).toHaveBeenCalledWith(FIXTURE);
  });

  it("returns 400 when the body is not JSON", async () => {
    const res = await PATCH(patch(undefined, { rawBody: "{not json" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /invalid JSON/i,
    );
    expect(writeReposMock).not.toHaveBeenCalled();
  });

  it("returns 400 when a repo entry is missing a source", async () => {
    const invalid = {
      defaults: {},
      repos: [{ name: "foo/bar", enabled: true }],
    };
    const res = await PATCH(patch(invalid));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /source must be/,
    );
    expect(writeReposMock).not.toHaveBeenCalled();
  });

  it("returns 400 when a repo has an invalid source string", async () => {
    const invalid: ReposConfig = {
      defaults: {},
      repos: [
        {
          name: "foo/bar",
          source: "wrong" as unknown as "issues",
          enabled: true,
        },
      ],
    };
    const res = await PATCH(patch(invalid));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /source must be/,
    );
    expect(writeReposMock).not.toHaveBeenCalled();
  });

  it("returns 400 when defaults is missing", async () => {
    const res = await PATCH(patch({ repos: [] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /defaults/,
    );
    expect(writeReposMock).not.toHaveBeenCalled();
  });

  it("returns 500 when write fails after validation passes", async () => {
    writeReposMock.mockRejectedValue(new Error("EACCES: permission denied"));
    const res = await PATCH(patch(FIXTURE));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /EACCES/,
    );
  });
});
