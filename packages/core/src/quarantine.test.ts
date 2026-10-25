import type { Connector } from "@solemcp/schema";
import { describe, expect, it } from "vitest";
import { commandHash, inputSchemaHash } from "./hash.ts";
import { applyToolList, visibleTools } from "./quarantine.ts";

const SCHEMA_A = { type: "object", properties: { x: { type: "string" } } };
const SCHEMA_B = { type: "object", properties: { y: { type: "number" } } };
const HASH_A = inputSchemaHash(SCHEMA_A);
const HASH_B = inputSchemaHash(SCHEMA_B);
const CMD = commandHash({ transport: "stdio", argv: ["npx", "srv"] });

function approvedConnector(overrides?: Partial<Connector>): Connector {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    slug: "github",
    transport: "stdio",
    argv: ["npx", "srv"],
    commandHash: CMD,
    http: null,
    secretRefs: [],
    origin: "local",
    quarantine: {
      state: "approved",
      approvedCommandHash: CMD,
      tools: {
        create_issue: { inputSchemaHash: HASH_A, state: "approved" },
        list_issues: { inputSchemaHash: HASH_A, state: "approved" },
      },
    },
    ...overrides,
  } as Connector;
}

describe("applyToolList / visibleTools", () => {
  it("hides a tool name not in quarantine.tools", () => {
    const connector = approvedConnector();
    const tools = [
      { name: "create_issue", description: "a", inputSchema: SCHEMA_A },
      { name: "new_tool", description: "n", inputSchema: SCHEMA_A },
    ];
    const next = applyToolList(connector, tools);
    expect(next.quarantine.tools.new_tool).toEqual({
      inputSchemaHash: HASH_A,
      state: "pending",
    });
    expect(visibleTools(next, tools).map((t) => t.name)).toEqual(["create_issue"]);
  });

  it("hides only the tool whose inputSchemaHash changed", () => {
    const connector = approvedConnector();
    const tools = [
      { name: "create_issue", description: "a", inputSchema: SCHEMA_B },
      { name: "list_issues", description: "b", inputSchema: SCHEMA_A },
    ];
    const next = applyToolList(connector, tools);
    expect(next.quarantine.tools.create_issue).toEqual({
      inputSchemaHash: HASH_B,
      state: "pending",
    });
    expect(next.quarantine.tools.list_issues).toEqual({
      inputSchemaHash: HASH_A,
      state: "approved",
    });
    expect(visibleTools(next, tools).map((t) => t.name)).toEqual(["list_issues"]);
  });

  it("does not hide on description-only change", () => {
    const connector = approvedConnector();
    const tools = [
      { name: "create_issue", description: "brand new text", inputSchema: SCHEMA_A },
      { name: "list_issues", description: "also new", inputSchema: SCHEMA_A },
    ];
    const next = applyToolList(connector, tools);
    expect(next.quarantine.tools.create_issue?.state).toBe("approved");
    expect(visibleTools(next, tools)).toHaveLength(2);
  });

  it("clears connector approval when commandHash differs", () => {
    const connector = approvedConnector({
      commandHash: commandHash({ transport: "stdio", argv: ["npx", "other"] }),
    });
    const tools = [
      { name: "create_issue", description: "a", inputSchema: SCHEMA_A },
    ];
    const next = applyToolList(connector, tools);
    expect(next.quarantine.state).toBe("pending");
    expect(next.quarantine).not.toHaveProperty("approvedCommandHash");
    expect(visibleTools(next, tools)).toEqual([]);
  });
});
