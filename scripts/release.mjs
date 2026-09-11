import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error(`Expected a three-part release version: ${version}`);
  const parts = version.split(".").map(Number);
  if (parts.some((part) => part > 65535))
    throw new Error(`Release version exceeds browser limits: ${version}`);
  return parts;
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function chooseRelease(tags, head, baseline) {
  versionParts(baseline);
  const versions = tags
    .filter(({ tag }) => /^v\d+\.\d+\.\d+$/.test(tag))
    .sort((a, b) => compareVersions(b.tag.slice(1), a.tag.slice(1)));
  const existing = versions.find(({ sha }) => sha === head);
  if (existing) return { tag: existing.tag, exists: true };
  const latest = versions[0]?.tag.slice(1) ?? baseline;
  const parts = versionParts(
    compareVersions(latest, baseline) > 0 ? latest : baseline,
  );
  parts[2] += 1;
  const version = parts.join(".");
  versionParts(version);
  return { tag: `v${version}`, exists: false };
}

function command(binary, args, options = {}) {
  return execFileSync(binary, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

export function publishRelease(
  { repo, head, tag, exists, release },
  run = command,
) {
  const archive = `pr-monitor-${tag.slice(1)}.zip`;
  if (release && !release.draft) {
    if (!release.assets.some(({ name, size }) => name === archive && size > 0))
      throw new Error(`Published release ${tag} is missing ${archive}`);
    return release.html_url;
  }
  // Package before creating remote state. The input is this run's tested artifact.
  run(process.execPath, ["scripts/package.mjs"], {
    env: { ...process.env, RELEASE_VERSION: tag.slice(1) },
  });
  if (!exists) {
    run("gh", [
      "api",
      `repos/${repo}/git/refs`,
      "--method",
      "POST",
      "-f",
      `ref=refs/tags/${tag}`,
      "-f",
      `sha=${head}`,
    ]);
  }
  if (!release) {
    run("gh", [
      "release",
      "create",
      tag,
      "--repo",
      repo,
      "--verify-tag",
      "--target",
      head,
      "--draft",
      "--title",
      tag,
      "--generate-notes",
    ]);
  }
  // A failed upload leaves a draft; a rerun resumes the same tag and draft.
  run("gh", ["release", "upload", tag, archive, "--repo", repo, "--clobber"]);
  run("gh", ["release", "edit", tag, "--repo", repo, "--draft=false"]);
  return `https://github.com/${repo}/releases/tag/${tag}`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_SHA, GITHUB_REPOSITORY } =
    process.env;
  if (GITHUB_EVENT_NAME !== "push" || GITHUB_REF !== "refs/heads/main")
    throw new Error("Automatic releases require a main branch push");
  if (
    !GITHUB_REPOSITORY ||
    command("git", ["rev-parse", "HEAD"]) !== GITHUB_SHA
  )
    throw new Error("Release checkout must match the tested commit");
  const tags = command("git", ["tag", "--list", "v*"])
    .split("\n")
    .filter(Boolean)
    .map((tag) => ({ tag, sha: command("git", ["rev-list", "-n", "1", tag]) }));
  const baseline = JSON.parse(readFileSync("manifest.json", "utf8")).version;
  const selected = chooseRelease(tags, GITHUB_SHA, baseline);
  const releases = JSON.parse(
    command("gh", [
      "api",
      `repos/${GITHUB_REPOSITORY}/releases?per_page=100`,
      "--paginate",
      "--slurp",
    ]),
  ).flat();
  const url = publishRelease({
    repo: GITHUB_REPOSITORY,
    head: GITHUB_SHA,
    ...selected,
    release: releases.find((release) => release.tag_name === selected.tag),
  });
  console.log(`Release ready: ${url}`);
}
