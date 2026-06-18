import { NextResponse } from "next/server";
import { listTranscripts } from "@/lib/flo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");
  try {
    const transcripts = await listTranscripts(limit);
    return NextResponse.json({ transcripts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, transcripts: [] }, { status: 500 });
  }
}
