import "server-only";

import {
  ConflictError,
  startSiege,
  type StartSiegeOptions,
} from "@/lib/siege";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function parseOptions(raw: unknown): StartSiegeOptions {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("body must be a JSON object");
  }
  const o = raw as Record<string, unknown>;
  const out: StartSiegeOptions = {};

  if (o.dryRun !== undefined) {
    if (typeof o.dryRun !== "boolean") {
      throw new Error("dryRun must be a boolean");
    }
    out.dryRun = o.dryRun;
  }
  if (o.watch !== undefined) {
    if (typeof o.watch !== "boolean") {
      throw new Error("watch must be a boolean");
    }
    out.watch = o.watch;
  }
  if (o.maxItems !== undefined) {
    if (
      typeof o.maxItems !== "number" ||
      !Number.isInteger(o.maxItems) ||
      o.maxItems < 1
    ) {
      throw new Error("maxItems must be a positive integer");
    }
    out.maxItems = o.maxItems;
  }
  if (o.repos !== undefined) {
    if (!Array.isArray(o.repos) || o.repos.length === 0) {
      throw new Error("repos must be a non-empty array of strings");
    }
    for (const r of o.repos) {
      if (typeof r !== "string") {
        throw new Error("repos must be a non-empty array of strings");
      }
    }
    out.repos = o.repos as string[];
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim().length > 0) {
    try {
      raw = JSON.parse(text);
    } catch {
      return errorResponse("invalid JSON body", 400);
    }
  }

  let opts: StartSiegeOptions;
  try {
    opts = parseOptions(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid body";
    return errorResponse(message, 400);
  }

  try {
    const result = await startSiege(opts);
    return Response.json(result);
  } catch (err) {
    if (err instanceof ConflictError) {
      return Response.json(
        { error: err.message, pids: err.pids },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : "failed to start siege";
    return errorResponse(message, 500);
  }
}
