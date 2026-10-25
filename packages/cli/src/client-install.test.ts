import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURSOR_SOLEMCP_ENTRY,
  installCursor,
  runCli,
} from "./index.ts";
import type { BridgeLaunch } from "@solemcp/daemon";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "solemcp-cli-"));
}

const pathLaunch: BridgeLaunch = {
  command: "solemcp",
  prefixArgs: [],
  usesAbsoluteBinary: false,
  entryPath: "/usr/local/bin/solemcp",
};

describe("client install cursor", () => {
  it("preserves an unrelated server and writes one solemcp entry", async () => {
    const dir = await tempDir();
    const configPath = join(dir, "mcp.json");
    const backupDir = join(dir, "backups");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            other: { command: "npx", args: ["-y", "other-mcp"] },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await installCursor({ configPath, backupDir, launch: pathLaunch });
    expect(result.wrote).toBe(true);

    const doc = JSON.parse(await readFile(configPath, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(doc.mcpServers.other).toEqual({
      command: "npx",
      args: ["-y", "other-mcp"],
    });
    expect(doc.mcpServers.solemcp).toEqual(CURSOR_SOLEMCP_ENTRY);
  });

  it("is idempotent", async () => {
    const dir = await tempDir();
    const configPath = join(dir, "mcp.json");
    const backupDir = join(dir, "backups");
    await writeFile(configPath, JSON.stringify({ mcpServers: {} }), "utf8");

    const first = await installCursor({ configPath, backupDir, launch: pathLaunch });
    expect(first.wrote).toBe(true);
    const afterFirst = await readFile(configPath, "utf8");

    const second = await installCursor({ configPath, backupDir, launch: pathLaunch });
    expect(second.wrote).toBe(false);
    expect(second.reason).toBe("already installed");
    expect(await readFile(configPath, "utf8")).toBe(afterFirst);
  });

  it("creates a backup file before write", async () => {
    const dir = await tempDir();
    const configPath = join(dir, "mcp.json");
    const backupDir = join(dir, "backups");
    const original = JSON.stringify(
      { mcpServers: { keep: { command: "x" } } },
      null,
      2,
    );
    await writeFile(configPath, original, "utf8");

    const result = await installCursor({ configPath, backupDir, launch: pathLaunch });
    expect(result.backupPath).toBeTruthy();
    expect(await readFile(result.backupPath!, "utf8")).toBe(original);
  });

  it("cli install uses SOLEMCP_CURSOR_MCP and never touches real home", async () => {
    const dir = await tempDir();
    const configPath = join(dir, "mcp.json");
    const backupDir = join(dir, "backups");
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { zed: { command: "zed" } } }),
      "utf8",
    );

    const code = await runCli(["client", "install", "cursor"], {
      env: {
        SOLEMCP_CURSOR_MCP: configPath,
        SOLEMCP_BACKUP_DIR: backupDir,
      },
      io: { stdout: () => {}, stderr: () => {} },
    });
    expect(code).toBe(0);
    const doc = JSON.parse(await readFile(configPath, "utf8")) as {
      mcpServers: { solemcp?: { args?: string[]; command?: string }; zed?: unknown };
    };
    expect(doc.mcpServers.zed).toBeTruthy();
    expect(doc.mcpServers.solemcp?.args).toContain("bridge");
    expect(doc.mcpServers.solemcp?.command).toBeTruthy();
  });
});
