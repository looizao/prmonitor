export class UserError extends Error {}
export class ProviderError extends Error {
  constructor(
    public readonly status: number,
    public readonly rateLimited = false,
  ) {
    super("Provider request failed");
  }
}
export function safeError(error: unknown): string {
  if (
    error instanceof ProviderError ||
    (typeof error === "object" && error !== null && "status" in error)
  ) {
    const status = Number((error as { status: unknown }).status);
    const headers = (
      error as { response?: { headers?: Record<string, string> } }
    ).response?.headers;
    if (
      status === 403 &&
      (headers?.["x-ratelimit-remaining"] === "0" || headers?.["retry-after"])
    )
      return "API rate limit reached; try again later";
    if (status === 401) return "authentication failed; check the token";
    if (status === 429 || (error instanceof ProviderError && error.rateLimited))
      return "API rate limit reached; try again later";
    if (status === 403)
      return "access denied; check token permissions and organization access";
    if (status === 422)
      return "query limit reached or unsupported search; narrow repository access";
    if (status === 404)
      return "resource unavailable; check server URL and token access";
    if (status >= 500) return "server unavailable; try again later";
  }
  // Never surface provider response bodies, request headers, or arbitrary exception messages.
  return "connection failed; check server URL, network, TLS, and token permissions";
}
/** Do not forward credentials through redirects or provider-controlled pagination URLs. */
export function scopedFetch(base: string, fetcher: typeof fetch): typeof fetch {
  const root = new URL(base);
  return async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (
      url.origin !== root.origin ||
      (!url.pathname.startsWith(root.pathname.replace(/\/$/, "") + "/") &&
        url.pathname !== root.pathname)
    ) {
      throw new Error("Unexpected API destination");
    }
    return fetcher(input, {
      ...init,
      redirect: "error",
      signal: init?.signal ?? AbortSignal.timeout(30_000),
    });
  };
}
