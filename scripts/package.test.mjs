import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./package.mjs", import.meta.url));
const cases = [
  {
    name: "main branch push",
    env: { GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" },
    version: "0.0.0",
  },
  {
    name: "pull request merge ref",
    env: { GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "42/merge" },
    version: "0.0.0",
  },
  {
    name: "version-shaped branch",
    env: { GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "v3.2.1" },
    version: "0.0.0",
  },
  {
    name: "release tag",
    env: { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v3.2.1" },
    version: "3.2.1",
  },
  {
    name: "explicit version override",
    env: {
      GITHUB_REF_TYPE: "tag",
      GITHUB_REF_NAME: "v3.2.1",
      RELEASE_VERSION: "4.5.6",
    },
    version: "4.5.6",
  },
  {
    name: "invalid release tag",
    env: { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "vnot-a-version" },
    error: /valid browser extension version/,
  },
  {
    name: "test-only host permissions",
    env: {},
    hostPermissions: ["http://127.0.0.1/*"],
    error: /test host permissions/,
  },
];

for (const scenario of cases) {
  test(`packaging: ${scenario.name}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "prmonitor-package-"));
    try {
      await mkdir(path.join(root, "dist", "assets"), { recursive: true });
      await mkdir(path.join(root, "dist", "images"));
      await writeFile(
        path.join(root, "dist", "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          version: "0.0.0",
          ...(scenario.hostPermissions
            ? { host_permissions: scenario.hostPermissions }
            : {}),
        }),
      );
      for (const file of [
        "popup.html",
        "options.html",
        "background.js",
        "assets/app.js",
        "assets/app.css",
        "images/logo128.png",
      ]) {
        await writeFile(path.join(root, "dist", file), "fixture");
      }
      const env = { ...process.env };
      delete env.RELEASE_VERSION;
      delete env.GITHUB_REF_NAME;
      delete env.GITHUB_REF_TYPE;
      Object.assign(env, scenario.env);
      const run = () =>
        execFileSync(process.execPath, [script], {
          cwd: root,
          env,
          encoding: "utf8",
          stdio: "pipe",
        });
      if (scenario.error) {
        assert.throws(run, scenario.error);
        assert.equal(
          JSON.parse(
            await readFile(path.join(root, "dist", "manifest.json"), "utf8"),
          ).version,
          "0.0.0",
        );
      } else {
        run();
        const archive = path.join(root, `pr-monitor-${scenario.version}.zip`);
        const manifest = JSON.parse(
          execFileSync("unzip", ["-p", archive, "manifest.json"], {
            encoding: "utf8",
          }),
        );
        assert.equal(manifest.version, scenario.version);
        const entries = execFileSync("unzip", ["-Z1", archive], {
          encoding: "utf8",
        }).split("\n");
        for (const file of [
          "popup.html",
          "options.html",
          "background.js",
          "assets/app.js",
          "assets/app.css",
          "images/logo128.png",
        ])
          assert.ok(entries.includes(file));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
