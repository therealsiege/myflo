import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import {
  GhError,
  ghAuthStatus,
  listIssues,
  listIssuesAcrossRepos,
  listLabels,
  listOpenSiegePRIssueNumbers,
  listProjectItems,
  listPRsForBranch,
} from "./gh";

type ExecFileArgs = [
  cmd: string,
  args: string[],
  opts: Record<string, unknown>,
  cb: (
    err: NodeJS.ErrnoException | null,
    stdout: string,
    stderr: string,
  ) => void,
];

function mockOk(stdout: string, stderr = ""): void {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as ExecFileArgs[3];
    cb(null, stdout, stderr);
  });
}

function mockFail(err: NodeJS.ErrnoException, stderr = ""): void {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as ExecFileArgs[3];
    cb(err, "", stderr);
  });
}

function lastCall(): { cmd: string; args: string[]; opts: Record<string, unknown> } {
  const call = execFileMock.mock.calls[execFileMock.mock.calls.length - 1] as ExecFileArgs;
  return { cmd: call[0], args: call[1], opts: call[2] };
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe("repo and arg validation", () => {
  it("listIssues rejects malformed repo name (no slash)", async () => {
    await expect(listIssues({ repo: "noslash" })).rejects.toThrow(/invalid repo/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("listIssues rejects repo with too many slashes", async () => {
    await expect(listIssues({ repo: "a/b/c" })).rejects.toThrow(/invalid repo/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("listIssues rejects repo with shell metacharacters", async () => {
    await expect(
      listIssues({ repo: "foo/bar; rm -rf /" }),
    ).rejects.toThrow(/invalid repo/);
    await expect(
      listIssues({ repo: "foo/bar`whoami`" }),
    ).rejects.toThrow(/invalid repo/);
    await expect(listIssues({ repo: "foo/bar|cat" })).rejects.toThrow(
      /invalid repo/,
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("listIssues rejects shell metacharacters in search arg", async () => {
    await expect(
      listIssues({ repo: "foo/bar", search: "label:foo;cat /etc/passwd" }),
    ).rejects.toThrow(/disallowed characters/);
    await expect(
      listIssues({ repo: "foo/bar", search: "label:`whoami`" }),
    ).rejects.toThrow(/disallowed characters/);
    await expect(
      listIssues({ repo: "foo/bar", search: "label:$HOME" }),
    ).rejects.toThrow(/disallowed characters/);
    await expect(
      listIssues({ repo: "foo/bar", search: "label:foo\nbar" }),
    ).rejects.toThrow(/disallowed characters/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("listIssues rejects search starting with a dash (flag injection)", async () => {
    await expect(
      listIssues({ repo: "foo/bar", search: "--inject" }),
    ).rejects.toThrow(/must not start with/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("listIssues rejects out-of-range limits", async () => {
    await expect(listIssues({ repo: "foo/bar", limit: 0 })).rejects.toThrow(
      /limit/,
    );
    await expect(
      listIssues({ repo: "foo/bar", limit: 99_999 }),
    ).rejects.toThrow(/limit/);
    await expect(
      listIssues({ repo: "foo/bar", limit: 1.5 as number }),
    ).rejects.toThrow(/limit/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("listPRsForBranch rejects malformed repo and unsafe head", async () => {
    await expect(
      listPRsForBranch({ repo: "bad repo", head: "feature" }),
    ).rejects.toThrow(/invalid repo/);
    await expect(
      listPRsForBranch({ repo: "foo/bar", head: "feature; echo hi" }),
    ).rejects.toThrow(/disallowed characters/);
    await expect(
      listPRsForBranch({ repo: "foo/bar", head: "--inject" }),
    ).rejects.toThrow(/must not start with/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("listLabels rejects malformed repo", async () => {
    await expect(listLabels("not a repo")).rejects.toThrow(/invalid repo/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("listProjectItems validates owner and projectNumber", async () => {
    await expect(
      listProjectItems({ owner: "bad owner!", projectNumber: 1 }),
    ).rejects.toThrow(/owner/);
    await expect(
      listProjectItems({ owner: "openloop", projectNumber: 0 }),
    ).rejects.toThrow(/projectNumber/);
    await expect(
      listProjectItems({ owner: "openloop", projectNumber: -3 }),
    ).rejects.toThrow(/projectNumber/);
    await expect(
      listProjectItems({ owner: "openloop", projectNumber: 1.5 }),
    ).rejects.toThrow(/projectNumber/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("listProjectItems rejects unsafe column", async () => {
    await expect(
      listProjectItems({
        owner: "openloop",
        projectNumber: 1,
        column: "Done; rm",
      }),
    ).rejects.toThrow(/disallowed characters/);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe("command shape", () => {
  it("listIssues builds safe argv with defaults", async () => {
    mockOk("[]");
    await listIssues({ repo: "therealsiege/myflo" });
    const { cmd, args, opts } = lastCall();
    expect(cmd).toBe("gh");
    expect(args).toEqual([
      "issue",
      "list",
      "-R",
      "therealsiege/myflo",
      "--limit",
      "50",
      "--json",
      "number,title,body,url,labels,assignees,state",
    ]);
    expect(opts.timeout).toBe(15_000);
  });

  it("listIssues passes search and custom limit", async () => {
    mockOk("[]");
    await listIssues({
      repo: "foo/bar",
      search: "label:overnight-ok state:open",
      limit: 25,
    });
    const { args } = lastCall();
    expect(args).toContain("--search");
    expect(args).toContain("label:overnight-ok state:open");
    expect(args[args.indexOf("--limit") + 1]).toBe("25");
  });

  it("listProjectItems uses the 30s timeout and item-list shape", async () => {
    mockOk("[]");
    await listProjectItems({ owner: "openloop", projectNumber: 7 });
    const { args, opts } = lastCall();
    expect(args.slice(0, 3)).toEqual(["project", "item-list", "7"]);
    expect(args).toContain("--owner");
    expect(args).toContain("openloop");
    expect(args).toContain("--format");
    expect(args).toContain("json");
    expect(opts.timeout).toBe(30_000);
  });

  it("listLabels and listPRsForBranch build expected argv", async () => {
    mockOk("[]");
    await listLabels("foo/bar");
    expect(lastCall().args).toEqual([
      "label",
      "list",
      "-R",
      "foo/bar",
      "--limit",
      "1000",
      "--json",
      "name,color,description",
    ]);

    mockOk("[]");
    await listPRsForBranch({ repo: "foo/bar", head: "feature/x.1" });
    expect(lastCall().args).toEqual([
      "pr",
      "list",
      "-R",
      "foo/bar",
      "--head",
      "feature/x.1",
      "--json",
      "number,url,state,title",
    ]);
  });
});

describe("JSON parsing", () => {
  it("listIssues parses documented shape", async () => {
    const payload = [
      {
        number: 12,
        title: "Fix bug",
        body: "body text",
        url: "https://github.com/x/y/issues/12",
        labels: [
          { name: "bug", color: "ff0000" },
          { name: "overnight-ok", color: "00ff00" },
        ],
        assignees: [{ login: "alice" }],
        state: "OPEN",
      },
    ];
    mockOk(JSON.stringify(payload));
    const result = await listIssues({ repo: "foo/bar" });
    expect(result).toEqual(payload);
  });

  it("listIssues tolerates missing optional fields", async () => {
    mockOk(JSON.stringify([{ number: 1, title: "t", url: "u" }]));
    const [issue] = await listIssues({ repo: "foo/bar" });
    expect(issue.body).toBe("");
    expect(issue.labels).toEqual([]);
    expect(issue.assignees).toEqual([]);
    expect(issue.state).toBe("");
  });

  it("returns [] for empty array output (no results)", async () => {
    mockOk("[]");
    expect(await listIssues({ repo: "foo/bar" })).toEqual([]);
    mockOk("");
    expect(await listLabels("foo/bar")).toEqual([]);
  });

  it("listLabels and listPRsForBranch parse documented shapes", async () => {
    mockOk(
      JSON.stringify([{ name: "bug", color: "ff0000", description: "broken" }]),
    );
    expect(await listLabels("foo/bar")).toEqual([
      { name: "bug", color: "ff0000", description: "broken" },
    ]);

    mockOk(
      JSON.stringify([
        { number: 5, url: "https://gh/p/5", state: "OPEN", title: "t" },
      ]),
    );
    expect(
      await listPRsForBranch({ repo: "foo/bar", head: "feature" }),
    ).toEqual([{ number: 5, url: "https://gh/p/5", state: "OPEN", title: "t" }]);
  });

  it("listProjectItems parses { items: [...] } wrapper", async () => {
    const payload = {
      items: [
        {
          content: {
            number: 3,
            title: "task",
            body: "do thing",
            url: "https://gh/example/issues/3",
            type: "Issue",
            repository: "https://github.com/foo/bar",
          },
          status: "Overnight Ready",
        },
      ],
    };
    mockOk(JSON.stringify(payload));
    const items = await listProjectItems({
      owner: "openloop",
      projectNumber: 7,
    });
    expect(items).toHaveLength(1);
    expect(items[0].content.title).toBe("task");
    expect(items[0].status).toBe("Overnight Ready");
  });

  it("listProjectItems accepts bare array shape too", async () => {
    const payload = [
      {
        content: {
          number: 1,
          title: "a",
          body: "",
          url: "u",
          type: "Issue",
          repository: "r",
        },
        status: "Backlog",
      },
    ];
    mockOk(JSON.stringify(payload));
    const items = await listProjectItems({
      owner: "openloop",
      projectNumber: 7,
    });
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("Backlog");
  });

  it("listProjectItems filters by column when provided", async () => {
    const payload = {
      items: [
        {
          content: {
            number: 1,
            title: "a",
            body: "",
            url: "",
            type: "Issue",
            repository: "",
          },
          status: "Backlog",
        },
        {
          content: {
            number: 2,
            title: "b",
            body: "",
            url: "",
            type: "Issue",
            repository: "",
          },
          status: "Overnight Ready",
        },
      ],
    };
    mockOk(JSON.stringify(payload));
    const items = await listProjectItems({
      owner: "openloop",
      projectNumber: 7,
      column: "Overnight Ready",
    });
    expect(items).toHaveLength(1);
    expect(items[0].content.number).toBe(2);
  });

  it("listProjectItems tolerates missing optional content fields", async () => {
    const payload = {
      items: [{ content: { number: 1, title: "a", url: "u" } }],
    };
    mockOk(JSON.stringify(payload));
    const [item] = await listProjectItems({
      owner: "openloop",
      projectNumber: 7,
    });
    expect(item.content.body).toBe("");
    expect(item.content.type).toBe("");
    expect(item.content.repository).toBe("");
    expect(item.status).toBeUndefined();
  });

  it("listProjectItems throws on unexpected output shape", async () => {
    mockOk(JSON.stringify({ unexpected: true }));
    await expect(
      listProjectItems({ owner: "openloop", projectNumber: 7 }),
    ).rejects.toThrow(/unexpected output shape/);
  });

  it("listIssues throws GhError on non-JSON output", async () => {
    mockOk("definitely not json");
    await expect(listIssues({ repo: "foo/bar" })).rejects.toBeInstanceOf(
      GhError,
    );
  });

  it("listIssues throws when JSON is not an array", async () => {
    mockOk(JSON.stringify({ not: "an array" }));
    await expect(listIssues({ repo: "foo/bar" })).rejects.toThrow(/array/);
  });
});

describe("error handling", () => {
  it("throws clear GhError when gh binary is missing (ENOENT)", async () => {
    const err = Object.assign(new Error("spawn ENOENT"), {
      code: "ENOENT",
    }) as NodeJS.ErrnoException;
    mockFail(err);
    await expect(listIssues({ repo: "foo/bar" })).rejects.toThrow(
      /gh CLI not found in PATH/,
    );
  });

  it("throws auth error when stderr indicates auth required", async () => {
    const err = Object.assign(new Error("exit 1"), {
      code: 1,
    }) as NodeJS.ErrnoException;
    mockFail(err, "gh: To get started, run: gh auth login");
    await expect(listIssues({ repo: "foo/bar" })).rejects.toThrow(
      /authentication required/i,
    );
  });

  it("surfaces a clear timeout error", async () => {
    const err = Object.assign(new Error("timed out"), {
      code: "ETIMEDOUT",
      killed: true,
      signal: "SIGTERM",
    }) as NodeJS.ErrnoException;
    mockFail(err);
    await expect(listIssues({ repo: "foo/bar" })).rejects.toThrow(/timed out/);
  });

  it("surfaces generic gh failure with stderr context", async () => {
    const err = Object.assign(new Error("exit 1"), {
      code: 1,
    }) as NodeJS.ErrnoException;
    mockFail(err, "GraphQL: Could not resolve to a Repository");
    await expect(listIssues({ repo: "foo/bar" })).rejects.toThrow(
      /Could not resolve to a Repository/,
    );
  });

  it("ghAuthStatus returns { authenticated: false } on non-ENOENT failure", async () => {
    const err = Object.assign(new Error("exit 1"), {
      code: 1,
    }) as NodeJS.ErrnoException;
    mockFail(err, "You are not logged into any GitHub hosts");
    expect(await ghAuthStatus()).toEqual({ authenticated: false });
  });

  it("ghAuthStatus throws when gh binary is missing", async () => {
    const err = Object.assign(new Error("spawn ENOENT"), {
      code: "ENOENT",
    }) as NodeJS.ErrnoException;
    mockFail(err);
    await expect(ghAuthStatus()).rejects.toThrow(/gh CLI not found/);
  });

  it("ghAuthStatus parses the username from gh output", async () => {
    mockOk(
      "",
      "github.com\n  ✓ Logged in to github.com account alice (oauth_token)\n",
    );
    const result = await ghAuthStatus();
    expect(result.authenticated).toBe(true);
    expect(result.user).toBe("alice");
  });

  it("ghAuthStatus reports authenticated without user when no name found", async () => {
    mockOk("", "github.com\n  ✓ Logged in\n");
    const result = await ghAuthStatus();
    expect(result).toEqual({ authenticated: true });
  });
});

describe("listOpenSiegePRIssueNumbers", () => {
  it("calls gh with --state open and returns issue numbers parsed from siege/issue-N heads", async () => {
    mockOk(
      JSON.stringify([
        { headRefName: "siege/issue-12" },
        { headRefName: "feature/unrelated" },
        { headRefName: "siege/issue-45" },
        { headRefName: "siege/issue-" },
        { headRefName: "siege/issue-x" },
      ]),
    );
    const result = await listOpenSiegePRIssueNumbers("foo/bar");
    expect(result).toEqual([12, 45]);

    const { args } = lastCall();
    expect(args).toEqual([
      "pr",
      "list",
      "-R",
      "foo/bar",
      "--state",
      "open",
      "--limit",
      "1000",
      "--json",
      "headRefName",
    ]);
  });

  it("returns [] when there are no open PRs", async () => {
    mockOk("[]");
    expect(await listOpenSiegePRIssueNumbers("foo/bar")).toEqual([]);
  });

  it("rejects malformed repo", async () => {
    await expect(listOpenSiegePRIssueNumbers("nope")).rejects.toThrow(
      /invalid repo/,
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe("listIssuesAcrossRepos", () => {
  it("returns [] items and [] errors when given no repos", async () => {
    const result = await listIssuesAcrossRepos([]);
    expect(result).toEqual({ items: [], errors: [] });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("fans out per repo and merges results", async () => {
    const calls: { args: string[] }[] = [];
    execFileMock.mockImplementation((...rest: unknown[]) => {
      const args = rest[1] as string[];
      const cb = rest[rest.length - 1] as ExecFileArgs[3];
      calls.push({ args });

      if (args[0] === "issue") {
        const repo = args[args.indexOf("-R") + 1];
        if (repo === "foo/a") {
          cb(
            null,
            JSON.stringify([
              {
                number: 1,
                title: "A1",
                body: "",
                url: "https://gh/foo/a/1",
                labels: [],
                assignees: [],
                state: "OPEN",
              },
            ]),
            "",
          );
        } else if (repo === "foo/b") {
          cb(
            null,
            JSON.stringify([
              {
                number: 2,
                title: "B2",
                body: "",
                url: "https://gh/foo/b/2",
                labels: [],
                assignees: [],
                state: "OPEN",
              },
            ]),
            "",
          );
        } else {
          cb(null, "[]", "");
        }
        return;
      }
      if (args[0] === "pr") {
        const repo = args[args.indexOf("-R") + 1];
        if (repo === "foo/a") {
          cb(null, JSON.stringify([{ headRefName: "siege/issue-1" }]), "");
        } else {
          cb(null, "[]", "");
        }
        return;
      }
      cb(new Error("unexpected"), "", "");
    });

    const result = await listIssuesAcrossRepos([
      { repo: "foo/a" },
      { repo: "foo/b" },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(2);
    const aResult = result.items.find((r) => r.repo === "foo/a");
    const bResult = result.items.find((r) => r.repo === "foo/b");
    expect(aResult?.issues.map((i) => i.number)).toEqual([1]);
    expect(aResult?.openSiegeIssueNumbers).toEqual([1]);
    expect(bResult?.issues.map((i) => i.number)).toEqual([2]);
    expect(bResult?.openSiegeIssueNumbers).toEqual([]);

    // Exactly 2 gh calls per repo (issues + PRs) — N+1 prevention
    const repoACalls = calls.filter((c) => c.args.includes("foo/a"));
    const repoBCalls = calls.filter((c) => c.args.includes("foo/b"));
    expect(repoACalls).toHaveLength(2);
    expect(repoBCalls).toHaveLength(2);
  });

  it("passes search filter through to listIssues", async () => {
    const calls: string[][] = [];
    execFileMock.mockImplementation((...rest: unknown[]) => {
      const args = rest[1] as string[];
      const cb = rest[rest.length - 1] as ExecFileArgs[3];
      calls.push(args);
      if (args[0] === "issue") cb(null, "[]", "");
      else cb(null, "[]", "");
    });

    await listIssuesAcrossRepos([
      { repo: "foo/a", search: "label:overnight-ok state:open" },
    ]);

    const issueCall = calls.find((c) => c[0] === "issue");
    expect(issueCall).toBeDefined();
    expect(issueCall).toContain("--search");
    expect(issueCall).toContain("label:overnight-ok state:open");
  });

  it("collects errors per repo via allSettled without short-circuiting", async () => {
    execFileMock.mockImplementation((...rest: unknown[]) => {
      const args = rest[1] as string[];
      const cb = rest[rest.length - 1] as ExecFileArgs[3];
      const repo = args[args.indexOf("-R") + 1];
      if (repo === "foo/broken") {
        const err = Object.assign(new Error("exit 1"), {
          code: 1,
        }) as NodeJS.ErrnoException;
        cb(err, "", "API rate limit exceeded");
        return;
      }
      if (args[0] === "issue") {
        cb(
          null,
          JSON.stringify([
            {
              number: 7,
              title: "ok",
              body: "",
              url: "u",
              labels: [],
              assignees: [],
              state: "OPEN",
            },
          ]),
          "",
        );
      } else {
        cb(null, "[]", "");
      }
    });

    const result = await listIssuesAcrossRepos([
      { repo: "foo/ok" },
      { repo: "foo/broken" },
    ]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].repo).toBe("foo/ok");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].repo).toBe("foo/broken");
    expect(result.errors[0].message).toMatch(/rate limit/i);
  });
});
