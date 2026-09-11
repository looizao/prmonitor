import { Octokit } from "@octokit/rest";
import type { RestEndpointMethodTypes } from "@octokit/rest";
type GetResponseDataTypeFromEndpointMethod<
  T extends (...args: never[]) => unknown,
> = Awaited<ReturnType<T>> extends { data: infer D } ? D : never;

/**
 * A simple wrapper around GitHub's API.
 */
export interface GitHubApi {
  /**
   * Returns the information about the current authenticated user.
   */
  loadAuthenticatedUser(): Promise<
    GetResponseDataTypeFromEndpointMethod<Octokit["users"]["getAuthenticated"]>
  >;

  /**
   * Returns the full list of pull requests matching a given query.
   */
  searchPullRequests(query: string): Promise<
    // Note: There might be a more efficient way to represent this type.
    RestEndpointMethodTypes["search"]["issuesAndPullRequests"]["response"]["data"]["items"]
  >;

  /**
   * Returns the details of a pull request.
   */
  loadPullRequestDetails(
    pr: PullRequestReference,
  ): Promise<GetResponseDataTypeFromEndpointMethod<Octokit["pulls"]["get"]>>;

  /**
   * Returns the full list of reviews for a pull request.
   */
  loadReviews(
    pr: PullRequestReference,
  ): Promise<
    GetResponseDataTypeFromEndpointMethod<Octokit["pulls"]["listReviews"]>
  >;

  /**
   * Returns the full list of comments for a pull request.
   */
  loadComments(
    pr: PullRequestReference,
  ): Promise<
    GetResponseDataTypeFromEndpointMethod<Octokit["issues"]["listComments"]>
  >;

  /**
   * Returns the full list of commits for a pull request.
   */
  loadCommits(
    pr: PullRequestReference,
  ): Promise<
    GetResponseDataTypeFromEndpointMethod<Octokit["pulls"]["listCommits"]>
  >;

  /**
   * Returns the current status fields for a pull request.
   */
  loadPullRequestStatus(pr: PullRequestReference): Promise<PullRequestStatus>;
}

// Ref: https://docs.github.com/en/graphql/reference/enums#pullrequestreviewdecision
export type ReviewDecision =
  "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";

// Ref: https://docs.github.com/en/graphql/reference/enums#statusstate
export type CheckStatus =
  "ERROR" | "EXPECTED" | "FAILURE" | "PENDING" | "SUCCESS";

export interface PullRequestStatus {
  reviewDecision: ReviewDecision;
  checkStatus?: CheckStatus;
}

export interface RepoReference {
  owner: string;
  name: string;
}

export interface PullRequestReference {
  accountId?: string;
  repo: RepoReference;
  number: number;
}
