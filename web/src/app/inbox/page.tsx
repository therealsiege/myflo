import { listInboxes } from "@/lib/flo";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  let inboxes: Awaited<ReturnType<typeof listInboxes>> = [];
  let error: string | null = null;
  try {
    inboxes = await listInboxes();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <section className="px-6 py-12 md:px-10 md:py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            flo · inbox
          </p>
          <h2 className="text-2xl font-medium tracking-tight text-foreground">
            Registered inboxes
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Folders that flo watches. Markdown drops route by frontmatter;
            audio drops are transcribed locally. Register a folder with{" "}
            <code className="font-mono">flo inbox add &lt;dir&gt;</code> and
            schedule background scans with{" "}
            <code className="font-mono">flo inbox install &lt;slug&gt;</code>.
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Failed to load inboxes: {error}
          </div>
        ) : inboxes.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            No inboxes registered yet. Try{" "}
            <code className="font-mono">
              flo inbox add ~/Downloads/inbox
            </code>{" "}
            from a terminal.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {inboxes.map((i) => (
              <InboxCard key={i.slug} inbox={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function InboxCard({
  inbox,
}: {
  inbox: Awaited<ReturnType<typeof listInboxes>>[number];
}) {
  const lastActivity = inbox.lastActivity
    ? new Date(inbox.lastActivity).toLocaleString()
    : "never";

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
        <code className="text-sm font-medium text-foreground">
          {inbox.slug}
        </code>
        {!inbox.exists ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[0.65rem] uppercase text-amber-700 dark:text-amber-400">
            missing
          </span>
        ) : (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[0.65rem] uppercase text-emerald-700 dark:text-emerald-400">
            ready
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1 border-b border-border bg-muted/10 px-4 py-3 text-center">
        <Stat label="pending" value={inbox.pending} tone="primary" />
        <Stat label="processed" value={inbox.processed} />
        <Stat label="failed" value={inbox.failed} tone={inbox.failed > 0 ? "warn" : "default"} />
      </div>
      <dl className="grid grid-cols-1 divide-y divide-border text-sm">
        <Row label="dir">
          <code className="font-mono text-xs text-muted-foreground break-all">
            {inbox.dir}
          </code>
        </Row>
        <Row label="last activity">
          <span className="text-xs text-muted-foreground">{lastActivity}</span>
        </Row>
        {inbox.createdAt ? (
          <Row label="added">
            <span className="text-xs text-muted-foreground">
              {new Date(inbox.createdAt).toLocaleString()}
            </span>
          </Row>
        ) : null}
      </dl>
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
  tone?: "default" | "primary" | "warn";
}) {
  const color =
    tone === "primary"
      ? "text-foreground"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <div>
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className={`mt-0.5 text-lg font-medium ${color}`}>{value}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2">
      <dt className="w-28 shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="flex-1 min-w-0">{children}</dd>
    </div>
  );
}
