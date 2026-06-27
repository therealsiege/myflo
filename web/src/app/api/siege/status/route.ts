import "server-only";

import { ghAuthStatus } from "@/lib/gh";
import {
  findLatestRunLogPath,
  getActivePid,
  getOvernightStartedAtMs,
  isCapReached,
  listRunDates,
  listRuns,
  parseCurrentItem,
  tailFile,
  type CurrentItem,
} from "@/lib/siege";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_TAIL_LINES = 400;

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
  currentItem: CurrentItem | null;
  capReached: boolean;
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

interface LogInsight {
  currentItem: CurrentItem | null;
  capReached: boolean;
}

async function resolveLogInsight(): Promise<LogInsight> {
  try {
    const file = await findLatestRunLogPath();
    if (file === null) return { currentItem: null, capReached: false };
    const tail = await tailFile(file, STATUS_TAIL_LINES);
    return {
      currentItem: parseCurrentItem(tail.lines),
      capReached: isCapReached(tail.lines),
    };
  } catch {
    return { currentItem: null, capReached: false };
  }
}

export async function GET(): Promise<Response> {
  try {
    const [pidsRaw, startedAtMs, latestRun, ghAuth, insight] =
      await Promise.all([
        getActivePid(),
        getOvernightStartedAtMs(),
        resolveLatestRun(),
        resolveGhAuth(),
        resolveLogInsight(),
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
      currentItem: running ? insight.currentItem : null,
      capReached: insight.capReached,
      ghAuth,
    };
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to read status";
    return Response.json({ error: message }, { status: 500 });
  }
}
