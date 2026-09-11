import type { AccountConfig } from "../accounts/model";
import {
  githubEndpoints,
  normalizeAccount,
  repositoryUrl,
} from "../accounts/urls";
import { ProviderError, safeError, scopedFetch } from "./http";
/** Read-only authentication and one-page smoke checks. Never return provider bodies or credentials. */
export async function smokeAccount(input: AccountConfig): Promise<void> {
  try {
    const account = normalizeAccount(input);
    const base =
      account.provider === "github"
        ? githubEndpoints(account.serverUrl).rest
        : account.organizationUrl;
    const request = scopedFetch(base, fetch);
    const headers = {
      Authorization:
        account.provider === "github"
          ? `Bearer ${account.token}`
          : `Basic ${btoa(`:${account.token}`)}`,
    };
    async function get(path: string) {
      const response = await request(`${base}/${path}`, { headers });
      if (!response.ok) throw new ProviderError(response.status);
      return response.json();
    }
    if (account.provider === "github") {
      const user = await get("user");
      if (typeof user.login !== "string") throw new ProviderError(401);
      const data = await get(
        `search/issues?q=${encodeURIComponent(`is:pr is:open author:${user.login}`)}&per_page=1`,
      );
      if (!Array.isArray(data.items)) throw new ProviderError(502);
      if (
        data.items[0] &&
        new URL(data.items[0].html_url).origin !==
          new URL(account.serverUrl).origin
      )
        throw new ProviderError(502);
    } else {
      const connection = await get("_apis/connectionData?api-version=6.0");
      if (!connection.authenticatedUser?.id) throw new ProviderError(401);
      const projects = await get("_apis/projects?api-version=6.0&$top=1");
      if (projects.value?.[0]) {
        const project = projects.value[0];
        const data = await get(
          `${encodeURIComponent(project.id)}/_apis/git/pullrequests?api-version=6.0&searchCriteria.status=active&$top=1`,
        );
        if (!Array.isArray(data.value)) throw new ProviderError(502);
        if (data.value[0])
          new URL(
            repositoryUrl(account, project.name, data.value[0].repository.name),
          );
      }
    }
  } catch (error) {
    throw new Error(`Live provider check: ${safeError(error)}`);
  }
}
