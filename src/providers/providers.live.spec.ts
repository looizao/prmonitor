import { smokeAccount } from "./live-smoke";
const githubToken = process.env.PRMONITOR_TEST_GITHUB_TOKEN;
const azureToken = process.env.PRMONITOR_TEST_AZURE_TOKEN;
const azureUrl = process.env.PRMONITOR_TEST_AZURE_ORGANIZATION_URL;
it.skipIf(!githubToken)(
  "read-only GitHub identity and one-page smoke",
  async () => {
    await smokeAccount({
      id: "live",
      name: "Live GitHub",
      provider: "github",
      enabled: true,
      token: githubToken!,
      serverUrl:
        process.env.PRMONITOR_TEST_GITHUB_SERVER_URL || "https://github.com",
    });
  },
);
it.skipIf(!azureToken || !azureUrl)(
  "read-only Azure identity and one-page smoke",
  async () => {
    await smokeAccount({
      id: "live",
      name: "Live Azure",
      provider: "azure-devops",
      enabled: true,
      token: azureToken!,
      organizationUrl: azureUrl!,
    });
  },
);
