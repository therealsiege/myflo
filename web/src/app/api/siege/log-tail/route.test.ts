import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findLatestRunLogPathMock, tailFileMock } = vi.hoisted(() => ({
  findLatestRunLogPathMock: vi.fn(),
  tailFileMock: vi.fn(),
}));

vi.mock("@/lib/siege", () => ({
  findLatestRunLogPath: findLatestRunLogPathMock,
  tailFile: tailFileMock,
}));

import { GET } from "./route";

beforeEach(() => {
  findLatestRunLogPathMock.mockReset();
  tailFileMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeReq(query = ""): Request {
  return new Request(
    `http://localhost:3000/api/siege/log-tail${query ? `?${query}` : ""}`,
  );
}

describe("GET /api/siege/log-tail", () => {
  it("returns an empty tail when no run logs exist", async () => {
    findLatestRunLogPathMock.mockResolvedValue(null);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: null,
      lines: [],
      size: 0,
      updatedAt: null,
    });
    expect(tailFileMock).not.toHaveBeenCalled();
  });

  it("tails the latest log with the default of 200 lines", async () => {
    findLatestRunLogPathMock.mockResolvedValue("/h/.siege/logs/x/x/start.log");
    tailFileMock.mockResolvedValue({
      path: "/h/.siege/logs/x/x/start.log",
      lines: ["line a", "line b"],
      size: 13,
      updatedAt: "2026-06-02T22:00:00.000Z",
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(tailFileMock).toHaveBeenCalledWith(
      "/h/.siege/logs/x/x/start.log",
      200,
    );
    expect(await res.json()).toEqual({
      path: "/h/.siege/logs/x/x/start.log",
      lines: ["line a", "line b"],
      size: 13,
      updatedAt: "2026-06-02T22:00:00.000Z",
    });
  });

  it("honors the ?lines= query param", async () => {
    findLatestRunLogPathMock.mockResolvedValue("/h/x.log");
    tailFileMock.mockResolvedValue({
      path: "/h/x.log",
      lines: [],
      size: 0,
      updatedAt: "2026-06-02T22:00:00.000Z",
    });
    await GET(makeReq("lines=50"));
    expect(tailFileMock).toHaveBeenCalledWith("/h/x.log", 50);
  });

  it("rejects non-integer lines", async () => {
    const res = await GET(makeReq("lines=abc"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /positive integer/,
    );
  });

  it("rejects lines below 1", async () => {
    const res = await GET(makeReq("lines=0"));
    expect(res.status).toBe(400);
  });

  it("rejects lines above the cap", async () => {
    const res = await GET(makeReq("lines=10000"));
    expect(res.status).toBe(400);
  });

  it("returns 500 if tailFile throws", async () => {
    findLatestRunLogPathMock.mockResolvedValue("/h/x.log");
    tailFileMock.mockRejectedValue(new Error("disk gone"));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/disk gone/);
  });
});
