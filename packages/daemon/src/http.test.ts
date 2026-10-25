import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFrameDecoder,
  encodeFrame,
  STATUS_TOOL,
  type ControlResponse,
} from "@solemcp/ipc";
import {
  MemoryKeychain,
  startDaemon,
  startHttpUpstream,
  type DaemonHandle,
} from "./index.ts";

const PING_TOOL = {
  name: "ping",
  description: "Ping tool",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

type FixtureMode = "streamable" | "sse-only";

type FixtureServer = {
  url: string;
  mode: FixtureMode;
  seenAuthHeaders: string[];
  close: () => Promise<void>;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function mcpResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function handleMcpRpc(msg: Record<string, unknown>): unknown {
  const method = msg.method;
  const id = msg.id;
  if (method === "initialize") {
    return mcpResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "fixture-http", version: "0.0.0" },
    });
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") {
    return mcpResult(id, { tools: [PING_TOOL] });
  }
  if (method === "tools/call") {
    const params = msg.params as { name?: string } | undefined;
    if (params?.name === "ping") {
      return mcpResult(id, {
        content: [{ type: "text", text: "pong" }],
      });
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `unknown tool ${params?.name}` },
    };
  }
  if (id !== undefined) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `method not found: ${method}` },
    };
  }
  return null;
}

async function startFixture(mode: FixtureMode): Promise<FixtureServer> {
  const seenAuthHeaders: string[] = [];
  /** Open SSE response streams that receive JSON-RPC replies (legacy transport). */
  const sseStreams = new Set<ServerResponse>();

  const server: Server = createServer(async (req, res) => {
    const auth = req.headers.authorization;
    if (typeof auth === "string") seenAuthHeaders.push(auth);

    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (mode === "streamable") {
      if (req.method === "POST" && (url.pathname === "/" || url.pathname === "/mcp")) {
        const raw = await readBody(req);
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          res.writeHead(400).end("bad json");
          return;
        }
        const out = handleMcpRpc(msg);
        if (out === null) {
          res.writeHead(202).end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
        return;
      }
      if (req.method === "GET") {
        res.writeHead(405).end();
        return;
      }
      res.writeHead(404).end();
      return;
    }

    // sse-only: refuse Streamable HTTP on the MCP URL; serve legacy SSE.
    if (url.pathname === "/" || url.pathname === "/mcp") {
      if (req.method === "POST") {
        res.writeHead(405, { Allow: "GET" }).end("streamable http not supported");
        return;
      }
      if (req.method === "GET") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(`event: endpoint\ndata: /messages\n\n`);
        sseStreams.add(res);
        req.on("close", () => {
          sseStreams.delete(res);
        });
        return;
      }
    }

    if (url.pathname === "/messages" && req.method === "POST") {
      const raw = await readBody(req);
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      const out = handleMcpRpc(msg);
      // Legacy SSE: ACK the POST; deliver JSON-RPC responses on the SSE stream.
      res.writeHead(202).end();
      if (out !== null) {
        const payload = `event: message\ndata: ${JSON.stringify(out)}\n\n`;
        for (const stream of sseStreams) {
          stream.write(payload);
        }
      }
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const base = `http://127.0.0.1:${addr.port}`;

  return {
    url: `${base}/mcp`,
    mode,
    seenAuthHeaders,
    close: () =>
      new Promise((resolve, reject) => {
        for (const stream of sseStreams) {
          try {
            stream.end();
          } catch {
            // ignore
          }
        }
        sseStreams.clear();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("HTTP upstreams M3", () => {
  const homes: string[] = [];
  const daemons: DaemonHandle[] = [];
  const fixtures: FixtureServer[] = [];

  afterEach(async () => {
    while (daemons.length) {
      await daemons.pop()!.close().catch(() => undefined);
    }
    while (fixtures.length) {
      await fixtures.pop()!.close().catch(() => undefined);
    }
    while (homes.length) {
      await rm(homes.pop()!, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function boot(keychain = new MemoryKeychain()) {
    const home = await mkdtemp(join(tmpdir(), "solemcp-http-"));
    homes.push(home);
    const daemon = await startDaemon({
      home,
      keychain,
      peerCheck: () => null,
    });
    daemons.push(daemon);
    return { home, keychain, daemon };
  }

  function connect(sockPath: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const sock = createConnection(sockPath);
      sock.once("connect", () => resolve(sock));
      sock.once("error", reject);
    });
  }

  function frameReader(sock: Socket): {
    next: () => Promise<unknown>;
    close: () => void;
  } {
    const queue: unknown[] = [];
    const waiters: Array<(v: unknown) => void> = [];
    const decoder = createFrameDecoder((value) => {
      const w = waiters.shift();
      if (w) w(value);
      else queue.push(value);
    });
    const onData = (chunk: Buffer) => decoder(chunk);
    sock.on("data", onData);
    return {
      next: () =>
        new Promise((resolve) => {
          if (queue.length) resolve(queue.shift()!);
          else waiters.push(resolve);
        }),
      close: () => sock.off("data", onData),
    };
  }

  async function cliRequest(
    daemon: DaemonHandle,
    body: Record<string, unknown>,
  ): Promise<ControlResponse> {
    const sock = await connect(daemon.socketPath);
    const reader = frameReader(sock);
    sock.write(encodeFrame({ type: "hello", token: daemon.token, role: "cli" }));
    sock.write(encodeFrame(body));
    const response = (await reader.next()) as ControlResponse;
    reader.close();
    sock.end();
    return response;
  }

  async function bridgeToolsList(
    daemon: DaemonHandle,
    root: string,
  ): Promise<Array<{ name: string }>> {
    const sock = await connect(daemon.socketPath);
    const reader = frameReader(sock);
    sock.write(
      encodeFrame({
        type: "hello",
        token: daemon.token,
        role: "bridge",
        root,
      }),
    );
    sock.write(
      encodeFrame({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      }),
    );
    await reader.next();
    sock.write(
      encodeFrame({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    );
    const listed = (await reader.next()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    reader.close();
    sock.end();
    return listed.result?.tools ?? [];
  }

  it("HTTP connector speaks Streamable HTTP against a local fixture", async () => {
    const fixture = await startFixture("streamable");
    fixtures.push(fixture);
    const secret = "streamable-secret-token";
    const keychain = new MemoryKeychain();
    await keychain.set("HTTP_TOKEN", secret);

    const handle = await startHttpUpstream({
      url: fixture.url,
      sseFallback: false,
      headers: { Authorization: `Bearer ${secret}` },
    });
    try {
      const { tools } = await handle.client.listTools();
      expect(tools.map((t) => t.name)).toEqual(["ping"]);
      expect(handle.kind).toBe("streamable-http");
      expect(fixture.seenAuthHeaders).toContain(`Bearer ${secret}`);
    } finally {
      await handle.close();
    }
  });

  it("SSE fallback runs when streamable HTTP is refused and sseFallback is true", async () => {
    const fixture = await startFixture("sse-only");
    fixtures.push(fixture);
    const secret = "sse-fallback-secret";

    const handle = await startHttpUpstream({
      url: fixture.url,
      sseFallback: true,
      headers: { Authorization: `Bearer ${secret}` },
    });
    try {
      expect(handle.kind).toBe("sse");
      const { tools } = await handle.client.listTools();
      expect(tools.map((t) => t.name)).toEqual(["ping"]);
      expect(fixture.seenAuthHeaders.some((h) => h.includes(secret))).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it("header values come from MemoryKeychain, not config.json", async () => {
    const fixture = await startFixture("streamable");
    fixtures.push(fixture);
    const secret = "keychain-only-secret-value";
    const keychain = new MemoryKeychain();
    await keychain.set("API_TOKEN", secret);

    const { home, daemon } = await boot(keychain);
    const projectRoot = "/tmp/http-header-project";

    const adopt = await cliRequest(daemon, {
      id: "1",
      method: "adopt",
      path: projectRoot,
    });
    const projectId = (adopt.result as { projectId: string }).projectId;

    const add = await cliRequest(daemon, {
      id: "2",
      method: "connectorAdd",
      slug: "remote",
      transport: "http",
      url: fixture.url,
      sseFallback: false,
      headerRefs: { Authorization: "API_TOKEN" },
    });
    expect(add.ok).toBe(true);

    // Config must store the ref name, never the secret value.
    const configText = await readFile(join(home, ".solemcp", "config.json"), "utf8");
    expect(configText).toContain("API_TOKEN");
    expect(configText).not.toContain(secret);

    await cliRequest(daemon, {
      id: "3",
      method: "connectorAssign",
      slug: "remote",
      projectId,
      toolPolicy: { mode: "all-approved" },
    });
    await cliRequest(daemon, {
      id: "4",
      method: "approveConnector",
      slug: "remote",
    });

    await bridgeToolsList(daemon, projectRoot);
    await cliRequest(daemon, {
      id: "5",
      method: "approveTool",
      slug: "remote",
      tool: "ping",
    });

    const tools = await bridgeToolsList(daemon, projectRoot);
    expect(tools.map((t) => t.name).sort()).toEqual(
      [STATUS_TOOL, "remote__ping"].sort(),
    );

    // Fixture must have received the resolved secret header from the keychain.
    expect(fixture.seenAuthHeaders).toContain(secret);
  });
});
