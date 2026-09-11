import {
  buildAccountLoader,
  loadGitHubAccount,
} from "../loading/implementation";
import { loadAzureDevOpsAccount, azureVote } from "./azure";
import { fixtureFetch, jsonResponse } from "../testing/provider-fixtures";
import { safeError } from "./http";
import type { AccountConfig } from "../accounts/model";
const github = (
  serverUrl = "https://github.com",
): Extract<AccountConfig, { provider: "github" }> => ({
  id: "github",
  name: "GitHub",
  provider: "github",
  enabled: true,
  token: "fixture",
  serverUrl,
});
const azure = (
  organizationUrl = "https://dev.azure.com/example",
): Extract<AccountConfig, { provider: "azure-devops" }> => ({
  id: "azure",
  name: "Azure",
  provider: "azure-devops",
  enabled: true,
  token: "fixture",
  organizationUrl,
});
describe("provider contracts", () => {
  it.each([
    "https://github.com",
    "https://github.enterprise.test",
    "http://git.test:8080/prefix",
  ])("loads a complete GitHub account at %s", async (url) => {
    const fetcher = vi.fn(fixtureFetch());
    const state = await loadGitHubAccount(github(url), fetcher);
    expect(state.userLogin).toBe("reviewer");
    expect(state.openPullRequests).toHaveLength(1);
    expect(state.openPullRequests[0]).toMatchObject({
      accountId: "github",
      accountName: "GitHub",
      provider: "github",
      currentUserLogin: "reviewer",
      checkStatus: "SUCCESS",
    });
    expect(state.openPullRequests[0].htmlUrl).toBe(
      `${url}/engineering/platform/pull/42`,
    );
    expect(
      fetcher.mock.calls.every(([, init]) => init?.redirect === "error"),
    ).toBe(true);
  });
  it("follows GitHub pagination", async () =>
    expect(
      (
        await loadGitHubAccount(
          github(),
          fixtureFetch({ githubPagination: true }),
        )
      ).openPullRequests.map((pr) => pr.pullRequestNumber),
    ).toEqual([42, 43]));
  it("blocks credential forwarding through foreign pagination links", async () => {
    const fetcher = vi.fn(
      fixtureFetch({ githubPagination: true, foreignPagination: true }),
    );
    await expect(loadGitHubAccount(github(), fetcher)).rejects.toThrow();
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("untrusted")),
    ).toBe(false);
  });
  it("uses REST statuses and checks when Enterprise GraphQL is unavailable", async () => {
    const result = await loadGitHubAccount(
      github("https://git.test"),
      fixtureFetch({ graphqlUnavailable: true }),
    );
    expect(result.openPullRequests[0].checkStatus).toBe("SUCCESS");
  });
  it.each([
    "https://dev.azure.com/example",
    "https://example.visualstudio.com",
    "http://server.test:8080/tfs/DefaultCollection",
  ])("loads Azure at %s with Basic PAT auth and correct URLs", async (url) => {
    const fetcher = vi.fn(fixtureFetch());
    const state = await loadAzureDevOpsAccount(azure(url), fetcher);
    const pr = state.openPullRequests[0];
    expect(state.userLogin).toBe("user-reviewer");
    expect(pr.htmlUrl).toBe(`${url}/Engineering/_git/platform/pullrequest/42`);
    expect(pr.changeSummary).toBeUndefined();
    expect(pr.updatedAt).toBe("2026-09-11T12:00:00Z");
    expect(pr.comments).toHaveLength(1);
    expect(pr.commits).toHaveLength(1);
    expect(
      fetcher.mock.calls.every(
        ([, init]) =>
          new Headers(init?.headers).get("authorization") ===
          `Basic ${btoa(":fixture")}`,
      ),
    ).toBe(true);
  });
  it.each([
    [10, "APPROVED"],
    [5, "APPROVED"],
    [0, "PENDING"],
    [-5, "CHANGES_REQUESTED"],
    [-10, "CHANGES_REQUESTED"],
    [2, "PENDING"],
  ] as const)("maps Azure vote %s", (vote, state) =>
    expect(azureVote(vote)).toBe(state),
  );
  it("follows Azure project continuation tokens", async () => {
    const fetcher = vi.fn(fixtureFetch({ azurePagination: true }));
    await loadAzureDevOpsAccount(azure(), fetcher);
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).includes("continuationToken=next-project"),
      ),
    ).toBe(true);
  });
  it("uses offsets for Azure PR pagination", async () => {
    const base = fixtureFetch();
    let requests = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/_apis/git/pullrequests")) {
        requests++;
        if (url.searchParams.get("$skip") === "100")
          return jsonResponse({ value: [] });
        const response = await base(input, init);
        const body = await response.json();
        return jsonResponse({
          value: Array.from({ length: 100 }, (_, i) => ({
            ...body.value[0],
            pullRequestId: i + 1,
          })),
        });
      }
      return base(input, init);
    };
    expect(
      (await loadAzureDevOpsAccount(azure(), fetcher)).openPullRequests,
    ).toHaveLength(100);
    expect(requests).toBe(2);
  });
  it("retains a healthy Azure project when another is forbidden", async () => {
    const state = await loadAzureDevOpsAccount(
      azure(),
      fixtureFetch({ failedProject: true }),
    );
    expect(state.openPullRequests).toHaveLength(1);
    expect(state.failedProjects).toEqual(["Forbidden"]);
    expect(state.error).toContain("1 project");
  });
  it("handles invalid tokens and rate limits without response or credential leakage", async () => {
    for (const provider of [github(), azure()])
      for (const options of [{ invalidToken: true }, { rateLimited: true }]) {
        try {
          await buildAccountLoader(fixtureFetch(options))(provider);
          throw new Error("expected failure");
        } catch (error) {
          expect(safeError(error)).toMatch(/authentication failed|rate limit/);
          expect(safeError(error)).not.toContain("fixture");
        }
      }
    expect(safeError(new Error("Authorization: fixture-secret"))).not.toContain(
      "fixture-secret",
    );
  });
});

it("detects GitHub search truncation and secondary rate limits", async () => {
  const base = fixtureFetch();
  const fetcher: typeof fetch = async (input, init) => {
    const response = await base(input, init);
    if (String(input).includes("/search/issues")) {
      const body = await response.json();
      const truncated = jsonResponse({ ...body, incomplete_results: true });
      Object.defineProperty(truncated, "url", { value: String(input) });
      return truncated;
    }
    return response;
  };
  await expect(loadGitHubAccount(github(), fetcher)).rejects.toMatchObject({
    status: 422,
  });
  expect(
    safeError({ status: 403, response: { headers: { "retry-after": "60" } } }),
  ).toContain("rate limit");
});
