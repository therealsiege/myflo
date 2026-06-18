import { listTasks, getTaskCounts } from "@/lib/flo";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "in_progress", "completed"] as const;

export default async function TasksPage() {
  let tasks: Awaited<ReturnType<typeof listTasks>> = [];
  let counts: Awaited<ReturnType<typeof getTaskCounts>> = {
    total: 0,
    pending: 0,
    in_progress: 0,
    completed: 0,
  };
  let error: string | null = null;
  try {
    [tasks, counts] = await Promise.all([listTasks({ limit: 200 }), getTaskCounts()]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const byStatus: Record<string, typeof tasks> = {
    pending: [],
    in_progress: [],
    completed: [],
  };
  for (const t of tasks) {
    if (byStatus[t.status]) byStatus[t.status].push(t);
  }

  return (
    <section className="px-6 py-12 md:px-10 md:py-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            flo · tasks
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            Persistent tasks
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Append-only event log at <code>~/.flo/tasks.jsonl</code>. Survives
            session boundaries. Create with{" "}
            <code className="font-mono">flo tasks create &lt;subject&gt;</code>{" "}
            or via the <code className="font-mono">flo_tasks_create</code> MCP
            tool from a Claude Code agent.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="total" value={counts.total} />
          <Stat label="pending" value={counts.pending} tone="warn" />
          <Stat label="in_progress" value={counts.in_progress} tone="primary" />
          <Stat label="completed" value={counts.completed} tone="ok" />
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : counts.total === 0 ? (
          <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            No tasks yet. Try{" "}
            <code className="font-mono">
              flo tasks create &quot;Build the thing&quot;
            </code>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {STATUSES.map((status) => (
              <Column
                key={status}
                title={status}
                tasks={byStatus[status]}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Column({ title, tasks }: { title: string; tasks: Awaited<ReturnType<typeof listTasks>> }) {
  return (
    <div className="rounded-md border border-border bg-muted/10">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
        <code className="font-mono text-xs uppercase tracking-wider text-foreground">
          {title}
        </code>
        <span className="font-mono text-[0.65rem] text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {tasks.length === 0 ? (
          <li className="px-3 py-3 text-xs text-muted-foreground">empty</li>
        ) : (
          tasks.map((t) => (
            <li key={t.id} className="px-3 py-2">
              <div className="text-sm text-foreground">{t.subject}</div>
              <div className="mt-1 flex items-center gap-2 text-[0.65rem] font-mono text-muted-foreground">
                <span>{t.id}</span>
                {t.owner ? <span>· {t.owner}</span> : null}
                <span>· {t.updatedAt.slice(0, 10)}</span>
              </div>
              {t.tags?.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.6rem] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "primary" | "ok" | "warn";
}) {
  const color =
    tone === "primary"
      ? "text-foreground"
      : tone === "ok"
        ? "text-emerald-700 dark:text-emerald-400"
        : tone === "warn"
          ? "text-amber-700 dark:text-amber-400"
          : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-medium ${color}`}>{value}</p>
    </div>
  );
}
