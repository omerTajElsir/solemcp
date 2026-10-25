import { createServer, type Server } from "node:http";

export type OAuthCallbackServer = {
  port: number;
  redirectUrl: string;
  /** Wait for the next callback matching `expectedState`. */
  waitForCallback: (expectedState: string, timeoutMs?: number) => Promise<URL>;
  close: () => Promise<void>;
};

/**
 * Loopback OAuth redirect catcher for MCP authorization-code + PKCE.
 */
export async function startOAuthCallbackServer(): Promise<OAuthCallbackServer> {
  const pending = new Map<
    string,
    { resolve: (url: URL) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  const server: Server = createServer((req, res) => {
    try {
      const host = req.headers.host ?? "127.0.0.1";
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname !== "/oauth/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const state = url.searchParams.get("state") ?? "";
      const waiter = pending.get(state);
      if (!waiter) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body><h1>Unknown or expired login</h1><p>Return to SoleMCP and try again.</p></body></html>");
        return;
      }
      clearTimeout(waiter.timer);
      pending.delete(state);
      waiter.resolve(url);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<html><body style=\"font-family:system-ui;padding:2rem\"><h1>Connected</h1><p>You can close this tab and return to SoleMCP.</p><script>window.close()</script></body></html>",
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(err instanceof Error ? err.message : "error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("OAuth callback server failed to bind");
  }

  const port = address.port;
  const redirectUrl = `http://127.0.0.1:${port}/oauth/callback`;

  return {
    port,
    redirectUrl,
    waitForCallback(expectedState, timeoutMs = 180_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(expectedState);
          reject(new Error("timed out waiting for OAuth login in the browser"));
        }, timeoutMs);
        pending.set(expectedState, { resolve, reject, timer });
      });
    },
    close: () =>
      new Promise((resolve, reject) => {
        for (const [, w] of pending) {
          clearTimeout(w.timer);
          w.reject(new Error("OAuth callback server closed"));
        }
        pending.clear();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
