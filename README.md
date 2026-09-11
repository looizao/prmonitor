# PR Monitor

Monitor incoming reviews and your own pull requests across multiple GitHub and Azure DevOps accounts. Each account has independent authentication, cache, errors, mute rules, notification history, and refresh state. The popup combines enabled accounts and keeps cached results visible during temporary failures.

This revamp targets Chromium Manifest V3. Firefox packaging is not currently verified.

## Build and install

Requires Node **22.12 or newer**, Corepack, and pnpm. The repository pins the pnpm version and dependency lockfile.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose `dist/`. Open the popup and select **Manage accounts**.

The toolchain uses ESM, Vite, strict TypeScript, React `createRoot`, Vitest, Oxlint, and Playwright. [T3 Code](https://github.com/pingdotgg/t3code) informed the tooling direction; this extension does not use its monorepo infrastructure or require Node 24.

## Connect accounts

Select **Add account**, choose a provider, enter a friendly name and complete server URL, and enter a personal access token. **Test connection** checks the authenticated identity and readable pull-request data. **Save account** stores the configuration and refreshes enabled accounts. A saved configuration can still have a connection error, which appears on its account card.

Saved tokens appear only as a masked placeholder. Leave the password field blank while editing to keep the current credential. Disable an account to stop refreshing and hide its PRs without deleting its data. Removal asks for confirmation and deletes its credential, cache, mute/ignore rules, and notification history.

### GitHub.com

Use `https://github.com`. Separate accounts may use the same server URL. The API endpoint is derived as `https://api.github.com`.

For fine-grained PATs, select every repository you want to monitor and grant read access to **Metadata**, **Pull requests**, **Issues** (issue comments), **Contents** (commits), **Checks**, and **Commit statuses**. Organization approval may also be required. Classic PATs need `repo` for private repositories, or `public_repo` for public-only access; organization/team policies may require `read:org` and SSO authorization. Use the least access that covers the selected repositories. See [GitHub endpoint permission requirements](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).

The loader retains authored, review-requested, and previously commented PR searches, then loads reviews, comments, commits, and checks. Pagination is supported. GitHub caps search results at 1,000; a query hitting that cap is reported as an error instead of silently presenting an incomplete refresh.

### GitHub Enterprise Server

Use the browser-facing URL, for example `https://github.company.example`. REST `/api/v3` and GraphQL `/api/graphql` are derived automatically. Custom ports and URL path prefixes are preserved. No source edits or special production build are required. If older GraphQL fields are unavailable, the loader uses REST reviews, commit statuses, and check runs. Servers must support the corresponding REST endpoints.

### Azure DevOps Services

Use a full organization URL such as `https://dev.azure.com/my-organization` or the legacy `https://my-organization.visualstudio.com`. Create a PAT with **Code: Read** (`vso.code`). Project discovery also needs **Project and Team: Read** (`vso.project`, or equivalent profile access). See Microsoft’s [PR read scope](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-requests-by-project?view=azure-devops-rest-7.1) and [project listing scopes](https://learn.microsoft.com/en-us/rest/api/azure/devops/core/projects/list?view=azure-devops-rest-7.1).

### Azure DevOps Server

Use the complete collection URL, including its protocol, port, and path:

- `https://devops.company.example/DefaultCollection`
- `http://devops.company.example:8080/tfs/DefaultCollection`

The client uses REST API 6.0 for Azure DevOps Server 2020 and newer, and Azure DevOps Services. Older Server versions are not verified. PATs use HTTP Basic authentication. Prefer HTTPS; an HTTP collection sends credentials without transport encryption. Microsoft Entra ID and OAuth are not implemented.

Project discovery follows continuation tokens. PR lists use offset pagination. Project loading is bounded and continues after an inaccessible project, retaining that project’s previous cache when available. Large collections can still generate substantial API traffic. Reviewer votes, comments, source commits, and PR status checks are loaded. Azure does not supply reliable PR change counts, so no additions/deletions summary is invented. PR status checks may not represent every branch-policy or build evaluation.

Azure reviewer votes do not carry submission timestamps. The extension records when it first observes a vote, then uses that local baseline to detect later comments and commits. Group-only reviewer assignments may not be attributed to an individual until Azure exposes that user as a reviewer; direct assignments and the user’s comments/reviews are supported.

## Browser permissions and credentials

Accounts request host permissions only when you save or test them. GitHub.com needs `api.github.com`; Enterprise and Azure accounts need their configured server origin. Broad HTTP/HTTPS patterns in `optional_host_permissions` only permit requesting access: they do not grant permanent access to every site. The browser grants access at the host level, not for one organization or collection path. Unused configured origins are revoked when practical; shared origins remain granted while another account uses them.

Tokens and PR caches live in `chrome.storage.local`, not browser sync or an operating-system secret store. Anyone with access to your browser profile may be able to read them. Saved credentials stay in the background service worker; account-page responses exclude them. Provider errors are sanitized. Credentialed requests reject redirects and out-of-scope pagination destinations. There is no analytics or telemetry. See [the privacy policy](PRIVACY_POLICY.md).

## Existing users

The first load migrates the legacy GitHub token to a `GitHub.com` account with ID `legacy-github`. Compatible cached PRs, mute/ignore rules, notification preferences, and history are migrated together. The old credential is removed only after the new collection is successfully stored. Migration is safe to retry after interruption. No sign-in is required again, but you may need to allow the new host permission from **Manage accounts**.

## Development and autonomous verification

```sh
pnpm exec playwright install chromium
pnpm qa:autonomous
```

The autonomous command runs type checking, lint, unit and contract tests, builds the production extension, then runs development UI and real-extension Chromium tests. On a fresh Linux CI machine use `pnpm exec playwright install --with-deps chromium` to install browser system dependencies. Local server ports must be available and the environment must allow launching Chromium.

Individual commands:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm test:e2e:headed
pnpm dev
```

Deterministic pages are available at `http://127.0.0.1:9000/options.html?fixture=multiple-accounts` and `http://127.0.0.1:9000/popup.html?fixture=partial-failure`. Supported fixtures: `no-accounts`, `github-account`, `enterprise-account`, `azure-account`, `server-account`, `multiple-accounts`, `disabled-account`, `partial-failure`, `empty-pr-list`, `large-pr-list`, and `permission-denied`. Invalid URL and masked-token states are exercised through the forms.

Fixtures contain synthetic data only. Playwright starts a local provider server on an available loopback port, copies the production extension into a temporary directory, and grants that copy only the test origin. The untouched production build is also loaded and checked. Temporary profiles and servers are removed after testing. Screenshots and failure traces are in `test-results/`, and the HTML report is in `playwright-report/`. Do not run fixture screenshots or traces against live credentials.

Opt-in, read-only live checks:

```sh
pnpm test:live
```

Securely provide `PRMONITOR_TEST_GITHUB_TOKEN` and optionally `PRMONITOR_TEST_GITHUB_SERVER_URL`, or `PRMONITOR_TEST_AZURE_TOKEN` and `PRMONITOR_TEST_AZURE_ORGANIZATION_URL`. These checks are skipped when credentials are absent. They only load identity and one page of PR data. They do not capture screenshots or traces, log credentials, or mutate provider resources.

Native browser permission prompts and operating-system notification interactions need a manual smoke check. Permission derivation/rejection, persisted click targets, and notification routing are covered deterministically.

## Release packaging

CI uses Corepack, pinned Node, a frozen pnpm lockfile, the autonomous suite, and package validation. Tag builds insert the version into the generated manifest and produce a ZIP with popup/options HTML, background worker, generated JS/CSS, and images.

```sh
pnpm build
RELEASE_VERSION=1.0.0 pnpm package
```

Packaging refuses test-only host permissions. The resulting archive is `pr-monitor-1.0.0.zip`. Building again restores the development manifest version.

## Troubleshooting

- **Authentication failed:** replace an expired or revoked token, check its selected repositories/organization, and authorize SSO where required.
- **Access denied:** verify the PAT permissions, organization approval, and project access. Azure project discovery requires project/profile read access in addition to Code read.
- **Host permission denied:** open Manage accounts and use Test connection or save the account to grant access. Browser settings can revoke permissions later.
- **Network/TLS/server failure:** check the full web or collection URL, VPN, proxy, network availability, and server certificate trust. Redirects are deliberately rejected; configure the final URL.
- **Rate limiting:** wait for a later refresh. Accounts refresh every three minutes, and overlapping refreshes are prevented. Lower the number of enabled accounts if the API traffic is excessive.
- **Partial failure:** healthy accounts and projects remain usable; warnings identify stale or unavailable data. The badge shows `!` only when every enabled account lacks usable data.
- **No notifications:** check browser/OS notification permissions, account enablement, mute rules, and direct-request/new-commit preferences. Previously notified PRs are not re-announced until they leave and re-enter an actionable state.
