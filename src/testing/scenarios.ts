import { emptyAccountData, emptyCollection } from "../accounts/storage";
import type { AccountConfig } from "../accounts/model";
import { fakePullRequest } from "./fake-pr";
export function fixtureCollection(fixture: string) {
  const collection = emptyCollection();
  if (fixture === "no-accounts") return collection;
  const accounts: AccountConfig[] = [
    {
      id: "github",
      name: "Personal GitHub",
      provider: "github",
      serverUrl: "https://github.com",
      token: "fixture-only",
      enabled: true,
    },
    {
      id: "enterprise",
      name: "Acme Engineering",
      provider: "github",
      serverUrl: "https://github.example.test",
      token: "fixture-only",
      enabled: true,
    },
    {
      id: "azure",
      name: "Platform Azure",
      provider: "azure-devops",
      organizationUrl: "https://dev.azure.com/example",
      token: "fixture-only",
      enabled: true,
    },
    {
      id: "server",
      name: "Internal DevOps",
      provider: "azure-devops",
      organizationUrl: "http://devops.example.test:8080/tfs/DefaultCollection",
      token: "fixture-only",
      enabled: true,
    },
  ];
  collection.accounts =
    fixture === "github-account"
      ? accounts.slice(0, 1)
      : fixture === "enterprise-account"
        ? [accounts[1]]
        : fixture === "azure-account"
          ? [accounts[2]]
          : fixture === "server-account"
            ? [accounts[3]]
            : accounts;
  if (fixture === "disabled-account") collection.accounts[0].enabled = false;
  for (const [index, a] of collection.accounts.entries()) {
    const data = emptyAccountData();
    data.loaded = {
      accountId: a.id,
      accountName: a.name,
      provider: a.provider,
      userLogin: "reviewer",
      userDisplayName: "Alex Reviewer",
      lastSuccessfulRefresh: 1789142400000,
      openPullRequests:
        fixture === "empty-pr-list"
          ? []
          : Array.from(
              { length: fixture === "large-pr-list" ? 75 : 1 },
              (_, i) => ({
                ...fakePullRequest()
                  .author("teammate")
                  .seenAs("reviewer")
                  .reviewRequested(["reviewer"])
                  .build(),
                accountId: a.id,
                accountName: a.name,
                provider: a.provider,
                currentUserLogin: "reviewer",
                nodeId: `fixture-${index}-${i}`,
                title: [
                  "Improve account refresh reliability",
                  "Add deployment health checks",
                  "Simplify project onboarding",
                  "Update release documentation",
                ][index],
                repoOwner: "engineering",
                repoName: "platform",
                pullRequestNumber: 42 + i,
                updatedAt: new Date(
                  1789142400000 - index * 3600000 - i * 60000,
                ).toISOString(),
                htmlUrl: "https://example.test/engineering/platform/pull/42",
                changeSummary:
                  a.provider === "github"
                    ? { changedFiles: 4, additions: 85, deletions: 23 }
                    : undefined,
              }),
            ),
    };
    if (fixture === "partial-failure" && a.id === "azure")
      data.loaded.error = "authentication failed; check the token";
    collection.data[a.id] = data;
  }
  return collection;
}
