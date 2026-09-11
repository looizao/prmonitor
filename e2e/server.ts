import { createServer } from "node:http";
import { fixtureFetch } from "../src/testing/provider-fixtures";
export async function startProviderServer() {
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    // Retain only URL paths. Never record request headers or bodies.
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const url = new URL(req.url ?? "/", origin);
    requests.push(url.pathname);
    const headers = new Headers();
    if (req.headers.authorization)
      headers.set("authorization", req.headers.authorization);
    const response = await fixtureFetch()(url, { headers });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    origin,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
