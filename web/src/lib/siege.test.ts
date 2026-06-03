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
  getActivePid,
  killSiege,
  listRunDates,
  listRuns,
  readConfig,
  readDesktopReport,
  readDesktopReports,
  readRepos,
  readRunItemResults,
  readSkills,
  startSiege,
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
      "# new\n",
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
