import { isCallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { STATUS_TOOL } from "@solemcp/ipc";
import type { Tool, ToolProvider } from "./tool-provider.ts";

export type BridgeMode = "status-only" | "adopted";

export type CreateBridgeMcpServerDeps = {
  provider: ToolProvider;
  /**
   * `status-only` / unadopted: only {@link STATUS_TOOL}.
   * `adopted`: status plus each namespaced tool from the provider.
   */
  mode: BridgeMode;
};

/**
 * Build an McpServer with tools already registered.
 * Safe to test without real stdio: connect via InMemoryTransport.
 */
export async function createBridgeMcpServer(
  deps: CreateBridgeMcpServerDeps,
): Promise<McpServer> {
  const server = new McpServer(
    { name: "solemcp-bridge", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  registerForwardedTool(
    server,
    {
      name: STATUS_TOOL,
      description: "SoleMCP session status for the current project root",
      inputSchema: { type: "object", properties: {} },
    },
    deps.provider,
  );

  if (deps.mode === "adopted") {
    const tools = await deps.provider.listTools();
    for (const tool of tools) {
      if (tool.name === STATUS_TOOL) continue;
      if (isForbiddenBridgeTool(tool.name)) continue;
      registerForwardedTool(server, tool, deps.provider);
    }
  }

  return server;
}

/**
 * The bridge never exposes approve, policy, or connector-mutation tools,
 * even if a misbehaving provider listed them.
 */
export function isForbiddenBridgeTool(name: string): boolean {
  if (name === STATUS_TOOL) return false;
  const lower = name.toLowerCase();
  if (lower.includes("approve")) return true;
  if (lower.includes("policy")) return true;
  if (lower.includes("connector") && (lower.includes("add") || lower.includes("assign") || lower.includes("mutate"))) {
    return true;
  }
  return false;
}

function registerForwardedTool(
  server: McpServer,
  tool: Tool,
  provider: ToolProvider,
): void {
  const inputSchema = jsonSchemaAsStandard(tool.inputSchema ?? { type: "object", properties: {} });
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema,
    },
    async (args) => toCallToolResult(await provider.callTool(tool.name, asArgs(args))),
  );
}

function asArgs(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toCallToolResult(result: unknown): CallToolResult {
  if (isCallToolResult(result)) return result;
  return {
    content: [
      {
        type: "text",
        text: typeof result === "string" ? result : JSON.stringify(result ?? null),
      },
    ],
  };
}

/** Minimal Standard Schema that advertises a JSON Schema and accepts any object. */
function jsonSchemaAsStandard(schema: Record<string, unknown>) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "solemcp",
      validate(value: unknown) {
        return { value: value ?? {} };
      },
      jsonSchema: {
        input: () => schema,
        output: () => schema,
      },
    },
  };
}
