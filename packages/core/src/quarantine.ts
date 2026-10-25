import type { Connector, Quarantine, QuarantineTool } from "@solemcp/schema";
import { inputSchemaHash } from "./hash.ts";

export type ListedTool = {
  name: string;
  description: string;
  inputSchema: unknown;
};

/**
 * Apply an upstream tools/list snapshot to connector quarantine state.
 * - Unknown tool names become pending (hidden).
 * - Input-schema hash changes hide that tool only.
 * - Description-only changes keep approval.
 * - commandHash ≠ approvedCommandHash clears connector approval.
 */
export function applyToolList(connector: Connector, tools: ListedTool[]): Connector {
  let quarantine = connector.quarantine;

  if (
    quarantine.state === "approved" &&
    quarantine.approvedCommandHash !== connector.commandHash
  ) {
    quarantine = {
      state: "pending",
      tools: clearToolApprovals(quarantine.tools),
    };
  }

  const nextTools: Record<string, QuarantineTool> = { ...quarantine.tools };

  for (const tool of tools) {
    const hash = inputSchemaHash(tool.inputSchema);
    const prev = nextTools[tool.name];
    if (!prev) {
      nextTools[tool.name] = { inputSchemaHash: hash, state: "pending" };
      continue;
    }
    if (prev.inputSchemaHash !== hash) {
      nextTools[tool.name] = { inputSchemaHash: hash, state: "pending" };
      continue;
    }
    // Description-only or identical: keep prior state and hash.
    nextTools[tool.name] = prev;
  }

  const nextQuarantine: Quarantine =
    quarantine.state === "approved"
      ? {
          state: "approved",
          approvedCommandHash: quarantine.approvedCommandHash,
          tools: nextTools,
        }
      : { state: "pending", tools: nextTools };

  return { ...connector, quarantine: nextQuarantine };
}

/**
 * Tools that may be advertised: connector approved, tool approved, hash matches.
 */
export function visibleTools(connector: Connector, tools: ListedTool[]): ListedTool[] {
  if (connector.quarantine.state !== "approved") return [];
  if (connector.quarantine.approvedCommandHash !== connector.commandHash) return [];

  const { tools: qTools } = connector.quarantine;
  return tools.filter((tool) => {
    const entry = qTools[tool.name];
    if (!entry || entry.state !== "approved") return false;
    return entry.inputSchemaHash === inputSchemaHash(tool.inputSchema);
  });
}

function clearToolApprovals(
  tools: Record<string, QuarantineTool>,
): Record<string, QuarantineTool> {
  const out: Record<string, QuarantineTool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    out[name] = { inputSchemaHash: tool.inputSchemaHash, state: "pending" };
  }
  return out;
}
