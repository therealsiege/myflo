import "server-only";

import { getRunDetail, RunNotFoundError } from "@/lib/siege";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RUN_STAMP_RE = /^\d{8}-\d{6}$/;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ stamp: string }> },
): Promise<Response> {
  const { stamp } = await ctx.params;

  if (typeof stamp !== "string" || !RUN_STAMP_RE.test(stamp)) {
    return Response.json(
      { error: "invalid run stamp (expected YYYYMMDD-HHMMSS)" },
      { status: 400 },
    );
  }

  try {
    const detail = await getRunDetail(stamp);
    return Response.json(detail);
  } catch (err) {
    if (err instanceof RunNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "failed to read run";
    return Response.json({ error: message }, { status: 500 });
  }
}
