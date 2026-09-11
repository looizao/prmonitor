import { UserError } from "../providers/http";
import {
  filterPullRequests,
  type FilteredPullRequests,
} from "../filtering/filters";
import { safeError } from "../providers/http";
import {
  addMute,
  removeOwnerMute,
  removePullRequestMute,
  removeRepositoryMute,
  type MuteType,
} from "../storage/mute-configuration";
import type { PullRequestReference } from "../github-api/api";
import { AccountRepository, emptyAccountData } from "./storage";
import {
  notificationKey,
  type AccountCollection,
  type AccountConfig,
  type AccountLoader,
} from "./model";
import { normalizeAccount, requiredOrigins } from "./urls";

export interface AccountEffects {
  hasPermission(origins: string[]): Promise<boolean>;
  revokePermission(origins: string[]): Promise<unknown>;
  notify(key: string, title: string, message: string): Promise<unknown>;
  clearNotification(key: string): Promise<unknown>;
  badge(text: string, error: boolean): Promise<unknown>;
  changed?(): void;
  isOnline?(): boolean;
}
export function filtered(collection: AccountCollection): FilteredPullRequests {
  const merged: FilteredPullRequests = {
    incoming: [],
    muted: [],
    reviewed: [],
    mine: [],
    ignored: [],
  };
  for (const account of collection.accounts.filter((a) => a.enabled)) {
    const data = collection.data[account.id];
    if (!data?.loaded) continue;
    const buckets = filterPullRequests(
      { getCurrentTime: Date.now },
      data.loaded.userLogin,
      data.loaded.openPullRequests,
      data.mute,
    );
    for (const key of Object.keys(merged) as (keyof FilteredPullRequests)[])
      merged[key].push(...buckets[key]);
  }
  for (const bucket of Object.values(merged))
    bucket.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return merged;
}
export const actionable = (c: AccountCollection) => {
  const buckets = filtered(c);
  return [
    ...buckets.incoming,
    ...buckets.mine.filter(
      (pr) =>
        pr.state.kind === "outgoing" &&
        (pr.state.approvedByEveryone || pr.state.changesRequested),
    ),
  ];
};
export class AccountService {
  private refreshing?: Promise<void>;
  constructor(
    readonly repository: AccountRepository,
    private loader: AccountLoader,
    private effects: AccountEffects,
  ) {}
  async snapshot() {
    return {
      collection: await this.repository.read(),
      refreshing: !!this.refreshing,
    };
  }
  async save(input: AccountConfig) {
    await this.repository.transaction(async (collection) => {
      const previous = collection.accounts.find((a) => a.id === input.id);
      const account = normalizeAccount(input, previous);
      if (!(await this.effects.hasPermission(requiredOrigins(account))))
        throw new UserError(
          "Host permission denied; allow access to the configured server",
        );
      const index = collection.accounts.findIndex((a) => a.id === account.id);
      if (index < 0) collection.accounts.push(account);
      else collection.accounts[index] = account;
      const data = collection.data[account.id] ?? emptyAccountData();
      delete data.loaded;
      collection.data[account.id] = data;
    });
    await this.cleanupPermissions();
    await this.refresh();
  }
  async enable(id: string, enabled: boolean) {
    await this.repository.transaction((c) => {
      const a = c.accounts.find((a) => a.id === id);
      if (a) a.enabled = enabled;
    });
    await this.refresh();
  }
  async remove(id: string) {
    const keys = await this.repository.transaction((c) => {
      const keys = Object.keys(c.data[id]?.notificationTargets ?? {});
      c.accounts = c.accounts.filter((a) => a.id !== id);
      delete c.data[id];
      return keys;
    });
    await Promise.allSettled(
      keys.map((key) => this.effects.clearNotification(key)),
    );
    await this.cleanupPermissions();
    await this.updateBadge();
  }
  private knownOrigins = new Set<string>();
  async rememberOrigins() {
    const collection = await this.repository.read();
    for (const a of collection.accounts)
      for (const o of requiredOrigins(a)) this.knownOrigins.add(o);
  }
  private async cleanupPermissions() {
    await this.repository.transaction(async (collection) => {
      const used = new Set(collection.accounts.flatMap(requiredOrigins));
      const unused = [...this.knownOrigins].filter((o) => !used.has(o));
      if (unused.length)
        await this.effects.revokePermission(unused).catch(() => {});
      this.knownOrigins = used;
    });
  }
  async test(account: AccountConfig) {
    const normalized = normalizeAccount(
      account,
      (await this.repository.read()).accounts.find((a) => a.id === account.id),
    );
    if (!(await this.effects.hasPermission(requiredOrigins(normalized))))
      throw new UserError(
        "Host permission denied; allow access to the configured server",
      );
    try {
      const loaded = await this.loader(normalized);
      if (loaded.error)
        throw new UserError(`${normalized.name}: ${loaded.error}`);
      return `Connected as ${loaded.userDisplayName || loaded.userLogin}`;
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError(`${normalized.name}: ${safeError(error)}`);
    }
  }
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.runRefresh().finally(() => {
      this.refreshing = undefined;
      this.effects.changed?.();
    });
    this.effects.changed?.();
    return this.refreshing;
  }
  private async runRefresh() {
    const snapshot = await this.repository.read();
    const accounts = snapshot.accounts.filter((a) => a.enabled);
    const results = await Promise.allSettled(
      accounts.map(async (a) => {
        if (this.effects.isOnline?.() === false)
          return {
            accountId: a.id,
            accountName: a.name,
            provider: a.provider,
            userLogin: "",
            openPullRequests: [],
            error: "browser is offline; reconnect to refresh",
          };
        if (!(await this.effects.hasPermission(requiredOrigins(a))))
          return {
            accountId: a.id,
            accountName: a.name,
            provider: a.provider,
            userLogin: "",
            openPullRequests: [],
            error:
              "host permission denied; open Manage accounts to grant access",
          };
        return this.loader(a);
      }),
    );
    const successful = new Set<string>();
    await this.repository.transaction(async (c) => {
      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        if (
          !c.accounts.some((a) => JSON.stringify(a) === JSON.stringify(account))
        )
          continue;
        const data = c.data[account.id] ?? emptyAccountData();
        const result = results[i];
        if (
          result.status === "fulfilled" &&
          result.value.lastSuccessfulRefresh
        ) {
          successful.add(account.id);
          // Azure votes have no submission time. Record when a vote was first observed,
          // retaining that local baseline so later comments/commits can trigger notifications.
          if (account.provider === "azure-devops") {
            for (const pr of result.value.openPullRequests) {
              const previous = data.loaded?.openPullRequests.find(
                (old) => notificationKey(old) === notificationKey(pr),
              );
              pr.reviews = pr.reviews.map((review) => ({
                ...review,
                observedAt:
                  previous?.reviews.find(
                    (old) =>
                      old.authorLogin === review.authorLogin &&
                      old.state === review.state,
                  )?.observedAt ?? Date.now(),
              }));
            }
          }
          const failed = result.value.failedProjects ?? [];
          result.value.openPullRequests.push(
            ...(data.loaded?.openPullRequests.filter((pr) =>
              failed.includes(pr.repoOwner),
            ) ?? []),
          );
          data.loaded = result.value;
        } else {
          data.loaded = {
            ...(data.loaded ?? {
              accountId: account.id,
              accountName: account.name,
              provider: account.provider,
              userLogin: "",
              openPullRequests: [],
            }),
            error:
              result.status === "rejected"
                ? safeError(result.reason)
                : result.value.error,
          };
        }
        c.data[account.id] = data;
      }
    });
    // Persist click targets before showing notifications, including across worker restarts.
    const toNotify = await this.repository.transaction((c) => {
      const active = actionable(c);
      const fresh = active.filter((pr) => {
        const data = c.data[pr.accountId];
        return (
          successful.has(pr.accountId) &&
          !data.loaded?.failedProjects?.includes(pr.repoOwner) &&
          !data.notified.includes(notificationKey(pr))
        );
      });
      for (const account of accounts) {
        const data = c.data[account.id];
        if (!data?.loaded || !successful.has(account.id)) continue;
        const keys = active
          .filter((pr) => pr.accountId === account.id)
          .map(notificationKey);
        const failedKeys = new Set(
          data.loaded.openPullRequests
            .filter((pr) => data.loaded?.failedProjects?.includes(pr.repoOwner))
            .map(notificationKey),
        );
        data.notified = data.notified.filter(
          (key) => keys.includes(key) || failedKeys.has(key),
        );
      }
      for (const pr of fresh)
        c.data[pr.accountId].notificationTargets[notificationKey(pr)] =
          pr.htmlUrl;
      return fresh;
    });
    for (const pr of toNotify) {
      const key = notificationKey(pr);
      // Serialize account removal against delivery to prevent notifications for deleted credentials.
      await this.repository.transaction(async (c) => {
        if (
          !c.accounts.some((a) => a.id === pr.accountId && a.enabled) ||
          !c.data[pr.accountId]?.notificationTargets[key]
        )
          return;
        try {
          await this.effects.notify(
            key,
            `${pr.accountName}: pull request needs attention`,
            pr.title,
          );
          c.data[pr.accountId].notified.push(key);
        } catch {
          /* Notification permission/OS failures must not discard provider data. */
        }
      });
    }
    await this.updateBadge();
    // If a configuration changed while loading, refresh the new snapshot as well.
    const current = await this.repository.read();
    if (JSON.stringify(snapshot.accounts) !== JSON.stringify(current.accounts))
      await this.runRefresh();
  }
  async updateBadge() {
    const c = await this.repository.read();
    const enabled = c.accounts.filter((a) => a.enabled);
    const usable = enabled.some(
      (a) => c.data[a.id]?.loaded?.lastSuccessfulRefresh,
    );
    const error =
      enabled.length > 0 &&
      !usable &&
      enabled.every((a) => c.data[a.id]?.loaded?.error);
    const count = actionable(c).length;
    await this.effects.badge(error ? "!" : count ? String(count) : "", error);
  }
  async mute(id: string, pr: PullRequestReference, kind: MuteType | "unmute") {
    await this.repository.transaction((c) => {
      const data = c.data[id];
      if (!data) return;
      const ref = { ...pr, accountId: id };
      data.mute =
        kind === "unmute"
          ? removePullRequestMute(data.mute, ref)
          : addMute({ getCurrentTime: Date.now }, data.mute, ref, kind);
    });
    await this.updateBadge();
  }
  async unignore(id: string, owner: string, name?: string) {
    await this.repository.transaction((c) => {
      const d = c.data[id];
      if (d)
        d.mute = name
          ? removeRepositoryMute(d.mute, { owner, name })
          : removeOwnerMute(d.mute, owner);
    });
    await this.updateBadge();
  }
  async preferences(
    id: string,
    settings: {
      notifyNewCommits: boolean;
      onlyDirectRequests: boolean;
      whitelistedTeams: string[];
    },
  ) {
    await this.repository.transaction((c) => {
      if (c.data[id]) c.data[id].mute = { ...c.data[id].mute, ...settings };
    });
    await this.updateBadge();
  }
}
