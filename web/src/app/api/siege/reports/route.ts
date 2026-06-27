import "server-only";

import { readDesktopReports } from "@/lib/siege";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const reports = await readDesktopReports();
    return Response.json({ reports });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "failed to list reports";
    return Response.json({ error: message }, { status: 500 });
  }
}
