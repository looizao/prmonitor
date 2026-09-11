import { UserError } from "../providers/http";
import { accountUrl, type AccountConfig } from "./model";

export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UserError("Enter a complete http:// or https:// server URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new UserError(
      "Server URL must use HTTP or HTTPS without credentials, query, or fragment",
    );
  }
  return url.href.replace(/\/+$/, "");
}
export function githubEndpoints(input: string) {
  const web = normalizeUrl(input);
  if (new URL(web).hostname === "github.com") {
    if (web !== "https://github.com")
      throw new UserError("Use https://github.com for GitHub.com");
    return {
      web,
      rest: "https://api.github.com",
      graphql: "https://api.github.com/graphql",
    };
  }
  return { web, rest: `${web}/api/v3`, graphql: `${web}/api/graphql` };
}
export function normalizeAccount(
  account: AccountConfig,
  previous?: AccountConfig,
): AccountConfig {
  if (!account.id || !account.name.trim())
    throw new UserError("Account name is required");
  const token = account.token.trim() || previous?.token || "";
  if (!token) throw new UserError("Personal access token is required");
  const base = { ...account, name: account.name.trim(), token };
  if (base.provider === "github")
    return { ...base, serverUrl: githubEndpoints(base.serverUrl).web };
  const organizationUrl = normalizeUrl(base.organizationUrl);
  if (
    new URL(organizationUrl).hostname === "dev.azure.com" &&
    new URL(organizationUrl).pathname === "/"
  ) {
    throw new UserError("Include the Azure organization in the URL");
  }
  return { ...base, organizationUrl };
}
export function requiredOrigins(a: AccountConfig): string[] {
  const urls =
    a.provider === "github"
      ? [githubEndpoints(a.serverUrl).rest]
      : [accountUrl(a)];
  return [...new Set(urls.map((url) => `${new URL(url).origin}/*`))];
}
export function repositoryUrl(
  account: AccountConfig,
  owner: string,
  name?: string,
): string {
  const base = `${accountUrl(account)}/${encodeURIComponent(owner)}`;
  return name
    ? `${base}/${account.provider === "github" ? "" : "_git/"}${encodeURIComponent(name)}`
    : base;
}
