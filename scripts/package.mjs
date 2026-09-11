import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const version = (
  process.env.RELEASE_VERSION ??
  process.env.GITHUB_REF_NAME ??
  manifest.version
).replace(/^v/, "");
if (
  !/^\d+\.\d+\.\d+(\.\d+)?$/.test(version) ||
  version.split(".").some((part) => Number(part) > 65535)
)
  throw new Error("Release version must be a valid browser extension version");
if (manifest.host_permissions?.length)
  throw new Error("Refusing to package a build with test host permissions");
manifest.version = version;
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
const files = await readdir("dist");
for (const required of [
  "manifest.json",
  "popup.html",
  "options.html",
  "background.js",
  "images",
  "assets",
])
  if (!files.includes(required))
    throw new Error(`Missing release asset: ${required}`);
const archive = path.resolve(`pr-monitor-${version}.zip`);
await rm(archive, { force: true });
execFileSync("zip", ["-q", "-r", archive, "."], { cwd: "dist" });
const listing = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" });
for (const required of [
  "manifest.json",
  "popup.html",
  "options.html",
  "background.js",
  "images/logo128.png",
])
  if (!listing.split("\n").includes(required))
    throw new Error(`Missing archive entry: ${required}`);
console.log(`Packaged ${path.basename(archive)}`);
