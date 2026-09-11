import { test, expect } from "@playwright/test";
const scenarios = [
  "no-accounts",
  "github-account",
  "enterprise-account",
  "azure-account",
  "server-account",
  "multiple-accounts",
  "disabled-account",
  "partial-failure",
  "empty-pr-list",
  "large-pr-list",
];
for (const fixture of scenarios)
  test(`development fixture: ${fixture}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:9000/options.html?fixture=${fixture}`);
    await expect(
      page.getByRole("heading", { name: "Connected accounts" }),
    ).toBeVisible();
    if (fixture === "no-accounts")
      await expect(
        page.getByText("Your review inbox starts here"),
      ).toBeVisible();
    else await expect(page.getByRole("article").first()).toBeVisible();
    await page.goto(`http://127.0.0.1:9000/popup.html?fixture=${fixture}`);
    await page.setViewportSize({ width: 600, height: 700 });
    await expect(
      page.getByRole("heading", { name: "PR Monitor", exact: true }),
    ).toBeVisible();
    if (fixture === "large-pr-list")
      await expect(page.getByRole("article")).toHaveCount(300);
    if (fixture === "partial-failure")
      await expect(
        page.getByText(/Platform Azure: authentication failed/),
      ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (
      ["no-accounts", "multiple-accounts", "partial-failure"].includes(fixture)
    )
      await page.screenshot({
        path: testInfo.outputPath(`${fixture}.png`),
        fullPage: true,
      });
    expect(errors).toEqual([]);
  });
test("validates URLs and handles permission rejection without saving", async ({
  page,
}) => {
  await page.goto(
    "http://127.0.0.1:9000/options.html?fixture=permission-denied",
  );
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name", { exact: true }).fill("Test account");
  await page.getByLabel("Personal access token").fill("fixture-only");
  await page
    .getByLabel("Server URL", { exact: true })
    .fill("ftp://server.test");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP or HTTPS");
  await page
    .getByLabel("Server URL", { exact: true })
    .fill("https://server.test");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByRole("alert")).toContainText("Host permission denied");
  await expect(
    page.getByRole("article", { name: "Test account", exact: true }),
  ).toHaveCount(0);
});
