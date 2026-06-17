import { getSwarmStatus } from "@/lib/flo";

export const dynamic = "force-dynamic";

export default async function SwarmPage() {
  let status: Awaited<ReturnType<typeof getSwarmStatus>> | null = null;
  let error: string | null = null;
  try {
    status = await getSwarmStatus();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <section className="px-6 py-12 md:px-10 md:py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            flo · swarm
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            Swarm state
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Reads <code>.swarm/state.json</code> and{" "}
            <code>.swarm/q-learning-model.json</code> from the project root.
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Failed to load swarm state: {error}
          </div>
        ) : !status?.available ? (
          <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            No <code>.swarm/</code> directory yet. Run{" "}
            <code className="font-mono">flo swarm status</code> from the CLI to
            initialize, or start a swarm via{" "}
            <code className="font-mono">npx ruflo swarm init</code>.
          </div>
        ) : (
          <>
            {status.state ? (
              <Card title="Active swarm">
                <DefList
                  items={[
                    ["ID", status.state.swarmId ?? "—"],
                    ["Objective", status.state.objective ?? "—"],
                    ["Strategy", status.state.strategy ?? "—"],
                    [
                      "Status",
                      <StatusPill
                        key="s"
                        status={status.state.status ?? "unknown"}
                      />,
                    ],
                    ["Agents", String(status.state.agents ?? 0)],
                    ["Parallel", String(status.state.parallel ?? false)],
                    ["Started", status.state.startedAt ?? "—"],
                    ["Stopped", status.state.stoppedAt ?? "—"],
                  ]}
                />
              </Card>
            ) : null}

            {status.state?.agentPlan?.length ? (
              <Card title={`Agent plan (${status.state.agentPlan.length})`}>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">×</th>
                      <th className="px-4 py-2 font-medium">Role</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {status.state.agentPlan.map((p, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 font-mono text-xs text-foreground">
                          {p.count}
                        </td>
                        <td className="px-4 py-2 text-foreground">{p.role}</td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {p.type}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {p.purpose}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : null}

            {status.qlearn ? (
              <Card title="Q-Learning model">
                <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
                  <Stat label="states" value={status.qlearn.stateCount} />
                  <Stat
                    label="steps"
                    value={status.qlearn.stats?.stepCount ?? 0}
                  />
                  <Stat
                    label="epsilon"
                    value={
                      status.qlearn.stats?.epsilon?.toFixed(4) ?? "—"
                    }
                  />
                  <Stat
                    label="avg TD err"
                    value={
                      status.qlearn.stats?.avgTDError?.toFixed(4) ?? "—"
                    }
                  />
                </div>
                {status.qlearn.sampleStates?.length ? (
                  <div className="border-t border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 font-medium">State</th>
                          <th className="px-4 py-2 font-medium">Visits</th>
                          <th className="px-4 py-2 font-medium">Top Q</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {status.qlearn.sampleStates.map((s) => (
                          <tr key={s.state}>
                            <td className="px-4 py-2 font-mono text-xs text-foreground">
                              {s.state}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {s.visits}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                              {s.topQ.toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </Card>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-muted/40 px-4 py-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function DefList({
  items,
}: {
  items: Array<[string, React.ReactNode]>;
}) {
  return (
    <dl className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
      {items.map(([k, v], i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-2 sm:border-b sm:border-border"
        >
          <dt className="w-24 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
            {k}
          </dt>
          <dd className="flex-1 truncate text-sm text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-medium text-foreground">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "running"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : status === "stopped"
        ? "bg-muted text-muted-foreground"
        : "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[0.7rem] ${color}`}
    >
      {status}
    </span>
  );
}
