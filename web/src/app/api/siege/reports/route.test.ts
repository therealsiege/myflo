import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopReport } from "@/lib/siege";

const { readDesktopReportsMock } = vi.hoisted(() => ({
  readDesktopReportsMock: vi.fn(),
}));

vi.mock("@/lib/siege", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/siege")>("@/lib/siege");
  return {
    ...actual,
    readDesktopReports: readDesktopReportsMock,
  };
});

import { GET } from "./route";

const FIXTURE: DesktopReport[] = [
  {
    filename: "siege-2026-06-03.md",
    date: "2026-06-03",
    bytes: 1200,
    mtime: "2026-06-03T08:00:00.000Z",
  },
  {
    filename: "siege-2026-06-02.md",
    date: "2026-06-02",
    bytes: 980,
    mtime: "2026-06-02T08:00:00.000Z",
  },
];

beforeEach(() => {
  readDesktopReportsMock.mockReset();
});

describe("GET /api/siege/reports", () => {
  it("returns the report list on success", async () => {
    readDesktopReportsMock.mockResolvedValue(FIXTURE);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reports: FIXTURE });
    expect(readDesktopReportsMock).toHaveBeenCalledTimes(1);
  });

  it("returns { reports: [] } when no reports exist", async () => {
    readDesktopReportsMock.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reports: [] });
  });

  it("returns 500 with error message when read fails", async () => {
    readDesktopReportsMock.mockRejectedValue(
      new Error("EACCES: ~/Desktop unreadable"),
    );
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/EACCES/);
  });
});
