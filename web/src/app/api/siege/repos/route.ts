import "server-only";

import { assertReposConfig, readRepos, writeRepos } from "@/lib/siege";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function GET(): Promise<Response> {
  try {
    const config = await readRepos();
    return Response.json(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to read repos";
    return errorResponse(message, 500);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }

  try {
    assertReposConfig(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid repos config";
    return errorResponse(message, 400);
  }

  try {
    await writeRepos(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to write repos";
    return errorResponse(message, 500);
  }

  return Response.json({ ok: true });
}
