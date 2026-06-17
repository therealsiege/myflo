import { NextResponse } from "next/server";
import { listSessions } from "@/lib/flo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "25");
  try {
    const checkpoints = await listSessions({ limit });
    return NextResponse.json({ checkpoints });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, checkpoints: [] }, { status: 500 });
  }
}
