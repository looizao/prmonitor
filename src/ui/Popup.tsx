import { useState } from "react";
import type { BrowserClient } from "../chrome/implementation";
import { filtered, actionable } from "../accounts/service";
import { notificationKey } from "../accounts/model";
import { repositoryUrl } from "../accounts/urls";
import { ref } from "../storage/loaded-state";
import type { MuteType } from "../storage/mute-configuration";
import { Filter } from "../filtering/filters";
import { useAccounts } from "./client";
import { providerName } from "./Options";

const tabs = [
  [Filter.INCOMING, "Incoming"],
  [Filter.MUTED, "Muted"],
  [Filter.REVIEWED, "Reviewed"],
  [Filter.MINE, "My PRs"],
] as const;
export function Popup({ client }: { client: BrowserClient }) {
  const { snapshot, error, busy, act } = useAccounts(client);
  const [tab, setTab] = useState<Filter>(Filter.INCOMING);
  const [accountId, setAccountId] = useState("all");
  const collection = snapshot?.collection;
  const buckets = collection ? filtered(collection) : undefined;
  const prs = buckets?.[tab].filter(
    (pr) => accountId === "all" || pr.accountId === accountId,
  );
  const warnings =
    collection?.accounts.filter(
      (a) => a.enabled && collection.data[a.id]?.loaded?.error,
    ) ?? [];
  return (
    <main className="popup">
      <header className="top">
        <div className="brand">
          <img src="/images/logo48.png" alt="" />
          <h1>PR Monitor</h1>
        </div>
        <div className="actions">
          <button
            disabled={busy || snapshot?.refreshing}
            onClick={() => void act({ kind: "refresh" })}
          >
            {busy || snapshot?.refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button onClick={() => client.manageAccounts()}>
            Manage accounts
          </button>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {warnings.map((a) => (
        <p key={a.id} className="warning" role="status">
          {a.name}: {collection!.data[a.id].loaded!.error}
          {collection!.data[a.id].loaded!.lastSuccessfulRefresh
            ? " (showing cached data)"
            : ""}
        </p>
      ))}
      {!snapshot && <p role="status">Loading pull requests…</p>}
      {collection && !collection.accounts.length ? (
        <section className="card empty">
          <h2>Connect your review inbox</h2>
          <p>Add a GitHub or Azure DevOps account to get started.</p>
          <button className="primary" onClick={() => client.manageAccounts()}>
            Add account
          </button>
        </section>
      ) : (
        collection && (
          <>
            <div className="toolbar">
              <span className="muted">
                {actionable(collection).length} need attention
              </span>
              <label>
                Account{" "}
                <select
                  aria-label="Account filter"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="all">All accounts</option>
                  {collection.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.enabled ? "" : " (disabled)"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              className="tabs"
              role="tablist"
              aria-label="Pull request views"
            >
              {tabs.map(([id, label]) => (
                <button
                  role="tab"
                  id={`tab-${id}`}
                  aria-controls="pr-panel"
                  aria-selected={id === tab}
                  key={id}
                  onClick={() => setTab(id)}
                >
                  {label}
                  <span className="count">
                    {buckets?.[id].filter(
                      (pr) => accountId === "all" || pr.accountId === accountId,
                    ).length ?? 0}
                  </span>
                </button>
              ))}
            </div>
            <section
              id="pr-panel"
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
            >
              {!prs?.length && (
                <div className="card empty">
                  <h2>
                    {tab === "incoming"
                      ? "You’re all caught up"
                      : "Nothing here yet"}
                  </h2>
                  <p>
                    {collection.accounts.some((a) => a.enabled)
                      ? "No pull requests in this view."
                      : "Enable an account in Manage accounts to resume monitoring."}
                  </p>
                </div>
              )}
              {prs?.map((pr) => (
                <article key={notificationKey(pr)} className="card pr">
                  <div className="pr-meta">
                    <span
                      className={`badge ${pr.provider === "azure-devops" ? "azure" : ""}`}
                    >
                      {providerName(pr.provider)}
                    </span>
                    <span>{pr.accountName}</span>
                    <span>·</span>
                    <span>
                      {pr.repoOwner}/{pr.repoName} #{pr.pullRequestNumber}
                    </span>
                  </div>
                  <a
                    className="pr-title"
                    href={pr.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {pr.title}
                  </a>
                  <div className="pr-meta">
                    {pr.draft && <span>Draft</span>}
                    <span>
                      {pr.reviewDecision === "APPROVED"
                        ? "Approved"
                        : pr.reviewDecision === "CHANGES_REQUESTED"
                          ? "Changes requested"
                          : "Review requested"}
                    </span>
                    {pr.checkStatus && (
                      <span>Checks: {pr.checkStatus.toLowerCase()}</span>
                    )}
                    <time dateTime={pr.updatedAt}>
                      {new Date(pr.updatedAt).toLocaleDateString()}
                    </time>
                    {pr.changeSummary && (
                      <>
                        <span>{pr.changeSummary.changedFiles} files</span>
                        <span className="change-add">
                          +{pr.changeSummary.additions}
                        </span>
                        <span className="change-delete">
                          −{pr.changeSummary.deletions}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="actions">
                    {tab === "muted" ? (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act({
                            kind: "mute",
                            id: pr.accountId,
                            pr: ref(pr),
                            muteType: "unmute",
                          })
                        }
                      >
                        Unmute
                      </button>
                    ) : tab === "incoming" ? (
                      <select
                        aria-label={`Mute ${pr.title}`}
                        value=""
                        disabled={busy}
                        onChange={(e) => {
                          if (e.target.value)
                            void act({
                              kind: "mute",
                              id: pr.accountId,
                              pr: ref(pr),
                              muteType: e.target.value as MuteType,
                            });
                        }}
                      >
                        <option value="">Mute or ignore…</option>
                        <option value="1-hour">Mute for an hour</option>
                        <option value="next-update">
                          Until author updates
                        </option>
                        <option value="next-comment-by-author">
                          Until author comments
                        </option>
                        <option value="not-draft">
                          Until ready for review
                        </option>
                        <option value="forever">Mute forever</option>
                        <option value="repo">Ignore repository</option>
                        <option value="owner">Ignore owner/project</option>
                      </select>
                    ) : null}
                  </div>
                </article>
              ))}
            </section>
            <details>
              <summary>
                Notification preferences and ignored repositories
              </summary>
              {collection.accounts.map((a) => {
                const mute = collection.data[a.id]?.mute;
                if (!mute) return null;
                const settings = {
                  notifyNewCommits: !!mute.notifyNewCommits,
                  onlyDirectRequests: !!mute.onlyDirectRequests,
                  whitelistedTeams: mute.whitelistedTeams ?? [],
                };
                return (
                  <section
                    className="card"
                    key={a.id}
                    style={{ marginTop: 10 }}
                  >
                    <h3>{a.name}</h3>
                    <label className="checkbox">
                      <input
                        disabled={busy}
                        type="checkbox"
                        checked={settings.notifyNewCommits}
                        onChange={(e) =>
                          void act({
                            kind: "preferences",
                            id: a.id,
                            settings: {
                              ...settings,
                              notifyNewCommits: e.target.checked,
                            },
                          })
                        }
                      />
                      Notify about new commits
                    </label>
                    <label className="checkbox">
                      <input
                        disabled={busy}
                        type="checkbox"
                        checked={settings.onlyDirectRequests}
                        onChange={(e) =>
                          void act({
                            kind: "preferences",
                            id: a.id,
                            settings: {
                              ...settings,
                              onlyDirectRequests: e.target.checked,
                            },
                          })
                        }
                      />
                      Only direct review requests
                    </label>
                    {a.provider === "github" && (
                      <label className="field">
                        Included teams (comma separated)
                        <input
                          defaultValue={settings.whitelistedTeams.join(", ")}
                          onBlur={(e) => {
                            const teams = e.target.value
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean);
                            if (
                              JSON.stringify(teams) !==
                              JSON.stringify(settings.whitelistedTeams)
                            )
                              void act({
                                kind: "preferences",
                                id: a.id,
                                settings: {
                                  ...settings,
                                  whitelistedTeams: teams,
                                },
                              });
                          }}
                        />
                      </label>
                    )}
                    {Object.entries(mute.ignored ?? {}).flatMap(
                      ([owner, config]) =>
                        (config.kind === "ignore-all"
                          ? [undefined]
                          : config.repoNames
                        ).map((name) => (
                          <div className="ignore-row" key={`${owner}/${name}`}>
                            <a
                              target="_blank"
                              rel="noreferrer"
                              href={repositoryUrl(a, owner, name)}
                            >
                              {owner}/{name || "*"}
                            </a>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act({
                                  kind: "unignore",
                                  id: a.id,
                                  owner,
                                  name,
                                })
                              }
                            >
                              Stop ignoring
                            </button>
                          </div>
                        )),
                    )}
                  </section>
                );
              })}
            </details>
          </>
        )
      )}
    </main>
  );
}
