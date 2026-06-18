import "server-only";

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(process.cwd(), "..");
const FLO_BIN = path.join(REPO_ROOT, "apps", "cli", "bin", "flo.js");

export interface FloCheckpoint {
  id: string;
  path: string;
  mtime: number;
  tag?: string;
  timestamp?: string;
  type?: string;
  file?: string;
  branch?: string;
}

export interface FloAuditResult {
  total: number;
  scopeHistogram: Record<string, number>;
  kindHistogram: Record<string, number>;
  duplicates: Array<{
    key: string;
    name: string;
    kind: string;
    count: number;
    occurrences: Array<{ scope: string; path: string; description: string }>;
  }>;
  missingDescription: Array<{ scope: string; kind: string; name: string; path: string }>;
}

async function runFlo(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [FLO_BIN, ...args], {
    cwd: REPO_ROOT,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  return stdout;
}

export async function listSessions(opts: { limit?: number } = {}): Promise<FloCheckpoint[]> {
  const args = ["sessions", "list", "--json"];
  if (opts.limit) args.push("--limit", String(opts.limit));
  const stdout = await runFlo(args);
  return JSON.parse(stdout);
}

export async function runGuidanceAudit(opts: { scope?: "all" | "user" | "project" } = {}): Promise<FloAuditResult> {
  const args = ["guidance", "audit", "--json", "--quiet"];
  if (opts.scope) args.push("--scope", opts.scope);
  const stdout = await runFlo(args);
  const parsed = JSON.parse(stdout);
  return {
    total: parsed.total,
    scopeHistogram: parsed.scopeHistogram,
    kindHistogram: parsed.kindHistogram,
    duplicates: parsed.duplicates,
    missingDescription: parsed.missingDescription,
  };
}

export interface FloSwarmStatus {
  available: boolean;
  dir: string;
  state: {
    swarmId?: string;
    objective?: string;
    strategy?: string;
    status?: string;
    agents?: number;
    parallel?: boolean;
    startedAt?: string;
    stoppedAt?: string;
    agentPlan?: Array<{
      role: string;
      type: string;
      count: number;
      purpose: string;
    }>;
  } | null;
  qlearn: {
    stateCount: number;
    stats?: {
      stepCount?: number;
      updateCount?: number;
      avgTDError?: number;
      epsilon?: number;
    };
    config?: {
      learningRate?: number;
      gamma?: number;
      numActions?: number;
    };
    metadata?: { savedAt?: string };
    sampleStates?: Array<{ state: string; visits: number; topQ: number }>;
  } | null;
}

export async function getSwarmStatus(): Promise<FloSwarmStatus> {
  const stdout = await runFlo(["swarm", "status", "--json"]);
  return JSON.parse(stdout);
}

export interface FloInbox {
  slug: string;
  dir: string;
  createdAt?: string;
  handlerHints?: string[];
  exists: boolean;
  pending: number;
  processed: number;
  failed: number;
  lastActivity: number | null;
}

export async function listInboxes(): Promise<FloInbox[]> {
  const stdout = await runFlo(["inbox", "list", "--json"]);
  return JSON.parse(stdout);
}

export interface FloMemoryEntry {
  id: string;
  namespace: string;
  key: string | null;
  value: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  _score?: number;
}

export interface FloMemoryNamespace {
  namespace: string;
  count: number;
  lastEntryAt: string | null;
}

export async function listMemoryNamespaces(): Promise<FloMemoryNamespace[]> {
  const stdout = await runFlo(["memory", "namespaces", "--json"]);
  return JSON.parse(stdout);
}

export async function listMemoryEntries(opts: { namespace?: string; limit?: number } = {}): Promise<FloMemoryEntry[]> {
  const args = ["memory", "list", "--json"];
  if (opts.namespace) args.push("--namespace", opts.namespace);
  if (opts.limit) args.push("--limit", String(opts.limit));
  const stdout = await runFlo(args);
  return JSON.parse(stdout);
}

export async function searchMemory(opts: { query: string; namespace?: string; tags?: string[]; limit?: number }): Promise<FloMemoryEntry[]> {
  const args = ["memory", "search", opts.query, "--json"];
  if (opts.namespace) args.push("--namespace", opts.namespace);
  if (opts.tags && opts.tags.length) args.push("--tags", opts.tags.join(","));
  if (opts.limit) args.push("--limit", String(opts.limit));
  const stdout = await runFlo(args);
  return JSON.parse(stdout);
}

export interface FloTranscript {
  inboxSlug: string;
  inboxDir: string;
  audioPath: string;
  audioFilename: string;
  sidecarPath: string;
  audioBytes: number;
  mtime: number;
  chars: number;
  snippet: string;
  fullText: string;
}

export async function listTranscripts(limit = 100): Promise<FloTranscript[]> {
  const stdout = await runFlo(["transcripts", "list", "--json", "--limit", String(limit)]);
  return JSON.parse(stdout);
}

export interface FloTask {
  id: string;
  subject: string;
  description: string | null;
  status: "pending" | "in_progress" | "completed";
  tags: string[];
  owner: string | null;
  parent: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface FloTaskCounts {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
}

export async function listTasks(opts: { status?: string; owner?: string; tag?: string; limit?: number } = {}): Promise<FloTask[]> {
  const args = ["tasks", "list", "--json"];
  if (opts.status) args.push("--status", opts.status);
  if (opts.owner) args.push("--owner", opts.owner);
  if (opts.tag) args.push("--tag", opts.tag);
  if (opts.limit) args.push("--limit", String(opts.limit));
  const stdout = await runFlo(args);
  return JSON.parse(stdout);
}

export async function getTaskCounts(): Promise<FloTaskCounts> {
  const stdout = await runFlo(["tasks", "counts", "--json"]);
  return JSON.parse(stdout);
}

export type FloActivityType = "task" | "note" | "memory" | "inbox" | "transcript" | "terminal" | "checkpoint";

export interface FloActivityEvent {
  type: FloActivityType;
  kind: string;
  id: string;
  ts: number;
  timestamp: string;
  snippet: string;
  source: string;
  namespace?: string;
  tags?: string[];
}

export async function listActivity(opts: { since?: string; type?: FloActivityType; limit?: number } = {}): Promise<FloActivityEvent[]> {
  const args = ["activity", "list", "--json"];
  if (opts.since) args.push("--since", opts.since);
  if (opts.type) args.push("--type", opts.type);
  if (opts.limit) args.push("--limit", String(opts.limit));
  const stdout = await runFlo(args);
  return JSON.parse(stdout);
}
