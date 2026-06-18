import Link from "next/link";
import { listMemoryEntries, listMemoryNamespaces, searchMemory } from "@/lib/flo";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ namespace?: string; q?: string }>;
}

export default async function MemoryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const namespace = params.namespace || "";
  const query = params.q || "";

  let namespaces: Awaited<ReturnType<typeof listMemoryNamespaces>> = [];
  let entries: Awaited<ReturnType<typeof listMemoryEntries>> = [];
  let error: string | null = null;
  try {
    namespaces = await listMemoryNamespaces();
    if (query) {
      entries = await searchMemory({
        query,
        namespace: namespace || undefined,
        limit: 50,
      });
    } else if (namespace) {
      entries = await listMemoryEntries({ namespace, limit: 50 });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <section className="px-6 py-12 md:px-10 md:py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            flo · memory
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            Memory store
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Local JSON memory at <code>~/.flo/memory/&lt;namespace&gt;.jsonl</code>.
            Substring + tag search; no vector embeddings yet.
          </p>
        </div>

        <form method="get" className="flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search…"
            className="flex-1 min-w-[180px] rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          />
          <select
            name="namespace"
            defaultValue={namespace}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">all namespaces</option>
            {namespaces.map((n) => (
              <option key={n.namespace} value={n.namespace}>
                {n.namespace} ({n.count})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm hover:bg-muted"
          >
            Search
          </button>
          {(query || namespace) ? (
            <Link
              href="/memory"
              className="self-center text-xs text-muted-foreground hover:text-foreground"
            >
              clear
            </Link>
          ) : null}
        </form>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
          <aside>
            <h3 className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
              namespaces
            </h3>
            {namespaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Empty. Store something with{" "}
                <code className="font-mono">
                  flo memory store --value &lt;…&gt;
                </code>
                .
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {namespaces.map((n) => (
                  <li key={n.namespace}>
                    <Link
                      href={`/memory?namespace=${encodeURIComponent(n.namespace)}`}
                      className={`flex items-center justify-between rounded px-2 py-1 text-sm transition-colors ${
                        namespace === n.namespace
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      }`}
                    >
                      <span className="font-mono">{n.namespace}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {n.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <main>
            {entries.length === 0 ? (
              <div className="rounded-md border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                {query
                  ? "No matches."
                  : namespace
                    ? "Empty namespace."
                    : "Pick a namespace or search to see entries."}
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {entries.map((e) => (
                  <li
                    key={e.id}
                    className="overflow-hidden rounded-md border border-border bg-muted/10"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
                      <code className="text-xs font-medium text-foreground">
                        {e.namespace}/{e.key ?? e.id.slice(0, 12)}
                      </code>
                      <div className="flex items-center gap-2 text-[0.65rem] text-muted-foreground">
                        {typeof e._score === "number" ? (
                          <span className="font-mono">score={e._score}</span>
                        ) : null}
                        <span className="font-mono">
                          {e.createdAt.slice(0, 19).replace("T", " ")}
                        </span>
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap break-words px-3 py-2 text-xs text-foreground">
                      {e.value}
                    </pre>
                    {e.tags?.length ? (
                      <div className="border-t border-border bg-muted/20 px-3 py-1.5 text-[0.65rem]">
                        {e.tags.map((t) => (
                          <span
                            key={t}
                            className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </main>
        </div>
      </div>
    </section>
  );
}
