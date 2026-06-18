import { NextResponse } from "next/server";
import { listMemoryEntries, listMemoryNamespaces, searchMemory } from "@/lib/flo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const namespace = url.searchParams.get("namespace") || undefined;
  const query = url.searchParams.get("q");
  const limit = Number(url.searchParams.get("limit") ?? "50");
  try {
    const namespaces = await listMemoryNamespaces();
    if (query) {
      const results = await searchMemory({ query, namespace, limit });
      return NextResponse.json({ namespaces, results, query, namespace });
    }
    const results = namespace
      ? await listMemoryEntries({ namespace, limit })
      : [];
    return NextResponse.json({ namespaces, results, query: null, namespace });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
