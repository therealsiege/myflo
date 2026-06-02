export default function QueuePage() {
  return (
    <section className="px-6 py-16 md:px-10 md:py-24">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
          queue
        </p>
        <h2 className="text-2xl font-medium tracking-tight text-foreground">
          Coming soon
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          The triaged issue queue across every enabled repository.
        </p>
      </div>
    </section>
  );
}
