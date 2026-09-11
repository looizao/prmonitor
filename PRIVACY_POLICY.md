# Privacy Policy

## Data stored on your device

PR Monitor stores each configured account’s name, provider, server or organization URL, and personal access token in extension-local browser storage (`chrome.storage.local`). It also stores authenticated identity information, cached pull-request metadata, refresh times, sanitized errors, mute/ignore rules, notification preferences, notification history, and notification click-target URLs.

Multiple credentials may be saved. This storage is local to the browser profile and is not synchronized by PR Monitor. It is not equivalent to an operating-system secret store. Someone who can access your browser profile may be able to read its contents.

## Provider requests

PR Monitor sends authenticated requests to the GitHub, GitHub Enterprise Server, Azure DevOps Services, or Azure DevOps Server endpoints you configure. GitHub.com uses its associated `api.github.com` endpoint. Credentials are used only for the configured provider and are not sent to a PR Monitor service, analytics provider, or other third party. Credentialed redirects and pagination to unexpected destinations are rejected.

HTTP self-hosted servers are supported when explicitly configured. HTTP does not encrypt credentials in transit; use HTTPS when available. Browser host permissions are requested for the configured hosts during account setup or connection testing. PR Monitor does not request permanent access to all websites.

## Display and notifications

PR titles, repository information, and account names may appear in the popup and operating-system notifications. Opening a PR or repository link navigates your browser to that provider. Saved tokens are masked in account forms and are not included in UI responses, provider error messages, logs, analytics, or telemetry. PR Monitor does not collect analytics or telemetry.

## Removal and migration

Removing an account deletes its saved credential, cached PRs, notification history, and account-specific mute and ignore rules. Host access is revoked when practical if no remaining account uses it. Removing the extension deletes its extension storage through the browser’s extension-removal process.

When upgrading from the legacy single-token version, PR Monitor migrates compatible credentials, cached state, and rules locally. The legacy credential is retired only after the new account data is successfully saved. No migration data is sent to another service.
