#!/usr/bin/env node
/**
 * Tiny MCP stdio server for daemon tests.
 * Speaks newline-delimited JSON-RPC: initialize, tools/list, tools/call.
 */
import { createInterface } from "node:readline";

const TOOLS = [
  {
    name: "echo",
    description: "Echo a message",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  },
];

if (process.env.SOLEMCP_FIXTURE_TOOLS === "annotated") {
  TOOLS.push(
    {
      name: "read_item",
      description: "Read an item",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: "delete_item",
      description: "Delete an item",
      inputSchema: { type: "object", properties: {} },
      annotations: { destructiveHint: true },
    },
    {
      name: "mutate_item",
      description: "Change an item",
      inputSchema: { type: "object", properties: {} },
    },
  );
}

const rl = createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture-stdio", version: "0.0.0" },
      },
    });
    return;
  }

  if (msg.method === "notifications/initialized") return;

  if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { tools: TOOLS },
    });
    return;
  }

  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    if (name === "echo") {
      const message = String(args.message ?? "");
      if (message.startsWith("ERROR:")) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message },
        });
        return;
      }
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: message }],
        },
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `unknown tool ${name}` },
    });
    return;
  }

  if (msg.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `method not found: ${msg.method}` },
    });
  }
});
