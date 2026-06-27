import "server-only";

import { killSiege } from "@/lib/siege";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function parseForce(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("body must be a JSON object");
  }
  const o = raw as Record<string, unknown>;
  if (o.force === undefined) return false;
  if (typeof o.force !== "boolean") {
    throw new Error("force must be a boolean");
  }
  return o.force;
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

  let force: boolean;
  try {
    force = parseForce(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid body";
    return errorResponse(message, 400);
  }

  try {
    const result = await killSiege(force);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to kill siege";
    return errorResponse(message, 500);
  }
}
