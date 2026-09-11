import type {
  AccountConfig,
  AccountLoadedState,
  AccountLoader,
} from "../accounts/model";
import { buildGitHubApi } from "../github-api/implementation";
import { refreshOpenPullRequests } from "./internal/pull-requests";
import { loadAzureDevOpsAccount } from "../providers/azure";

export async function loadGitHubAccount(
  account: Extract<AccountConfig, { provider: "github" }>,
  fetcher: typeof fetch = fetch,
): Promise<AccountLoadedState> {
  const api = buildGitHubApi(account.token, account.serverUrl, fetcher);
  const user = await api.loadAuthenticatedUser();
  return {
    accountId: account.id,
    accountName: account.name,
    provider: account.provider,
    userLogin: user.login,
    userDisplayName: user.name ?? undefined,
    openPullRequests: await refreshOpenPullRequests(api, user.login, account),
    lastSuccessfulRefresh: Date.now(),
  };
}
export function buildAccountLoader(
  fetcher: typeof fetch = fetch,
): AccountLoader {
  return (account) =>
    account.provider === "github"
      ? loadGitHubAccount(account, fetcher)
      : loadAzureDevOpsAccount(account, fetcher);
}
