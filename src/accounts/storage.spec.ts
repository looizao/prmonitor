import { ACCOUNTS_KEY, emptyCollection, loadAndMigrate } from "./storage";
import { MemoryStorage } from "../testing/memory-storage";
import { fakePullRequest } from "../testing/fake-pr";
import { notificationKey } from "./model";
const pr = fakePullRequest().build();
const legacy = () =>
  new MemoryStorage({
    gitHubApiToken: JSON.stringify("fixture-legacy"),
    lastCheck: JSON.stringify({
      userLogin: "reviewer",
      openPullRequests: [pr],
    }),
    mute: JSON.stringify({
      mutedPullRequests: [
        {
          repo: { owner: pr.repoOwner, name: pr.repoName },
          number: pr.pullRequestNumber,
          until: { kind: "forever" },
        },
      ],
      ignored: { engineering: { kind: "ignore-all" } },
      notifyNewCommits: true,
    }),
    lastSeenPullRequests: JSON.stringify([pr.htmlUrl]),
  });
describe("legacy migration", () => {
  it("atomically preserves credentials, cached PRs, rules, and notification history", async () => {
    const storage = legacy();
    const result = await loadAndMigrate(storage);
    const data = result.data["legacy-github"];
    expect(result.accounts[0]).toMatchObject({
      id: "legacy-github",
      token: "fixture-legacy",
      serverUrl: "https://github.com",
    });
    expect(data.loaded!.openPullRequests[0]).toMatchObject({
      accountId: "legacy-github",
      currentUserLogin: "reviewer",
    });
    expect(data.mute.mutedPullRequests[0].accountId).toBe("legacy-github");
    expect(data.mute.ignored).toEqual({ engineering: { kind: "ignore-all" } });
    expect(data.mute.notifyNewCommits).toBe(true);
    expect(data.notified).toEqual([
      notificationKey(data.loaded!.openPullRequests[0]),
    ]);
    expect(Object.values(data.notificationTargets)).toEqual([pr.htmlUrl]);
    expect(storage.values.gitHubApiToken).toBeUndefined();
  });
  it("also accepts legacy values stored without JSON serialization", async () => {
    const storage = new MemoryStorage({ gitHubApiToken: "fixture-raw" });
    expect((await loadAndMigrate(storage)).accounts[0].token).toBe(
      "fixture-raw",
    );
  });
  it("is idempotent across extension restarts", async () => {
    const storage = legacy();
    const first = await loadAndMigrate(storage);
    expect(await loadAndMigrate(storage)).toEqual(first);
  });
  it("never removes legacy credentials if the new write fails", async () => {
    const storage = legacy();
    storage.failWrite = true;
    await expect(loadAndMigrate(storage)).rejects.toThrow();
    expect(storage.values.gitHubApiToken).toBeDefined();
    expect(storage.values[ACCOUNTS_KEY]).toBeUndefined();
    storage.failWrite = false;
    expect((await loadAndMigrate(storage)).accounts).toHaveLength(1);
  });
  it("retries interrupted legacy cleanup without duplicating accounts", async () => {
    const storage = legacy();
    storage.failRemove = true;
    await expect(loadAndMigrate(storage)).rejects.toThrow();
    expect(storage.values[ACCOUNTS_KEY]).toBeDefined();
    storage.failRemove = false;
    expect((await loadAndMigrate(storage)).accounts).toHaveLength(1);
    expect(storage.values.gitHubApiToken).toBeUndefined();
  });
  it("prefers a committed collection and does not resurrect removed accounts", async () => {
    const storage = legacy();
    storage.values[ACCOUNTS_KEY] = emptyCollection();
    expect((await loadAndMigrate(storage)).accounts).toHaveLength(0);
  });
});

it("migrates a legacy token when an unmarked new collection is empty", async () => {
  const storage = legacy();
  storage.values[ACCOUNTS_KEY] = { version: 1, accounts: [], data: {} };
  expect((await loadAndMigrate(storage)).accounts[0].id).toBe("legacy-github");
});
it("preserves compatible notification history without a PR cache", async () => {
  const url = "https://github.com/engineering/platform/pull/42";
  const storage = new MemoryStorage({
    gitHubApiToken: "fixture",
    lastSeenPullRequests: [url],
  });
  const result = await loadAndMigrate(storage);
  expect(result.data["legacy-github"].notified).toEqual([
    "legacy-github:github:engineering/platform:42",
  ]);
  expect(
    Object.values(result.data["legacy-github"].notificationTargets),
  ).toEqual([url]);
});
