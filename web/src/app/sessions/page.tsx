import { listSessions } from "@/lib/flo";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  let checkpoints: Awaited<ReturnType<typeof listSessions>> = [];
  let error: string | null = null;
  try {
    checkpoints = await listSessions({ limit: 100 });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <section className="px-6 py-12 md:px-10 md:py-16">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            flo · sessions
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            Session checkpoints
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Claude Code captures a checkpoint after each tool use; flo reads
            them from <code>.claude/checkpoints/</code> in this project.
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Failed to load checkpoints: {error}
          </div>
        ) : checkpoints.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            No checkpoints yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Tag</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Branch</th>
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {checkpoints.map((cp) => (
                  <tr key={cp.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono text-xs text-foreground">
                      {cp.tag ?? cp.id}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {cp.type ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {cp.branch ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {cp.file ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {cp.timestamp ?? new Date(cp.mtime).toISOString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
