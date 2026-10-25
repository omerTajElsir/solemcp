import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { STATUS_TOOL } from "@solemcp/ipc";
import { createBridgeMcpServer } from "./mcp-server.ts";
import type { ToolProvider } from "./tool-provider.ts";

async function withClient(
  mode: "status-only" | "adopted",
  provider: ToolProvider,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const server = await createBridgeMcpServer({ provider, mode });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("createBridgeMcpServer golden", () => {
  it("initialize + tools/list for unadopted/status-only is exactly solemcp__status", async () => {
    const provider: ToolProvider = {
      async listTools() {
        return [
          {
            name: "github__create_issue",
            description: "must not appear when status-only",
            inputSchema: { type: "object", properties: {} },
          },
        ];
      },
      async callTool() {
        return { content: [{ type: "text" as const, text: "{}" }] };
      },
    };

    await withClient("status-only", provider, async (client) => {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toEqual([STATUS_TOOL]);
    });
  });

  it("adopted lists status plus fixture namespaced tools", async () => {
    const provider: ToolProvider = {
      async listTools() {
        return [
          {
            name: "github__create_issue",
            description: "Create an issue",
            inputSchema: {
              type: "object",
              properties: { title: { type: "string" } },
              required: ["title"],
            },
          },
          {
            name: "github__list_issues",
            description: "List issues",
            inputSchema: { type: "object", properties: {} },
          },
        ];
      },
      async callTool() {
        return { content: [{ type: "text" as const, text: "{}" }] };
      },
    };

    await withClient("adopted", provider, async (client) => {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toEqual([
        STATUS_TOOL,
        "github__create_issue",
        "github__list_issues",
      ]);
    });
  });

  it("calling a tool forwards to the provider", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const provider: ToolProvider = {
      async listTools() {
        return [
          {
            name: "github__create_issue",
            description: "Create an issue",
            inputSchema: {
              type: "object",
              properties: { title: { type: "string" } },
            },
          },
        ];
      },
      async callTool(name, args) {
        calls.push({ name, args });
        return { content: [{ type: "text" as const, text: "created" }] };
      },
    };

    await withClient("adopted", provider, async (client) => {
      const result = await client.callTool({
        name: "github__create_issue",
        arguments: { title: "hello" },
      });
      expect(result).toEqual({ content: [{ type: "text", text: "created" }] });
      expect(calls).toEqual([{ name: "github__create_issue", args: { title: "hello" } }]);
    });
  });

  it("does not register approve or policy tools from the provider", async () => {
    const provider: ToolProvider = {
      async listTools() {
        return [
          { name: "solemcp__approve_connector", description: "nope", inputSchema: { type: "object" } },
          { name: "github__set_policy", description: "nope", inputSchema: { type: "object" } },
          { name: "github__ok", description: "ok", inputSchema: { type: "object" } },
        ];
      },
      async callTool() {
        return { content: [{ type: "text" as const, text: "{}" }] };
      },
    };

    await withClient("adopted", provider, async (client) => {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toEqual([STATUS_TOOL, "github__ok"]);
    });
  });
});
