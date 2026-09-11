import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseRelease, publishRelease } from "./release.mjs";

test("first main release starts at v0.0.1", () => {
  assert.deepEqual(chooseRelease([], "new", "0.0.0"), {
    tag: "v0.0.1",
    exists: false,
  });
});

test("patch increment uses numeric ordering and ignores unrelated tags", () => {
  const tags = ["v1.2.9", "v1.2.10", "v1.1.30", "v1.3.0-beta.1", "archive"].map(
    (tag) => ({ tag, sha: "old" }),
  );
  assert.equal(chooseRelease(tags, "new", "0.0.0").tag, "v1.2.11");
});

test("a rerun reuses its commit's tag even after newer commits release", () => {
  assert.deepEqual(
    chooseRelease(
      [
        { tag: "v0.0.1", sha: "rerun" },
        { tag: "v0.0.2", sha: "newer" },
      ],
      "rerun",
      "0.0.0",
    ),
    { tag: "v0.0.1", exists: true },
  );
});

test("a higher manifest version establishes the next release baseline", () => {
  assert.equal(
    chooseRelease([{ tag: "v0.0.9", sha: "old" }], "new", "1.0.0").tag,
    "v1.0.1",
  );
});

test("invalid versions and extension version overflow fail before publishing", () => {
  assert.throws(() => chooseRelease([], "new", "main"), /three-part/);
  assert.throws(
    () => chooseRelease([{ tag: "v1.0.65535", sha: "old" }], "new", "0.0.0"),
    /browser limits/,
  );
});

const plan = {
  repo: "owner/repo",
  head: "tested-sha",
  tag: "v0.0.1",
  exists: false,
};
const asset = { name: "pr-monitor-0.0.1.zip", size: 100 };

test("new release tags the tested commit and uploads before publishing", () => {
  const calls = [];
  publishRelease(plan, (...args) => calls.push(args));
  assert.equal(calls[0][2].env.RELEASE_VERSION, "0.0.1");
  assert.ok(calls[1][1].includes("sha=tested-sha"));
  assert.ok(calls[2][1].includes("--draft"));
  assert.equal(calls[3][1][1], "upload");
  assert.ok(calls[4][1].includes("--draft=false"));
});

test("packaging failure leaves no remote tag or release", () => {
  let calls = 0;
  assert.throws(
    () =>
      publishRelease(plan, () => {
        calls += 1;
        throw new Error("invalid artifact");
      }),
    /invalid artifact/,
  );
  assert.equal(calls, 1);
});

test("an upload failure leaves the release unpublished", () => {
  const calls = [];
  assert.throws(
    () =>
      publishRelease(plan, (binary, args) => {
        calls.push(args);
        if (binary === "gh" && args[1] === "upload")
          throw new Error("upload failed");
      }),
    /upload failed/,
  );
  assert.equal(calls.length, 4);
  assert.ok(!calls.some((args) => args.includes("--draft=false")));
});

test("rerun resumes a draft without creating another tag or release", () => {
  const calls = [];
  publishRelease(
    { ...plan, exists: true, release: { draft: true } },
    (binary, args) => calls.push(args),
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[1][1], "upload");
  assert.ok(calls[1].includes("--clobber"));
  assert.ok(calls[2].includes("--draft=false"));
});

test("rerun after tag creation resumes by creating its missing release", () => {
  const calls = [];
  publishRelease({ ...plan, exists: true }, (binary, args) => calls.push(args));
  assert.equal(calls.length, 4);
  assert.equal(calls[1][1], "create");
  assert.ok(!calls.some((args) => args.includes("POST")));
});

test("completed release rerun makes no changes", () => {
  const url = publishRelease(
    {
      ...plan,
      exists: true,
      release: {
        draft: false,
        assets: [asset],
        html_url: "https://github.com/owner/repo/releases/tag/v0.0.1",
      },
    },
    () => assert.fail("Published releases must not be changed"),
  );
  assert.ok(url.endsWith("/v0.0.1"));
});

test("published release missing its artifact is reported, not silently accepted", () => {
  assert.throws(
    () =>
      publishRelease(
        {
          ...plan,
          exists: true,
          release: {
            draft: false,
            assets: [],
          },
        },
        () => assert.fail("Published releases must not be changed"),
      ),
    /missing/,
  );
});
