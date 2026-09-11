import { Octokit } from "@octokit/rest";
import type { GitHubApi, PullRequestStatus } from "./api";
import { githubEndpoints } from "../accounts/urls";
import { ProviderError, scopedFetch } from "../providers/http";

export function buildGitHubApi(
  token: string,
  serverUrl = "https://github.com",
  fetcher: typeof fetch = fetch,
): GitHubApi {
  const endpoints = githubEndpoints(serverUrl);
  const octokit = new Octokit({
    auth: token,
    baseUrl: endpoints.rest,
    request: { fetch: scopedFetch(endpoints.rest, fetcher) },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const params = (pr: Parameters<GitHubApi["loadPullRequestDetails"]>[0]) => ({
    owner: pr.repo.owner,
    repo: pr.repo.name,
    pull_number: pr.number,
    per_page: 100,
  });
  return {
    async loadAuthenticatedUser() {
      return (await octokit.users.getAuthenticated()).data;
    },
    async searchPullRequests(query) {
      const result = await octokit.paginate(
        octokit.search.issuesAndPullRequests,
        { q: `is:pr ${query}`, per_page: 100 },
        (response) => {
          const meta = response.data as typeof response.data & {
            incomplete_results?: boolean;
            total_count?: number;
          };
          if (meta.incomplete_results || (meta.total_count ?? 0) >= 1000)
            throw new ProviderError(422);
          return response.data;
        },
      );
      // GitHub search is capped at 1,000 results, never silently claim a complete list.
      if (result.length >= 1000) throw new ProviderError(422);
      return result;
    },
    async loadPullRequestDetails(pr) {
      return (await octokit.pulls.get(params(pr))).data;
    },
    loadReviews(pr) {
      return octokit.paginate(octokit.pulls.listReviews, params(pr));
    },
    loadComments(pr) {
      return octokit.paginate(octokit.issues.listComments, {
        ...params(pr),
        issue_number: pr.number,
      });
    },
    loadCommits(pr) {
      return octokit.paginate(octokit.pulls.listCommits, params(pr));
    },
    async loadPullRequestStatus(pr) {
      try {
        const response = await scopedFetch(endpoints.graphql, fetcher)(
          endpoints.graphql,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query:
                "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewDecision commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}",
              variables: {
                owner: pr.repo.owner,
                name: pr.repo.name,
                number: pr.number,
              },
            }),
          },
        );
        if (!response.ok)
          throw new ProviderError(
            response.status,
            response.headers.get("x-ratelimit-remaining") === "0",
          );
        const result = (await response.json()) as {
          errors?: { type?: string }[];
          data?: {
            repository: {
              pullRequest: {
                reviewDecision: PullRequestStatus["reviewDecision"];
                commits: {
                  nodes: {
                    commit: {
                      statusCheckRollup?: {
                        state: PullRequestStatus["checkStatus"];
                      };
                    };
                  }[];
                };
              };
            };
          };
        };
        if (result.errors?.some((error) => error.type === "RATE_LIMITED"))
          throw new ProviderError(429);
        if (result.errors || !result.data) throw new ProviderError(404);
        const value = result.data.repository.pullRequest;
        return {
          reviewDecision: value.reviewDecision,
          checkStatus: value.commits.nodes[0]?.commit.statusCheckRollup?.state,
        };
      } catch (error) {
        if (
          !(error instanceof ProviderError) ||
          ![400, 404, 501].includes(error.status)
        )
          throw error;
        // Older Enterprise installations may not expose the GraphQL fields.
        const details = (await octokit.pulls.get(params(pr))).data;
        const reviews = await octokit.paginate(
          octokit.pulls.listReviews,
          params(pr),
        );
        const latest = new Map(
          reviews
            .filter((r) => r.user && r.state !== "COMMENTED")
            .map((r) => [r.user!.login, r.state]),
        );
        const combined = (
          await octokit.repos.getCombinedStatusForRef({
            owner: pr.repo.owner,
            repo: pr.repo.name,
            ref: details.head.sha,
          })
        ).data;
        const checks = await octokit.paginate(octokit.checks.listForRef, {
          owner: pr.repo.owner,
          repo: pr.repo.name,
          ref: details.head.sha,
          per_page: 100,
        });
        const values = [...latest.values()];
        const failed = checks.some((c) =>
          [
            "failure",
            "timed_out",
            "cancelled",
            "action_required",
            "startup_failure",
          ].includes(c.conclusion || ""),
        );
        const pending = checks.some((c) => c.status !== "completed");
        const checkStatus =
          failed || combined.state === "failure"
            ? "FAILURE"
            : combined.state === "error"
              ? "ERROR"
              : pending ||
                  (combined.total_count > 0 && combined.state === "pending")
                ? "PENDING"
                : checks.length > 0 || combined.total_count > 0
                  ? "SUCCESS"
                  : undefined;
        return {
          reviewDecision: values.includes("CHANGES_REQUESTED")
            ? "CHANGES_REQUESTED"
            : values.includes("APPROVED")
              ? "APPROVED"
              : "REVIEW_REQUIRED",
          checkStatus,
        };
      }
    },
  };
}
