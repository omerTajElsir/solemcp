import type { Config } from "@solemcp/schema";
import { describe, expect, it } from "vitest";
import { mergeConfig } from "./merge-config.ts";

const HASH = `sha256:${"ab".repeat(32)}`;

function baseConfig(): Config {
  return {
    schemaVersion: 1,
    connectors: [
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        slug: "github",
        transport: "stdio",
        argv: ["npx", "github"],
        commandHash: HASH,
        http: null,
        secretRefs: [],
        origin: "local",
        quarantine: { state: "pending", tools: {} },
      },
    ],
    projects: [
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        originUrl: "https://github.com/a/b",
        paths: ["/a"],
        adopted: true,
        assignments: [],
      },
    ],
    clients: {
      cursor: { installed: false },
      "claude-code": { installed: false },
      codex: { installed: false },
    },
    sync: { cursors: {}, tombstones: [] },
  };
}

describe("mergeConfig", () => {
  it("merges disjoint connector and project edits", () => {
    const base = baseConfig();
    const local: Config = {
      ...base,
      connectors: [
        ...base.connectors,
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
          slug: "linear",
          transport: "http",
          argv: null,
          commandHash: HASH,
          http: {
            url: "https://example.com/mcp",
            sseFallback: false,
            headerRefs: {},
          },
          secretRefs: [],
          origin: "local",
          quarantine: { state: "pending", tools: {} },
        },
      ],
    };
    const other: Config = {
      ...base,
      projects: [
        ...base.projects,
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
          originUrl: null,
          paths: ["/other"],
          adopted: false,
          assignments: [],
        },
      ],
    };
    const merged = mergeConfig(base, local, other);
    expect(merged).not.toEqual({ conflict: true });
    if ("conflict" in merged) return;
    expect(merged.connectors).toHaveLength(2);
    expect(merged.projects).toHaveLength(2);
  });

  it("conflicts when the same connector id is edited differently on both sides", () => {
    const base = baseConfig();
    const local: Config = {
      ...base,
      connectors: [{ ...base.connectors[0]!, slug: "github-local" }],
    };
    const other: Config = {
      ...base,
      connectors: [{ ...base.connectors[0]!, slug: "github-other" }],
    };
    expect(mergeConfig(base, local, other)).toEqual({ conflict: true });
  });

  it("conflicts when the same project id is edited differently on both sides", () => {
    const base = baseConfig();
    const local: Config = {
      ...base,
      projects: [{ ...base.projects[0]!, adopted: false }],
    };
    const other: Config = {
      ...base,
      projects: [{ ...base.projects[0]!, paths: ["/other"] }],
    };
    expect(mergeConfig(base, local, other)).toEqual({ conflict: true });
  });

  it("does not conflict when both sides make identical edits", () => {
    const base = baseConfig();
    const edited: Config = {
      ...base,
      clients: {
        ...base.clients,
        cursor: { installed: true, serverKey: "solemcp" },
      },
    };
    const merged = mergeConfig(base, edited, structuredClone(edited));
    expect(merged).not.toEqual({ conflict: true });
    if ("conflict" in merged) return;
    expect(merged.clients.cursor.installed).toBe(true);
  });

  it("merges disjoint client key edits", () => {
    const base = baseConfig();
    const local: Config = {
      ...base,
      clients: { ...base.clients, cursor: { installed: true } },
    };
    const other: Config = {
      ...base,
      clients: { ...base.clients, codex: { installed: true } },
    };
    const merged = mergeConfig(base, local, other);
    expect(merged).not.toEqual({ conflict: true });
    if ("conflict" in merged) return;
    expect(merged.clients.cursor.installed).toBe(true);
    expect(merged.clients.codex.installed).toBe(true);
  });
});
