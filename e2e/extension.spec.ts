import { test, expect } from "./extension-fixture";
import { emptyAccountData, emptyCollection } from "../src/accounts/storage";
import { fixtureCollection } from "../src/testing/scenarios";
import type { AccountConfig } from "../src/accounts/model";
import { notificationKey } from "../src/accounts/model";
import { ref } from "../src/storage/loaded-state";

function localCollection(origin: string) {
  const collection = emptyCollection();
  collection.accounts = [
    {
      id: "github",
      name: "Local GitHub Enterprise",
      provider: "github",
      serverUrl: origin,
      token: "fixture-valid",
      enabled: true,
    },
    {
      id: "azure",
      name: "Local Azure Server",
      provider: "azure-devops",
      organizationUrl: `${origin}/tfs/DefaultCollection`,
      token: "fixture-valid",
      enabled: true,
    },
  ];
  collection.accounts.forEach(
    (a) => (collection.data[a.id] = emptyAccountData()),
  );
  return collection;
}

test.describe("release build", () => {
  test.use({ productionBuild: true });
  test("starts the production MV3 service worker and renders popup and options", async ({
    extension,
  }, testInfo) => {
    const manifest = await extension.worker.evaluate(() =>
      chrome.runtime.getManifest(),
    );
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toBeUndefined();
    await expect(
      extension.page.getByText("Your review inbox starts here"),
    ).toBeVisible();
    await extension.page.screenshot({
      path: testInfo.outputPath("empty-options.png"),
      fullPage: true,
    });
    await extension.open("popup");
    await expect(
      extension.page.getByText("Connect your review inbox"),
    ).toBeVisible();
    await extension.page.screenshot({
      path: testInfo.outputPath("empty-popup.png"),
    });
    expect(
      await extension.worker.evaluate(
        async () => (await chrome.alarms.get("refresh"))?.periodInMinutes,
      ),
    ).toBe(3);
  });
  test("migrates legacy credentials and state and keeps them after restart", async ({
    extension,
  }) => {
    const fixture = fixtureCollection("github-account");
    const pr = fixture.data.github.loaded!.openPullRequests[0];
    await extension.seed({
      gitHubApiToken: JSON.stringify("fixture-legacy"),
      lastCheck: JSON.stringify({
        userLogin: "reviewer",
        openPullRequests: [pr],
      }),
      lastSeenPullRequests: JSON.stringify([pr.htmlUrl]),
      mute: JSON.stringify({
        mutedPullRequests: [],
        ignored: { engineering: { kind: "ignore-all" } },
        notifyNewCommits: true,
      }),
    });
    await extension.send({ kind: "snapshot" });
    let c = await extension.read();
    expect(c.accounts).toHaveLength(1);
    expect(c.accounts[0].id).toBe("legacy-github");
    expect(c.data["legacy-github"].notified[0]).toContain(
      "legacy-github:github:",
    );
    await extension.restart();
    c = await extension.read();
    expect(c.accounts[0].token).toBe("fixture-legacy");
    expect(c.data["legacy-github"].mute.notifyNewCommits).toBe(true);
    expect(
      await extension.worker.evaluate(
        async () =>
          (await chrome.storage.local.get("gitHubApiToken")).gitHubApiToken,
      ),
    ).toBeUndefined();
  });
});

test("refreshes both providers, scopes notifications, and renders account labels", async ({
  extension,
}, testInfo) => {
  await extension.seed({ "accounts.v1": localCollection(extension.origin) });
  expect((await extension.send({ kind: "refresh" })).ok).toBe(true);
  const c = await extension.read();
  expect(c.data.github.loaded?.openPullRequests).toHaveLength(1);
  expect(c.data.azure.loaded?.openPullRequests).toHaveLength(1);
  expect(c.data.github.notified).toHaveLength(1);
  expect(c.data.azure.notified).toHaveLength(1);
  for (const data of Object.values(c.data)) {
    const pr = data.loaded!.openPullRequests[0];
    expect(data.notificationTargets[notificationKey(pr)]).toBe(pr.htmlUrl);
  }
  expect(
    await extension.worker.evaluate(() => chrome.action.getBadgeText({})),
  ).toBe("2");
  await extension.open();
  await expect(
    extension.page.getByText("Alex Reviewer", { exact: true }),
  ).toHaveCount(2);
  await extension.page.screenshot({
    path: testInfo.outputPath("multiple-accounts.png"),
    fullPage: true,
  });
  await extension.open("popup");
  await expect(
    extension.page.getByRole("link", {
      name: "Improve account refresh reliability",
    }),
  ).toBeVisible();
  await expect(
    extension.page.getByRole("link", { name: "Simplify project onboarding" }),
  ).toBeVisible();
  await extension.page.screenshot({
    path: testInfo.outputPath("populated-popup.png"),
  });
  await extension.page.getByLabel("Account filter").selectOption("azure");
  await expect(
    extension.page.getByRole("link", {
      name: "Improve account refresh reliability",
    }),
  ).toHaveCount(0);
  await extension.restart();
  expect((await extension.read()).accounts).toHaveLength(2);
});

test("masks and preserves tokens through an options-page edit", async ({
  extension,
}) => {
  await extension.seed({ "accounts.v1": localCollection(extension.origin) });
  await extension.page.reload();
  await extension.page
    .getByRole("article", { name: "Local GitHub Enterprise", exact: true })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const token = extension.page.getByLabel("Personal access token");
  await expect(token).toHaveAttribute("type", "password");
  await expect(token).toHaveValue("");
  await expect(token).toHaveAttribute("placeholder", "•••••••• (saved token)");
  expect(await extension.page.locator("body").textContent()).not.toContain(
    "fixture-valid",
  );
  await extension.page
    .getByLabel("Account name", { exact: true })
    .fill("Renamed GitHub");
  await extension.page
    .getByRole("button", { name: "Save account", exact: true })
    .click();
  await expect(
    extension.page.getByRole("article", {
      name: "Renamed GitHub",
      exact: true,
    }),
  ).toBeVisible();
  expect((await extension.read()).accounts[0].token).toBe("fixture-valid");
});

test("adds an account through the form and validates its connection", async ({
  extension,
}) => {
  await extension.page
    .getByRole("button", { name: "Add account", exact: true })
    .click();
  await extension.page
    .getByLabel("Account name", { exact: true })
    .fill("Added Enterprise");
  await extension.page
    .getByLabel("Server URL", { exact: true })
    .fill(extension.origin);
  await extension.page
    .getByLabel("Personal access token")
    .fill("fixture-valid");
  await extension.page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(extension.page.getByRole("status")).toContainText(
    "Connected as Alex Reviewer",
  );
  await extension.page
    .getByRole("button", { name: "Save account", exact: true })
    .click();
  await expect(
    extension.page.getByRole("article", { name: "Added Enterprise" }),
  ).toBeVisible();
  expect((await extension.read()).accounts).toHaveLength(1);
});

test("keeps healthy results and badge when another provider fails", async ({
  extension,
}, testInfo) => {
  const c = localCollection(extension.origin);
  c.accounts[0].token = "fixture-invalid";
  await extension.seed({ "accounts.v1": c });
  await extension.send({ kind: "refresh" });
  const loaded = await extension.read();
  expect(loaded.data.github.loaded?.error).toContain("authentication failed");
  expect(loaded.data.azure.loaded?.openPullRequests).toHaveLength(1);
  expect(
    await extension.worker.evaluate(() => chrome.action.getBadgeText({})),
  ).toBe("1");
  await extension.open("popup");
  await expect(
    extension.page.getByText(/Local GitHub Enterprise: authentication failed/),
  ).toBeVisible();
  await expect(
    extension.page.getByRole("link", { name: "Simplify project onboarding" }),
  ).toBeVisible();
  await extension.page.screenshot({
    path: testInfo.outputPath("partial-failure.png"),
  });
});

test("disabled accounts stop loading and resume when enabled", async ({
  extension,
}) => {
  const c = localCollection(extension.origin);
  c.accounts[0].enabled = false;
  await extension.seed({ "accounts.v1": c });
  await extension.send({ kind: "refresh" });
  expect(extension.requests.some((url) => url.endsWith("/user"))).toBe(false);
  await extension.page.reload();
  await extension.page
    .getByRole("article", { name: "Local GitHub Enterprise", exact: true })
    .getByRole("button", { name: "Enable", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await extension.read()).data.github.loaded?.openPullRequests.length,
    )
    .toBe(1);
  await extension.page
    .getByRole("article", { name: "Local GitHub Enterprise", exact: true })
    .getByRole("button", { name: "Disable", exact: true })
    .click();
  await expect
    .poll(async () => (await extension.read()).accounts[0].enabled)
    .toBe(false);
  await extension.restart();
  expect((await extension.read()).accounts[0].enabled).toBe(false);
});

test("removal confirms scope and cleans only the selected account", async ({
  extension,
}) => {
  await extension.seed({ "accounts.v1": localCollection(extension.origin) });
  await extension.send({ kind: "refresh" });
  const c = await extension.read();
  const pr = c.data.github.loaded!.openPullRequests[0];
  await extension.send({
    kind: "mute",
    id: "github",
    pr: ref(pr),
    muteType: "repo",
  });
  await extension.page.reload();
  await extension.page
    .getByRole("article", { name: "Local GitHub Enterprise", exact: true })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(extension.page.getByRole("dialog")).toContainText(
    "notification history",
  );
  await extension.page
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect((await extension.read()).accounts).toHaveLength(2);
  await extension.page
    .getByRole("article", { name: "Local GitHub Enterprise", exact: true })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await extension.page
    .getByRole("button", { name: "Remove account", exact: true })
    .click();
  await expect(
    extension.page.getByRole("article", {
      name: "Local GitHub Enterprise",
      exact: true,
    }),
  ).toHaveCount(0);
  const after = await extension.read();
  expect(after.data.github).toBeUndefined();
  expect(after.data.azure).toEqual(c.data.azure);
});

test("isolates mute behavior for identical PR numbers on two accounts", async ({
  extension,
}) => {
  const c = localCollection(extension.origin);
  const second: AccountConfig = {
    ...c.accounts[0],
    id: "second",
    name: "Second GitHub",
  };
  c.accounts = [c.accounts[0], second];
  c.data = { github: emptyAccountData(), second: emptyAccountData() };
  await extension.seed({ "accounts.v1": c });
  await extension.send({ kind: "refresh" });
  await extension.open("popup");
  await extension.page
    .getByLabel("Mute Improve account refresh reliability")
    .first()
    .selectOption("forever");
  await expect(
    extension.page.getByRole("link", {
      name: "Improve account refresh reliability",
    }),
  ).toHaveCount(1);
  await extension.page.getByRole("tab", { name: /Muted/ }).click();
  await expect(
    extension.page.getByRole("link", {
      name: "Improve account refresh reliability",
    }),
  ).toHaveCount(1);
  await extension.page
    .getByRole("button", { name: "Unmute", exact: true })
    .click();
  await extension.page.getByRole("tab", { name: /Incoming/ }).click();
  await expect(
    extension.page.getByRole("link", {
      name: "Improve account refresh reliability",
    }),
  ).toHaveCount(2);
});

test("alarm refresh updates an already-open popup and clears its busy state", async ({
  extension,
}) => {
  await extension.seed({ "accounts.v1": localCollection(extension.origin) });
  await extension.open("popup");
  await extension.worker.evaluate(async () =>
    chrome.alarms.create("refresh", { when: Date.now() + 100 }),
  );
  await expect
    .poll(
      async () =>
        (await extension.read()).data.github.loaded?.openPullRequests.length,
    )
    .toBe(1);
  await expect(
    extension.page.getByText("2 need attention", { exact: true }),
  ).toBeVisible();
  await expect(
    extension.page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
});

test("failed connection tests show an error and leave the form unsaved", async ({
  extension,
}) => {
  await extension.page
    .getByRole("button", { name: "Add account", exact: true })
    .click();
  await extension.page
    .getByLabel("Account name", { exact: true })
    .fill("Invalid account");
  await extension.page
    .getByLabel("Server URL", { exact: true })
    .fill(extension.origin);
  await extension.page
    .getByLabel("Personal access token", { exact: true })
    .fill("fixture-invalid");
  await extension.page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(extension.page.getByRole("alert")).toContainText(
    "authentication failed",
  );
  await expect(extension.page.getByRole("status")).toHaveCount(0);
  expect((await extension.read()).accounts).toHaveLength(0);
});
