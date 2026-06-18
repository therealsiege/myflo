import { listTranscripts } from "@/lib/flo";

export const dynamic = "force-dynamic";

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function TranscriptsPage() {
  let transcripts: Awaited<ReturnType<typeof listTranscripts>> = [];
  let error: string | null = null;
  try {
    transcripts = await listTranscripts(100);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <section className="px-6 py-12 md:px-10 md:py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            flo · transcripts
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            Audio transcripts
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Sidecar <code>.txt</code> files produced when audio drops are
            processed by the inbox watcher (local whisper, no cloud).
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : transcripts.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            No transcripts yet. Register an inbox with{" "}
            <code className="font-mono">flo inbox add &lt;dir&gt;</code>, drop
            an <code>.m4a</code>/<code>.wav</code>/<code>.mp3</code> in, then
            run <code className="font-mono">flo inbox watch &lt;dir&gt; --once</code>.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {transcripts.map((t) => (
              <li
                key={t.sidecarPath}
                className="overflow-hidden rounded-md border border-border"
              >
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <code className="font-medium text-foreground">
                      {t.audioFilename}
                    </code>
                    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
                      {t.inboxSlug}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-muted-foreground">
                    <span>{fmtBytes(t.audioBytes)}</span>
                    <span>{t.chars} chars</span>
                    <span>
                      {new Date(t.mtime).toISOString().slice(0, 19).replace("T", " ")}
                    </span>
                  </div>
                </header>
                <pre className="whitespace-pre-wrap break-words bg-muted/10 px-4 py-3 text-sm leading-relaxed text-foreground">
                  {t.fullText.trim()}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
