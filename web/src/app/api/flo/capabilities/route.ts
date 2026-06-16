import { NextResponse } from "next/server";
import { runGuidanceAudit } from "@/lib/flo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scopeParam = url.searchParams.get("scope");
  const scope = scopeParam === "user" || scopeParam === "project" ? scopeParam : "all";
  try {
    const audit = await runGuidanceAudit({ scope });
    return NextResponse.json(audit);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
