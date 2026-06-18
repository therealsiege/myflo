import { NextResponse } from "next/server";
import { listTasks, getTaskCounts } from "@/lib/flo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const owner = url.searchParams.get("owner") || undefined;
  const tag = url.searchParams.get("tag") || undefined;
  const limit = Number(url.searchParams.get("limit") ?? "200");
  try {
    const [tasks, counts] = await Promise.all([
      listTasks({ status, owner, tag, limit }),
      getTaskCounts(),
    ]);
    return NextResponse.json({ tasks, counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, tasks: [], counts: { total: 0, pending: 0, in_progress: 0, completed: 0 } }, { status: 500 });
  }
}
