import "server-only";

import { listRecentRuns } from "@/lib/siege";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 30;

export async function GET(): Promise<Response> {
  try {
    const runs = await listRecentRuns(DEFAULT_LIMIT);
    return Response.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to list runs";
    return Response.json({ error: message }, { status: 500 });
  }
}
