// Stub worker factory — for capabilities planned but not yet implemented.
// Returns { ok: true, summary: "stub", notImplemented: true } so the scheduler
// records a run (avoiding tight retry loops) but the user can see it's a placeholder.

export function stubWorker(name) {
  return {
    name,
    description: `(stub) ${name} worker — not yet implemented`,
    stub: true,
    async run() {
      return {
        ok: true,
        notImplemented: true,
        summary: `${name} worker not yet implemented`,
      };
    },
  };
}
