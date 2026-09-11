import githubUser from "./fixtures/github/user.json" with { type: "json" };
import githubPR from "./fixtures/github/pull-request.json" with { type: "json" };
import graphql from "./fixtures/github/graphql.json" with { type: "json" };
import connection from "./fixtures/azure-devops/connection.json" with { type: "json" };
import azurePR from "./fixtures/azure-devops/pull-request.json" with { type: "json" };
import threads from "./fixtures/azure-devops/threads.json" with { type: "json" };
import commits from "./fixtures/azure-devops/commits.json" with { type: "json" };

export interface FixtureOptions {
  githubPagination?: boolean;
  azurePagination?: boolean;
  failedProject?: boolean;
  graphqlUnavailable?: boolean;
  invalidToken?: boolean;
  rateLimited?: boolean;
  foreignPagination?: boolean;
}
export const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
/** Shared, sanitized provider contracts for unit tests and the local HTTP server. */
export function fixtureFetch(options: FixtureOptions = {}): typeof fetch {
  const respond: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const path = decodeURIComponent(url.pathname);
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (options.invalidToken || auth.includes("fixture-invalid"))
      return jsonResponse({ message: "Rejected" }, 401);
    if (options.rateLimited)
      return jsonResponse({ message: "Rate limited" }, 429, {
        "retry-after": "60",
      });
    if (path.endsWith("/api/graphql") || path === "/graphql")
      return options.graphqlUnavailable
        ? jsonResponse({}, 404)
        : jsonResponse(graphql);
    if (path.endsWith("/user")) return jsonResponse(githubUser);
    if (path.endsWith("/search/issues")) {
      const isRequested = (url.searchParams.get("q") ?? "").includes(
        "review-requested:reviewer -author",
      );
      const base =
        url.origin === "https://api.github.com"
          ? "https://github.com"
          : url.origin + path.split("/api/v3/")[0];
      const pr = {
        ...githubPR,
        html_url: `${base}/engineering/platform/pull/42`,
        repository_url: `${url.origin}${path.replace("/search/issues", "/repos/engineering/platform")}`,
      };
      const headers: Record<string, string> = {};
      if (
        isRequested &&
        options.githubPagination &&
        !url.searchParams.get("page")
      ) {
        const next = new URL(url);
        next.searchParams.set("page", "2");
        headers.link = `<${options.foreignPagination ? "https://untrusted.example.test/search/issues" : next.href}>; rel="next"`;
      }
      return jsonResponse(
        {
          total_count: isRequested ? 1 : 0,
          incomplete_results: false,
          items: isRequested
            ? [
                url.searchParams.get("page")
                  ? {
                      ...pr,
                      number: 43,
                      node_id: "PR_fixture_43",
                      html_url: `${base}/engineering/platform/pull/43`,
                    }
                  : pr,
              ]
            : [],
        },
        200,
        headers,
      );
    }
    if (/\/pulls\/\d+$/.test(path)) return jsonResponse(githubPR);
    if (/\/pulls\/\d+\/reviews$/.test(path)) return jsonResponse([]);
    if (/\/issues\/\d+\/comments$/.test(path))
      return jsonResponse([
        { user: { login: "teammate" }, created_at: "2026-09-10T10:00:00Z" },
      ]);
    if (/\/pulls\/\d+\/commits$/.test(path))
      return jsonResponse([
        {
          author: { login: "teammate" },
          commit: { author: { date: "2026-09-11T11:00:00Z" } },
        },
      ]);
    if (path.endsWith("/status"))
      return jsonResponse({ state: "success", total_count: 1, statuses: [] });
    if (path.endsWith("/check-runs"))
      return jsonResponse({
        total_count: 1,
        check_runs: [{ status: "completed", conclusion: "success" }],
      });
    if (path.endsWith("/_apis/connectionData")) return jsonResponse(connection);
    if (path.endsWith("/_apis/projects")) {
      if (url.searchParams.has("continuationToken"))
        return jsonResponse({
          value: [{ id: "project-second", name: "Second Project" }],
        });
      const value = [{ id: "project-engineering", name: "Engineering" }];
      if (options.failedProject)
        value.push({ id: "project-forbidden", name: "Forbidden" });
      return jsonResponse(
        { value },
        200,
        options.azurePagination
          ? { "x-ms-continuationtoken": "next-project" }
          : {},
      );
    }
    if (path.includes("/project-forbidden/")) return jsonResponse({}, 403);
    if (path.includes("/project-second/")) return jsonResponse({ value: [] });
    if (path.endsWith("/_apis/git/pullrequests"))
      return jsonResponse({ value: [azurePR] });
    if (path.endsWith("/threads")) return jsonResponse(threads);
    if (path.endsWith("/commits")) return jsonResponse(commits);
    if (path.endsWith("/statuses"))
      return jsonResponse({
        value: [{ context: { name: "build" }, state: "succeeded" }],
      });
    return jsonResponse({}, 404);
  };
  return async (input, init) => {
    const response = await respond(input, init);
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
}
