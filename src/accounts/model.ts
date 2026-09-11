import type { PullRequest } from "../storage/loaded-state";
import type { MuteConfiguration } from "../storage/mute-configuration";

interface AccountBase {
  id: string;
  name: string;
  enabled: boolean;
  token: string;
}
export type AccountConfig =
  | (AccountBase & { provider: "github"; serverUrl: string })
  | (AccountBase & { provider: "azure-devops"; organizationUrl: string });
export interface AccountLoadedState {
  accountId: string;
  accountName: string;
  provider: AccountConfig["provider"];
  userLogin: string;
  userDisplayName?: string;
  openPullRequests: PullRequest[];
  error?: string;
  lastSuccessfulRefresh?: number;
  /** Projects whose cache must survive a partial Azure refresh. */
  failedProjects?: string[];
}
export interface AccountData {
  loaded?: AccountLoadedState;
  mute: MuteConfiguration;
  notified: string[];
  notificationTargets: Record<string, string>;
}
export interface AccountCollection {
  version: 1;
  migrationComplete?: boolean;
  accounts: AccountConfig[];
  data: Record<string, AccountData>;
}
export type AccountLoader = (
  account: AccountConfig,
) => Promise<AccountLoadedState>;
export const accountUrl = (a: AccountConfig) =>
  a.provider === "github" ? a.serverUrl : a.organizationUrl;
export function notificationKey(pr: PullRequest): string {
  return `${pr.accountId}:${pr.provider}:${encodeURIComponent(pr.repoOwner)}/${encodeURIComponent(pr.repoName)}:${pr.pullRequestNumber}`;
}
