import { NextResponse } from "next/server";
import { getSwarmStatus } from "@/lib/flo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getSwarmStatus();
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
