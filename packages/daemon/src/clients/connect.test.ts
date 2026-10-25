import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClientConnectGuide,
  buildCursorInstallUrls,
  installClient,
} from "./connect.ts";
import type { BridgeLaunch } from "./bridge-launch.ts";

const launch: BridgeLaunch = {
  command: "solemcp",
  prefixArgs: [],
  usesAbsoluteBinary: false,
  entryPath: "/usr/local/bin/solemcp",
};

describe("client connect guide", () => {
  it("builds a Cursor deeplink with base64 config", () => {
    const urls = buildCursorInstallUrls(launch);
    expect(urls.app).toMatch(/^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/);
    expect(urls.web).toMatch(/^https:\/\/cursor\.com\/link\/mcp\/install\?/);
    expect(urls.app).toContain("name=solemcp");
    expect(urls.app).toContain("config=");
  });

  it("reports install status and writes via installClient", async () => {
    const home = await mkdtemp(join(tmpdir(), "solemcp-connect-"));
    const cursorPath = join(home, "mcp.json");
    await mkdir(join(home, "backups"), { recursive: true });
    await writeFile(cursorPath, JSON.stringify({ mcpServers: {} }), "utf8");

    const env = {
      SOLEMCP_CURSOR_MCP: cursorPath,
      SOLEMCP_CLAUDE: join(home, ".claude.json"),
      SOLEMCP_CODEX: join(home, "config.toml"),
      SOLEMCP_BACKUP_DIR: join(home, "backups"),
    };

    const before = buildClientConnectGuide({ env, launch });
    expect(before.clients.find((c) => c.id === "cursor")?.installed).toBe(false);

    const result = await installClient("cursor", { env, launch });
    expect(result.wrote).toBe(true);

    const after = buildClientConnectGuide({ env, launch });
    expect(after.clients.find((c) => c.id === "cursor")?.installed).toBe(true);
    expect(after.clients.find((c) => c.id === "claude-code")?.cliCommand).toContain(
      "claude mcp add",
    );
  });
});
