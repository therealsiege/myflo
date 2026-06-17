import { runGuidanceAudit } from "@/lib/flo";

export const dynamic = "force-dynamic";

export default async function CapabilitiesPage() {
  let audit: Awaited<ReturnType<typeof runGuidanceAudit>> | null = null;
  let error: string | null = null;
  try {
    audit = await runGuidanceAudit({ scope: "all" });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <section className="px-6 py-12 md:px-10 md:py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            flo · capabilities
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            Capability audit
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Scans <code>~/.claude/{"{skills,commands,agents}"}/</code> and the
            project <code>.claude/</code>; reports duplicates and missing
            descriptions.
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Failed to run audit: {error}
          </div>
        ) : audit ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="total" value={audit.total} />
              <Stat label="duplicates" value={audit.duplicates.length} />
              <Stat
                label="missing description"
                value={audit.missingDescription.length}
              />
            </div>

            <Section title="Scope × kind">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Bucket</th>
                    <th className="px-4 py-2 font-medium">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {Object.entries(audit.kindHistogram)
                    .sort()
                    .map(([k, v]) => (
                      <tr key={k}>
                        <td className="px-4 py-2 font-mono text-xs text-foreground">
                          {k}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{v}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Section>

            <Section title={`Duplicates (${audit.duplicates.length})`}>
              {audit.duplicates.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  No duplicates detected.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {audit.duplicates
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 50)
                    .map((dup) => (
                      <li key={dup.key} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <code className="text-sm text-foreground">
                            {dup.kind}/{dup.name}
                          </code>
                          <span className="font-mono text-xs text-muted-foreground">
                            ×{dup.count}
                          </span>
                        </div>
                        <ul className="mt-1 ml-4 list-disc text-xs text-muted-foreground">
                          {dup.occurrences.slice(0, 6).map((o, i) => (
                            <li key={i} className="font-mono">
                              {o.scope} · {o.path}
                            </li>
                          ))}
                          {dup.occurrences.length > 6 ? (
                            <li>…and {dup.occurrences.length - 6} more</li>
                          ) : null}
                        </ul>
                      </li>
                    ))}
                </ul>
              )}
            </Section>
          </>
        ) : null}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-medium text-foreground">{value}</p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-muted/40 px-4 py-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}
