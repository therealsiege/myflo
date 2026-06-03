import { beforeEach, describe, expect, it, vi } from "vitest";

const { killSiegeMock } = vi.hoisted(() => ({
  killSiegeMock: vi.fn(),
}));

vi.mock("@/lib/siege", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/siege")>("@/lib/siege");
  return {
    ...actual,
    killSiege: killSiegeMock,
  };
});

import { POST } from "./route";

function postRequest(
  body: unknown,
  opts: { rawBody?: string } = {},
): Request {
  return new Request("http://localhost/api/siege/kill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: opts.rawBody ?? (body === undefined ? "" : JSON.stringify(body)),
  });
}

beforeEach(() => {
  killSiegeMock.mockReset();
});

describe("POST /api/siege/kill", () => {
  it("returns 200 with killed pids on graceful shutdown", async () => {
    killSiegeMock.mockResolvedValue({
      killed: [12345, 12346],
      method: "graceful",
    });

    const res = await POST(postRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      killed: [12345, 12346],
      method: "graceful",
    });
    expect(killSiegeMock).toHaveBeenCalledWith(false);
  });

  it("accepts an empty body and defaults force to false", async () => {
    killSiegeMock.mockResolvedValue({ killed: [42], method: "graceful" });

    const res = await POST(postRequest(undefined, { rawBody: "" }));
    expect(res.status).toBe(200);
    expect(killSiegeMock).toHaveBeenCalledWith(false);
  });

  it("forwards force=true and reports method 'force'", async () => {
    killSiegeMock.mockResolvedValue({ killed: [777], method: "force" });

    const res = await POST(postRequest({ force: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ killed: [777], method: "force" });
    expect(killSiegeMock).toHaveBeenCalledWith(true);
  });

  it("returns 200 with empty killed array when nothing is running", async () => {
    killSiegeMock.mockResolvedValue({ killed: [], method: "noop" });

    const res = await POST(postRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ killed: [], method: "noop" });
  });

  it("returns 400 when body is not valid JSON", async () => {
    const res = await POST(postRequest(undefined, { rawBody: "{not json" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /invalid JSON/i,
    );
    expect(killSiegeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when body is a JSON array instead of object", async () => {
    const res = await POST(postRequest([]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /must be a JSON object/,
    );
    expect(killSiegeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when force is not boolean", async () => {
    const res = await POST(postRequest({ force: "yes" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/force/);
    expect(killSiegeMock).not.toHaveBeenCalled();
  });

  it("returns 500 when killSiege throws a generic error", async () => {
    killSiegeMock.mockRejectedValue(new Error("kill script missing"));
    const res = await POST(postRequest({}));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /kill script missing/,
    );
  });
});
