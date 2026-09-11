import type { AccountCollection, AccountConfig } from "./model";
import type { PullRequestReference } from "../github-api/api";
import type { MuteType } from "../storage/mute-configuration";
import type { AccountService } from "./service";
import { UserError } from "../providers/http";

export type Command =
  | { kind: "snapshot" }
  | { kind: "refresh" }
  | { kind: "save"; account: AccountConfig }
  | { kind: "test"; account: AccountConfig }
  | { kind: "enable"; id: string; enabled: boolean }
  | { kind: "remove"; id: string }
  | {
      kind: "mute";
      id: string;
      pr: PullRequestReference;
      muteType: MuteType | "unmute";
    }
  | { kind: "unignore"; id: string; owner: string; name?: string }
  | {
      kind: "preferences";
      id: string;
      settings: {
        notifyNewCommits: boolean;
        onlyDirectRequests: boolean;
        whitelistedTeams: string[];
      };
    };
export interface Snapshot {
  collection: AccountCollection;
  refreshing: boolean;
}
export interface Reply {
  ok: boolean;
  snapshot?: Snapshot;
  message?: string;
  error?: string;
}
export async function handleCommand(
  service: AccountService,
  command: Command,
): Promise<Reply> {
  try {
    let message: string | undefined;
    switch (command.kind) {
      case "save":
        await service.save(command.account);
        message = "Account saved";
        break;
      case "test":
        message = await service.test(command.account);
        break;
      case "enable":
        await service.enable(command.id, command.enabled);
        break;
      case "remove":
        await service.remove(command.id);
        break;
      case "refresh":
        await service.refresh();
        break;
      case "mute":
        await service.mute(command.id, command.pr, command.muteType);
        break;
      case "unignore":
        await service.unignore(command.id, command.owner, command.name);
        break;
      case "preferences":
        await service.preferences(command.id, command.settings);
        break;
      case "snapshot":
        break;
      default:
        throw new UserError("Unknown request");
    }
    const snapshot = await service.snapshot();
    // Saved credentials never leave the background service worker.
    snapshot.collection.accounts = snapshot.collection.accounts.map((a) => ({
      ...a,
      token: "",
    }));
    return { ok: true, snapshot, message };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof UserError
          ? error.message
          : "Operation failed; check browser storage and try again",
    };
  }
}
