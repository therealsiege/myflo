import { beforeEach, describe, expect, it, vi } from "vitest";

const { readDesktopReportMock } = vi.hoisted(() => ({
  readDesktopReportMock: vi.fn(),
}));

vi.mock("@/lib/siege", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/siege")>("@/lib/siege");
  return {
    ...actual,
    readDesktopReport: readDesktopReportMock,
  };
});

import { GET } from "./route";

function call(filename: string): Promise<Response> {
  const req = new Request(
    `http://localhost/api/siege/reports/${encodeURIComponent(filename)}`,
  );
  return GET(req, { params: Promise.resolve({ filename }) });
}

beforeEach(() => {
  readDesktopReportMock.mockReset();
});

describe("GET /api/siege/reports/[filename]", () => {
  it("returns the markdown body as text/markdown on success", async () => {
    readDesktopReportMock.mockResolvedValue("# report body\n\n| a | b |\n|---|---|\n");
    const res = await call("siege-2026-06-03.md");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
    expect(await res.text()).toContain("# report body");
    expect(readDesktopReportMock).toHaveBeenCalledWith("siege-2026-06-03.md");
  });

  it("rejects path traversal attempts with 400", async () => {
    const res = await call("../../etc/passwd");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /invalid report filename/,
    );
    expect(readDesktopReportMock).not.toHaveBeenCalled();
  });

  it("rejects extensions other than .md with 400", async () => {
    const res = await call("siege-2026-06-03.txt");
    expect(res.status).toBe(400);
    expect(readDesktopReportMock).not.toHaveBeenCalled();
  });

  it("rejects filenames without the siege- prefix with 400", async () => {
    const res = await call("notes-2026-06-03.md");
    expect(res.status).toBe(400);
    expect(readDesktopReportMock).not.toHaveBeenCalled();
  });

  it("rejects filenames with a malformed date with 400", async () => {
    const res = await call("siege-2026-6-3.md");
    expect(res.status).toBe(400);
    expect(readDesktopReportMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the helper raises ENOENT", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    readDesktopReportMock.mockRejectedValue(err);
    const res = await call("siege-2026-06-03.md");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /not found/,
    );
  });

  it("returns 500 when the helper throws an unknown error", async () => {
    readDesktopReportMock.mockRejectedValue(new Error("boom"));
    const res = await call("siege-2026-06-03.md");
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/boom/);
  });
});
