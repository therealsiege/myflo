import "server-only";

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

export interface DesktopReport {
  filename: string;
  date: string;
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

function assertReposConfig(value: unknown): asserts value is ReposConfig {
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

export async function readDesktopReports(): Promise<DesktopReport[]> {
  const desktop = resolveDesktop();
  const entries = await readDirIfPresent(desktop);
  const reports: DesktopReport[] = [];
  for (const filename of entries) {
    const m = DESKTOP_REPORT_RE.exec(filename);
    if (!m) continue;
    const full = await resolveSafePath(path.join(desktop, filename), desktop);
    const stat = await fsp.stat(full).catch(() => null);
    if (stat?.isFile()) reports.push({ filename, date: m[1] });
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
