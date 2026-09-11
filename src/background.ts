import { AccountRepository } from "./accounts/storage";
import { AccountService } from "./accounts/service";
import { handleCommand, type Command } from "./accounts/messages";
import { buildAccountLoader } from "./loading/implementation";
import { openNotification } from "./accounts/notifications";

const repository = new AccountRepository(chrome.storage.local);
const service = new AccountService(repository, buildAccountLoader(), {
  isOnline: () => navigator.onLine,
  hasPermission: (origins) => chrome.permissions.contains({ origins }),
  revokePermission: (origins) => chrome.permissions.remove({ origins }),
  notify: (id, title, message) =>
    chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "images/logo128.png",
      title,
      message,
    }),
  clearNotification: (id) => chrome.notifications.clear(id),
  changed() {
    void chrome.runtime.sendMessage({ kind: "changed" }).catch(() => {});
  },
  async badge(text, error) {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({
      color: error ? "#b42318" : "#295bd6",
    });
  },
});
const ready = service.rememberOrigins();
// Register all events synchronously so suspended workers receive their wake-up event.
chrome.runtime.onMessage.addListener((command: Command, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  )
    return false;
  void ready
    .then(() => handleCommand(service, command))
    .then(respond, () =>
      respond({ ok: false, error: "Browser storage unavailable" }),
    );
  return true;
});
const refresh = () => {
  void ready
    .then(() => service.refresh())
    .catch(() => {
      /* Retry on the next alarm. No raw exceptions or credentials in logs. */
    });
};
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refresh") refresh();
});
chrome.runtime.onInstalled.addListener(refresh);
chrome.runtime.onStartup.addListener(refresh);
chrome.runtime.onUpdateAvailable.addListener(() => chrome.runtime.reload());
chrome.notifications.onClicked.addListener((id) => {
  void openNotification(
    repository,
    id,
    (url) => chrome.tabs.create({ url }),
    (key) => chrome.notifications.clear(key),
  ).catch(() => {});
});
void chrome.alarms.create("refresh", { periodInMinutes: 3 });
