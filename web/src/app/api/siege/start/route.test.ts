import { beforeEach, describe, expect, it, vi } from "vitest";

const { startSiegeMock } = vi.hoisted(() => ({
  startSiegeMock: vi.fn(),
}));

vi.mock("@/lib/siege", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/siege")>("@/lib/siege");
  return {
    ...actual,
    startSiege: startSiegeMock,
  };
});

import { ConflictError } from "@/lib/siege";

import { POST } from "./route";

function postRequest(
  body: unknown,
  opts: { rawBody?: string } = {},
): Request {
  return new Request("http://localhost/api/siege/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: opts.rawBody ?? (body === undefined ? "" : JSON.stringify(body)),
  });
}

beforeEach(() => {
  startSiegeMock.mockReset();
});

describe("POST /api/siege/start", () => {
  it("returns 200 with runStamp, logDir, pids on success", async () => {
    startSiegeMock.mockResolvedValue({
      runStamp: "20260603-082130",
      logDir: "/home/me/.siege/logs/2026-06-03/20260603-082130",
      pids: [12345, 12346],
    });

    const res = await POST(postRequest({ dryRun: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      runStamp: "20260603-082130",
      logDir: "/home/me/.siege/logs/2026-06-03/20260603-082130",
      pids: [12345, 12346],
    });
    expect(startSiegeMock).toHaveBeenCalledWith({ dryRun: true });
  });

  it("accepts an empty body and forwards no options", async () => {
    startSiegeMock.mockResolvedValue({
      runStamp: "20260603-082130",
      logDir: "/h/.siege/logs/2026-06-03/20260603-082130",
      pids: [42],
    });

    const res = await POST(postRequest(undefined, { rawBody: "" }));
    expect(res.status).toBe(200);
    expect(startSiegeMock).toHaveBeenCalledWith({});
  });

  it("forwards all four options when provided", async () => {
    startSiegeMock.mockResolvedValue({
      runStamp: "20260603-082130",
      logDir: "/h/.siege/logs/2026-06-03/20260603-082130",
      pids: [1],
    });

    await POST(
      postRequest({
        dryRun: false,
        watch: true,
        maxItems: 4,
        repos: ["a/b", "c/d"],
      }),
    );

    expect(startSiegeMock).toHaveBeenCalledWith({
      dryRun: false,
      watch: true,
      maxItems: 4,
      repos: ["a/b", "c/d"],
    });
  });

  it("returns 409 when a siege is already running", async () => {
    startSiegeMock.mockRejectedValue(
      new ConflictError("siege already running", [9999, 10000]),
    );

    const res = await POST(postRequest({}));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "siege already running",
      pids: [9999, 10000],
    });
  });

  it("returns 400 when body is not valid JSON", async () => {
    const res = await POST(postRequest(undefined, { rawBody: "{not json" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /invalid JSON/i,
    );
    expect(startSiegeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when body is a JSON array instead of object", async () => {
    const res = await POST(postRequest([]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /must be a JSON object/,
    );
    expect(startSiegeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when maxItems is not a positive integer", async () => {
    const res = await POST(postRequest({ maxItems: "5" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /maxItems/,
    );
    expect(startSiegeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when maxItems is zero", async () => {
    const res = await POST(postRequest({ maxItems: 0 }));
    expect(res.status).toBe(400);
    expect(startSiegeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when repos is not an array", async () => {
    const res = await POST(postRequest({ repos: "openloop/foo" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/repos/);
    expect(startSiegeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when repos contains non-strings", async () => {
    const res = await POST(postRequest({ repos: ["a/b", 123] }));
    expect(res.status).toBe(400);
    expect(startSiegeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when dryRun is not boolean", async () => {
    const res = await POST(postRequest({ dryRun: "yes" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /dryRun/,
    );
    expect(startSiegeMock).not.toHaveBeenCalled();
  });

  it("returns 500 when startSiege throws a generic error", async () => {
    startSiegeMock.mockRejectedValue(
      new Error("no pids appeared within 5000ms"),
    );
    const res = await POST(postRequest({}));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /no pids appeared/,
    );
  });
});
