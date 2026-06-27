import "server-only";

import { execFile, type ExecFileException } from "node:child_process";

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: { name: string; color: string }[];
  assignees: { login: string }[];
  state: string;
}

export interface GhProjectItem {
  content: {
    number: number;
    title: string;
    body: string;
    url: string;
    type: string;
    repository: string;
  };
  status?: string;
}

export interface GhLabel {
  name: string;
  color: string;
  description: string;
}

export interface GhPR {
  number: number;
  url: string;
  state: string;
  title: string;
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SIMPLE_TOKEN_RE = /^[A-Za-z0-9_.-]+$/;
// Defense in depth: even though execFile bypasses the shell, refuse anything
// that resembles shell metacharacters or control bytes in user-supplied args.
const META_RE = /[\x00-\x1f\x7f`$\\;|&<>]/;

const DEFAULT_TIMEOUT_MS = 15_000;
const PROJECT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

export class GhError extends Error {
  readonly stderr?: string;
  constructor(message: string, stderr?: string) {
    super(message);
    this.name = "GhError";
    this.stderr = stderr;
  }
}

function assertRepo(repo: unknown): asserts repo is string {
  if (typeof repo !== "string" || !REPO_RE.test(repo)) {
    throw new Error(
      `invalid repo: ${JSON.stringify(repo)} (expected "owner/name")`,
    );
  }
}

function assertSafeArg(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  if (value.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  if (META_RE.test(value)) {
    throw new Error(`${name} contains disallowed characters`);
  }
  if (value.startsWith("-")) {
    throw new Error(`${name} must not start with "-"`);
  }
}

function assertSimpleToken(
  name: string,
  value: unknown,
): asserts value is string {
  if (typeof value !== "string" || !SIMPLE_TOKEN_RE.test(value)) {
    throw new Error(`${name} must match [A-Za-z0-9_.-]+`);
  }
}

function resolveLimit(limit: unknown): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT
  ) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

interface GhResult {
  stdout: string;
  stderr: string;
}

function runGh(args: string[], timeoutMs: number): Promise<GhResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      {
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const out = stdout ?? "";
        const errOut = stderr ?? "";

        if (err) {
          const e = err as ExecFileException;
          if (e.code === "ENOENT") {
            reject(
              new GhError(
                "gh CLI not found in PATH (install via https://cli.github.com)",
              ),
            );
            return;
          }
          const text = errOut.trim();
          if (
            e.killed === true ||
            e.signal === "SIGTERM" ||
            e.code === "ETIMEDOUT"
          ) {
            reject(
              new GhError(
                `gh ${args.slice(0, 2).join(" ").trim()} timed out after ${timeoutMs}ms`,
                text,
              ),
            );
            return;
          }
          if (
            /authentication required|not logged in|gh auth login|HTTP 401/i.test(
              text,
            )
          ) {
            reject(
              new GhError(
                `gh authentication required: ${text || "run \"gh auth login\""}`,
                text,
              ),
            );
            return;
          }
          reject(
            new GhError(
              `gh ${args.slice(0, 2).join(" ").trim()} failed: ${
                text || (err as Error).message
              }`,
              text,
            ),
          );
          return;
        }
        resolve({ stdout: out, stderr: errOut });
      },
    );
  });
}

function parseJsonArray<T>(stdout: string, label: string): T[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new GhError(`gh ${label}: failed to parse JSON output`);
  }
  if (!Array.isArray(parsed)) {
    throw new GhError(`gh ${label}: expected JSON array`);
  }
  return parsed as T[];
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asLabels(v: unknown): { name: string; color: string }[] {
  if (!Array.isArray(v)) return [];
  return v.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    return { name: asString(o.name), color: asString(o.color) };
  });
}

function asAssignees(v: unknown): { login: string }[] {
  if (!Array.isArray(v)) return [];
  return v.map((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    return { login: asString(o.login) };
  });
}

export async function listIssues(opts: {
  repo: string;
  search?: string;
  limit?: number;
}): Promise<GhIssue[]> {
  assertRepo(opts.repo);
  const limit = resolveLimit(opts.limit);
  const args: string[] = [
    "issue",
    "list",
    "-R",
    opts.repo,
    "--limit",
    String(limit),
    "--json",
    "number,title,body,url,labels,assignees,state",
  ];
  if (opts.search !== undefined) {
    assertSafeArg("search", opts.search);
    args.push("--search", opts.search);
  }
  const { stdout } = await runGh(args, DEFAULT_TIMEOUT_MS);
  const raw = parseJsonArray<Record<string, unknown>>(stdout, "issue list");
  return raw.map((o) => ({
    number: asNumber(o.number),
    title: asString(o.title),
    body: asString(o.body),
    url: asString(o.url),
    labels: asLabels(o.labels),
    assignees: asAssignees(o.assignees),
    state: asString(o.state),
  }));
}

export async function listProjectItems(opts: {
  owner: string;
  projectNumber: number;
  column?: string;
  limit?: number;
}): Promise<GhProjectItem[]> {
  assertSimpleToken("owner", opts.owner);
  if (
    typeof opts.projectNumber !== "number" ||
    !Number.isInteger(opts.projectNumber) ||
    opts.projectNumber < 1
  ) {
    throw new Error("projectNumber must be a positive integer");
  }
  let column: string | undefined;
  if (opts.column !== undefined) {
    assertSafeArg("column", opts.column);
    column = opts.column;
  }
  const limit = resolveLimit(opts.limit);
  const args: string[] = [
    "project",
    "item-list",
    String(opts.projectNumber),
    "--owner",
    opts.owner,
    "--format",
    "json",
    "--limit",
    String(limit),
  ];
  const { stdout } = await runGh(args, PROJECT_TIMEOUT_MS);
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new GhError("gh project item-list: failed to parse JSON output");
  }

  const rawItems: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.items)
      ? ((parsed as Record<string, unknown>).items as unknown[])
      : null;
  if (rawItems === null) {
    throw new GhError("gh project item-list: unexpected output shape");
  }

  const items: GhProjectItem[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const status = typeof e.status === "string" ? e.status : undefined;
    if (column !== undefined && status !== column) continue;
    const content = (e.content ?? {}) as Record<string, unknown>;
    items.push({
      content: {
        number: asNumber(content.number),
        title: asString(content.title),
        body: asString(content.body),
        url: asString(content.url),
        type: asString(content.type),
        repository: asString(content.repository),
      },
      status,
    });
  }
  return items;
}

export async function listLabels(repo: string): Promise<GhLabel[]> {
  assertRepo(repo);
  const args: string[] = [
    "label",
    "list",
    "-R",
    repo,
    "--limit",
    String(MAX_LIMIT),
    "--json",
    "name,color,description",
  ];
  const { stdout } = await runGh(args, DEFAULT_TIMEOUT_MS);
  const raw = parseJsonArray<Record<string, unknown>>(stdout, "label list");
  return raw.map((o) => ({
    name: asString(o.name),
    color: asString(o.color),
    description: asString(o.description),
  }));
}

export async function listPRsForBranch(opts: {
  repo: string;
  head: string;
}): Promise<GhPR[]> {
  assertRepo(opts.repo);
  assertSafeArg("head", opts.head);
  const args: string[] = [
    "pr",
    "list",
    "-R",
    opts.repo,
    "--head",
    opts.head,
    "--json",
    "number,url,state,title",
  ];
  const { stdout } = await runGh(args, DEFAULT_TIMEOUT_MS);
  const raw = parseJsonArray<Record<string, unknown>>(stdout, "pr list");
  return raw.map((o) => ({
    number: asNumber(o.number),
    url: asString(o.url),
    state: asString(o.state),
    title: asString(o.title),
  }));
}

const SIEGE_BRANCH_RE = /^siege\/issue-(\d+)$/;

export async function listOpenSiegePRIssueNumbers(
  repo: string,
): Promise<number[]> {
  assertRepo(repo);
  const args: string[] = [
    "pr",
    "list",
    "-R",
    repo,
    "--state",
    "open",
    "--limit",
    String(MAX_LIMIT),
    "--json",
    "headRefName",
  ];
  const { stdout } = await runGh(args, DEFAULT_TIMEOUT_MS);
  const raw = parseJsonArray<Record<string, unknown>>(stdout, "pr list");
  const numbers: number[] = [];
  for (const o of raw) {
    const head = asString(o.headRefName);
    const m = SIEGE_BRANCH_RE.exec(head);
    if (m) numbers.push(Number(m[1]));
  }
  return numbers;
}

export interface RepoIssueResult {
  repo: string;
  issues: GhIssue[];
  openSiegeIssueNumbers: number[];
}

export interface RepoFetchError {
  repo: string;
  message: string;
}

export interface IssuesAcrossReposResult {
  items: RepoIssueResult[];
  errors: RepoFetchError[];
}

export async function listIssuesAcrossRepos(
  repos: ReadonlyArray<{ repo: string; search?: string; limit?: number }>,
): Promise<IssuesAcrossReposResult> {
  const settled = await Promise.allSettled(
    repos.map(async (r) => {
      const [issues, openSiegeIssueNumbers] = await Promise.all([
        listIssues({ repo: r.repo, search: r.search, limit: r.limit }),
        listOpenSiegePRIssueNumbers(r.repo),
      ]);
      return { repo: r.repo, issues, openSiegeIssueNumbers };
    }),
  );

  const items: RepoIssueResult[] = [];
  const errors: RepoFetchError[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      items.push(result.value);
    } else {
      const reason = result.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "unknown gh failure";
      errors.push({ repo: repos[i].repo, message });
    }
  }
  return { items, errors };
}

export async function ghAuthStatus(): Promise<{
  authenticated: boolean;
  user?: string;
}> {
  try {
    const { stdout, stderr } = await runGh(
      ["auth", "status"],
      DEFAULT_TIMEOUT_MS,
    );
    const out = `${stdout}\n${stderr}`;
    const m =
      /account\s+(\S+)/i.exec(out) ??
      /Logged in to github\.com as\s+(\S+)/i.exec(out);
    const user = m?.[1];
    return user ? { authenticated: true, user } : { authenticated: true };
  } catch (err) {
    if (
      err instanceof GhError &&
      err.message.startsWith("gh CLI not found")
    ) {
      throw err;
    }
    return { authenticated: false };
  }
}
