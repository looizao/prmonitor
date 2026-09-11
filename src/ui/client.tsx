import { useCallback, useEffect, useState } from "react";
import type { Snapshot, Command } from "../accounts/messages";
import type { BrowserClient } from "../chrome/implementation";
export function useAccounts(client: BrowserClient) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const send = useCallback(
    async (command: Command) => {
      try {
        const reply = await client.send(command);
        if (!reply.ok) {
          setError(reply.error || "Operation failed");
          return false;
        }
        if (reply.snapshot) setSnapshot(reply.snapshot);
        if (reply.message) setMessage(reply.message);
        return true;
      } catch {
        setError(
          "Unable to reach the background service. Reopen the extension and try again.",
        );
        return false;
      }
    },
    [client],
  );
  useEffect(() => {
    void send({ kind: "snapshot" });
    return client.subscribe(() => {
      void send({ kind: "snapshot" });
    });
  }, [client, send]);
  async function act(command: Command) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      return await send(command);
    } finally {
      setBusy(false);
    }
  }
  return { snapshot, error, setError, busy, setBusy, message, act };
}
