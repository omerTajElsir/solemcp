import type { Client } from "@modelcontextprotocol/client";

/** Tool descriptor advertised on the bridge MCP surface. */
export type Tool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

/**
 * Source of tools the bridge advertises (and forwards calls to).
 * Production: daemon over the Unix socket after hello.
 * Tests: an in-memory fake.
 */
export type ToolProvider = {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
};

/** ToolProvider backed by an MCP client connected to the daemon. */
export function createDaemonToolProvider(client: Client): ToolProvider {
  return {
    async listTools(): Promise<Tool[]> {
      const result = await client.listTools();
      return result.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      }));
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      return client.callTool({ name, arguments: args });
    },
  };
}
