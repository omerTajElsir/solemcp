import { describe, expect, it } from "vitest";
import { migrateConfig, newId, parseConfig, parseProjectFile, type ToolPolicy } from "./index.ts";

const HASH = `sha256:${"ab".repeat(32)}`;

function v1Fixture() {
  const github = newId();
  const linear = newId();
  const projectId = newId();
  return {
    schemaVersion: 1 as const,
    connectors: [
      {
        id: github,
        slug: "github",
        transport: "stdio" as const,
        argv: ["npx", "-y", "@modelcontextprotocol/server-github"],
        commandHash: HASH,
        http: null,
        secretRefs: ["GITHUB_TOKEN"],
        origin: "local" as const,
        quarantine: {
          state: "approved" as const,
          approvedCommandHash: HASH,
          tools: {
            create_issue: { inputSchemaHash: HASH, state: "approved" as const },
          },
        },
      },
      {
        id: linear,
        slug: "linear",
        transport: "http" as const,
        argv: null,
        commandHash: HASH,
        http: {
          url: "https://example.com/mcp",
          sseFallback: true,
          headerRefs: { Authorization: "LINEAR_TOKEN" },
        },
        secretRefs: [],
        origin: "cloud-template" as const,
        quarantine: {
          state: "pending" as const,
          tools: {},
        },
      },
    ],
    projects: [
      {
        id: projectId,
        originUrl: "https://github.com/example/repo",
        paths: ["/Users/me/src/repo"],
        adopted: true,
        assignments: [
          { connectorId: github, toolPolicy: { mode: "all-approved" } as ToolPolicy },
          { connectorId: linear, toolPolicy: { allow: ["list_issues", "create_issue"] } as ToolPolicy },
        ],
      },
    ],
    clients: {
      cursor: { installed: true, configPath: "~/.cursor/mcp.json", serverKey: "solemcp" },
      "claude-code": { installed: true, scope: "user" },
      codex: { installed: false },
    },
    sync: {
      cursors: {},
      tombstones: [{ id: newId(), kind: "connector" as const, deletedAt: "2026-01-01T00:00:00.000Z" }],
    },
  };
}

function projectFileFixture() {
  return {
    schemaVersion: 1 as const,
    projectId: newId(),
    connectors: ["github", "linear"],
    toolPolicy: {
      github: { mode: "all-approved" as const },
      linear: { deny: ["delete_issue"] },
    },
  };
}

describe("migrateConfig", () => {
  it("fails closed when schemaVersion is missing", () => {
    expect(() => migrateConfig({})).toThrow(/schemaVersion/);
    expect(() => migrateConfig({ connectors: [] })).toThrow(/missing schemaVersion/);
    expect(() => migrateConfig(null)).toThrow(/missing schemaVersion/);
    expect(() => parseConfig({ schemaVersion: undefined })).toThrow(/schemaVersion/);
  });

  it("treats v1 to v1 as an identity", () => {
    const doc = { schemaVersion: 1, connectors: [{ slug: "kept" }], extra: { ok: true } };
    expect(migrateConfig(doc)).toEqual(doc);
  });
});

describe("parseConfig", () => {
  it("round-trips a fixture v1 document", () => {
    const fixture = v1Fixture();
    expect(parseConfig(fixture)).toEqual(fixture);
  });

  it("accepts deny tool policy and local http hosts", () => {
    const doc = v1Fixture();
    doc.projects[0].assignments[1].toolPolicy = { deny: ["delete_issue"] };
    const http = doc.connectors[1];
    if (http.transport !== "http") throw new Error("expected http connector");
    http.http.url = "http://127.0.0.1/mcp";
    expect(parseConfig(doc)).toEqual(doc);
    http.http.url = "http://localhost:3000/mcp";
    expect(parseConfig(doc)).toEqual(doc);
  });

  it("rejects a url with userinfo", () => {
    const doc = v1Fixture();
    const http = doc.connectors[1];
    if (http.transport !== "http") throw new Error("expected http connector");
    http.http.url = "https://user:pass@example.com/mcp";
    expect(() => parseConfig(doc)).toThrow(/userinfo/);
    http.http.url = "http://user@127.0.0.1/mcp";
    expect(() => parseConfig(doc)).toThrow(/userinfo/);
  });

  it("rejects non-local http urls", () => {
    const doc = v1Fixture();
    const http = doc.connectors[1];
    if (http.transport !== "http") throw new Error("expected http connector");
    http.http.url = "http://example.com/mcp";
    expect(() => parseConfig(doc)).toThrow(/127\.0\.0\.1 or localhost/);
  });

  it("rejects the reserved slug solemcp", () => {
    const doc = v1Fixture();
    doc.connectors[0].slug = "solemcp";
    expect(() => parseConfig(doc)).toThrow(/solemcp/);
  });
});

describe("parseProjectFile", () => {
  it("round-trips an allowed project file", () => {
    const file = projectFileFixture();
    expect(parseProjectFile(file)).toEqual(file);
  });

  it("rejects forbidden keys", () => {
    const forbidden = [
      "argv",
      "command",
      "url",
      "env",
      "headers",
      "token",
      "path",
      "home",
      "commandHash",
      "quarantine",
    ] as const;
    for (const key of forbidden) {
      const file = { ...projectFileFixture(), [key]: "nope" };
      expect(() => parseProjectFile(file)).toThrow(new RegExp(key));
    }
    const nested = projectFileFixture();
    (nested.toolPolicy.github as { mode: "all-approved"; url?: string }).url = "https://example.com";
    expect(() => parseProjectFile(nested)).toThrow(/url/);
  });

  it("rejects the reserved slug solemcp", () => {
    const file = projectFileFixture();
    file.connectors = ["solemcp"];
    expect(() => parseProjectFile(file)).toThrow(/solemcp/);
  });
});
