import "server-only";

import { listIssuesAcrossRepos, type RepoFetchError } from "@/lib/gh";
import { getLastAttempt, readRepos, type LastAttempt } from "@/lib/siege";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface QueueItem {
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: { name: string; color: string }[];
  siegeLabels: string[];
  hasOpenSiegePR: boolean;
  lastAttempt: LastAttempt | null;
}

interface QueueResponse {
  items: QueueItem[];
  fetchedAt: string;
  errors: RepoFetchError[];
}

const SIEGE_LABEL_RE = /^siege:/;

export async function GET(): Promise<Response> {
  let config;
  try {
    config = await readRepos();
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to read repos";
    return Response.json({ error: message }, { status: 500 });
  }

  const enabledIssueRepos = config.repos.filter(
    (r) => r.enabled === true && r.source === "issues",
  );

  const { items: repoResults, errors } = await listIssuesAcrossRepos(
    enabledIssueRepos.map((r) => ({
      repo: r.name,
      search: typeof r.filter === "string" ? r.filter : undefined,
    })),
  );

  const items: QueueItem[] = [];
  await Promise.all(
    repoResults.map(async (repoResult) => {
      const openSet = new Set(repoResult.openSiegeIssueNumbers);
      const attempts = await Promise.all(
        repoResult.issues.map((issue) =>
          getLastAttempt(repoResult.repo, issue.number).catch(() => null),
        ),
      );
      for (let i = 0; i < repoResult.issues.length; i++) {
        const issue = repoResult.issues[i];
        const siegeLabels = issue.labels
          .map((l) => l.name)
          .filter((name) => SIEGE_LABEL_RE.test(name));
        items.push({
          repo: repoResult.repo,
          number: issue.number,
          title: issue.title,
          url: issue.url,
          labels: issue.labels,
          siegeLabels,
          hasOpenSiegePR: openSet.has(issue.number),
          lastAttempt: attempts[i],
        });
      }
    }),
  );

  items.sort((a, b) => {
    if (a.repo !== b.repo) return a.repo < b.repo ? -1 : 1;
    return a.number - b.number;
  });

  const body: QueueResponse = {
    items,
    fetchedAt: new Date().toISOString(),
    errors,
  };
  return Response.json(body);
}
