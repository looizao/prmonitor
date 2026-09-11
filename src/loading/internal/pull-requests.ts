import type { AccountConfig } from "../../accounts/model";
import { RestEndpointMethodTypes } from "@octokit/rest";
import {
  GitHubApi,
  PullRequestReference,
  PullRequestStatus,
  RepoReference,
} from "../../github-api/api";
import { nonEmptyItems } from "../../helpers";
import {
  Comment,
  Commit,
  PullRequest,
  Review,
  ReviewState,
} from "../../storage/loaded-state";

/**
 * Refreshes the list of pull requests for a list of repositories.
 *
 * This optimizes for the minimum number of API requests to GitHub as
 * brute-forcing would quickly go over API rate limits if the user has several
 * hundred repositories or many pull requests opened.
 */
export async function refreshOpenPullRequests(
  githubApi: GitHubApi,
  userLogin: string,
  account?: AccountConfig,
): Promise<PullRequest[]> {
  // Note: each query should specifically exclude the previous ones so we don't end up having
  // to deduplicate PRs across lists.
  const reviewRequestedPullRequests = await githubApi.searchPullRequests(
    `review-requested:${userLogin} -author:${userLogin} is:open archived:false`,
  );
  const commentedPullRequests = await githubApi.searchPullRequests(
    `commenter:${userLogin} -author:${userLogin} -review-requested:${userLogin} is:open archived:false`,
  );
  const ownPullRequests = await githubApi.searchPullRequests(
    `author:${userLogin} is:open archived:false`,
  );
  const pending = [
    ...reviewRequestedPullRequests.map((pr) => ({ pr, requested: true })),
    ...commentedPullRequests.map((pr) => ({ pr, requested: false })),
    ...ownPullRequests.map((pr) => ({ pr, requested: false })),
  ];
  const results: PullRequest[] = [];
  // Each PR loads five resources. Bound fan-out instead of starting every PR at once.
  for (let offset = 0; offset < pending.length; offset += 2) {
    results.push(
      ...(await Promise.all(
        pending
          .slice(offset, offset + 2)
          .map(({ pr, requested }) =>
            updateCommentsAndReviews(githubApi, pr, requested),
          ),
      )),
    );
  }
  return results.map((pr) => ({
    ...pr,
    accountId: account?.id || "legacy-github",
    accountName: account?.name || "GitHub.com",
    provider: "github",
    currentUserLogin: userLogin,
  }));
}

async function updateCommentsAndReviews(
  githubApi: GitHubApi,
  rawPullRequest: RestEndpointMethodTypes["search"]["issuesAndPullRequests"]["response"]["data"]["items"][number],
  isReviewRequested = false,
): Promise<PullRequest> {
  const repo = extractRepo(rawPullRequest);
  const pr: PullRequestReference = {
    repo,
    number: rawPullRequest.number,
  };
  const [
    freshPullRequestDetails,
    freshReviews,
    freshComments,
    freshCommits,
    pullRequestStatus,
  ] = await Promise.all([
    githubApi.loadPullRequestDetails(pr),
    githubApi.loadReviews(pr).then((reviews) =>
      reviews.map((review) => ({
        authorLogin: review.user ? review.user.login : "",
        state: review.state as ReviewState,
        submittedAt: review.submitted_at,
      })),
    ),
    githubApi.loadComments(pr).then((comments) =>
      comments.map((comment) => ({
        authorLogin: comment.user ? comment.user.login : "",
        createdAt: comment.created_at,
      })),
    ),
    githubApi.loadCommits(pr).then((commits) =>
      commits.map((commit) => ({
        authorLogin: commit.author ? commit.author.login : "",
        createdAt: commit.commit.author?.date,
      })),
    ),
    githubApi.loadPullRequestStatus(pr),
  ]);

  return pullRequestFromResponse(
    rawPullRequest,
    freshPullRequestDetails,
    freshReviews,
    freshComments,
    freshCommits,
    isReviewRequested,
    pullRequestStatus,
  );
}

function pullRequestFromResponse(
  response: RestEndpointMethodTypes["search"]["issuesAndPullRequests"]["response"]["data"]["items"][number],
  details: RestEndpointMethodTypes["pulls"]["get"]["response"]["data"],
  reviews: Review[],
  comments: Comment[],
  commits: Commit[],
  reviewRequested: boolean,
  status: PullRequestStatus,
): PullRequest {
  const repo = extractRepo(response);
  return {
    accountId: "legacy-github",
    accountName: "GitHub.com",
    provider: "github",
    currentUserLogin: "",
    nodeId: response.node_id,
    htmlUrl: response.html_url,
    repoOwner: repo.owner,
    repoName: repo.name,
    pullRequestNumber: response.number,
    updatedAt: response.updated_at,
    author: response.user && {
      login: response.user.login,
      avatarUrl: response.user.avatar_url,
    },
    changeSummary: {
      changedFiles: details.changed_files,
      additions: details.additions,
      deletions: details.deletions,
    },
    title: response.title,
    draft: response.draft,
    mergeable: details.mergeable || false,
    reviewRequested,
    requestedReviewers: nonEmptyItems(
      details.requested_reviewers?.map((reviewer) => reviewer?.login),
    ),
    requestedTeams: nonEmptyItems(
      details.requested_teams?.map((team) => team?.name),
    ),
    reviews,
    comments,
    commits,
    reviewDecision: status.reviewDecision,
    checkStatus: status.checkStatus,
  };
}

function extractRepo(
  response: RestEndpointMethodTypes["search"]["issuesAndPullRequests"]["response"]["data"]["items"][number],
): RepoReference {
  const urlParts = response.repository_url.split("/");
  if (urlParts.length < 2) {
    throw new Error(`Unexpected repository_url: ${response.repository_url}`);
  }
  return {
    owner: urlParts[urlParts.length - 2],
    name: urlParts[urlParts.length - 1],
  };
}
