import type { AccountCollection, AccountConfig, AccountData } from "./model";
import { notificationKey } from "./model";
import type { LoadedState } from "../storage/loaded-state";
import {
  NOTHING_MUTED,
  type MuteConfiguration,
} from "../storage/mute-configuration";

export const ACCOUNTS_KEY = "accounts.v1";
export interface LocalStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}
export const emptyCollection = (): AccountCollection => ({
  version: 1,
  migrationComplete: true,
  accounts: [],
  data: {},
});
export const emptyAccountData = (): AccountData => ({
  mute: structuredClone(NOTHING_MUTED),
  notified: [],
  notificationTargets: {},
});
function legacyValue<T>(value: unknown): T | undefined {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }
  return value as T | undefined;
}
const legacyKeys = [
  "gitHubApiToken",
  "lastCheck",
  "mute",
  "lastSeenPullRequests",
  "error",
  "currentlyRefreshing",
];
export async function loadAndMigrate(
  storage: LocalStorage,
): Promise<AccountCollection> {
  const values = await storage.get([ACCOUNTS_KEY, ...legacyKeys]);
  const saved = values[ACCOUNTS_KEY] as AccountCollection | undefined;
  const token = legacyValue<string>(values.gitHubApiToken);
  if (
    saved?.version === 1 &&
    (saved.accounts.length > 0 || saved.migrationComplete)
  ) {
    // A completed atomic write is authoritative, even when the final credential cleanup was interrupted.
    if (values.gitHubApiToken !== undefined) await storage.remove(legacyKeys);
    return saved;
  }
  const collection = emptyCollection();
  if (token) {
    const account: AccountConfig = {
      id: "legacy-github",
      name: "GitHub.com",
      provider: "github",
      enabled: true,
      serverUrl: "https://github.com",
      token,
    };
    collection.accounts.push(account);
    const data = emptyAccountData();
    const previous = legacyValue<LoadedState>(values.lastCheck);
    const mute = legacyValue<MuteConfiguration>(values.mute);
    if (mute)
      data.mute = {
        ...data.mute,
        ...mute,
        mutedPullRequests: mute.mutedPullRequests.map((pr) => ({
          ...pr,
          accountId: account.id,
        })),
      };
    if (previous?.userLogin) {
      data.loaded = {
        accountId: account.id,
        accountName: account.name,
        provider: "github",
        userLogin: previous.userLogin,
        lastSuccessfulRefresh: previous.startRefreshTimestamp ?? Date.now(),
        openPullRequests: previous.openPullRequests.map((pr) => ({
          ...pr,
          accountId: account.id,
          accountName: account.name,
          provider: "github",
          currentUserLogin: previous.userLogin,
        })),
      };
      const urls = legacyValue<string[]>(values.lastSeenPullRequests) ?? [];
      for (const pr of data.loaded.openPullRequests)
        if (urls.includes(pr.htmlUrl)) {
          const key = notificationKey(pr);
          data.notified.push(key);
          data.notificationTargets[key] = pr.htmlUrl;
        }
    }
    // Preserve compatible notification URLs even when the legacy PR cache is absent.
    for (const url of legacyValue<string[]>(values.lastSeenPullRequests) ??
      []) {
      try {
        const parsed = new URL(url);
        const parts = parsed.pathname.match(
          /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/,
        );
        if (
          parsed.hostname !== "github.com" ||
          !parts ||
          !["http:", "https:"].includes(parsed.protocol)
        )
          continue;
        const key = `${account.id}:github:${encodeURIComponent(decodeURIComponent(parts[1]))}/${encodeURIComponent(decodeURIComponent(parts[2]))}:${parts[3]}`;
        if (!data.notified.includes(key)) data.notified.push(key);
        data.notificationTargets[key] = url;
      } catch {
        /* Ignore URLs that cannot be safely migrated. */
      }
    }
    collection.data[account.id] = data;
  }
  // Commit the credential, cache, and rules together before deleting any legacy fields.
  await storage.set({ [ACCOUNTS_KEY]: collection });
  if (token) await storage.remove(legacyKeys);
  return collection;
}
export class AccountRepository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private storage: LocalStorage) {}
  transaction<T>(
    update: (collection: AccountCollection) => T | Promise<T>,
  ): Promise<T> {
    const operation = this.queue.then(async () => {
      const collection = await loadAndMigrate(this.storage);
      const result = await update(collection);
      await this.storage.set({ [ACCOUNTS_KEY]: collection });
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  read(): Promise<AccountCollection> {
    const operation = this.queue.then(async () =>
      structuredClone(await loadAndMigrate(this.storage)),
    );
    this.queue = operation.catch(() => {});
    return operation;
  }
}
