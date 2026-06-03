import "server-only";

import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface ReposConfig {
  defaults: Record<string, unknown>;
  repos: RepoEntry[];
  [key: string]: unknown;
}

export interface RepoEntry {
  name: string;
  source: "issues" | "project";
  enabled: boolean;
  filter?: string;
  project_owner?: string;
  project_number?: number;
  column?: string;
  [key: string]: unknown;
}

export interface RunInfo {
  stamp: string;
  logDir: string;
}

export interface ItemResult {
  repo: string;
  issue: number;
  title: string;
  status: string;
  stage: string;
  reason: string;
  branch: string;
  ts: string;
  url: string;
}

export interface RunOutcomeCounts {
  [status: string]: number;
}

export interface RunSummary {
  date: string;
  stamp: string;
  logDir: string;
  itemCount: number;
  outcomes: RunOutcomeCounts;
  startedAt: string | null;
  endedAt: string | null;
}

export interface RunItemDetail extends ItemResult {
  logPath: string | null;
  planPath: string | null;
  reviewPath: string | null;
}

export interface RunDetail {
  stamp: string;
  logDir: string;
  items: RunItemDetail[];
}

export interface DesktopReport {
  filename: string;
  date: string;
  bytes: number;
  mtime: string;
}

const RUN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RUN_STAMP_RE = /^\d{8}-\d{6}$/;
const DESKTOP_REPORT_RE = /^siege-(\d{4}-\d{2}-\d{2})\.md$/;

function resolveSiegeHome(): string {
  const fromEnv = process.env.SIEGE_HOME;
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }
  return path.join(os.homedir(), ".siege");
}

function resolveDesktop(): string {
  return path.join(os.homedir(), "Desktop");
}

export const SIEGE_HOME: string = resolveSiegeHome();

async function realpathOrSelf(target: string): Promise<string> {
  try {
    return await fsp.realpath(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return path.resolve(target);
    }
    throw err;
  }
}

async function resolveSafePath(target: string, root: string): Promise<string> {
  const absTarget = path.resolve(target);
  const rootReal = await realpathOrSelf(root);

  const tail: string[] = [];
  let cursor = absTarget;
  let resolved: string | null = null;

  while (resolved === null) {
    try {
      const real = await fsp.realpath(cursor);
      resolved = tail.length === 0 ? real : path.join(real, ...tail.reverse());
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        resolved = absTarget;
        break;
      }
      tail.push(path.basename(cursor));
      cursor = parent;
    }
  }

  if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) {
    throw new Error(
      `Path escape blocked: "${target}" resolves outside of "${root}"`,
    );
  }
  return resolved;
}

async function readTextIfPresent(file: string): Promise<string | null> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readDirIfPresent(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export function assertReposConfig(value: unknown): asserts value is ReposConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("repos config must be an object");
  }
  const v = value as Record<string, unknown>;
  if (!v.defaults || typeof v.defaults !== "object" || Array.isArray(v.defaults)) {
    throw new Error("repos config: 'defaults' must be an object");
  }
  if (!Array.isArray(v.repos)) {
    throw new Error("repos config: 'repos' must be an array");
  }
  for (const [idx, entry] of v.repos.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`repos[${idx}] must be an object`);
    }
    const r = entry as Record<string, unknown>;
    if (typeof r.name !== "string" || r.name.length === 0) {
      throw new Error(`repos[${idx}].name must be a non-empty string`);
    }
    if (r.source !== "issues" && r.source !== "project") {
      throw new Error(`repos[${idx}].source must be "issues" or "project"`);
    }
    if (typeof r.enabled !== "boolean") {
      throw new Error(`repos[${idx}].enabled must be a boolean`);
    }
  }
}

export async function readRepos(): Promise<ReposConfig> {
  const home = resolveSiegeHome();
  const target = await resolveSafePath(path.join(home, "repos.json"), home);
  const raw = await fsp.readFile(target, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertReposConfig(parsed);
  return parsed;
}

export async function writeRepos(next: ReposConfig): Promise<void> {
  assertReposConfig(next);
  const home = resolveSiegeHome();
  const target = await resolveSafePath(path.join(home, "repos.json"), home);
  const dir = path.dirname(target);
  await fsp.mkdir(dir, { recursive: true });

  const tmp = path.join(
    dir,
    `.repos.json.tmp.${process.pid}.${randomBytes(6).toString("hex")}`,
  );
  const safeTmp = await resolveSafePath(tmp, home);
  const json = JSON.stringify(next, null, 2) + "\n";

  await fsp.writeFile(safeTmp, json, { encoding: "utf8", mode: 0o600 });
  try {
    await fsp.rename(safeTmp, target);
  } catch (err) {
    await fsp.rm(safeTmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function readConfig(): Promise<string> {
  const home = resolveSiegeHome();
  const target = await resolveSafePath(path.join(home, "config.yml"), home);
  return await fsp.readFile(target, "utf8");
}

export async function readSkills(): Promise<string> {
  const home = resolveSiegeHome();
  const target = await resolveSafePath(path.join(home, "skills.yml"), home);
  return await fsp.readFile(target, "utf8");
}

export async function listRunDates(): Promise<string[]> {
  const home = resolveSiegeHome();
  const logsDir = await resolveSafePath(path.join(home, "logs"), home);
  const entries = await readDirIfPresent(logsDir);
  const dates: string[] = [];
  for (const name of entries) {
    if (!RUN_DATE_RE.test(name)) continue;
    const child = await resolveSafePath(path.join(logsDir, name), home);
    const stat = await fsp.stat(child).catch(() => null);
    if (stat?.isDirectory()) dates.push(name);
  }
  return dates.sort().reverse();
}

export async function listRuns(date: string): Promise<RunInfo[]> {
  if (!RUN_DATE_RE.test(date)) {
    throw new Error(`invalid run date: "${date}" (expected YYYY-MM-DD)`);
  }
  const home = resolveSiegeHome();
  const dateDir = await resolveSafePath(
    path.join(home, "logs", date),
    home,
  );
  const entries = await readDirIfPresent(dateDir);
  const runs: RunInfo[] = [];
  for (const name of entries) {
    if (!RUN_STAMP_RE.test(name)) continue;
    const logDir = await resolveSafePath(path.join(dateDir, name), home);
    const stat = await fsp.stat(logDir).catch(() => null);
    if (stat?.isDirectory()) runs.push({ stamp: name, logDir });
  }
  return runs.sort((a, b) => b.stamp.localeCompare(a.stamp));
}

export async function readRunItemResults(runPath: string): Promise<ItemResult[]> {
  const home = resolveSiegeHome();
  const logsRoot = path.join(home, "logs");
  const runReal = await resolveSafePath(runPath, logsRoot);
  const itemsDir = await resolveSafePath(path.join(runReal, "items"), home);
  const repoDirs = await readDirIfPresent(itemsDir);

  const results: ItemResult[] = [];
  for (const repoDir of repoDirs) {
    const repoPath = await resolveSafePath(
      path.join(itemsDir, repoDir),
      home,
    );
    const stat = await fsp.stat(repoPath).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const files = await readDirIfPresent(repoPath);
    for (const f of files) {
      if (!f.endsWith(".result.json")) continue;
      const file = await resolveSafePath(path.join(repoPath, f), home);
      const raw = await readTextIfPresent(file);
      if (raw === null) continue;
      const parsed = parseItemResult(raw);
      if (parsed) results.push(parsed);
    }
  }
  results.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return results;
}

function parseItemResult(raw: string): ItemResult | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    repo: typeof o.repo === "string" ? o.repo : "",
    issue: typeof o.issue === "number" ? o.issue : Number(o.issue) || 0,
    title: typeof o.title === "string" ? o.title : "",
    status: typeof o.status === "string" ? o.status : "",
    stage: typeof o.stage === "string" ? o.stage : "",
    reason: typeof o.reason === "string" ? o.reason : "",
    branch: typeof o.branch === "string" ? o.branch : "",
    ts: typeof o.ts === "string" ? o.ts : "",
    url: typeof o.url === "string" ? o.url : "",
  };
}

export function assertRunStamp(stamp: string): void {
  if (typeof stamp !== "string" || !RUN_STAMP_RE.test(stamp)) {
    throw new Error(
      `invalid run stamp: ${JSON.stringify(stamp)} (expected YYYYMMDD-HHMMSS)`,
    );
  }
}

interface RunItemFiles {
  result: string;
  log: string | null;
  plan: string | null;
  review: string | null;
}

const ISSUE_RESULT_RE = /^issue-(\d+)\.result\.json$/;

async function collectRunItemFiles(runDir: string): Promise<RunItemFiles[]> {
  const home = resolveSiegeHome();
  const itemsDir = await resolveSafePath(path.join(runDir, "items"), home);
  const repoDirs = await readDirIfPresent(itemsDir);

  const files: RunItemFiles[] = [];
  for (const repoDir of repoDirs) {
    const repoPath = await resolveSafePath(path.join(itemsDir, repoDir), home);
    const stat = await fsp.stat(repoPath).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const entries = await readDirIfPresent(repoPath);
    const entrySet = new Set(entries);
    for (const f of entries) {
      const m = ISSUE_RESULT_RE.exec(f);
      if (!m) continue;
      const issueNum = m[1];
      const resultPath = await resolveSafePath(path.join(repoPath, f), home);
      const logName = `issue-${issueNum}.log`;
      const planName = `issue-${issueNum}.plan.json`;
      const reviewName = `issue-${issueNum}.review.json`;
      files.push({
        result: resultPath,
        log: entrySet.has(logName)
          ? await resolveSafePath(path.join(repoPath, logName), home)
          : null,
        plan: entrySet.has(planName)
          ? await resolveSafePath(path.join(repoPath, planName), home)
          : null,
        review: entrySet.has(reviewName)
          ? await resolveSafePath(path.join(repoPath, reviewName), home)
          : null,
      });
    }
  }
  return files;
}

async function summarizeRun(date: string, run: RunInfo): Promise<RunSummary> {
  const files = await collectRunItemFiles(run.logDir);
  const outcomes: RunOutcomeCounts = {};
  let itemCount = 0;
  let startedMs: number | null = null;
  let endedMs: number | null = null;

  for (const f of files) {
    const raw = await readTextIfPresent(f.result);
    if (raw === null) continue;
    const parsed = parseItemResult(raw);
    if (!parsed) continue;
    itemCount += 1;
    const status = parsed.status || "unknown";
    outcomes[status] = (outcomes[status] ?? 0) + 1;

    const stat = await fsp.stat(f.result).catch(() => null);
    if (stat) {
      const ms = stat.mtimeMs;
      if (startedMs === null || ms < startedMs) startedMs = ms;
      if (endedMs === null || ms > endedMs) endedMs = ms;
    }
  }

  return {
    date,
    stamp: run.stamp,
    logDir: run.logDir,
    itemCount,
    outcomes,
    startedAt: startedMs === null ? null : new Date(startedMs).toISOString(),
    endedAt: endedMs === null ? null : new Date(endedMs).toISOString(),
  };
}

export async function listRecentRuns(limit = 30): Promise<RunSummary[]> {
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1
  ) {
    throw new Error("limit must be a positive integer");
  }

  const summaries: RunSummary[] = [];
  const dates = await listRunDates();
  for (const date of dates) {
    const runs = await listRuns(date);
    for (const run of runs) {
      summaries.push(await summarizeRun(date, run));
      if (summaries.length >= limit) {
        summaries.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
        return summaries.slice(0, limit);
      }
    }
  }
  summaries.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
  return summaries;
}

export class RunNotFoundError extends Error {
  readonly stamp: string;
  constructor(stamp: string) {
    super(`run not found: ${stamp}`);
    this.name = "RunNotFoundError";
    this.stamp = stamp;
  }
}

export async function getRunDetail(stamp: string): Promise<RunDetail> {
  assertRunStamp(stamp);

  const home = resolveSiegeHome();
  const logsRoot = await resolveSafePath(path.join(home, "logs"), home);
  const dates = (await readDirIfPresent(logsRoot))
    .filter((name) => RUN_DATE_RE.test(name))
    .sort()
    .reverse();

  let runDir: string | null = null;
  for (const date of dates) {
    const candidate = await resolveSafePath(
      path.join(logsRoot, date, stamp),
      home,
    );
    const stat = await fsp.stat(candidate).catch(() => null);
    if (stat?.isDirectory()) {
      runDir = candidate;
      break;
    }
  }

  if (runDir === null) throw new RunNotFoundError(stamp);

  const files = await collectRunItemFiles(runDir);
  const items: RunItemDetail[] = [];
  for (const f of files) {
    const raw = await readTextIfPresent(f.result);
    if (raw === null) continue;
    const parsed = parseItemResult(raw);
    if (!parsed) continue;
    items.push({
      ...parsed,
      logPath: f.log,
      planPath: f.plan,
      reviewPath: f.review,
    });
  }
  items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  return { stamp, logDir: runDir, items };
}

export interface LastAttempt {
  date: string;
  stamp: string;
  status: string;
}

const REPO_SAFE_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function toRepoSafe(repo: string): string {
  if (typeof repo !== "string" || !REPO_SAFE_RE.test(repo)) {
    throw new Error(
      `invalid repo: ${JSON.stringify(repo)} (expected "owner/name")`,
    );
  }
  return repo.replace("/", "_");
}

export async function getLastAttempt(
  repo: string,
  issueNumber: number,
): Promise<LastAttempt | null> {
  if (
    typeof issueNumber !== "number" ||
    !Number.isInteger(issueNumber) ||
    issueNumber < 1
  ) {
    throw new Error("issueNumber must be a positive integer");
  }
  const repoSafe = toRepoSafe(repo);
  const home = resolveSiegeHome();
  const logsRoot = await resolveSafePath(path.join(home, "logs"), home);
  const dates = await readDirIfPresent(logsRoot);
  const sortedDates = dates
    .filter((name) => RUN_DATE_RE.test(name))
    .sort()
    .reverse();

  const resultFile = `issue-${issueNumber}.result.json`;

  for (const date of sortedDates) {
    const dateDir = await resolveSafePath(
      path.join(logsRoot, date),
      home,
    );
    const stamps = (await readDirIfPresent(dateDir))
      .filter((name) => RUN_STAMP_RE.test(name))
      .sort()
      .reverse();

    for (const stamp of stamps) {
      const candidate = await resolveSafePath(
        path.join(dateDir, stamp, "items", repoSafe, resultFile),
        home,
      );
      const raw = await readTextIfPresent(candidate);
      if (raw === null) continue;
      const parsed = parseItemResult(raw);
      if (!parsed) continue;
      return { date, stamp, status: parsed.status };
    }
  }
  return null;
}

export async function readDesktopReports(): Promise<DesktopReport[]> {
  const desktop = resolveDesktop();
  const entries = await readDirIfPresent(desktop);
  const reports: DesktopReport[] = [];
  for (const filename of entries) {
    const m = DESKTOP_REPORT_RE.exec(filename);
    if (!m) continue;
    const full = await resolveSafePath(path.join(desktop, filename), desktop);
    const stat = await fsp.stat(full).catch(() => null);
    if (stat?.isFile()) {
      reports.push({
        filename,
        date: m[1],
        bytes: stat.size,
        mtime: new Date(stat.mtimeMs).toISOString(),
      });
    }
  }
  reports.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return reports;
}

export async function readDesktopReport(filename: string): Promise<string> {
  if (!DESKTOP_REPORT_RE.test(filename)) {
    throw new Error(
      `invalid desktop report filename: "${filename}" (expected siege-YYYY-MM-DD.md)`,
    );
  }
  const desktop = resolveDesktop();
  const target = await resolveSafePath(path.join(desktop, filename), desktop);
  return await fsp.readFile(target, "utf8");
}

export async function getActivePid(): Promise<number[] | null> {
  const home = resolveSiegeHome();
  const target = await resolveSafePath(
    path.join(home, "overnight.pid"),
    home,
  );
  const raw = await readTextIfPresent(target);
  if (raw === null) return null;
  const pids: number[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (Number.isInteger(n) && n > 0) pids.push(n);
  }
  return pids;
}

export async function getOvernightStartedAtMs(): Promise<number | null> {
  const home = resolveSiegeHome();
  const target = await resolveSafePath(
    path.join(home, "overnight.pid"),
    home,
  );
  try {
    const stat = await fsp.stat(target);
    return stat.mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

const REPO_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEFAULT_START_POLL_TIMEOUT_MS = 5_000;
const DEFAULT_START_POLL_INTERVAL_MS = 100;

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export class ConflictError extends Error {
  readonly pids: number[];
  constructor(message: string, pids: number[]) {
    super(message);
    this.name = "ConflictError";
    this.pids = pids;
  }
}

export interface StartSiegeOptions {
  dryRun?: boolean;
  maxItems?: number;
  repos?: string[];
  watch?: boolean;
}

export interface StartSiegeResult {
  runStamp: string;
  logDir: string;
  pids: number[];
}

export function buildStartArgs(opts: StartSiegeOptions): string[] {
  const args: string[] = [];

  if (opts.dryRun !== undefined && typeof opts.dryRun !== "boolean") {
    throw new Error("dryRun must be a boolean");
  }
  if (opts.dryRun === true) args.push("--dry-run");

  if (opts.watch !== undefined && typeof opts.watch !== "boolean") {
    throw new Error("watch must be a boolean");
  }
  if (opts.watch === true) args.push("--watch");

  if (opts.maxItems !== undefined) {
    if (
      typeof opts.maxItems !== "number" ||
      !Number.isInteger(opts.maxItems) ||
      opts.maxItems < 1
    ) {
      throw new Error("maxItems must be a positive integer");
    }
    args.push("--max-items", String(opts.maxItems));
  }

  if (opts.repos !== undefined) {
    if (!Array.isArray(opts.repos) || opts.repos.length === 0) {
      throw new Error("repos must be a non-empty array of strings");
    }
    for (const r of opts.repos) {
      if (typeof r !== "string" || !REPO_NAME_RE.test(r)) {
        throw new Error(
          `invalid repo: ${JSON.stringify(r)} (expected "owner/name")`,
        );
      }
    }
    args.push("--repos", opts.repos.join(","));
  }

  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForPids(
  timeoutMs: number,
  intervalMs: number,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await getActivePid();
    if (found && found.length > 0) return found;
    await sleep(intervalMs);
  }
  const final = await getActivePid();
  return final ?? [];
}

async function resolveLatestRun(): Promise<RunInfo | null> {
  const dates = await listRunDates();
  for (const date of dates) {
    const runs = await listRuns(date);
    if (runs.length > 0) return runs[0];
  }
  return null;
}

export async function startSiege(
  opts: StartSiegeOptions = {},
): Promise<StartSiegeResult> {
  const args = buildStartArgs(opts);

  const existing = await getActivePid();
  if (existing && existing.length > 0) {
    throw new ConflictError("siege already running", existing);
  }

  const home = resolveSiegeHome();
  const startBin = path.join(home, "bin", "start");

  const child = spawn(startBin, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const timeoutMs = positiveIntFromEnv(
    "SIEGE_START_POLL_TIMEOUT_MS",
    DEFAULT_START_POLL_TIMEOUT_MS,
  );
  const intervalMs = positiveIntFromEnv(
    "SIEGE_START_POLL_INTERVAL_MS",
    DEFAULT_START_POLL_INTERVAL_MS,
  );
  const pids = await pollForPids(timeoutMs, intervalMs);
  if (pids.length === 0) {
    throw new Error(
      `siege start: no pids appeared within ${timeoutMs}ms`,
    );
  }

  const latest = await resolveLatestRun();
  if (latest === null) {
    throw new Error("siege start: no run directory found");
  }
  return { runStamp: latest.stamp, logDir: latest.logDir, pids };
}

const KILL_TIMEOUT_MS = 35_000;
const KILL_PIDS_LINE_RE =
  /killing\s+\d+\s+siege\s+process\(es\):\s*(.+)/i;

export type KillSiegeMethod = "graceful" | "force" | "noop";

export interface KillSiegeResult {
  killed: number[];
  method: KillSiegeMethod;
}

function parseKilledPids(stdout: string): number[] {
  const m = KILL_PIDS_LINE_RE.exec(stdout);
  if (!m) return [];
  const pids: number[] = [];
  for (const token of m[1].trim().split(/\s+/)) {
    const n = Number(token);
    if (Number.isInteger(n) && n > 0) pids.push(n);
  }
  return pids;
}

function runKillScript(
  bin: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: KILL_TIMEOUT_MS, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

export async function killSiege(force = false): Promise<KillSiegeResult> {
  const home = resolveSiegeHome();
  const killBin = path.join(home, "bin", "kill");
  const args = force ? ["--force"] : [];

  const { stdout } = await runKillScript(killBin, args);
  const killed = parseKilledPids(stdout);
  if (killed.length === 0) {
    return { killed: [], method: "noop" };
  }
  return { killed, method: force ? "force" : "graceful" };
}
