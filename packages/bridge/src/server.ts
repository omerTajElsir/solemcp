import { createConnection } from "node:net";
import type { Duplex } from "node:stream";
import { Client } from "@modelcontextprotocol/client";
import { isCallToolResult } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { encodeFrame, socketPath, STATUS_TOOL, type HelloMessage } from "@solemcp/ipc";
import { createBridgeMcpServer, type BridgeMode } from "./mcp-server.ts";
import { StreamTransport } from "./stream-transport.ts";
import { createDaemonToolProvider, type ToolProvider } from "./tool-provider.ts";

export type BridgeConnect = (path: string) => Promise<Duplex>;

export type CreateBridgeServerOptions = {
  home: string;
  token: string;
  root: string;
  sessionKey?: string;
  /** Open the daemon Unix socket. Injectable for tests. */
  connect: BridgeConnect;
  /**
   * Force status-only registration (multi-root conflict).
   * Otherwise adoption is read from the daemon's {@link STATUS_TOOL}.
   */
  forceStatusOnly?: boolean;
  /** Override tool provider after hello (tests). Default talks to the daemon. */
  provider?: ToolProvider;
  /**
   * How to serve the MCP server toward the coding client.
   * Default: {@link serveStdio}. Tests may inject a no-op or custom factory.
   */
  serve?: (factory: () => Promise<McpServer>) => StdioServerHandle;
};

/**
 * Connect to the daemon, send a bridge hello, then become an MCP server
 * toward the coding client via serveStdio (or an injectable serve factory).
 */
export async function createBridgeServer(
  opts: CreateBridgeServerOptions,
): Promise<StdioServerHandle> {
  const path = socketPath(opts.home);
  const stream = await opts.connect(path);

  const hello: HelloMessage = {
    type: "hello",
    token: opts.token,
    role: "bridge",
    root: opts.root,
  };
  if (opts.sessionKey !== undefined) hello.sessionKey = opts.sessionKey;
  stream.write(encodeFrame(hello));

  let provider = opts.provider;
  let client: Client | undefined;
  if (!provider) {
    const transport = new StreamTransport(stream);
    client = new Client({ name: "solemcp-bridge", version: "0.0.0" });
    await client.connect(transport);
    provider = createDaemonToolProvider(client);
  }

  const mode = await resolveMode(provider, opts.forceStatusOnly);
  const mcpServer = await createBridgeMcpServer({ provider, mode });

  const serve = opts.serve ?? ((factory) => serveStdio(async () => factory()));
  const handle = serve(async () => mcpServer);

  const originalClose = handle.close.bind(handle);
  return {
    close: async () => {
      await originalClose();
      await client?.close().catch(() => undefined);
      stream.destroy();
    },
  };
}

/** Default TCP/Unix connect used by {@link runBridgeMain}. */
export function defaultConnect(path: string): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reject(
          new Error(
            `SoleMCP daemon socket missing at ${path}. Start it with: solemcp daemon`,
          ),
        );
        return;
      }
      reject(err);
    });
  });
}

async function resolveMode(
  provider: ToolProvider,
  forceStatusOnly: boolean | undefined,
): Promise<BridgeMode> {
  if (forceStatusOnly) return "status-only";
  try {
    const result = await provider.callTool(STATUS_TOOL, {});
    const adopted = readAdoptedFlag(result);
    return adopted ? "adopted" : "status-only";
  } catch {
    return "status-only";
  }
}

function readAdoptedFlag(result: unknown): boolean {
  if (isCallToolResult(result)) {
    for (const block of result.content) {
      if (block.type === "text") {
        try {
          const parsed = JSON.parse(block.text) as { adopted?: unknown };
          return parsed.adopted === true;
        } catch {
          /* continue */
        }
      }
    }
    return false;
  }
  if (result !== null && typeof result === "object" && "adopted" in result) {
    return (result as { adopted: unknown }).adopted === true;
  }
  return false;
}
