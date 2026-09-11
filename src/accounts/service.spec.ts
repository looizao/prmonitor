import {
  AccountRepository,
  ACCOUNTS_KEY,
  emptyAccountData,
  emptyCollection,
} from "./storage";
import {
  AccountService,
  actionable,
  filtered,
  type AccountEffects,
} from "./service";
import {
  notificationKey,
  type AccountConfig,
  type AccountLoadedState,
  type AccountLoader,
} from "./model";
import { fixtureCollection } from "../testing/scenarios";
import { MemoryStorage } from "../testing/memory-storage";
import { handleCommand } from "./messages";
import { buildAccountLoader } from "../loading/implementation";
import { fixtureFetch } from "../testing/provider-fixtures";
import { ref } from "../storage/loaded-state";

function harness(
  accounts = fixtureCollection("multiple-accounts").accounts,
  loader?: AccountLoader,
) {
  const collection = emptyCollection();
  collection.accounts = accounts;
  accounts.forEach((a) => (collection.data[a.id] = emptyAccountData()));
  const storage = new MemoryStorage({ [ACCOUNTS_KEY]: collection });
  const repository = new AccountRepository(storage);
  const effects: AccountEffects = {
    hasPermission: vi.fn(async () => true),
    revokePermission: vi.fn(async () => true),
    notify: vi.fn(async () => {}),
    clearNotification: vi.fn(async () => {}),
    badge: vi.fn(async () => {}),
  };
  const accountLoader = vi.fn(loader ?? buildAccountLoader(fixtureFetch()));
  const service = new AccountService(repository, accountLoader, effects);
  return { storage, repository, effects, loader: accountLoader, service };
}
const single = () => fixtureCollection("github-account").accounts;
describe("multi-account lifecycle", () => {
  it.each([
    [
      "two GitHub.com accounts",
      [
        { ...single()[0], id: "one" },
        { ...single()[0], id: "two" },
      ],
    ],
    [
      "GitHub.com and Enterprise",
      fixtureCollection("multiple-accounts").accounts.slice(0, 2),
    ],
    [
      "GitHub and Azure",
      [
        fixtureCollection("multiple-accounts").accounts[0],
        fixtureCollection("multiple-accounts").accounts[2],
      ],
    ],
    [
      "two Azure organizations",
      [
        { ...fixtureCollection("azure-account").accounts[0], id: "one" },
        {
          ...fixtureCollection("azure-account").accounts[0],
          id: "two",
          organizationUrl: "https://dev.azure.com/second",
        },
      ],
    ],
  ] as [string, AccountConfig[]][])(
    "aggregates %s",
    async (_name, accounts) => {
      const h = harness(accounts);
      await h.service.refresh();
      const c = await h.repository.read();
      expect(actionable(c)).toHaveLength(2);
      expect(new Set(actionable(c).map(notificationKey)).size).toBe(2);
      expect(h.effects.badge).toHaveBeenLastCalledWith("2", false);
      expect(h.effects.notify).toHaveBeenCalledTimes(2);
    },
  );
  it("runs independent accounts concurrently and prevents overlapping refreshes", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((r) => (finish = r));
    const loader = async (a: AccountConfig) => {
      await pending;
      return buildAccountLoader(fixtureFetch())(a);
    };
    const h = harness(fixtureCollection("multiple-accounts").accounts, loader);
    const first = h.service.refresh();
    const second = h.service.refresh();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(h.loader).toHaveBeenCalledTimes(4));
    finish();
    await first;
  });
  it("preserves the failing account cache without losing healthy account data", async () => {
    const h = harness();
    await h.service.refresh();
    const before = await h.repository.read();
    h.loader.mockImplementation((a) =>
      a.id === "azure"
        ? Promise.reject(new Error("fixture-secret"))
        : buildAccountLoader(fixtureFetch())(a),
    );
    await h.service.refresh();
    const after = await h.repository.read();
    expect(after.data.azure.loaded?.openPullRequests).toEqual(
      before.data.azure.loaded?.openPullRequests,
    );
    expect(after.data.azure.loaded?.error).not.toContain("fixture-secret");
    expect(actionable(after)).toHaveLength(4);
    expect(h.effects.badge).toHaveBeenLastCalledWith("4", false);
  });
  it("sets a global error only if all enabled accounts lack usable data", async () => {
    const h = harness(single(), async () => {
      throw new Error("offline");
    });
    await h.service.refresh();
    expect(h.effects.badge).toHaveBeenLastCalledWith("!", true);
  });
  it("keeps the actionable badge when all accounts fail but cached data is usable", async () => {
    const h = harness(single());
    await h.service.refresh();
    h.loader.mockRejectedValue(new Error("offline"));
    await h.service.refresh();
    expect(h.effects.badge).toHaveBeenLastCalledWith("1", false);
  });
  it("does not load disabled accounts or include them in the badge", async () => {
    const h = harness(single().map((a) => ({ ...a, enabled: false })));
    await h.service.refresh();
    expect(h.loader).not.toHaveBeenCalled();
    expect(actionable(await h.repository.read())).toEqual([]);
    expect(h.effects.badge).toHaveBeenLastCalledWith("", false);
  });
  it("enables accounts and retains their state while disabled", async () => {
    const h = harness(single());
    await h.service.refresh();
    await h.service.enable("github", false);
    expect(h.loader).toHaveBeenCalledTimes(1);
    expect((await h.repository.read()).data.github.loaded).toBeDefined();
    await h.service.enable("github", true);
    expect(h.loader).toHaveBeenCalledTimes(2);
  });
  it("handles denied and revoked host permission without sending credentials", async () => {
    const h = harness(single());
    vi.mocked(h.effects.hasPermission).mockResolvedValue(false);
    await h.service.refresh();
    expect(h.loader).not.toHaveBeenCalled();
    expect((await h.repository.read()).data.github.loaded?.error).toContain(
      "host permission denied",
    );
    await expect(h.service.save(single()[0])).rejects.toThrow(
      "Host permission",
    );
  });
  it("preserves a masked token on edit and invalidates only the edited cache", async () => {
    const h = harness();
    await h.service.refresh();
    const before = await h.repository.read();
    h.loader.mockRejectedValue(new Error("offline"));
    await h.service.save({ ...before.accounts[0], name: "Renamed", token: "" });
    const after = await h.repository.read();
    expect(after.accounts[0].token).toBe(before.accounts[0].token);
    expect(after.data.github.loaded?.openPullRequests).toEqual([]);
    expect(after.data.enterprise.loaded?.openPullRequests).toEqual(
      before.data.enterprise.loaded?.openPullRequests,
    );
  });
  it("removes only one account credential, cache, rules, notifications and unused host permission", async () => {
    const h = harness();
    await h.service.rememberOrigins();
    await h.service.refresh();
    const c = await h.repository.read();
    const pr = c.data.enterprise.loaded!.openPullRequests[0];
    await h.service.mute("enterprise", ref(pr), "forever");
    await h.service.remove("enterprise");
    const after = await h.repository.read();
    expect(after.accounts.map((a) => a.id)).not.toContain("enterprise");
    expect(after.data.enterprise).toBeUndefined();
    expect(after.data.github).toEqual(c.data.github);
    expect(h.effects.revokePermission).toHaveBeenCalledWith([
      "https://github.example.test/*",
    ]);
    expect(h.effects.clearNotification).toHaveBeenCalledWith(
      notificationKey(pr),
    );
  });
  it("does not revoke a shared origin used by another account", async () => {
    const h = harness([
      { ...single()[0], id: "one" },
      { ...single()[0], id: "two" },
    ]);
    await h.service.rememberOrigins();
    await h.service.remove("one");
    expect(h.effects.revokePermission).not.toHaveBeenCalled();
  });
  it("cannot resurrect an account removed during a refresh", async () => {
    const h = harness(single());
    let release!: (state: AccountLoadedState) => void;
    h.loader.mockImplementation(() => new Promise((r) => (release = r)));
    const running = h.service.refresh();
    await vi.waitFor(() => expect(h.loader).toHaveBeenCalled());
    await h.service.remove("github");
    release(fixtureCollection("github-account").data.github.loaded!);
    await running;
    expect((await h.repository.read()).accounts).toHaveLength(0);
    expect((await h.repository.read()).data).toEqual({});
    expect(h.effects.notify).not.toHaveBeenCalled();
  });
  it("refreshes the latest credentials when an account is edited during a refresh", async () => {
    const h = harness(single());
    let release!: (state: AccountLoadedState) => void;
    h.loader.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const running = h.service.refresh();
    await vi.waitFor(() => expect(h.loader).toHaveBeenCalled());
    const saving = h.service.save({
      ...single()[0],
      name: "Updated",
      token: "replacement",
    });
    await vi.waitFor(async () =>
      expect((await h.repository.read()).accounts[0].name).toBe("Updated"),
    );
    release(fixtureCollection("github-account").data.github.loaded!);
    await Promise.all([running, saving]);
    expect(h.loader).toHaveBeenCalledTimes(2);
    expect((await h.repository.read()).data.github.loaded?.accountName).toBe(
      "Updated",
    );
  });
  it("scopes identical PR mutes, repository ignores, and notifications by account", async () => {
    const h = harness([
      { ...single()[0], id: "one" },
      { ...single()[0], id: "two" },
    ]);
    await h.service.refresh();
    const c = await h.repository.read();
    const pr = c.data.one.loaded!.openPullRequests[0];
    await h.service.mute("one", ref(pr), "forever");
    let buckets = filtered(await h.repository.read());
    expect(buckets.incoming.map((p) => p.accountId)).toEqual(["two"]);
    expect(buckets.muted.map((p) => p.accountId)).toEqual(["one"]);
    await h.service.mute("one", ref(pr), "repo");
    buckets = filtered(await h.repository.read());
    expect(buckets.ignored.map((p) => p.accountId)).toEqual(["one"]);
    expect(buckets.incoming.map((p) => p.accountId)).toEqual(["two"]);
    await h.service.unignore("one", pr.repoOwner, pr.repoName);
    await h.service.mute("one", ref(pr), "unmute");
    expect(filtered(await h.repository.read()).incoming).toHaveLength(2);
    const restarted = new AccountService(
      new AccountRepository(h.storage),
      h.loader,
      h.effects,
    );
    await restarted.refresh();
    expect(h.effects.notify).toHaveBeenCalledTimes(2);
  });
  it("does not lose notification preferences when adding or removing mutes", async () => {
    const h = harness(single());
    await h.service.refresh();
    await h.service.preferences("github", {
      notifyNewCommits: true,
      onlyDirectRequests: true,
      whitelistedTeams: ["team"],
    });
    const pr = (await h.repository.read()).data.github.loaded!
      .openPullRequests[0];
    await h.service.mute("github", ref(pr), "forever");
    await h.service.mute("github", ref(pr), "unmute");
    expect((await h.repository.read()).data.github.mute).toMatchObject({
      notifyNewCommits: true,
      onlyDirectRequests: true,
      whitelistedTeams: ["team"],
    });
  });
  it("retains failed-project cache during a partial Azure refresh", async () => {
    const h = harness(fixtureCollection("azure-account").accounts);
    await h.service.refresh();
    const previous = (await h.repository.read()).data.azure.loaded!;
    h.loader.mockResolvedValue({
      ...previous,
      openPullRequests: [],
      failedProjects: ["Engineering"],
      error: "project unavailable",
    });
    await h.service.refresh();
    expect(
      (await h.repository.read()).data.azure.loaded!.openPullRequests,
    ).toEqual(previous.openPullRequests);
  });
  it("redacts credentials from every UI reply and surfaces only safe errors", async () => {
    const h = harness(single());
    const reply = await handleCommand(h.service, { kind: "snapshot" });
    expect(reply.snapshot?.collection.accounts[0].token).toBe("");
    expect(JSON.stringify(reply)).not.toContain("fixture-only");
    h.storage.failWrite = true;
    expect(
      (
        await handleCommand(h.service, {
          kind: "enable",
          id: "github",
          enabled: false,
        })
      ).error,
    ).toContain("Operation failed");
  });
});

it("can notify a healthy Azure project during partial failure without repeating cached notifications", async () => {
  const h = harness(
    fixtureCollection("azure-account").accounts,
    buildAccountLoader(fixtureFetch({ failedProject: true })),
  );
  await h.service.refresh();
  expect(h.effects.notify).toHaveBeenCalledTimes(1);
  await h.service.refresh();
  expect(h.effects.notify).toHaveBeenCalledTimes(1);
});

it("observes Azure votes without treating old commits as new activity", async () => {
  const load = buildAccountLoader(fixtureFetch());
  let commitTime = "2026-09-11T11:00:00Z";
  const h = harness(fixtureCollection("azure-account").accounts, async (a) => {
    const state = await load(a);
    state.openPullRequests[0].reviewRequested = false;
    state.openPullRequests[0].requestedReviewers = [];
    state.openPullRequests[0].reviews = [
      { authorLogin: "user-reviewer", state: "APPROVED" },
    ];
    state.openPullRequests[0].commits = [
      { authorLogin: "user-author", createdAt: commitTime },
    ];
    return state;
  });
  await h.service.preferences("azure", {
    notifyNewCommits: true,
    onlyDirectRequests: false,
    whitelistedTeams: [],
  });
  await h.service.refresh();
  const c = await h.repository.read();
  expect(filtered(c).reviewed).toHaveLength(1);
  expect(h.effects.notify).not.toHaveBeenCalled();
  const observed =
    c.data.azure.loaded!.openPullRequests[0].reviews[0].observedAt!;
  commitTime = new Date(observed + 1000).toISOString();
  await h.service.refresh();
  expect(filtered(await h.repository.read()).incoming).toHaveLength(1);
  expect(h.effects.notify).toHaveBeenCalledTimes(1);
  expect(
    (await h.repository.read()).data.azure.loaded!.openPullRequests[0]
      .reviews[0].observedAt,
  ).toBe(observed);
});

it("announces refresh start and finish to already-open pages", async () => {
  const h = harness(single());
  const changed = vi.fn();
  h.effects.changed = changed;
  await h.service.refresh();
  expect(changed).toHaveBeenCalledTimes(2);
  expect((await h.service.snapshot()).refreshing).toBe(false);
});

it("records offline state per account without issuing provider requests", async () => {
  const h = harness(single());
  h.effects.isOnline = () => false;
  await h.service.refresh();
  expect(h.loader).not.toHaveBeenCalled();
  expect((await h.repository.read()).data.github.loaded?.error).toContain(
    "offline",
  );
});

it("reports a failed connection test as an error, never a successful status", async () => {
  const h = harness(single(), async () => {
    throw { status: 401, request: { token: "fixture-private" } };
  });
  const reply = await handleCommand(h.service, {
    kind: "test",
    account: single()[0],
  });
  expect(reply.ok).toBe(false);
  expect(reply.error).toContain("authentication failed");
  expect(reply.message).toBeUndefined();
  expect(JSON.stringify(reply)).not.toContain("fixture-private");
});
