import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { ListedTool } from "@solemcp/core";
import type { HttpConnector } from "@solemcp/schema";
import type { Keychain } from "./keychain.ts";
import type { UpstreamStatus } from "./upstream.ts";

export type HttpUpstreamKind = "streamable-http" | "sse";

export type StartHttpUpstreamOptions = {
  url: string;
  sseFallback: boolean;
  /** Resolved header values (never secret ref names). */
  headers: Record<string, string>;
};

export type HttpUpstreamHandle = {
  client: Client;
  kind: HttpUpstreamKind;
  close: () => Promise<void>;
};

/**
 * Connect to an HTTP MCP upstream.
 * Tries Streamable HTTP first; on transport failure, one SSE fallback when enabled.
 */
export async function startHttpUpstream(
  opts: StartHttpUpstreamOptions,
): Promise<HttpUpstreamHandle> {
  const url = new URL(opts.url);
  const requestInit: RequestInit = {
    headers: { ...opts.headers },
  };

  try {
    return await connectStreamable(url, requestInit);
  } catch (streamableErr) {
    if (!opts.sseFallback) throw streamableErr;
    try {
      return await connectSse(url, requestInit);
    } catch (sseErr) {
      const streamMsg =
        streamableErr instanceof Error ? streamableErr.message : String(streamableErr);
      const sseMsg = sseErr instanceof Error ? sseErr.message : String(sseErr);
      throw new Error(
        `http upstream failed (streamable: ${streamMsg}; sse fallback: ${sseMsg})`,
      );
    }
  }
}

async function connectStreamable(
  url: URL,
  requestInit: RequestInit,
): Promise<HttpUpstreamHandle> {
  const client = new Client({ name: "solemcp-daemon", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(url, { requestInit });
  try {
    await client.connect(transport);
  } catch (err) {
    await client.close().catch(() => undefined);
    throw err;
  }
  return {
    client,
    kind: "streamable-http",
    close: async () => {
      await client.close();
    },
  };
}

async function connectSse(url: URL, requestInit: RequestInit): Promise<HttpUpstreamHandle> {
  const client = new Client({ name: "solemcp-daemon", version: "0.0.0" });
  const transport = new SSEClientTransport(url, { requestInit });
  try {
    await client.connect(transport);
  } catch (err) {
    await client.close().catch(() => undefined);
    throw err;
  }
  return {
    client,
    kind: "sse",
    close: async () => {
      await client.close();
    },
  };
}

type ManagedHttp = {
  connectorId: string;
  slug: string;
  url: string;
  sseFallback: boolean;
  headerRefs: Record<string, string>;
  handle: HttpUpstreamHandle | null;
  status: UpstreamStatus;
  tools: ListedTool[];
  kind: HttpUpstreamKind | null;
  starting: Promise<void> | null;
};

/**
 * One HTTP MCP client session per connector, shared across bridge sessions.
 */
export class HttpUpstreamManager {
  private readonly byId = new Map<string, ManagedHttp>();

  constructor(private readonly keychain: Keychain) {}

  getStatus(connectorId: string): UpstreamStatus {
    return this.byId.get(connectorId)?.status ?? "stopped";
  }

  getKind(connectorId: string): HttpUpstreamKind | null {
    return this.byId.get(connectorId)?.kind ?? null;
  }

  getTools(connectorId: string): ListedTool[] {
    return this.byId.get(connectorId)?.tools ?? [];
  }

  async ensureStarted(connector: HttpConnector): Promise<ManagedHttp> {
    let managed = this.byId.get(connector.id);
    if (!managed) {
      managed = {
        connectorId: connector.id,
        slug: connector.slug,
        url: connector.http.url,
        sseFallback: connector.http.sseFallback,
        headerRefs: connector.http.headerRefs,
        handle: null,
        status: "stopped",
        tools: [],
        kind: null,
        starting: null,
      };
      this.byId.set(connector.id, managed);
    } else {
      managed.slug = connector.slug;
      managed.url = connector.http.url;
      managed.sseFallback = connector.http.sseFallback;
      managed.headerRefs = connector.http.headerRefs;
    }

    if (managed.status === "failed") {
      throw new Error(`connector ${connector.slug} is marked failed`);
    }
    if (managed.handle && managed.status === "running") {
      return managed;
    }
    if (managed.starting) {
      await managed.starting;
      return managed;
    }

    managed.starting = this.connectAndList(managed);
    try {
      await managed.starting;
    } finally {
      managed.starting = null;
    }
    return managed;
  }

  async listTools(connector: HttpConnector): Promise<ListedTool[]> {
    const managed = await this.ensureStarted(connector);
    return managed.tools;
  }

  async callTool(
    connector: HttpConnector,
    name: string,
    args: unknown,
  ): Promise<unknown> {
    const managed = await this.ensureStarted(connector);
    if (!managed.handle) throw new Error("http upstream not running");
    return managed.handle.client.callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    });
  }

  async syncDesired(desired: HttpConnector[]): Promise<void> {
    const desiredIds = new Set(desired.map((c) => c.id));
    for (const [id] of this.byId) {
      if (!desiredIds.has(id)) {
        await this.stop(id);
      }
    }
    for (const connector of desired) {
      if (connector.quarantine.state !== "approved") continue;
      try {
        await this.ensureStarted(connector);
      } catch {
        // doctor / status surface failures
      }
    }
  }

  /** Clear a failed HTTP connector and connect once. No timer retries after failure. */
  async reconnect(connector: HttpConnector): Promise<void> {
    await this.stop(connector.id);
    const managed = this.byId.get(connector.id);
    if (managed) managed.status = "stopped";
    await this.ensureStarted(connector);
  }

  async stop(connectorId: string): Promise<void> {
    const managed = this.byId.get(connectorId);
    if (!managed) return;
    const handle = managed.handle;
    managed.handle = null;
    managed.status = "stopped";
    managed.kind = null;
    if (handle) {
      await handle.close().catch(() => undefined);
    }
  }

  async stopAll(): Promise<void> {
    const ids = [...this.byId.keys()];
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  private async connectAndList(managed: ManagedHttp): Promise<void> {
    managed.status = "starting";
    const headers: Record<string, string> = {};
    for (const [headerName, ref] of Object.entries(managed.headerRefs)) {
      const value = await this.keychain.get(ref);
      if (value === null) {
        managed.status = "failed";
        throw new Error(`missing secret ref ${ref}`);
      }
      headers[headerName] = value;
    }

    try {
      const handle = await startHttpUpstream({
        url: managed.url,
        sseFallback: managed.sseFallback,
        headers,
      });
      managed.handle = handle;
      managed.kind = handle.kind;

      const listed = await handle.client.listTools();
      managed.tools = (listed.tools ?? []).map((t) => {
        const annotations = t.annotations;
        return {
          name: t.name,
          description: t.description ?? "",
          inputSchema: t.inputSchema ?? { type: "object" },
          ...(annotations
            ? {
                annotations: {
                  ...(annotations.readOnlyHint === true ? { readOnlyHint: true as const } : {}),
                  ...(annotations.destructiveHint === true
                    ? { destructiveHint: true as const }
                    : {}),
                },
              }
            : {}),
        };
      });
      managed.status = "running";
    } catch (err) {
      managed.handle = null;
      managed.kind = null;
      managed.status = "failed";
      throw err;
    }
  }
}
