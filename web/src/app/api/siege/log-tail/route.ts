import "server-only";

import { findLatestRunLogPath, tailFile } from "@/lib/siege";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LINES = 200;
const MAX_LINES = 2_000;

function parseLines(raw: string | null): number {
  if (raw === null) return DEFAULT_LINES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LINES) {
    throw new Error(
      `lines must be a positive integer ≤ ${MAX_LINES}`,
    );
  }
  return n;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);

  let lines: number;
  try {
    lines = parseLines(url.searchParams.get("lines"));
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid lines param";
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    const target = await findLatestRunLogPath();
    if (target === null) {
      return Response.json({
        path: null,
        lines: [],
        size: 0,
        updatedAt: null,
      });
    }
    const tail = await tailFile(target, lines);
    return Response.json(tail);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to tail log";
    return Response.json({ error: message }, { status: 500 });
  }
}
