import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const { spawnMock, execFileMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    spawn: spawnMock,
    execFile: execFileMock,
  };
});

import {
  buildStartArgs,
  ConflictError,
  findLatestRunLogPath,
  getActivePid,
  getLastAttempt,
  getRunDetail,
  isCapReached,
  killSiege,
  listRecentRuns,
  listRunDates,
  listRuns,
  parseCurrentItem,
  readConfig,
  readDesktopReport,
  readDesktopReports,
  readRepos,
  readRunItemResults,
  readSkills,
  RunNotFoundError,
  startSiege,
  tailFile,
  toRepoSafe,
  writeRepos,
  type ReposConfig,
} from "./siege";

const ENV_KEYS = [
  "SIEGE_HOME",
  "HOME",
  "SIEGE_START_POLL_TIMEOUT_MS",
  "SIEGE_START_POLL_INTERVAL_MS",
] as const;

const FIXTURE_REPOS: ReposConfig = {
  defaults: {
    model: "claude-opus-4-7",
    label_ok: "overnight-ok",
    max_parallel_per_repo: 2,
  },
  repos: [
    {
      name: "therealsiege/myflo",
      source: "issues",
      enabled: true,
      filter: "label:overnight-ok state:open",
    },
    {
      name: "openloop/example-with-project",
      source: "project",
      enabled: false,
      project_owner: "openloop",
      project_number: 7,
      column: "Overnight Ready",
    },
  ],
};

let siegeHome: string;
let fakeHome: string;
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

beforeEach(async () => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

  siegeHome = await fsp.mkdtemp(path.join(os.tmpdir(), "siege-home-"));
  fakeHome = await fsp.mkdtemp(path.join(os.tmpdir(), "siege-userhome-"));
  await fsp.mkdir(path.join(fakeHome, "Desktop"), { recursive: true });

  process.env.SIEGE_HOME = siegeHome;
  process.env.HOME = fakeHome;

  spawnMock.mockReset();
  execFileMock.mockReset();
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(siegeHome, { recursive: true, force: true });
  await fsp.rm(fakeHome, { recursive: true, force: true });
});

describe("readRepos / writeRepos", () => {
  it("parses an existing repos.json", async () => {
    await fsp.writeFile(
      path.join(siegeHome, "repos.json"),
      JSON.stringify(FIXTURE_REPOS, null, 2),
      "utf8",
    );
    const result = await readRepos();
    expect(result).toEqual(FIXTURE_REPOS);
  });

  it("writeRepos round-trips through readRepos", async () => {
    await writeRepos(FIXTURE_REPOS);
    const result = await readRepos();
    expect(result).toEqual(FIXTURE_REPOS);
  });

  it("writeRepos atomically rotates the file (no tmp left behind)", async () => {
    await writeRepos(FIXTURE_REPOS);
    const entries = await fsp.readdir(siegeHome);
    expect(entries).toContain("repos.json");
    expect(entries.filter((e) => e.includes(".tmp."))).toEqual([]);
  });

  it("writeRepos rejects malformed shape", async () => {
    await expect(
      writeRepos({ defaults: {}, repos: [{ name: "x" } as never] }),
    ).rejects.toThrow(/source/);
  });

  it("readRepos throws when repos.json is missing", async () => {
    await expect(readRepos()).rejects.toThrow();
  });
});

describe("readConfig / readSkills", () => {
  it("returns raw YAML for config.yml", async () => {
    const raw = "runtime:\n  wall_clock_cap_hours: 8\n";
    await fsp.writeFile(path.join(siegeHome, "config.yml"), raw, "utf8");
    expect(await readConfig()).toBe(raw);
  });

  it("returns raw YAML for skills.yml", async () => {
    const raw = "catalog:\n  - name: frontend-design\n";
    await fsp.writeFile(path.join(siegeHome, "skills.yml"), raw, "utf8");
    expect(await readSkills()).toBe(raw);
  });
});

describe("listRunDates / listRuns / readRunItemResults", () => {
  it("returns [] when logs dir is missing", async () => {
    expect(await listRunDates()).toEqual([]);
  });

  it("listRuns returns [] when date dir is missing", async () => {
    expect(await listRuns("2026-06-02")).toEqual([]);
  });

  it("lists only well-formed date and stamp dirs, newest first", async () => {
    const logs = path.join(siegeHome, "logs");
    await fsp.mkdir(path.join(logs, "2026-06-01", "20260601-120000"), {
      recursive: true,
    });
    await fsp.mkdir(path.join(logs, "2026-06-02", "20260602-180223"), {
      recursive: true,
    });
    await fsp.mkdir(path.join(logs, "not-a-date", "noise"), { recursive: true });

    expect(await listRunDates()).toEqual(["2026-06-02", "2026-06-01"]);
    const runs = await listRuns("2026-06-02");
    expect(runs).toHaveLength(1);
    expect(runs[0].stamp).toBe("20260602-180223");
    expect(runs[0].logDir.endsWith("20260602-180223")).toBe(true);
  });

  it("rejects malformed run date strings", async () => {
    await expect(listRuns("../etc")).rejects.toThrow(/invalid run date/);
  });

  it("readRunItemResults returns [] when items dir is missing", async () => {
    const runDir = path.join(siegeHome, "logs", "2026-06-02", "20260602-180223");
    await fsp.mkdir(runDir, { recursive: true });
    expect(await readRunItemResults(runDir)).toEqual([]);
  });

  it("readRunItemResults parses result.json files", async () => {
    const runDir = path.join(siegeHome, "logs", "2026-06-02", "20260602-180223");
    const repoDir = path.join(runDir, "items", "therealsiege_myflo");
    await fsp.mkdir(repoDir, { recursive: true });
    const result = {
      repo: "therealsiege/myflo",
      issue: 2,
      title: "lib/siege.ts",
      url: "https://github.com/therealsiege/myflo/issues/2",
      status: "done",
      stage: "coder",
      reason: "",
      branch: "siege/issue-2",
      ts: "2026-06-02T18:03:22-04:00",
    };
    await fsp.writeFile(
      path.join(repoDir, "issue-2.result.json"),
      JSON.stringify(result),
      "utf8",
    );
    const got = await readRunItemResults(runDir);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject(result);
  });

  it("readRunItemResults rejects paths outside the logs dir", async () => {
    await expect(
      readRunItemResults(path.join(siegeHome, "..")),
    ).rejects.toThrow(/escape/);
  });
});

describe("toRepoSafe", () => {
  it("replaces the first slash with an underscore", () => {
    expect(toRepoSafe("therealsiege/myflo")).toBe("therealsiege_myflo");
    expect(toRepoSafe("a-b.c/d_e")).toBe("a-b.c_d_e");
  });

  it("rejects malformed repo names", () => {
    expect(() => toRepoSafe("nope")).toThrow(/invalid repo/);
    expect(() => toRepoSafe("a/b/c")).toThrow(/invalid repo/);
    expect(() => toRepoSafe("a/b;rm")).toThrow(/invalid repo/);
  });
});

describe("getLastAttempt", () => {
  async function writeResult(
    date: string,
    stamp: string,
    repoSafe: string,
    issueNum: number,
    body: Record<string, unknown>,
  ) {
    const dir = path.join(
      siegeHome,
      "logs",
      date,
      stamp,
      "items",
      repoSafe,
    );
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, `issue-${issueNum}.result.json`),
      JSON.stringify(body),
      "utf8",
    );
  }

  it("returns null when there are no logs", async () => {
    expect(await getLastAttempt("therealsiege/myflo", 12)).toBeNull();
  });

  it("returns null when no matching result.json exists", async () => {
    await writeResult(
      "2026-06-02",
      "20260602-120000",
      "therealsiege_myflo",
      99,
      { status: "done" },
    );
    expect(await getLastAttempt("therealsiege/myflo", 12)).toBeNull();
  });

  it("returns the most recent matching result (newest date wins)", async () => {
    await writeResult(
      "2026-06-01",
      "20260601-120000",
      "therealsiege_myflo",
      12,
      { status: "failed", ts: "2026-06-01T12:00:00Z" },
    );
    await writeResult(
      "2026-06-02",
      "20260602-180000",
      "therealsiege_myflo",
      12,
      { status: "merged", ts: "2026-06-02T18:00:00Z" },
    );
    const result = await getLastAttempt("therealsiege/myflo", 12);
    expect(result).toEqual({
      date: "2026-06-02",
      stamp: "20260602-180000",
      status: "merged",
    });
  });

  it("returns the most recent stamp within the newest date", async () => {
    await writeResult(
      "2026-06-02",
      "20260602-120000",
      "therealsiege_myflo",
      12,
      { status: "failed" },
    );
    await writeResult(
      "2026-06-02",
      "20260602-180000",
      "therealsiege_myflo",
      12,
      { status: "done" },
    );
    const result = await getLastAttempt("therealsiege/myflo", 12);
    expect(result).toEqual({
      date: "2026-06-02",
      stamp: "20260602-180000",
      status: "done",
    });
  });

  it("ignores other repos and other issues", async () => {
    await writeResult(
      "2026-06-02",
      "20260602-180000",
      "another_repo",
      12,
      { status: "merged" },
    );
    await writeResult(
      "2026-06-02",
      "20260602-180000",
      "therealsiege_myflo",
      99,
      { status: "merged" },
    );
    expect(await getLastAttempt("therealsiege/myflo", 12)).toBeNull();
  });

  it("skips malformed date and stamp directories", async () => {
    const badDate = path.join(siegeHome, "logs", "not-a-date");
    await fsp.mkdir(badDate, { recursive: true });
    const badStamp = path.join(siegeHome, "logs", "2026-06-02", "junk");
    await fsp.mkdir(badStamp, { recursive: true });
    await writeResult(
      "2026-06-02",
      "20260602-180000",
      "therealsiege_myflo",
      12,
      { status: "done" },
    );
    const result = await getLastAttempt("therealsiege/myflo", 12);
    expect(result?.stamp).toBe("20260602-180000");
  });

  it("rejects malformed repo names", async () => {
    await expect(getLastAttempt("nope", 1)).rejects.toThrow(/invalid repo/);
    await expect(getLastAttempt("a/b;rm -rf", 1)).rejects.toThrow(
      /invalid repo/,
    );
  });

  it("rejects non-positive issue numbers", async () => {
    await expect(getLastAttempt("foo/bar", 0)).rejects.toThrow(
      /positive integer/,
    );
    await expect(getLastAttempt("foo/bar", -1)).rejects.toThrow(
      /positive integer/,
    );
    await expect(getLastAttempt("foo/bar", 1.5)).rejects.toThrow(
      /positive integer/,
    );
  });
});

describe("readDesktopReports / readDesktopReport", () => {
  it("returns [] when Desktop has no siege-*.md files", async () => {
    expect(await readDesktopReports()).toEqual([]);
  });

  it("lists matching reports newest first", async () => {
    await fsp.writeFile(
      path.join(fakeHome, "Desktop", "siege-2026-06-01.md"),
      "# old\n",
    );
    await fsp.writeFile(
      path.join(fakeHome, "Desktop", "siege-2026-06-02.md"),
      "# new body\n",
    );
    await fsp.writeFile(
      path.join(fakeHome, "Desktop", "unrelated.txt"),
      "noise",
    );

    const reports = await readDesktopReports();
    expect(reports.map((r) => r.filename)).toEqual([
      "siege-2026-06-02.md",
      "siege-2026-06-01.md",
    ]);
    expect(reports[0].date).toBe("2026-06-02");
    expect(reports[0].bytes).toBe(Buffer.byteLength("# new body\n", "utf8"));
    expect(reports[1].bytes).toBe(Buffer.byteLength("# old\n", "utf8"));
    // mtime should be an ISO timestamp string
    expect(reports[0].mtime).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("reads the contents of a named report", async () => {
    await fsp.writeFile(
      path.join(fakeHome, "Desktop", "siege-2026-06-02.md"),
      "# report body\n",
    );
    expect(await readDesktopReport("siege-2026-06-02.md")).toBe(
      "# report body\n",
    );
  });

  it("rejects traversal attempts on the desktop report name", async () => {
    await expect(readDesktopReport("../../etc/passwd")).rejects.toThrow();
    await expect(readDesktopReport("siege-../escape.md")).rejects.toThrow();
  });
});

describe("getActivePid", () => {
  it("returns null when overnight.pid is missing", async () => {
    expect(await getActivePid()).toBeNull();
  });

  it("parses multi-line pid file, ignoring blanks and junk", async () => {
    await fsp.writeFile(
      path.join(siegeHome, "overnight.pid"),
      "96455\n96465\n\n97250\nnotapid\n",
      "utf8",
    );
    expect(await getActivePid()).toEqual([96455, 96465, 97250]);
  });
});

describe("buildStartArgs", () => {
  it("returns an empty array when no opts are provided", () => {
    expect(buildStartArgs({})).toEqual([]);
  });

  it("emits --dry-run only when true", () => {
    expect(buildStartArgs({ dryRun: true })).toEqual(["--dry-run"]);
    expect(buildStartArgs({ dryRun: false })).toEqual([]);
  });

  it("emits --watch only when true", () => {
    expect(buildStartArgs({ watch: true })).toEqual(["--watch"]);
    expect(buildStartArgs({ watch: false })).toEqual([]);
  });

  it("emits --max-items N for a positive integer", () => {
    expect(buildStartArgs({ maxItems: 3 })).toEqual(["--max-items", "3"]);
  });

  it("rejects non-integer maxItems", () => {
    expect(() => buildStartArgs({ maxItems: 1.5 })).toThrow(
      /positive integer/,
    );
    expect(() => buildStartArgs({ maxItems: 0 })).toThrow(/positive integer/);
    expect(() =>
      buildStartArgs({ maxItems: "3" as unknown as number }),
    ).toThrow(/positive integer/);
  });

  it("emits --repos a,b for a list of valid repos", () => {
    expect(
      buildStartArgs({ repos: ["openloop/foo", "therealsiege/myflo"] }),
    ).toEqual(["--repos", "openloop/foo,therealsiege/myflo"]);
  });

  it("rejects non-array repos", () => {
    expect(() =>
      buildStartArgs({ repos: "openloop/foo" as unknown as string[] }),
    ).toThrow(/non-empty array/);
  });

  it("rejects an empty repos array", () => {
    expect(() => buildStartArgs({ repos: [] })).toThrow(/non-empty array/);
  });

  it("rejects malformed repo names", () => {
    expect(() => buildStartArgs({ repos: ["nope"] })).toThrow(/invalid repo/);
    expect(() => buildStartArgs({ repos: ["a/b;rm -rf"] })).toThrow(
      /invalid repo/,
    );
  });

  it("rejects non-boolean dryRun / watch", () => {
    expect(() =>
      buildStartArgs({ dryRun: "yes" as unknown as boolean }),
    ).toThrow(/dryRun/);
    expect(() =>
      buildStartArgs({ watch: 1 as unknown as boolean }),
    ).toThrow(/watch/);
  });

  it("combines all flags in a stable order", () => {
    expect(
      buildStartArgs({
        dryRun: true,
        watch: true,
        maxItems: 5,
        repos: ["a/b"],
      }),
    ).toEqual([
      "--dry-run",
      "--watch",
      "--max-items",
      "5",
      "--repos",
      "a/b",
    ]);
  });
});

describe("startSiege", () => {
  beforeEach(() => {
    // Speed up the polling loop so the timeout test finishes fast.
    process.env.SIEGE_START_POLL_TIMEOUT_MS = "200";
    process.env.SIEGE_START_POLL_INTERVAL_MS = "20";
  });

  function stubChild() {
    return { unref: vi.fn(), on: vi.fn() } as unknown as ReturnType<
      typeof spawnMock
    >;
  }

  async function makeRun(
    stamp = "20260603-082130",
    date = "2026-06-03",
  ): Promise<string> {
    const logDir = path.join(siegeHome, "logs", date, stamp);
    await fsp.mkdir(logDir, { recursive: true });
    return logDir;
  }

  it("spawns ~/.siege/bin/start with the expected args and returns run info", async () => {
    await makeRun();
    spawnMock.mockImplementationOnce(() => {
      // simulate the bash script writing pids + creating log dir before exit
      void fsp.writeFile(
        path.join(siegeHome, "overnight.pid"),
        "12345\n12346\n",
        "utf8",
      );
      return stubChild();
    });

    const result = await startSiege({ dryRun: true, maxItems: 2 });

    expect(result.runStamp).toBe("20260603-082130");
    expect(
      result.logDir.endsWith(
        path.join("logs", "2026-06-03", "20260603-082130"),
      ),
    ).toBe(true);
    expect(result.pids).toEqual([12345, 12346]);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [file, args, opts] = spawnMock.mock.calls[0];
    expect(file).toBe(path.join(siegeHome, "bin", "start"));
    expect(args).toEqual(["--dry-run", "--max-items", "2"]);
    expect(opts).toMatchObject({ detached: true, stdio: "ignore" });
  });

  it("forwards the --repos argument when provided", async () => {
    await makeRun();
    spawnMock.mockImplementationOnce(() => {
      void fsp.writeFile(
        path.join(siegeHome, "overnight.pid"),
        "100\n",
        "utf8",
      );
      return stubChild();
    });

    await startSiege({ repos: ["openloop/foo", "therealsiege/myflo"] });
    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      "--repos",
      "openloop/foo,therealsiege/myflo",
    ]);
  });

  it("throws ConflictError when overnight.pid already lists pids", async () => {
    await fsp.writeFile(
      path.join(siegeHome, "overnight.pid"),
      "9999\n",
      "utf8",
    );

    await expect(startSiege({})).rejects.toBeInstanceOf(ConflictError);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("attaches pids to ConflictError", async () => {
    await fsp.writeFile(
      path.join(siegeHome, "overnight.pid"),
      "9999\n10000\n",
      "utf8",
    );

    try {
      await startSiege({});
      throw new Error("expected ConflictError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).pids).toEqual([9999, 10000]);
    }
  });

  it("rejects when no pids appear before the poll timeout", async () => {
    spawnMock.mockImplementationOnce(() => stubChild());
    // never write to overnight.pid -> polling exhausts
    await expect(startSiege({})).rejects.toThrow(/no pids appeared/);
  });

  it("rejects when pids appear but no run directory exists", async () => {
    spawnMock.mockImplementationOnce(() => {
      void fsp.writeFile(
        path.join(siegeHome, "overnight.pid"),
        "777\n",
        "utf8",
      );
      return stubChild();
    });

    await expect(startSiege({})).rejects.toThrow(/no run directory/);
  });

  it("validates bad opts before pre-checking the pid file", async () => {
    // pre-existing pids would otherwise throw ConflictError; bad opts should fail first
    await fsp.writeFile(
      path.join(siegeHome, "overnight.pid"),
      "9999\n",
      "utf8",
    );
    await expect(startSiege({ maxItems: -1 })).rejects.toThrow(
      /positive integer/,
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("killSiege", () => {
  function mockKillStdout(stdout: string) {
    execFileMock.mockImplementationOnce(
      (
        _file: string,
        _args: readonly string[],
        _opts: unknown,
        cb: (
          err: NodeJS.ErrnoException | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        cb(null, stdout, "");
      },
    );
  }

  it("runs ~/.siege/bin/kill with no args by default and returns parsed pids", async () => {
    mockKillStdout(
      "killing 2 siege process(es): 12345 12346\nsiege stopped.\n",
    );

    const result = await killSiege();

    expect(result).toEqual({ killed: [12345, 12346], method: "graceful" });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args, opts] = execFileMock.mock.calls[0];
    expect(file).toBe(path.join(siegeHome, "bin", "kill"));
    expect(args).toEqual([]);
    expect(opts).toMatchObject({ timeout: 35_000 });
  });

  it("passes --force when requested and reports method 'force'", async () => {
    mockKillStdout("killing 1 siege process(es): 999\nsiege stopped.\n");

    const result = await killSiege(true);

    expect(result).toEqual({ killed: [999], method: "force" });
    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(["--force"]);
  });

  it("returns noop when the script reports no pid file", async () => {
    mockKillStdout("no siege running (no pid file).\n");

    const result = await killSiege();

    expect(result).toEqual({ killed: [], method: "noop" });
  });

  it("returns noop when the script reports no alive processes", async () => {
    mockKillStdout("no siege processes alive. cleaning up pid file.\n");

    const result = await killSiege();

    expect(result).toEqual({ killed: [], method: "noop" });
  });

  it("returns noop on empty stdout", async () => {
    mockKillStdout("");

    const result = await killSiege();

    expect(result).toEqual({ killed: [], method: "noop" });
  });

  it("propagates execFile errors", async () => {
    execFileMock.mockImplementationOnce(
      (
        _file: string,
        _args: readonly string[],
        _opts: unknown,
        cb: (
          err: NodeJS.ErrnoException | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        cb(new Error("ENOENT: kill script missing"), "", "");
      },
    );

    await expect(killSiege()).rejects.toThrow(/kill script missing/);
  });

  it("ignores junk tokens on the killing line", async () => {
    mockKillStdout(
      "killing 3 siege process(es): 100 not-a-pid 200 0 300\nsiege stopped.\n",
    );

    const result = await killSiege();

    expect(result).toEqual({ killed: [100, 200, 300], method: "graceful" });
  });
});

describe("listRecentRuns", () => {
  async function writeItem(
    date: string,
    stamp: string,
    repoSafe: string,
    issueNum: number,
    body: Record<string, unknown>,
    extras: { plan?: boolean; review?: boolean; log?: boolean } = {},
  ): Promise<string> {
    const dir = path.join(
      siegeHome,
      "logs",
      date,
      stamp,
      "items",
      repoSafe,
    );
    await fsp.mkdir(dir, { recursive: true });
    const resultPath = path.join(dir, `issue-${issueNum}.result.json`);
    await fsp.writeFile(resultPath, JSON.stringify(body), "utf8");
    if (extras.plan) {
      await fsp.writeFile(
        path.join(dir, `issue-${issueNum}.plan.json`),
        "{}",
        "utf8",
      );
    }
    if (extras.review) {
      await fsp.writeFile(
        path.join(dir, `issue-${issueNum}.review.json`),
        "{}",
        "utf8",
      );
    }
    if (extras.log) {
      await fsp.writeFile(
        path.join(dir, `issue-${issueNum}.log`),
        "log line\n",
        "utf8",
      );
    }
    return resultPath;
  }

  it("returns [] when logs dir is missing", async () => {
    expect(await listRecentRuns()).toEqual([]);
  });

  it("summarizes runs newest-first with item count and outcomes", async () => {
    await writeItem("2026-06-01", "20260601-120000", "owner_a", 1, {
      status: "merged",
      ts: "2026-06-01T12:00:00Z",
    });
    await writeItem("2026-06-02", "20260602-100000", "owner_a", 2, {
      status: "merged",
      ts: "2026-06-02T10:00:00Z",
    });
    await writeItem("2026-06-02", "20260602-100000", "owner_a", 3, {
      status: "skipped",
      ts: "2026-06-02T10:05:00Z",
    });
    await writeItem("2026-06-02", "20260602-180000", "owner_b", 7, {
      status: "merged",
      ts: "2026-06-02T18:00:00Z",
    });

    const runs = await listRecentRuns();
    expect(runs.map((r) => r.stamp)).toEqual([
      "20260602-180000",
      "20260602-100000",
      "20260601-120000",
    ]);
    expect(runs[0]).toMatchObject({
      date: "2026-06-02",
      itemCount: 1,
      outcomes: { merged: 1 },
    });
    expect(runs[1]).toMatchObject({
      date: "2026-06-02",
      itemCount: 2,
      outcomes: { merged: 1, skipped: 1 },
    });
    for (const r of runs) {
      expect(typeof r.startedAt).toBe("string");
      expect(typeof r.endedAt).toBe("string");
      expect(r.logDir.endsWith(r.stamp)).toBe(true);
    }
  });

  it("honors the limit param", async () => {
    for (let i = 0; i < 5; i++) {
      const stamp = `20260602-12000${i}`;
      await writeItem("2026-06-02", stamp, "owner_a", i + 1, {
        status: "done",
      });
    }
    const runs = await listRecentRuns(3);
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.stamp)).toEqual([
      "20260602-120004",
      "20260602-120003",
      "20260602-120002",
    ]);
  });

  it("rejects bad limit values", async () => {
    await expect(listRecentRuns(0)).rejects.toThrow(/positive integer/);
    await expect(listRecentRuns(-1)).rejects.toThrow(/positive integer/);
    await expect(listRecentRuns(1.5)).rejects.toThrow(/positive integer/);
  });

  it("tolerates result.json files missing a status field", async () => {
    await writeItem("2026-06-02", "20260602-180000", "owner_a", 1, {
      // no status key
      ts: "2026-06-02T18:00:00Z",
    });
    const runs = await listRecentRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].itemCount).toBe(1);
    // parseItemResult coerces missing status to "" — tally that under "unknown"
    expect(runs[0].outcomes).toEqual({ unknown: 1 });
  });

  it("returns empty outcomes and null timestamps for an empty run", async () => {
    await fsp.mkdir(
      path.join(siegeHome, "logs", "2026-06-02", "20260602-180000"),
      { recursive: true },
    );
    const runs = await listRecentRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      date: "2026-06-02",
      stamp: "20260602-180000",
      itemCount: 0,
      outcomes: {},
      startedAt: null,
      endedAt: null,
    });
    expect(
      runs[0].logDir.endsWith(
        path.join("logs", "2026-06-02", "20260602-180000"),
      ),
    ).toBe(true);
  });
});

describe("getRunDetail", () => {
  async function seedItem(
    date: string,
    stamp: string,
    repoSafe: string,
    issueNum: number,
    body: Record<string, unknown>,
    extras: { plan?: boolean; review?: boolean; log?: boolean } = {},
  ): Promise<void> {
    const dir = path.join(
      siegeHome,
      "logs",
      date,
      stamp,
      "items",
      repoSafe,
    );
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, `issue-${issueNum}.result.json`),
      JSON.stringify(body),
      "utf8",
    );
    if (extras.plan) {
      await fsp.writeFile(
        path.join(dir, `issue-${issueNum}.plan.json`),
        "{}",
        "utf8",
      );
    }
    if (extras.review) {
      await fsp.writeFile(
        path.join(dir, `issue-${issueNum}.review.json`),
        "{}",
        "utf8",
      );
    }
    if (extras.log) {
      await fsp.writeFile(
        path.join(dir, `issue-${issueNum}.log`),
        "log line\n",
        "utf8",
      );
    }
  }

  it("rejects malformed stamps", async () => {
    await expect(getRunDetail("../etc")).rejects.toThrow(/invalid run stamp/);
    await expect(getRunDetail("2026-06-02")).rejects.toThrow(
      /invalid run stamp/,
    );
    await expect(getRunDetail("20260602")).rejects.toThrow(/invalid run stamp/);
  });

  it("throws RunNotFoundError for an unknown stamp", async () => {
    await expect(getRunDetail("20260602-180000")).rejects.toBeInstanceOf(
      RunNotFoundError,
    );
  });

  it("returns items with plan/review/log paths when present, null otherwise", async () => {
    await seedItem(
      "2026-06-02",
      "20260602-180000",
      "owner_a",
      4,
      {
        repo: "owner/a",
        issue: 4,
        title: "first",
        status: "merged",
        stage: "merge",
        branch: "siege/issue-4",
        ts: "2026-06-02T18:00:00Z",
      },
      { plan: true, review: true, log: true },
    );
    await seedItem(
      "2026-06-02",
      "20260602-180000",
      "owner_a",
      5,
      {
        repo: "owner/a",
        issue: 5,
        title: "second",
        status: "skipped",
        stage: "skip",
        branch: "",
        ts: "2026-06-02T18:05:00Z",
      },
      { plan: true },
    );

    const detail = await getRunDetail("20260602-180000");
    expect(detail.stamp).toBe("20260602-180000");
    expect(detail.logDir.endsWith("20260602-180000")).toBe(true);
    expect(detail.items).toHaveLength(2);

    // sorted newest ts first
    expect(detail.items.map((i) => i.issue)).toEqual([5, 4]);

    const item4 = detail.items.find((i) => i.issue === 4)!;
    expect(item4.planPath).toBeTruthy();
    expect(item4.reviewPath).toBeTruthy();
    expect(item4.logPath).toBeTruthy();
    expect(item4.planPath?.endsWith("issue-4.plan.json")).toBe(true);
    expect(item4.reviewPath?.endsWith("issue-4.review.json")).toBe(true);
    expect(item4.logPath?.endsWith("issue-4.log")).toBe(true);

    const item5 = detail.items.find((i) => i.issue === 5)!;
    expect(item5.planPath?.endsWith("issue-5.plan.json")).toBe(true);
    expect(item5.reviewPath).toBeNull();
    expect(item5.logPath).toBeNull();
  });

  it("finds the run across multiple date directories", async () => {
    await seedItem(
      "2026-06-01",
      "20260601-120000",
      "owner_a",
      1,
      { status: "done" },
    );
    await seedItem(
      "2026-06-03",
      "20260603-090000",
      "owner_a",
      2,
      { status: "merged" },
    );
    const detail = await getRunDetail("20260601-120000");
    expect(detail.stamp).toBe("20260601-120000");
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toMatchObject({ status: "done" });
  });

  it("returns an empty items list when the run dir has no items", async () => {
    await fsp.mkdir(
      path.join(siegeHome, "logs", "2026-06-02", "20260602-180000"),
      { recursive: true },
    );
    const detail = await getRunDetail("20260602-180000");
    expect(detail.items).toEqual([]);
  });
});

describe("tailFile", () => {
  async function writeLog(rel: string, body: string): Promise<string> {
    const full = path.join(siegeHome, "logs", rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body, "utf8");
    return full;
  }

  it("returns empty lines for an empty file", async () => {
    const file = await writeLog("2026-06-02/20260602-120000/empty.log", "");
    const out = await tailFile(file, 10);
    expect(out.lines).toEqual([]);
    expect(out.size).toBe(0);
    expect(out.path).toBe(await fsp.realpath(file));
    expect(typeof out.updatedAt).toBe("string");
  });

  it("returns the last N lines when file has more than N", async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
    const file = await writeLog(
      "2026-06-02/20260602-120000/big.log",
      lines.join("\n") + "\n",
    );
    const out = await tailFile(file, 200);
    expect(out.lines).toHaveLength(200);
    expect(out.lines[0]).toBe("line 101");
    expect(out.lines[199]).toBe("line 300");
  });

  it("returns all lines when file has fewer than N", async () => {
    const file = await writeLog(
      "2026-06-02/20260602-120000/small.log",
      "a\nb\nc\n",
    );
    const out = await tailFile(file, 200);
    expect(out.lines).toEqual(["a", "b", "c"]);
  });

  it("handles file without trailing newline", async () => {
    const file = await writeLog(
      "2026-06-02/20260602-120000/no-newline.log",
      "first\nsecond\nthird",
    );
    const out = await tailFile(file, 10);
    expect(out.lines).toEqual(["first", "second", "third"]);
  });

  it("rejects non-positive maxLines", async () => {
    const file = await writeLog("2026-06-02/20260602-120000/x.log", "a\n");
    await expect(tailFile(file, 0)).rejects.toThrow(/positive integer/);
    await expect(tailFile(file, -1)).rejects.toThrow(/positive integer/);
    await expect(tailFile(file, 1.5)).rejects.toThrow(/positive integer/);
  });

  it("rejects paths outside the logs root", async () => {
    const outside = path.join(siegeHome, "secret.txt");
    await fsp.writeFile(outside, "secret\n", "utf8");
    await expect(tailFile(outside, 10)).rejects.toThrow(/escape/);
  });

  it("rejects traversal attempts", async () => {
    await expect(
      tailFile(path.join(siegeHome, "logs", "..", "passwd"), 10),
    ).rejects.toThrow(/escape/);
  });

  it("handles a large file efficiently by reverse-reading", async () => {
    // 50k lines, ~500KB
    const lines = Array.from({ length: 50_000 }, (_, i) => `entry-${i}`);
    const file = await writeLog(
      "2026-06-02/20260602-120000/huge.log",
      lines.join("\n") + "\n",
    );
    const out = await tailFile(file, 200);
    expect(out.lines).toHaveLength(200);
    expect(out.lines[0]).toBe("entry-49800");
    expect(out.lines[199]).toBe("entry-49999");
  });
});

describe("parseCurrentItem", () => {
  it("returns null on empty input", () => {
    expect(parseCurrentItem([])).toBeNull();
  });

  it("returns null when no item markers are present", () => {
    expect(parseCurrentItem(["[INFO] some line", "[INFO] another"])).toBeNull();
  });

  it("returns the most recent open item (unmatched ▶)", () => {
    const lines = [
      "[2026-06-02 18:40:23] [INFO] ▶ #2: lib/siege.ts: helpers",
      "[2026-06-02 18:40:24] [INFO]   skip — PR exists",
      "[2026-06-02 18:40:25] [INFO] ▶ #3: lib/gh.ts: wrapper",
      "[2026-06-02 18:47:30] [INFO]   PR: https://...",
    ];
    expect(parseCurrentItem(lines)).toEqual({
      issue: 3,
      title: "lib/gh.ts: wrapper",
    });
  });

  it("returns null when every ▶ has a matching ▼ done", () => {
    const lines = [
      "[2026-06-02 18:40:23] [INFO] ▶ #2: lib/siege.ts",
      "[2026-06-02 18:47:36] [INFO] ▼ #2 done",
      "[2026-06-02 18:47:38] [INFO] ▶ #3: lib/gh.ts",
      "[2026-06-02 18:55:00] [INFO] ▼ #3 done",
    ];
    expect(parseCurrentItem(lines)).toBeNull();
  });

  it("skips items that ended later in the log", () => {
    const lines = [
      "[2026-06-02 18:40:23] [INFO] ▶ #2: starting",
      "[2026-06-02 18:40:25] [INFO] ▶ #3: also starting",
      "[2026-06-02 18:47:36] [INFO] ▼ #3 done",
    ];
    expect(parseCurrentItem(lines)).toEqual({
      issue: 2,
      title: "starting",
    });
  });

  it("handles title with colons inside", () => {
    const lines = [
      "[2026-06-02 18:40:23] [INFO] ▶ #4: API routes: /api/siege/repos and /api/siege/status",
    ];
    expect(parseCurrentItem(lines)).toEqual({
      issue: 4,
      title: "API routes: /api/siege/repos and /api/siege/status",
    });
  });
});

describe("isCapReached", () => {
  it("returns false for empty input", () => {
    expect(isCapReached([])).toBe(false);
  });

  it("returns false when no cap line present", () => {
    expect(isCapReached(["just some line", "another line"])).toBe(false);
  });

  it("detects the canonical cap-reached watchdog line", () => {
    expect(
      isCapReached([
        "[2026-06-02 18:40:20] [WARN] wall-clock cap reached (8h) — terminating siege",
      ]),
    ).toBe(true);
  });

  it("is case insensitive", () => {
    expect(
      isCapReached(["WALL-CLOCK CAP REACHED at 8h"]),
    ).toBe(true);
  });
});

describe("findLatestRunLogPath", () => {
  it("returns null when there are no runs", async () => {
    expect(await findLatestRunLogPath()).toBeNull();
  });

  it("returns null when the latest run has no log files", async () => {
    await fsp.mkdir(
      path.join(siegeHome, "logs", "2026-06-02", "20260602-180000"),
      { recursive: true },
    );
    expect(await findLatestRunLogPath()).toBeNull();
  });

  it("picks the most recently modified .log across run + items dirs", async () => {
    const runDir = path.join(
      siegeHome,
      "logs",
      "2026-06-02",
      "20260602-180000",
    );
    const itemsDir = path.join(runDir, "items", "owner_repo");
    await fsp.mkdir(itemsDir, { recursive: true });

    const startLog = path.join(runDir, "start.log");
    const repoLog = path.join(runDir, "owner_repo.log");
    const issueLog = path.join(itemsDir, "issue-2.log");

    await fsp.writeFile(startLog, "start\n", "utf8");
    await fsp.writeFile(repoLog, "repo\n", "utf8");
    await fsp.writeFile(issueLog, "issue\n", "utf8");

    const now = Date.now();
    await fsp.utimes(startLog, now / 1000, (now - 5_000) / 1000);
    await fsp.utimes(repoLog, now / 1000, (now - 3_000) / 1000);
    await fsp.utimes(issueLog, now / 1000, now / 1000);

    expect(await findLatestRunLogPath()).toBe(await fsp.realpath(issueLog));
  });

  it("prefers logs from the newest run", async () => {
    const oldRun = path.join(
      siegeHome,
      "logs",
      "2026-06-01",
      "20260601-120000",
    );
    const newRun = path.join(
      siegeHome,
      "logs",
      "2026-06-02",
      "20260602-180000",
    );
    await fsp.mkdir(oldRun, { recursive: true });
    await fsp.mkdir(newRun, { recursive: true });
    await fsp.writeFile(path.join(oldRun, "start.log"), "old\n", "utf8");
    await fsp.writeFile(path.join(newRun, "start.log"), "new\n", "utf8");
    expect(await findLatestRunLogPath()).toBe(
      await fsp.realpath(path.join(newRun, "start.log")),
    );
  });
});
