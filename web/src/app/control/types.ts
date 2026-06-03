export interface SiegeStatusBody {
  running: boolean
  pids: number[]
  elapsedSec: number | null
  latestRun: { date: string; stamp: string; logDir: string } | null
  currentItem: { issue: number; title: string } | null
  capReached: boolean
  ghAuth: { authenticated: boolean; user?: string }
}

export interface SiegeLogTailBody {
  path: string | null
  lines: string[]
  size: number
  updatedAt: string | null
}

export interface SiegeRunSummary {
  date: string
  stamp: string
  logDir: string
  itemCount: number
  outcomes: Record<string, number>
  startedAt: string | null
  endedAt: string | null
}

export interface SiegeStartFormValues {
  dryRun: boolean
  maxItems: string
  repos: string
}

export interface SiegeStartPayload {
  dryRun?: boolean
  maxItems?: number
  repos?: string[]
}
