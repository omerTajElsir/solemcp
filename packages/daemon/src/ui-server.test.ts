import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryKeychain, startDaemon } from "./index.ts";
import { emptyConfig } from "./empty-config.ts";
import { ConfigStore } from "./config-store.ts";
import { startUiServer } from "./ui-server.ts";

describe("loopback UI server", () => {
  it("rejects requests without the session token and serves with Bearer auth", async () => {
    const uiRoot = await mkdtemp(join(tmpdir(), "solemcp-ui-"));
    await writeFile(join(uiRoot, "index.html"), "<html>ok</html>\n");

    const ui = await startUiServer({
      uiRoot,
      handlers: {
        status: () => ({ version: "test" }),
        projects: () => [],
        connectors: () => [],
        doctor: () => ({ ok: true, issues: [] }),
        activity: () => [],
        approveConnector: async () => undefined,
        approveTool: async () => undefined,
        connectorAdd: async () => ({ id: "x", slug: "x" }),
        assign: async () => ({ assigned: true }),
        unassign: async () => ({ unassigned: true }),
        adopt: async () => ({ projectId: "p1" }),
        clients: () => ({ clients: [] }),
        clientInstall: async () => ({ wrote: false }),
        catalog: () => ({ entries: [] }),
        catalogInstall: async () => ({ slug: "x" }),
        catalogOauthStatus: async () => ({ status: "complete" }),
        calls: () => [],
        projectUpdate: async () => undefined,
        connectorReconnect: async () => undefined,
        registrySearch: async () => ({ servers: [] }),
        registryInstall: async () => ({ status: "complete" }),
      },
    });

    try {
      const denied = await fetch(`http://127.0.0.1:${ui.port}/api/status`);
      expect(denied.status).toBe(401);

      const ok = await fetch(`http://127.0.0.1:${ui.port}/api/status`, {
        headers: { Authorization: `Bearer ${ui.token}` },
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ version: "test" });

      const page = await fetch(`http://127.0.0.1:${ui.port}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("ok");
    } finally {
      await ui.close();
    }
  });

  it("startUi control method returns port and token", async () => {
    const home = await mkdtemp(join(tmpdir(), "solemcp-home-"));
    await mkdir(join(home, ".solemcp"), { recursive: true });
    const store = new ConfigStore({ home });
    await store.ensureLayout();
    await store.write(emptyConfig());

    const uiRoot = await mkdtemp(join(tmpdir(), "solemcp-ui-"));
    await writeFile(join(uiRoot, "index.html"), "<html>ui</html>\n");

    const keychain = new MemoryKeychain();
    const daemon = await startDaemon({ home, keychain, uiRoot, version: "ui-test" });

    try {
      const { createConnection } = await import("node:net");
      const {
        encodeFrame,
        createFrameDecoder,
        socketPath,
        DAEMON_TOKEN_ACCOUNT,
      } = await import("@solemcp/ipc");

      const token = await keychain.get(DAEMON_TOKEN_ACCOUNT);
      expect(token).toBeTruthy();

      const result = await new Promise<{ port: number; token: string }>((resolve, reject) => {
        const socket = createConnection(socketPath(home));
        const onFrame = createFrameDecoder((value) => {
          const res = value as { ok: boolean; result?: { port: number; token: string }; error?: string };
          socket.end();
          if (!res.ok || !res.result) reject(new Error(res.error ?? "fail"));
          else resolve(res.result);
        });
        socket.on("data", (c) => onFrame(c));
        socket.on("error", reject);
        socket.on("connect", () => {
          socket.write(encodeFrame({ type: "hello", token, role: "cli" }));
          socket.write(encodeFrame({ id: "1", method: "startUi" }));
        });
      });

      expect(result.port).toBeGreaterThan(0);
      expect(result.token.length).toBeGreaterThan(10);

      const status = await fetch(`http://127.0.0.1:${result.port}/api/status`, {
        headers: { Authorization: `Bearer ${result.token}` },
      });
      expect(status.status).toBe(200);
      const body = (await status.json()) as { version: string };
      expect(body.version).toBe("ui-test");
    } finally {
      await daemon.close();
    }
  });
});
