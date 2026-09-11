import { AccountRepository, ACCOUNTS_KEY } from "../accounts/storage";
import { AccountService } from "../accounts/service";
import { handleCommand, type Command } from "../accounts/messages";
import { fixtureCollection } from "../testing/scenarios";

/** Browser-only deterministic development adapter. Excluded from production builds. */
export function fakeChrome(fixture: string) {
  const listeners = new Set<() => void>();
  const values: Record<string, unknown> = {
    [ACCOUNTS_KEY]: fixtureCollection(fixture),
  };
  const service = new AccountService(
    new AccountRepository({
      async get(keys) {
        return structuredClone(
          Object.fromEntries(keys.map((key) => [key, values[key]])),
        );
      },
      async set(next) {
        Object.assign(values, structuredClone(next));
      },
      async remove(keys) {
        keys.forEach((key) => delete values[key]);
      },
    }),
    async (account) => {
      const state = fixtureCollection("multiple-accounts").data.github.loaded!;
      return {
        ...state,
        accountId: account.id,
        accountName: account.name,
        provider: account.provider,
        openPullRequests: state.openPullRequests.map((pr) => ({
          ...pr,
          accountId: account.id,
          accountName: account.name,
          provider: account.provider,
        })),
      };
    },
    {
      hasPermission: async () => true,
      revokePermission: async () => true,
      notify: async () => {},
      clearNotification: async () => {},
      badge: async () => {},
    },
  );
  return {
    async send(command: Command) {
      const reply = await handleCommand(service, command);
      if (command.kind !== "snapshot") listeners.forEach((fn) => fn());
      return reply;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    requestPermission: async () => fixture !== "permission-denied",
    manageAccounts() {
      window.location.href = `/options.html?fixture=${encodeURIComponent(fixture)}`;
    },
  };
}
