import type { Command, Reply } from "../accounts/messages";
export interface BrowserClient {
  send(command: Command): Promise<Reply>;
  subscribe(listener: () => void): () => void;
  requestPermission(origins: string[]): Promise<boolean>;
  manageAccounts(): void;
}
export async function browserClient(): Promise<BrowserClient> {
  if (import.meta.env.DEV && !globalThis.chrome?.runtime?.id) {
    const { fakeChrome } = await import("./fake-chrome");
    return fakeChrome(
      new URLSearchParams(location.search).get("fixture") ?? "no-accounts",
    );
  }
  return {
    send: (command) => chrome.runtime.sendMessage(command),
    subscribe(listener) {
      const onMessage = (message: { kind?: string }) => {
        if (message.kind === "changed") listener();
      };
      chrome.storage.onChanged.addListener(listener);
      chrome.runtime.onMessage.addListener(onMessage);
      return () => {
        chrome.storage.onChanged.removeListener(listener);
        chrome.runtime.onMessage.removeListener(onMessage);
      };
    },
    requestPermission: (origins) => chrome.permissions.request({ origins }),
    manageAccounts: () => {
      void chrome.runtime.openOptionsPage();
    },
  };
}
