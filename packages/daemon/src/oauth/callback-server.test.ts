import { describe, expect, it } from "vitest";
import { startOAuthCallbackServer } from "./callback-server.ts";

describe("OAuth callback server", () => {
  it("resolves when the browser hits /oauth/callback with matching state", async () => {
    const server = await startOAuthCallbackServer();
    try {
      const waiter = server.waitForCallback("abc", 5000);
      const res = await fetch(
        `http://127.0.0.1:${server.port}/oauth/callback?code=xyz&state=abc`,
      );
      expect(res.status).toBe(200);
      const url = await waiter;
      expect(url.searchParams.get("code")).toBe("xyz");
      expect(url.searchParams.get("state")).toBe("abc");
    } finally {
      await server.close();
    }
  });
});
