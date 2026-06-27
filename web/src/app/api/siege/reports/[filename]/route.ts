import "server-only";

import { readDesktopReport } from "@/lib/siege";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DESKTOP_REPORT_RE = /^siege-\d{4}-\d{2}-\d{2}\.md$/;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ filename: string }> },
): Promise<Response> {
  const { filename } = await ctx.params;

  if (typeof filename !== "string" || !DESKTOP_REPORT_RE.test(filename)) {
    return Response.json(
      {
        error:
          'invalid report filename (expected "siege-YYYY-MM-DD.md")',
      },
      { status: 400 },
    );
  }

  try {
    const body = await readDesktopReport(filename);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return Response.json(
        { error: `report not found: ${filename}` },
        { status: 404 },
      );
    }
    const message = err instanceof Error ? err.message : "failed to read report";
    return Response.json({ error: message }, { status: 500 });
  }
}
