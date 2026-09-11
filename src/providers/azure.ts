import type { AccountConfig, AccountLoadedState } from "../accounts/model";
import { repositoryUrl } from "../accounts/urls";
import type { PullRequest, ReviewState } from "../storage/loaded-state";
import { ProviderError, scopedFetch } from "./http";

type AzureAccount = Extract<AccountConfig, { provider: "azure-devops" }>;
interface Identity {
  id: string;
  displayName?: string;
  providerDisplayName?: string;
  customDisplayName?: string;
  uniqueName?: string;
}
interface AzurePR {
  pullRequestId: number;
  title: string;
  creationDate: string;
  isDraft?: boolean;
  mergeStatus?: string;
  repository: {
    id: string;
    name: string;
    project: { id: string; name: string };
  };
  createdBy: Identity;
  reviewers: (Identity & { vote: number; votedFor?: Identity[] })[];
}
interface Thread {
  publishedDate?: string;
  lastUpdatedDate?: string;
  comments?: {
    author: Identity;
    publishedDate: string;
    commentType?: string;
    isDeleted?: boolean;
  }[];
}
interface Commit {
  commitId: string;
  author: { name?: string; email?: string; date?: string };
  committer?: { date?: string };
}
interface Status {
  context?: { genre?: string; name?: string };
  state: string;
}
export function azureVote(vote: number): ReviewState {
  if (vote === 10 || vote === 5) return "APPROVED";
  if (vote === -5 || vote === -10) return "CHANGES_REQUESTED";
  return "PENDING";
}
export function mapAzurePR(
  account: AzureAccount,
  user: Identity,
  pr: AzurePR,
  threads: Thread[],
  commits: Commit[],
  statuses: Status[],
): PullRequest {
  const comments = threads.flatMap((t) =>
    (t.comments ?? [])
      .filter(
        (c) => !c.isDeleted && (!c.commentType || c.commentType === "text"),
      )
      .map((c) => ({ authorLogin: c.author.id, createdAt: c.publishedDate })),
  );
  const reviewStates = pr.reviewers.map((r) => azureVote(r.vote));
  const dates = [
    pr.creationDate,
    ...threads.flatMap((t) => [
      t.lastUpdatedDate ?? t.publishedDate ?? pr.creationDate,
    ]),
    ...commits.map(
      (c) => c.committer?.date ?? c.author.date ?? pr.creationDate,
    ),
  ];
  const latestStatuses = new Map(
    statuses.map((s) => [`${s.context?.genre}/${s.context?.name}`, s.state]),
  );
  const states = [...latestStatuses.values()];
  return {
    accountId: account.id,
    accountName: account.name,
    provider: "azure-devops",
    currentUserLogin: user.id,
    nodeId: String(pr.pullRequestId),
    repoOwner: pr.repository.project.name,
    repoName: pr.repository.name,
    pullRequestNumber: pr.pullRequestId,
    htmlUrl: `${repositoryUrl(account, pr.repository.project.name, pr.repository.name)}/pullrequest/${pr.pullRequestId}`,
    title: pr.title,
    updatedAt: dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0],
    draft: pr.isDraft,
    mergeable: pr.mergeStatus === "succeeded",
    author: { login: pr.createdBy.id, avatarUrl: "" },
    reviewRequested: pr.reviewers.some((r) => r.id === user.id && r.vote === 0),
    requestedReviewers: pr.reviewers
      .filter((r) => r.vote === 0)
      .map((r) => r.id),
    reviews: pr.reviewers
      .filter((r) => r.vote !== 0)
      .map((r) => ({ authorLogin: r.id, state: azureVote(r.vote) })),
    comments,
    commits: commits.map((c) => ({
      authorLogin: pr.createdBy.id,
      createdAt: c.committer?.date ?? c.author.date,
    })),
    reviewDecision: reviewStates.includes("CHANGES_REQUESTED")
      ? "CHANGES_REQUESTED"
      : reviewStates.includes("APPROVED")
        ? "APPROVED"
        : "REVIEW_REQUIRED",
    checkStatus:
      states.includes("failed") || states.includes("error")
        ? "FAILURE"
        : states.includes("pending")
          ? "PENDING"
          : states.includes("succeeded")
            ? "SUCCESS"
            : undefined,
  };
}
export async function loadAzureDevOpsAccount(
  account: AzureAccount,
  fetcher: typeof fetch = fetch,
): Promise<AccountLoadedState> {
  const request = scopedFetch(account.organizationUrl, fetcher);
  async function get<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<{ value: T; continuation: string | null }> {
    const url = new URL(`${account.organizationUrl}/${path}`);
    // 6.0 also supports Azure DevOps Server 2020 and newer.
    url.search = new URLSearchParams({
      "api-version": "6.0",
      ...params,
    }).toString();
    const response = await request(url, {
      headers: { Authorization: `Basic ${btoa(`:${account.token}`)}` },
    });
    if (!response.ok) throw new ProviderError(response.status);
    return {
      value: (await response.json()) as T,
      continuation: response.headers.get("x-ms-continuationtoken"),
    };
  }
  async function list<T>(
    path: string,
    params: Record<string, string> = {},
    offset = false,
  ): Promise<T[]> {
    const values: T[] = [];
    let continuation: string | null = null;
    const seen = new Set<string>();
    let more = true;
    while (more) {
      const page: { value: { value: T[] }; continuation: string | null } =
        await get(path, {
          $top: "100",
          ...params,
          ...(continuation ? { continuationToken: continuation } : {}),
          ...(offset ? { $skip: String(values.length) } : {}),
        });
      values.push(...page.value.value);
      continuation = page.continuation;
      if (continuation) {
        if (seen.has(continuation)) throw new ProviderError(502);
        seen.add(continuation);
      } else more = offset && page.value.value.length === 100;
    }
    return values;
  }
  const connection = (
    await get<{ authenticatedUser: Identity }>("_apis/connectionData")
  ).value;
  const user = connection.authenticatedUser;
  if (!user?.id) throw new ProviderError(401);
  const projects = await list<{ id: string; name: string }>("_apis/projects");
  const results: PullRequest[] = [];
  const failedProjects: string[] = [];
  let statusUnavailable = false;
  // Bound Azure fan-out to avoid flooding large collections.
  for (const project of projects) {
    try {
      const prs = await list<AzurePR>(
        `${encodeURIComponent(project.id)}/_apis/git/pullrequests`,
        { "searchCriteria.status": "active" },
        true,
      );
      const projectResults: PullRequest[] = [];
      for (const pr of prs) {
        const prefix = `${encodeURIComponent(project.id)}/_apis/git/repositories/${encodeURIComponent(pr.repository.id)}/pullRequests/${pr.pullRequestId}`;
        const [threads, commits] = await Promise.all([
          list<Thread>(`${prefix}/threads`),
          list<Commit>(`${prefix}/commits`),
        ]);
        let statuses: Status[] = [];
        try {
          statuses = await list<Status>(`${prefix}/statuses`);
        } catch {
          statusUnavailable = true;
        }
        projectResults.push(
          mapAzurePR(account, user, pr, threads, commits, statuses),
        );
      }
      results.push(...projectResults);
    } catch {
      failedProjects.push(project.name);
    }
  }
  if (projects.length && failedProjects.length === projects.length)
    throw new ProviderError(403);
  return {
    accountId: account.id,
    accountName: account.name,
    provider: account.provider,
    userLogin: user.id,
    userDisplayName:
      user.customDisplayName || user.providerDisplayName || user.displayName,
    openPullRequests: results,
    lastSuccessfulRefresh: Date.now(),
    failedProjects,
    error: failedProjects.length
      ? `${failedProjects.length} project(s) unavailable; cached results retained`
      : statusUnavailable
        ? "Some check statuses unavailable"
        : undefined,
  };
}
