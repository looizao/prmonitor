# PR Monitor Revamp Engineering Plan

## 1. Objective

Modernize PR Monitor and add first-class support for:

- Multiple GitHub.com accounts
- Multiple GitHub Enterprise Server accounts
- Multiple Azure DevOps Services organizations
- Multiple Azure DevOps Server collections
- A dedicated account configuration page
- Independent authentication, refresh, cache, error, mute, and notification state per account
- Automatic migration from the existing single GitHub token
- Autonomous unit, integration, browser, and extension testing from Codex

Use [T3 Code](https://github.com/pingdotgg/t3code) as the tooling reference.

## 2. Current Limitations

The existing extension assumes exactly one GitHub.com account:

- One global GitHub token
- One authenticated username
- One fixed GitHub API URL
- One global error and refresh state
- One cached pull-request list
- GitHub-specific naming across the loader and environment layers
- GitHub Enterprise requires source changes and a custom build
- Azure DevOps is unsupported
- Account credentials are edited inside the popup
- Mute and notification identifiers can collide across providers and accounts
- The project uses Yarn, Webpack, Jest, ESLint, React 18, and TypeScript 4

## 3. Tooling Migration

Adopt the transferable conventions used by T3 Code:

- pnpm instead of Yarn
- ESM package configuration
- Vite instead of Webpack
- Vitest instead of Jest
- Oxlint for linting
- Strict modern TypeScript
- Modern React and `createRoot`
- Reproducible installs through `pnpm-lock.yaml`

Do not copy T3 Code's monorepo-specific Effect patches, mobile tooling, custom lint plugin, or Node 24-only infrastructure. Use standard Vite, Vitest, and Oxlint packages compatible with this extension.

### Required tooling changes

- Replace `yarn.lock` with `pnpm-lock.yaml`.
- Remove Webpack, Babel, Jest, ts-jest, ESLint, and obsolete configuration files.
- Add `vite.config.ts`.
- Configure separate popup, options-page, and background service-worker entries.
- Copy `manifest.json` and `images/` into `dist`.
- Generate predictable service-worker output such as `background.js`.
- Update CI and release workflows to use Corepack and pnpm.
- Update the README build instructions.
- Require Node 22.12 or newer.

Recommended scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "oxlint src",
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed",
    "test:extension": "pnpm build && playwright test",
    "check": "pnpm typecheck && pnpm lint && pnpm test && pnpm build",
    "qa:autonomous": "pnpm check && pnpm test:extension"
  }
}
```

## 4. Provider-Neutral Account Model

Introduce a discriminated account configuration union:

```ts
type AccountConfig =
  | {
      id: string;
      name: string;
      provider: "github";
      enabled: boolean;
      serverUrl: string;
      token: string;
    }
  | {
      id: string;
      name: string;
      provider: "azure-devops";
      enabled: boolean;
      organizationUrl: string;
      token: string;
    };
```

Each loaded account should expose:

```ts
interface AccountLoadedState {
  accountId: string;
  accountName: string;
  provider: "github" | "azure-devops";
  userLogin: string;
  userDisplayName?: string;
  openPullRequests: PullRequest[];
  error?: string;
  lastSuccessfulRefresh?: number;
}
```

Each pull request must carry:

- `accountId`
- `accountName`
- `provider`
- `currentUserLogin`

This prevents collisions between identical usernames, repositories, and PR numbers on different accounts.

## 5. Provider URL Handling

### GitHub.com

For `https://github.com`, derive:

```text
REST:    https://api.github.com
GraphQL: https://api.github.com/graphql
Web:     https://github.com
```

### GitHub Enterprise Server

For a configured server such as `https://github.company.example`, derive:

```text
REST:    https://github.company.example/api/v3
GraphQL: https://github.company.example/api/graphql
Web:     https://github.company.example
```

Store the browser-facing server URL and derive API endpoints internally.

### Azure DevOps Services

Accept the complete organization URL:

```text
https://dev.azure.com/my-organization
```

Also support legacy URLs:

```text
https://my-organization.visualstudio.com
```

### Azure DevOps Server

Accept a complete collection URL:

```text
https://devops.company.example/DefaultCollection
http://devops.company.example:8080/tfs/DefaultCollection
```

Do not assume a hostname, port, collection name, path prefix, or HTTPS for a self-hosted server.

All URLs must be validated with `new URL()` and normalized by removing trailing slashes.

## 6. Browser Host Permissions

Enterprise servers can use arbitrary origins. Do not add permanent `<all_urls>` access.

Add optional host permissions:

```json
{
  "optional_host_permissions": [
    "https://*/*",
    "http://*/*"
  ]
}
```

When saving an account:

1. Derive the exact required origins.
2. Request those origins with `chrome.permissions.request`.
3. Continue only if permission is granted.
4. Explain that access is limited to the configured server.
5. Revoke origins that are no longer used by any configured account when practical.

Permission requests must happen directly from a user action such as submitting the account form.

## 7. Dedicated Account Configuration Page

Add an extension options page using `options_ui` or `options_page`.

The page must show:

- Friendly account name
- Provider badge
- Server or organization URL
- Connected identity
- Enabled or disabled state
- Last successful refresh
- Current connection error
- Add account action
- Edit account action
- Test connection action
- Enable or disable action
- Remove account action

### GitHub form

- Account name
- Server URL, defaulting to `https://github.com`
- Personal access token
- Enabled checkbox

### Azure DevOps form

- Account name
- Organization or collection URL
- Personal access token
- Enabled checkbox

### Credential behavior

- Use password inputs.
- Disable credential autocomplete where supported.
- Never redisplay a saved token in plain text.
- Show a masked placeholder while editing.
- Preserve the existing token when the field is left unchanged.
- Never include tokens in logs or error messages.
- Validate a connection before reporting it as successful.

### Removing an account

Display a confirmation explaining that removal deletes:

- The saved credential
- Cached PRs for the account
- Account-specific notification history
- Account-specific mute and ignore rules

## 8. Authentication

### GitHub

Use Octokit with personal access tokens. Support fine-grained and classic tokens where the required endpoints permit both.

Document the minimum permissions needed to read:

- Repository metadata
- Pull requests
- Reviews
- Comments
- Commits
- Checks and statuses

### Azure DevOps

Initially use PAT authentication through HTTP Basic auth:

```ts
Authorization: `Basic ${btoa(`:${token}`)}`
```

Document the minimum `vso.code` read scope.

Microsoft Entra ID or OAuth can be considered later because they require application registration and callback infrastructure.

## 9. Provider Loader Architecture

Replace the GitHub-specific loader with:

```ts
type AccountLoader = (
  account: AccountConfig
) => Promise<AccountLoadedState>;
```

Dispatch by provider:

```ts
if (account.provider === "github") {
  return loadGitHubAccount(account);
}

return loadAzureDevOpsAccount(account);
```

### GitHub loader

- Construct REST and GraphQL clients from the account configuration.
- Retain existing search, review, comment, commit, and status behavior.
- Attach account metadata to every returned PR.
- Support provider pagination and rate limiting.

### Azure DevOps loader

Suggested flow:

1. Load the authenticated identity from `_apis/connectionData`.
2. Enumerate accessible projects through `_apis/projects`.
3. Load active pull requests for each accessible project.
4. Handle continuation tokens and pagination.
5. Load reviewers and votes.
6. Load threads or comments needed for notification behavior.
7. Load commits or reliable latest-source-commit metadata.
8. Map provider data into the internal pull-request model.
9. Generate correct browser-facing repository and PR URLs.
10. Load policy, build, and check status where practical.

Azure reviewer vote mapping:

- `10` or `5`: approved
- `0`: pending
- `-5` or `-10`: changes requested
- Other nonzero values: map according to documented Azure semantics

Do not display invented change statistics. Make `changeSummary` optional when Azure DevOps does not provide reliable counts.

## 10. Multi-Account Refresh Engine

Refresh enabled accounts concurrently with `Promise.allSettled`.

Required behavior:

- A failed account must not discard successful results from other accounts.
- Preserve the last successful cache for an account that temporarily fails.
- Store errors per account.
- Merge successful PRs into the global display.
- Sort the combined list by update time.
- Do not refresh disabled accounts.
- Removing an account removes only its cached data.
- Editing an account invalidates only that account's cache.
- Prevent overlapping background refreshes.
- Refresh after an account is added or edited.
- Continue loading other Azure projects when one project is inaccessible where possible.

The badge should show the total actionable count across usable accounts. It should show a global error only when no enabled account has usable data.

## 11. Storage Migration

Keep the old `gitHubApiToken` reader temporarily.

On first load:

1. Read the new versioned account collection, such as `accounts.v1`.
2. Use it when accounts already exist.
3. If it is empty and a legacy token exists, create a default GitHub.com account.
4. Convert compatible cached state into account-scoped state.
5. Preserve mute configuration and notification history.
6. Save the new account configuration successfully.
7. Only then remove or retire the legacy credential.

Suggested migrated account:

```ts
{
  id: "legacy-github",
  name: "GitHub.com",
  provider: "github",
  enabled: true,
  serverUrl: "https://github.com",
  token: legacyToken
}
```

The migration must be idempotent and safe to retry after interruption.

## 12. Account-Scoped Mutes and Notifications

Include `accountId` in pull-request references. Otherwise, matching repository coordinates on two accounts collide.

Scope the following by account:

- Muted PRs
- Ignored repositories
- Ignored owners or projects
- Previously notified PRs
- Cached errors
- Refresh metadata

Use a stable notification key such as:

```text
{accountId}:{provider}:{repository}:{pullRequestNumber}
```

Store the click-target URL separately from the stable notification key.

Generate provider-specific repository links in the ignored-repository UI.

## 13. Popup and UI Modernization

Keep credential management out of the popup.

Recommended popup structure:

- Compact refresh and status header
- Manage accounts button
- Optional account filter
- Provider and account badge on each PR
- Existing Incoming, Muted, Reviewed, and My PRs tabs
- Aggregated actionable counts
- Compact per-account warning summary

Mount React with:

```ts
createRoot(document.getElementById("root")!).render(<App />);
```

Preserve familiar monitoring behavior while modernizing layout and accessibility.

## 14. Error Handling

Errors should identify the account without exposing credentials:

```text
Acme GitHub: authentication failed
Corporate Azure DevOps: host permission denied
```

Handle at least:

- Invalid or expired token
- Missing scopes
- Permission request rejection
- Invalid server URL
- Enterprise server unavailable
- TLS or network failure
- Offline browser state
- API rate limiting
- Azure project access restrictions
- GitHub GraphQL unavailable on an older Enterprise version
- Partial project failure

One provider or project failure must not unnecessarily invalidate other usable results.

## 15. Unit and Integration Tests

Add unit coverage for:

- GitHub URL normalization
- GitHub Enterprise endpoint derivation
- Azure Services and Server URL handling
- Host-origin permission derivation
- Legacy token migration
- Idempotent migration
- Account add, edit, enable, disable, and removal
- Account-scoped mute and notification keys
- Multiple-account aggregation
- Partial and total refresh failure
- Azure vote mapping
- Azure PR mapping
- Credential masking and preservation
- Pagination and continuation tokens

Add integration coverage for:

- Two GitHub.com accounts
- GitHub.com plus GitHub Enterprise
- GitHub plus Azure DevOps
- Two Azure DevOps organizations
- One healthy and one failing account
- Disabled accounts
- Account removal
- Extension restart after storage migration

## 16. CI and Release

Update GitHub Actions to:

- Enable Corepack.
- Install the required Node version.
- Cache pnpm.
- Run `pnpm install --frozen-lockfile`.
- Run `pnpm qa:autonomous` where the environment supports browser tests.
- Build the extension.
- Insert the release tag into the packaged manifest.
- Zip the final `dist` directory.

The release archive must contain:

- `manifest.json`
- Popup HTML and JavaScript
- Options HTML and JavaScript
- Background service worker
- Generated CSS and assets
- Extension images

## 17. Documentation and Privacy

Update the README with:

- pnpm installation and build steps
- Supported providers
- GitHub.com setup
- GitHub Enterprise setup
- Azure DevOps Services setup
- Azure DevOps Server setup
- Minimum token permissions
- Per-host browser permission behavior
- Credential storage warning
- Legacy migration behavior
- Troubleshooting instructions

Update the privacy policy to document:

- Multiple saved credentials
- Extension-local credential storage
- Requests to user-configured Enterprise hosts
- No transmission of credentials outside configured providers

## 18. Security and Product Risks

- Tokens in `chrome.storage.local` are not equivalent to operating-system secret storage.
- Arbitrary Enterprise hosts require optional host permission prompts.
- Tokens must never appear in logs, traces, telemetry, screenshots, or errors.
- Azure organizations with many projects may create substantial API traffic.
- GitHub GraphQL behavior may vary by Enterprise Server version.
- Existing mute identifiers can collide until account scoping is complete.
- Combining a tooling migration and provider rewrite increases regression risk.
- OAuth and Entra authentication are safer long-term but materially increase setup and infrastructure scope.

## 19. Recommended Delivery Sequence

1. Complete the pnpm, Vite, Vitest, Oxlint, and TypeScript migration.
2. Add the provider-neutral account model and storage migration.
3. Make GitHub.com multi-account aware.
4. Add GitHub Enterprise URL and permission support.
5. Add the dedicated options page.
6. Scope mutes, caches, errors, and notifications by account.
7. Add Azure DevOps Services support.
8. Add Azure DevOps Server URL support.
9. Add partial-failure handling and pagination.
10. Complete automated and manual extension testing.
11. Update CI, release packaging, README, and privacy policy.

## 20. Autonomous Testing from Codex

The repository must expose one command that lets Codex build, test, launch, inspect, and verify the extension with minimal user involvement.

### Layer 1: Fast deterministic checks

Codex runs:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

These checks must not require credentials, provider access, or a browser.

### Layer 2: Provider contract tests

Provider API clients should accept an injected `fetch` implementation. Tests can then simulate complete provider behavior without real accounts.

Store sanitized representative responses under:

```text
src/testing/fixtures/github/
src/testing/fixtures/azure-devops/
```

Fixtures should cover:

- GitHub.com
- GitHub Enterprise
- Azure DevOps Services
- Azure DevOps Server
- Pagination
- Invalid and expired tokens
- Rate limiting
- Partial project failures
- One successful and one failing account
- Enterprise URLs with ports and path prefixes

Never store live tokens or private repository data in fixtures.

### Layer 3: Development UI testing

Keep a development environment backed by `fakeChrome` and mocked provider clients. Expose deterministic fixture states through query parameters or a fixture selector:

```text
http://127.0.0.1:9000/options.html?fixture=multiple-accounts
http://127.0.0.1:9000/popup.html?fixture=partial-failure
```

Required scenarios:

- No accounts
- GitHub.com account
- GitHub Enterprise account
- Azure DevOps Services account
- Azure DevOps Server account
- Multiple connected accounts
- Disabled account
- Invalid URL
- Masked stored token
- Partial provider failure
- Empty PR list
- Large PR list
- Account removal confirmation

Codex can autonomously start Vite, open these scenarios in the app browser, exercise forms, inspect console errors, capture screenshots, fix defects, and repeat verification.

### Layer 4: Real extension testing with Playwright

Add `@playwright/test` and load the built Manifest V3 extension in Playwright's bundled Chromium through a persistent context.

Example fixture:

```ts
import { chromium, test as base } from "@playwright/test";
import path from "node:path";

export const test = base.extend<{ extensionId: string }>({
  extensionId: async ({}, use) => {
    const extensionPath = path.resolve("dist");
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker");
    }

    const extensionId = new URL(serviceWorker.url()).host;
    await use(extensionId);
    await context.close();
  },
});
```

Open extension pages directly:

```ts
await page.goto(`chrome-extension://${extensionId}/options.html`);
```

Use Playwright's bundled Chromium because branded Chrome and Edge do not support the required extension side-loading flags in current versions.

### Extension E2E coverage

Verify:

- Manifest V3 service worker startup
- Popup and options rendering without unexpected console errors
- Legacy storage migration
- Multiple-account persistence after restart
- Token masking and preservation during edits
- Disabled-account behavior
- Account removal and cache cleanup
- Provider and account labels
- Account-scoped notifications
- Partial provider failure
- Background alarms and refresh messages
- Correct notification click targets
- Popup and options layouts at expected dimensions

### Local provider mock server

Add a small local HTTP fixture server for full background-service-worker tests.

Emulate at least:

```text
GitHub Enterprise:
  /api/v3/user
  /api/v3/search/issues
  /api/v3/repos/*
  /api/graphql

Azure DevOps Server:
  /DefaultCollection/_apis/connectionData
  /DefaultCollection/_apis/projects
  /DefaultCollection/{project}/_apis/git/pullrequests
```

The Playwright setup should:

1. Start the server on an available local port.
2. Build the extension with the required test origin.
3. Seed account configuration into extension storage.
4. Trigger refresh through the service worker.
5. Assert UI, cache, errors, badge, and notifications.
6. Stop the server and remove the temporary browser profile.

### Live-provider smoke tests

Live tests are opt-in and read-only. Use securely provided environment variables:

```text
PRMONITOR_TEST_GITHUB_TOKEN
PRMONITOR_TEST_GITHUB_SERVER_URL
PRMONITOR_TEST_AZURE_TOKEN
PRMONITOR_TEST_AZURE_ORGANIZATION_URL
```

Skip live tests when credentials are absent. They should only verify authentication, identity loading, one page of PR data, and URL generation.

Never print environment-variable values or include them in screenshots, traces, reports, or failure messages.

### Permission-dialog limitation

Test permission derivation and rejection through unit tests and mocked Chrome APIs. A real browser host-permission prompt may require one initial user interaction.

After the user grants the test origin, Codex should autonomously verify permission detection, refresh behavior, editing, restart, removal, and permission cleanup.

### Autonomous repair loop

When asked to test the implementation, Codex should:

1. Inspect repository status and preserve unrelated changes.
2. Run `pnpm qa:autonomous`.
3. Start the deterministic fixture server.
4. Exercise every options-page and popup scenario.
5. Inspect browser and service-worker errors.
6. Capture screenshots of important states.
7. Fix every reproducible defect within scope.
8. Re-run the smallest affected tests.
9. Run the complete autonomous suite again.
10. Report changed files, commands, passing test counts, screenshots, remaining risks, and skipped live-provider checks.

### Suggested Codex implementation prompt

```text
Implement and autonomously verify the PR Monitor revamp described in ENGINEERING_REVAMP_PLAN.md. Preserve unrelated changes and inspect repository status before editing.

Use pnpm, Vite, Vitest, Oxlint, and Playwright. Add deterministic GitHub, GitHub Enterprise, Azure DevOps Services, and Azure DevOps Server fixtures. Build and load the real Manifest V3 extension in Playwright Chromium. Test the popup, options page, storage migration, background service worker, multiple-account refresh, partial failures, account-scoped notifications, and account removal.

Use browser automation to inspect the UI and console. Capture screenshots of the empty state, multiple-account configuration, populated popup, and partial-failure state. Fix every reproducible problem found and rerun the complete suite. Do not use live credentials unless they are already supplied through secure environment variables. Do not print or persist secrets.

Finish with the exact commands run, passing test counts, screenshots, remaining limitations, and manual verification steps.
```

## 21. Completion Criteria

The revamp is complete only when:

- `pnpm qa:autonomous` passes.
- The production extension build loads successfully in Playwright Chromium.
- Popup, options page, and service worker have no unexpected console errors.
- Legacy-token migration is tested.
- Multiple accounts across both providers are tested.
- Partial-account failure is tested.
- Account restart, disable, edit, and removal behavior is tested.
- Account-scoped mutes and notifications are tested.
- Key UI states have screenshot evidence.
- CI and release packaging pass.
- README and privacy policy are updated.
- Live-provider checks skipped because of missing credentials are clearly identified.
