export default function Home() {
  return (
    <section className="px-6 py-16 md:px-10 md:py-24">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
          overview
        </p>
        <h2 className="text-2xl font-medium tracking-tight text-foreground">
          Welcome to MyFlo
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          The local command center for siege. Pick a section from the sidebar
          to manage repos, watch the queue, control a run, or read past
          reports.
        </p>
      </div>
    </section>
  );
}
