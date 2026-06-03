import "server-only";

import { ghAuthStatus } from "@/lib/gh";
import {
  getActivePid,
  getOvernightStartedAtMs,
  listRunDates,
  listRuns,
} from "@/lib/siege";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LatestRun {
  date: string;
  stamp: string;
  logDir: string;
}

interface StatusResponse {
  running: boolean;
  pids: number[];
  elapsedSec: number | null;
  latestRun: LatestRun | null;
  ghAuth: { authenticated: boolean; user?: string };
}

async function resolveLatestRun(): Promise<LatestRun | null> {
  const dates = await listRunDates();
  for (const date of dates) {
    const runs = await listRuns(date);
    if (runs.length > 0) {
      return { date, stamp: runs[0].stamp, logDir: runs[0].logDir };
    }
  }
  return null;
}

async function resolveGhAuth(): Promise<StatusResponse["ghAuth"]> {
  try {
    return await ghAuthStatus();
  } catch {
    return { authenticated: false };
  }
}

export async function GET(): Promise<Response> {
  try {
    const [pidsRaw, startedAtMs, latestRun, ghAuth] = await Promise.all([
      getActivePid(),
      getOvernightStartedAtMs(),
      resolveLatestRun(),
      resolveGhAuth(),
    ]);

    const pids = pidsRaw ?? [];
    const running = pids.length > 0;
    const elapsedSec =
      running && startedAtMs !== null
        ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
        : null;

    const body: StatusResponse = {
      running,
      pids,
      elapsedSec,
      latestRun,
      ghAuth,
    };
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to read status";
    return Response.json({ error: message }, { status: 500 });
  }
}
