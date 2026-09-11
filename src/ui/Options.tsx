import { useState, useRef, useEffect, type FormEvent } from "react";
import type { AccountConfig } from "../accounts/model";
import { accountUrl } from "../accounts/model";
import { normalizeAccount, requiredOrigins } from "../accounts/urls";
import { UserError } from "../providers/http";
import type { BrowserClient } from "../chrome/implementation";
import { useAccounts } from "./client";

const freshAccount = (): AccountConfig => ({
  id: crypto.randomUUID(),
  name: "",
  provider: "github",
  enabled: true,
  serverUrl: "https://github.com",
  token: "",
});
export const providerName = (provider: AccountConfig["provider"]) =>
  provider === "github" ? "GitHub" : "Azure DevOps";
export function Options({ client }: { client: BrowserClient }) {
  const { snapshot, error, setError, busy, setBusy, message, act } =
    useAccounts(client);
  const [form, setForm] = useState<AccountConfig>();
  const [removing, setRemoving] = useState<AccountConfig>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (removing) cancelRef.current?.focus();
  }, [removing]);
  const collection = snapshot?.collection;
  const editing = !!collection?.accounts.some((a) => a.id === form?.id);
  async function submit(event: FormEvent, test = false) {
    event.preventDefault();
    if (!form || busy) return;
    setError("");
    try {
      // Validation is synchronous: requesting host access remains directly inside the click/submit gesture.
      const normalized = normalizeAccount({
        ...form,
        token: form.token || (editing ? "unchanged" : ""),
      });
      const permission = client.requestPermission(requiredOrigins(normalized));
      setBusy(true);
      if (!(await permission)) {
        setError(
          "Host permission denied. Access is limited to the configured server and is required to connect.",
        );
        return;
      }
      const saved = await act({
        kind: test ? "test" : "save",
        account: { ...normalized, token: form.token },
      });
      if (saved && !test) setForm(undefined);
    } catch (failure) {
      setError(
        failure instanceof UserError
          ? failure.message
          : "Unable to request host permission",
      );
    } finally {
      setBusy(false);
    }
  }
  async function testSaved(account: AccountConfig) {
    const permission = client.requestPermission(requiredOrigins(account));
    setBusy(true);
    setError("");
    try {
      if (await permission) await act({ kind: "test", account });
      else
        setError(
          "Host permission denied. Allow access to the configured server to test the connection.",
        );
    } catch {
      setError("Unable to request host permission");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <img src="/images/logo48.png" alt="" />
          <div>
            <div className="eyebrow">PR Monitor</div>
            <h1>Connected accounts</h1>
          </div>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => setForm(freshAccount())}
        >
          Add account
        </button>
      </header>
      <p className="intro">
        Bring your pull requests together. Connect GitHub and Azure DevOps
        accounts, including your company’s own servers. Each account refreshes
        independently.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {form && (
        <form className="card form" onSubmit={(event) => void submit(event)}>
          <h2>{editing ? "Edit account" : "Add an account"}</h2>
          <label className="field">
            Account name
            <input
              autoFocus
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Acme Engineering"
            />
          </label>
          <label className="field">
            Provider
            <select
              value={form.provider}
              disabled={editing}
              onChange={(e) =>
                setForm(
                  e.target.value === "github"
                    ? {
                        id: form.id,
                        name: form.name,
                        enabled: form.enabled,
                        token: "",
                        provider: "github",
                        serverUrl: "https://github.com",
                      }
                    : {
                        id: form.id,
                        name: form.name,
                        enabled: form.enabled,
                        token: "",
                        provider: "azure-devops",
                        organizationUrl: "https://dev.azure.com/",
                      },
                )
              }
            >
              <option value="github">GitHub</option>
              <option value="azure-devops">Azure DevOps</option>
            </select>
          </label>
          <label className="field">
            {form.provider === "github"
              ? "Server URL"
              : "Organization or collection URL"}
            <input
              aria-label={
                form.provider === "github"
                  ? "Server URL"
                  : "Organization or collection URL"
              }
              aria-describedby="server-help"
              required
              type="url"
              value={accountUrl(form)}
              onChange={(e) =>
                setForm(
                  form.provider === "github"
                    ? { ...form, serverUrl: e.target.value }
                    : { ...form, organizationUrl: e.target.value },
                )
              }
            />
            <span id="server-help" className="help">
              {form.provider === "github"
                ? "Use https://github.com or your Enterprise server’s web address."
                : "Include your organization or the full Server collection path, port, and protocol."}
            </span>
          </label>
          <label className="field">
            Personal access token
            <input
              aria-label="Personal access token"
              aria-describedby="token-help"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="none"
              required={!editing}
              value={form.token}
              placeholder={
                editing
                  ? "•••••••• (saved token)"
                  : "Paste a personal access token"
              }
              onChange={(e) => setForm({ ...form, token: e.target.value })}
            />
            <span id="token-help" className="help">
              {editing ? "Leave blank to preserve the saved token. " : ""}
              Credentials are stored locally in this browser. They are not
              protected by an operating-system secret store.
            </span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
          <p className="footer">
            Your browser will ask for access to this server. The token is sent
            only to this account’s configured provider. HTTP servers send
            credentials without transport encryption.
          </p>
          <div className="actions">
            <button className="primary" disabled={busy} type="submit">
              {busy ? "Connecting…" : "Save account"}
            </button>
            <button
              disabled={busy}
              type="button"
              onClick={(e) => void submit(e, true)}
            >
              Test connection
            </button>
            <button
              disabled={busy}
              type="button"
              onClick={() => setForm(undefined)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {!snapshot && <p role="status">Loading accounts…</p>}
      {collection?.accounts.length === 0 && !form && (
        <section className="card empty">
          <h2>Your review inbox starts here</h2>
          <p>
            Add an account to monitor incoming reviews and your own pull
            requests.
          </p>
          <button className="primary" onClick={() => setForm(freshAccount())}>
            Connect your first account
          </button>
        </section>
      )}
      <div className="accounts">
        {collection?.accounts.map((account) => {
          const loaded = collection.data[account.id]?.loaded;
          return (
            <article
              className="card"
              key={account.id}
              aria-label={account.name}
            >
              <div className="account-heading">
                <h2>{account.name}</h2>
                <span
                  className={`badge ${account.provider === "azure-devops" ? "azure" : ""}`}
                >
                  {providerName(account.provider)}
                </span>
              </div>
              <p className="account-url">{accountUrl(account)}</p>
              <p className="identity">
                {loaded?.userDisplayName ||
                  loaded?.userLogin ||
                  "Not connected yet"}
              </p>
              <p className="state">
                {account.enabled ? "Enabled" : "Disabled"} ·{" "}
                {loaded?.lastSuccessfulRefresh
                  ? `Last refreshed ${new Date(loaded.lastSuccessfulRefresh).toLocaleString()}`
                  : "Awaiting first refresh"}
              </p>
              {loaded?.error && (
                <p className="warning" style={{ marginTop: 12 }}>
                  {account.name}: {loaded.error}
                </p>
              )}
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() => setForm({ ...account, token: "" })}
                >
                  Edit
                </button>
                <button disabled={busy} onClick={() => void testSaved(account)}>
                  Test connection
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act({
                      kind: "enable",
                      id: account.id,
                      enabled: !account.enabled,
                    })
                  }
                >
                  {account.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => setRemoving(account)}
                >
                  Remove
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="footer">
        Only enabled accounts appear in your inbox. Removing an account deletes
        its saved credential and account-specific monitoring data.
      </p>
      {removing && (
        <div
          className="dialog-backdrop"
          onKeyDown={(e) => {
            if (e.key === "Escape") setRemoving(undefined);
            if (e.key === "Tab") {
              const buttons = e.currentTarget.querySelectorAll("button");
              const first = buttons[0];
              const last = buttons[buttons.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }}
        >
          <section
            className="card dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-title"
            aria-describedby="remove-description"
          >
            <h2 id="remove-title">Remove {removing.name}?</h2>
            <p id="remove-description">
              This deletes the saved credential, cached pull requests,
              notification history, and all mute and ignore rules for this
              account.
            </p>
            <div className="actions">
              <button
                ref={cancelRef}
                disabled={busy}
                onClick={() => setRemoving(undefined)}
              >
                Cancel
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (await act({ kind: "remove", id: removing.id }))
                    setRemoving(undefined);
                }}
              >
                Remove account
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
