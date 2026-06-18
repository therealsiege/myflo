import Link from "next/link";
import {
  getSwarmStatus,
  getTaskCounts,
  listMemoryNamespaces,
  listInboxes,
  listTranscripts,
  runGuidanceAudit,
  listTasks,
} from "@/lib/flo";

export const dynamic = "force-dynamic";

async function safeCall<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

export default async function HomePage() {
  // Parallel server-side fetch — bounded by a 30s timeout per call inside flo.ts
  const [swarm, taskCounts, recentTasks, namespaces, inboxes, transcripts, audit] = await Promise.all([
    safeCall(getSwarmStatus(), { available: false, dir: "", state: null, qlearn: null } as Awaited<ReturnType<typeof getSwarmStatus>>),
    safeCall(getTaskCounts(), { total: 0, pending: 0, in_progress: 0, completed: 0 }),
    safeCall(listTasks({ limit: 5 }), []),
    safeCall(listMemoryNamespaces(), []),
    safeCall(listInboxes(), []),
    safeCall(listTranscripts(5), []),
    safeCall(runGuidanceAudit({ scope: "all" }), { total: 0, scopeHistogram: {}, kindHistogram: {}, duplicates: [], missingDescription: [] }),
  ]);

  const memoryTotal = namespaces.reduce((sum, n) => sum + n.count, 0);
  const inboxPending = inboxes.reduce((sum, i) => sum + i.pending, 0);
  const inboxProcessed = inboxes.reduce((sum, i) => sum + i.processed, 0);

  return (
    <section className="px-6 py-10 md:px-10 md:py-14">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            myflo · overview
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            Welcome
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Local-first developer workbench. Pick a panel below to drill in, or
            run <code className="font-mono">flo --help</code> for the CLI surface.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card href="/swarm" title="Swarm" subtitle={swarm.available ? "active" : "no .swarm/"}>
            {swarm.available && swarm.state ? (
              <>
                <KV k="objective" v={swarm.state.objective || "—"} />
                <KV k="strategy" v={swarm.state.strategy || "—"} />
                <KV k="status" v={swarm.state.status || "—"} />
                <KV k="agents" v={String(swarm.state.agents ?? 0)} />
              </>
            ) : (
              <Empty>Initialize with <code className="font-mono">npx ruflo swarm init</code></Empty>
            )}
          </Card>

          <Card href="/tasks" title="Tasks" subtitle={`${taskCounts.total} total`}>
            <Bar label="pending" value={taskCounts.pending} max={Math.max(taskCounts.total, 1)} tone="warn" />
            <Bar label="in_progress" value={taskCounts.in_progress} max={Math.max(taskCounts.total, 1)} />
            <Bar label="completed" value={taskCounts.completed} max={Math.max(taskCounts.total, 1)} tone="ok" />
            {recentTasks.length > 0 ? (
              <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                Latest: <span className="text-foreground">{recentTasks[0].subject}</span>
              </div>
            ) : null}
          </Card>

          <Card href="/memory" title="Memory" subtitle={`${memoryTotal} entries`}>
            {namespaces.length === 0 ? (
              <Empty>No entries. <code className="font-mono">flo memory store</code> to begin.</Empty>
            ) : (
              <ul className="flex flex-col gap-1">
                {namespaces.slice(0, 5).map((n) => (
                  <li key={n.namespace} className="flex justify-between text-sm">
                    <code className="font-mono text-foreground">{n.namespace}</code>
                    <span className="font-mono text-xs text-muted-foreground">{n.count}</span>
                  </li>
                ))}
                {namespaces.length > 5 ? <li className="text-xs text-muted-foreground">…and {namespaces.length - 5} more</li> : null}
              </ul>
            )}
          </Card>

          <Card href="/inbox" title="Inbox" subtitle={`${inboxes.length} folder(s)`}>
            {inboxes.length === 0 ? (
              <Empty>None registered. <code className="font-mono">flo inbox add &lt;dir&gt;</code></Empty>
            ) : (
              <>
                <KV k="pending" v={String(inboxPending)} tone={inboxPending > 0 ? "warn" : "default"} />
                <KV k="processed" v={String(inboxProcessed)} />
                <KV k="failed" v={String(inboxes.reduce((s, i) => s + i.failed, 0))} />
              </>
            )}
          </Card>

          <Card href="/transcripts" title="Transcripts" subtitle={`${transcripts.length} recent`}>
            {transcripts.length === 0 ? (
              <Empty>None. Drop audio in a registered inbox to transcribe.</Empty>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {transcripts.slice(0, 3).map((t) => (
                  <li key={t.sidecarPath} className="text-xs">
                    <code className="font-mono text-foreground">{t.audioFilename}</code>
                    <p className="mt-0.5 truncate text-muted-foreground">{t.snippet}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card href="/capabilities" title="Capabilities" subtitle={`${audit.total} scanned`}>
            <KV k="duplicates" v={String(audit.duplicates.length)} tone={audit.duplicates.length > 0 ? "warn" : "default"} />
            <KV k="missing desc" v={String(audit.missingDescription.length)} tone={audit.missingDescription.length > 10 ? "warn" : "default"} />
            <KV k="scopes" v={Object.keys(audit.scopeHistogram).join(", ") || "—"} />
          </Card>
        </div>
      </div>
    </section>
  );
}

function Card({ href, title, subtitle, children }: { href: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 overflow-hidden rounded-md border border-border bg-muted/10 px-4 py-3 transition-colors hover:bg-muted/30"
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-border pb-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {subtitle ? (
          <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </Link>
  );
}

function KV({ k, v, tone = "default" }: { k: string; v: string; tone?: "default" | "warn" | "ok" }) {
  const color =
    tone === "warn"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "ok"
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
        {k}
      </span>
      <span className={`truncate text-sm ${color}`}>{v}</span>
    </div>
  );
}

function Bar({ label, value, max, tone = "default" }: { label: string; value: number; max: number; tone?: "default" | "warn" | "ok" }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const color =
    tone === "warn"
      ? "bg-amber-500/60"
      : tone === "ok"
        ? "bg-emerald-500/60"
        : "bg-foreground/40";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[0.65rem] font-mono text-muted-foreground">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
