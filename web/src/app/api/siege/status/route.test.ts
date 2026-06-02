import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getActivePidMock,
  getOvernightStartedAtMsMock,
  listRunDatesMock,
  listRunsMock,
  ghAuthStatusMock,
} = vi.hoisted(() => ({
  getActivePidMock: vi.fn(),
  getOvernightStartedAtMsMock: vi.fn(),
  listRunDatesMock: vi.fn(),
  listRunsMock: vi.fn(),
  ghAuthStatusMock: vi.fn(),
}));

vi.mock("@/lib/siege", () => ({
  getActivePid: getActivePidMock,
  getOvernightStartedAtMs: getOvernightStartedAtMsMock,
  listRunDates: listRunDatesMock,
  listRuns: listRunsMock,
}));

vi.mock("@/lib/gh", () => ({
  ghAuthStatus: ghAuthStatusMock,
}));

import { GET } from "./route";

interface StatusBody {
  running: boolean;
  pids: number[];
  elapsedSec: number | null;
  latestRun: { date: string; stamp: string; logDir: string } | null;
  ghAuth: { authenticated: boolean; user?: string };
}

const NOW = Date.parse("2026-06-02T22:05:00.000Z");

beforeEach(() => {
  getActivePidMock.mockReset();
  getOvernightStartedAtMsMock.mockReset();
  listRunDatesMock.mockReset();
  listRunsMock.mockReset();
  ghAuthStatusMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/siege/status", () => {
  it("returns running:false when no pid file is present", async () => {
    getActivePidMock.mockResolvedValue(null);
    getOvernightStartedAtMsMock.mockResolvedValue(null);
    listRunDatesMock.mockResolvedValue([]);
    ghAuthStatusMock.mockResolvedValue({ authenticated: false });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatusBody;
    expect(body).toEqual({
      running: false,
      pids: [],
      elapsedSec: null,
      latestRun: null,
      ghAuth: { authenticated: false },
    });
  });

  it("returns running:false when pid file exists but is empty", async () => {
    getActivePidMock.mockResolvedValue([]);
    getOvernightStartedAtMsMock.mockResolvedValue(NOW - 60_000);
    listRunDatesMock.mockResolvedValue([]);
    ghAuthStatusMock.mockResolvedValue({ authenticated: false });

    const res = await GET();
    const body = (await res.json()) as StatusBody;
    expect(body.running).toBe(false);
    expect(body.pids).toEqual([]);
    expect(body.elapsedSec).toBeNull();
  });

  it("returns running:true with elapsed seconds and latest run", async () => {
    getActivePidMock.mockResolvedValue([1234, 5678]);
    getOvernightStartedAtMsMock.mockResolvedValue(NOW - 90_000);
    listRunDatesMock.mockResolvedValue(["2026-06-02", "2026-06-01"]);
    listRunsMock.mockImplementation(async (date: string) => {
      if (date === "2026-06-02") {
        return [
          { stamp: "20260602-220301", logDir: "/h/.siege/logs/2026-06-02/20260602-220301" },
          { stamp: "20260602-210000", logDir: "/h/.siege/logs/2026-06-02/20260602-210000" },
        ];
      }
      return [];
    });
    ghAuthStatusMock.mockResolvedValue({
      authenticated: true,
      user: "therealsiege",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatusBody;
    expect(body.running).toBe(true);
    expect(body.pids).toEqual([1234, 5678]);
    expect(body.elapsedSec).toBe(90);
    expect(body.latestRun).toEqual({
      date: "2026-06-02",
      stamp: "20260602-220301",
      logDir: "/h/.siege/logs/2026-06-02/20260602-220301",
    });
    expect(body.ghAuth).toEqual({ authenticated: true, user: "therealsiege" });
  });

  it("skips empty date dirs when locating the latest run", async () => {
    getActivePidMock.mockResolvedValue(null);
    getOvernightStartedAtMsMock.mockResolvedValue(null);
    listRunDatesMock.mockResolvedValue(["2026-06-02", "2026-06-01"]);
    listRunsMock.mockImplementation(async (date: string) => {
      if (date === "2026-06-02") return [];
      return [
        { stamp: "20260601-090000", logDir: `/h/.siege/logs/${date}/20260601-090000` },
      ];
    });
    ghAuthStatusMock.mockResolvedValue({ authenticated: false });

    const res = await GET();
    const body = (await res.json()) as StatusBody;
    expect(body.latestRun?.date).toBe("2026-06-01");
    expect(body.latestRun?.stamp).toBe("20260601-090000");
  });

  it("degrades ghAuth to authenticated:false when gh CLI throws", async () => {
    getActivePidMock.mockResolvedValue(null);
    getOvernightStartedAtMsMock.mockResolvedValue(null);
    listRunDatesMock.mockResolvedValue([]);
    ghAuthStatusMock.mockRejectedValue(new Error("gh CLI not found in PATH"));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatusBody;
    expect(body.ghAuth).toEqual({ authenticated: false });
  });

  it("clamps elapsedSec to zero if the pid file has a future mtime", async () => {
    getActivePidMock.mockResolvedValue([42]);
    getOvernightStartedAtMsMock.mockResolvedValue(NOW + 5_000);
    listRunDatesMock.mockResolvedValue([]);
    ghAuthStatusMock.mockResolvedValue({ authenticated: false });

    const res = await GET();
    const body = (await res.json()) as StatusBody;
    expect(body.elapsedSec).toBe(0);
  });

  it("returns 500 when a siege helper throws unexpectedly", async () => {
    getActivePidMock.mockRejectedValue(new Error("boom"));
    getOvernightStartedAtMsMock.mockResolvedValue(null);
    listRunDatesMock.mockResolvedValue([]);
    ghAuthStatusMock.mockResolvedValue({ authenticated: false });

    const res = await GET();
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/boom/);
  });
});
