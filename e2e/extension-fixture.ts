import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startProviderServer } from "./server";
import type { AccountCollection } from "../src/accounts/model";
import type { Command, Reply } from "../src/accounts/messages";
export interface Extension {
  context: BrowserContext;
  page: Page;
  worker: Worker;
  id: string;
  origin: string;
  requests: string[];
  seed(values: Record<string, unknown>): Promise<void>;
  send(command: Command): Promise<Reply>;
  read(): Promise<AccountCollection>;
  open(page?: "popup" | "options"): Promise<void>;
  restart(): Promise<void>;
}
export const test = base.extend<{
  extension: Extension;
  productionBuild: boolean;
}>({
  productionBuild: [false, { option: true }],
  extension: async ({ headless, productionBuild }, use) => {
    const root = await mkdtemp(path.join(tmpdir(), "prmonitor-e2e-"));
    const server = await startProviderServer();
    const extensionPath = productionBuild
      ? path.resolve("dist")
      : path.join(root, "extension");
    if (!productionBuild) {
      await cp("dist", extensionPath, { recursive: true });
      const manifest = JSON.parse(
        await readFile(path.join(extensionPath, "manifest.json"), "utf8"),
      );
      // Only this temporary copy receives loopback permission. dist remains the release build.
      manifest.host_permissions = [`${server.origin}/*`];
      await writeFile(
        path.join(extensionPath, "manifest.json"),
        JSON.stringify(manifest),
      );
    }
    const errors: string[] = [];
    let context: BrowserContext;
    const extension = {} as Extension;
    async function launch() {
      context = await chromium.launchPersistentContext(
        path.join(root, "profile"),
        {
          channel: "chromium",
          headless,
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
          ],
          viewport: { width: 1100, height: 850 },
        },
      );
      context.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      context.on("weberror", (error) => errors.push(error.error().message));
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent("serviceworker"));
      // Listen for worker exceptions before fixture requests start.
      await worker.evaluate(() => {
        globalThis.addEventListener("unhandledrejection", (event) =>
          console.error("Unhandled worker rejection", String(event.reason)),
        );
        globalThis.addEventListener("error", () =>
          console.error("Unhandled worker exception"),
        );
      });
      Object.assign(extension, {
        context,
        worker,
        id: new URL(worker.url()).host,
        page: await context.newPage(),
      });
    }
    try {
      await launch();
      Object.assign(extension, {
        origin: server.origin,
        requests: server.requests,
        async seed(values: Record<string, unknown>) {
          await extension.worker.evaluate(async (values) => {
            await chrome.storage.local.clear();
            await chrome.storage.local.set(values);
          }, values);
        },
        async send(command: Command) {
          return extension.page.evaluate(
            (command) => chrome.runtime.sendMessage(command),
            command,
          );
        },
        async read() {
          return extension.worker.evaluate(
            async () =>
              (await chrome.storage.local.get("accounts.v1"))["accounts.v1"],
          );
        },
        async open(page = "options") {
          await extension.page.setViewportSize(
            page === "popup"
              ? { width: 600, height: 700 }
              : { width: 1100, height: 850 },
          );
          await extension.page.goto(
            `chrome-extension://${extension.id}/${page}.html`,
          );
          await expect(
            extension.page.getByRole("heading", {
              name: page === "options" ? "Connected accounts" : "PR Monitor",
              exact: true,
            }),
          ).toBeVisible();
        },
        async restart() {
          await context.close();
          await launch();
          await extension.open();
        },
      });
      await extension.open();
      await use(extension);
      expect(errors, "Unexpected page or service-worker errors").toEqual([]);
    } finally {
      await context!.close();
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  },
});
export { expect };
