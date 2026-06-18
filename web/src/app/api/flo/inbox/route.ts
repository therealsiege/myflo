import { NextResponse } from "next/server";
import { listInboxes } from "@/lib/flo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const inboxes = await listInboxes();
    return NextResponse.json({ inboxes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, inboxes: [] }, { status: 500 });
  }
}
