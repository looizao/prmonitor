import {
  githubEndpoints,
  normalizeAccount,
  normalizeUrl,
  repositoryUrl,
  requiredOrigins,
} from "./urls";
import type { AccountConfig } from "./model";
const github: AccountConfig = {
  id: "g",
  name: "GitHub",
  provider: "github",
  enabled: true,
  serverUrl: "https://github.com",
  token: "fixture",
};
const azure: AccountConfig = {
  id: "a",
  name: "Azure",
  provider: "azure-devops",
  enabled: true,
  organizationUrl: "https://dev.azure.com/org",
  token: "fixture",
};
describe("account URLs and credentials", () => {
  it("derives GitHub.com REST, GraphQL, and web URLs", () =>
    expect(githubEndpoints(" https://github.com/// ")).toEqual({
      web: "https://github.com",
      rest: "https://api.github.com",
      graphql: "https://api.github.com/graphql",
    }));
  it("preserves Enterprise ports and path prefixes", () =>
    expect(githubEndpoints("http://enterprise.test:8080/git/")).toEqual({
      web: "http://enterprise.test:8080/git",
      rest: "http://enterprise.test:8080/git/api/v3",
      graphql: "http://enterprise.test:8080/git/api/graphql",
    }));
  it.each([
    "https://dev.azure.com/org/",
    "https://org.visualstudio.com/",
    "https://devops.test/DefaultCollection/",
    "http://devops.test:8080/tfs/DefaultCollection/",
  ])("normalizes Azure %s", (url) =>
    expect(normalizeUrl(url)).toBe(url.slice(0, -1)),
  );
  it.each([
    "garbage",
    "javascript:alert(1)",
    "ftp://host",
    "https://user:secret@host",
    "https://host/?token=secret",
    "https://host/#secret",
  ])(
    "rejects invalid or credential-bearing URLs without leaking them",
    (url) => {
      expect(() => normalizeUrl(url)).toThrow();
      try {
        normalizeUrl(url);
      } catch (error) {
        expect(String(error)).not.toContain("secret");
      }
    },
  );
  it("requires the complete Azure organization URL", () =>
    expect(() =>
      normalizeAccount({ ...azure, organizationUrl: "https://dev.azure.com" }),
    ).toThrow("organization"));
  it("derives only exact provider host permissions", () => {
    expect(requiredOrigins(github)).toEqual(["https://api.github.com/*"]);
    expect(
      requiredOrigins({ ...github, serverUrl: "https://git.test/path" }),
    ).toEqual(["https://git.test/*"]);
    expect(
      requiredOrigins({
        ...azure,
        organizationUrl: "http://devops.test:8080/tfs/Collection",
      }),
    ).toEqual(["http://devops.test:8080/*"]);
  });
  it("preserves a saved token only when the field is unchanged", () => {
    expect(normalizeAccount({ ...github, token: "" }, github).token).toBe(
      "fixture",
    );
    expect(
      normalizeAccount({ ...github, token: "replacement" }, github).token,
    ).toBe("replacement");
    expect(() => normalizeAccount({ ...github, token: "" })).toThrow("token");
  });
  it("builds provider-specific ignored repository links", () => {
    expect(repositoryUrl(azure, "My Project", "my repo")).toBe(
      "https://dev.azure.com/org/My%20Project/_git/my%20repo",
    );
    expect(repositoryUrl(github, "owner", "repo")).toBe(
      "https://github.com/owner/repo",
    );
  });
});
