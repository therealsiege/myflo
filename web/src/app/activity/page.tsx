import Link from "next/link";
import { listActivity, type FloActivityEvent } from "@/lib/flo";

export const dynamic = "force-dynamic";

const TYPE_GLYPH: Record<string, string> = {
  task: "T",
  note: "N",
  memory: "M",
  inbox: "I",
  transcript: "A",
  terminal: "$",
  checkpoint: "C",
};

const TYPE_COLOR: Record<string, string> = {
  task: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  note: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  memory: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  inbox: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  transcript: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  terminal: "bg-foreground/15 text-foreground",
  checkpoint: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

interface PageProps {
  searchParams: Promise<{ since?: string; type?: string }>;
}

export default async function ActivityPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const type = params.type as Parameters<typeof listActivity>[0] extends infer P
    ? P extends { type?: infer T } ? T : never
    : never;
  const since = params.since || "30d";

  let events: FloActivityEvent[] = [];
  let error: string | null = null;
  try {
    events = await listActivity({ since, type, limit: 200 });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Group by date (YYYY-MM-DD)
  const groups: Map<string, FloActivityEvent[]> = new Map();
  for (const e of events) {
    const day = e.timestamp.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(e);
  }

  return (
    <section className="px-6 py-12 md:px-10 md:py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            flo · activity
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            Recent activity
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Cross-subsystem timeline. Tasks, notes, memory, inbox, transcripts,
            terminals, and Claude Code checkpoints — chronologically merged.
          </p>
        </div>

        <FilterBar since={since} type={params.type} />

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            No events in the last {since}.
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {[...groups.entries()].map(([day, dayEvents]) => (
              <div key={day} className="flex flex-col gap-2">
                <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  {day} <span className="text-foreground/50">· {dayEvents.length}</span>
                </h3>
                <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border">
                  {dayEvents.map((e) => (
                    <li key={e.id} className="flex items-start gap-3 px-3 py-2 hover:bg-muted/20">
                      <div
                        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded font-mono text-xs ${TYPE_COLOR[e.type] || ""}`}
                        title={e.type}
                      >
                        {TYPE_GLYPH[e.type] || "?"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm text-foreground">
                            {e.snippet || <span className="text-muted-foreground italic">(no snippet)</span>}
                          </p>
                          <span className="flex-shrink-0 font-mono text-[0.65rem] text-muted-foreground">
                            {e.timestamp.slice(11, 19)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[0.65rem] text-muted-foreground">
                          <span>{e.type}/{e.kind}</span>
                          <span>·</span>
                          <span className="truncate">{e.source}</span>
                          {e.tags?.length ? (
                            <>
                              <span>·</span>
                              <span className="truncate">{e.tags.join(", ")}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FilterBar({ since, type }: { since: string; type?: string }) {
  const types = ["task", "note", "memory", "inbox", "transcript", "terminal", "checkpoint"];
  const sinceOptions = ["1d", "7d", "30d", "90d"];
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <label className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">since</label>
      <select name="since" defaultValue={since} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
        {sinceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <label className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">type</label>
      <select name="type" defaultValue={type || ""} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
        <option value="">all</option>
        {types.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <button type="submit" className="rounded-md border border-border bg-muted/30 px-2 py-1 text-xs hover:bg-muted">Apply</button>
      <Link href="/activity" className="text-[0.65rem] text-muted-foreground hover:text-foreground">clear</Link>
    </form>
  );
}
