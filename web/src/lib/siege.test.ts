import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  getActivePid,
  listRunDates,
  listRuns,
  readConfig,
  readDesktopReport,
  readDesktopReports,
  readRepos,
  readRunItemResults,
  readSkills,
  writeRepos,
  type ReposConfig,
} from "./siege";

const ENV_KEYS = ["SIEGE_HOME", "HOME"] as const;

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
