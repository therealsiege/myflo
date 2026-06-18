import { NextResponse } from "next/server";
import { listActivity, type FloActivityType } from "@/lib/flo";

export const dynamic = "force-dynamic";

const VALID_TYPES: FloActivityType[] = ["task", "note", "memory", "inbox", "transcript", "terminal", "checkpoint"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = url.searchParams.get("since") || undefined;
  const typeParam = url.searchParams.get("type");
  const type = typeParam && VALID_TYPES.includes(typeParam as FloActivityType) ? (typeParam as FloActivityType) : undefined;
  const limit = Number(url.searchParams.get("limit") ?? "200");
  try {
    const events = await listActivity({ since, type, limit });
    return NextResponse.json({ events });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, events: [] }, { status: 500 });
  }
}
