import { homedir } from "node:os";
import { join } from "node:path";
import {
  claudeAddCommand,
  claudeInstalled,
  installClaudeCode,
} from "./claude-code.ts";
import {
  codexAddCommand,
  codexInstalled,
  installCodex,
  codexTomlSnippet,
} from "./codex.ts";
import {
  cursorBridgeEntry,
  resolveBridgeLaunch,
  type BridgeLaunch,
} from "./bridge-launch.ts";
import { cursorInstalled, installCursor } from "./cursor.ts";

export type ClientName = "cursor" | "claude-code" | "codex";

export type ClientConnectCard = {
  id: ClientName;
  title: string;
  summary: string;
  configPath: string;
  installed: boolean;
  blocked?: string;
  /** Cursor deeplink (opens install prompt). */
  oneClickUrl?: string;
  /** HTTPS redirect variant for Cursor. */
  oneClickWebUrl?: string;
  /** Shell one-liner (Claude / Codex CLI). */
  cliCommand: string;
  /** JSON/TOML snippet to copy. */
  snippet: string;
  /** Label for the primary write-config action. */
  installLabel: string;
};

export type ClientConnectGuide = {
  launch: {
    command: string;
    prefixArgs: string[];
    usesAbsoluteBinary: boolean;
    entryPath: string;
  };
  note: string;
  afterInstall: string[];
  clients: ClientConnectCard[];
};

export function defaultClientPaths(env: NodeJS.ProcessEnv = process.env): Record<
  ClientName,
  string
> {
  return {
    cursor: env.SOLEMCP_CURSOR_MCP ?? join(homedir(), ".cursor", "mcp.json"),
    "claude-code": env.SOLEMCP_CLAUDE ?? join(homedir(), ".claude.json"),
    codex: env.SOLEMCP_CODEX ?? join(homedir(), ".codex", "config.toml"),
  };
}

export function defaultBackupDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SOLEMCP_BACKUP_DIR ?? join(homedir(), ".solemcp", "backups");
}

export function buildCursorInstallUrls(launch: BridgeLaunch): {
  app: string;
  web: string;
} {
  const config = cursorBridgeEntry(launch);
  const encoded = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
  const q = `name=${encodeURIComponent("solemcp")}&config=${encodeURIComponent(encoded)}`;
  return {
    app: `cursor://anysphere.cursor-deeplink/mcp/install?${q}`,
    web: `https://cursor.com/link/mcp/install?${q}`,
  };
}

export function buildClientConnectGuide(opts?: {
  env?: NodeJS.ProcessEnv;
  launch?: BridgeLaunch;
}): ClientConnectGuide {
  const env = opts?.env ?? process.env;
  const launch = opts?.launch ?? resolveBridgeLaunch();
  const paths = defaultClientPaths(env);
  const cursorUrls = buildCursorInstallUrls(launch);
  const cursorEntry = cursorBridgeEntry(launch);
  const claudeEntry = {
    command: launch.command,
    args: [...launch.prefixArgs, "bridge"],
  };

  const cursorStatus = cursorInstalled(paths.cursor);
  const claudeStatus = claudeInstalled(paths["claude-code"]);
  const codexStatus = codexInstalled(paths.codex);

  return {
    launch: {
      command: launch.command,
      prefixArgs: launch.prefixArgs,
      usesAbsoluteBinary: launch.usesAbsoluteBinary,
      entryPath: launch.entryPath,
    },
    note: launch.usesAbsoluteBinary
      ? "SoleMCP isn’t installed globally yet — Connect still works using the copy on this Mac."
      : "Your coding apps talk to SoleMCP through a private connection on this Mac.",
    afterInstall: [
      "Keep the SoleMCP window open while you work.",
      "Reload tools in your coding app so it picks up the connection.",
      "Link a project folder and enable tools for it — otherwise only a basic status check is available.",
    ],
    clients: [
      {
        id: "cursor",
        title: "Cursor",
        summary: "Connect every Cursor workspace to SoleMCP in one step.",
        configPath: paths.cursor,
        installed: cursorStatus.installed,
        blocked: cursorStatus.blocked,
        oneClickUrl: cursorUrls.app,
        oneClickWebUrl: cursorUrls.web,
        cliCommand: `solemcp client install cursor`,
        snippet: JSON.stringify({ mcpServers: { solemcp: cursorEntry } }, null, 2),
        installLabel: "Connect Cursor",
      },
      {
        id: "claude-code",
        title: "Claude Code",
        summary: "Connect Claude Code for your user account on this Mac.",
        configPath: paths["claude-code"],
        installed: claudeStatus.installed,
        blocked: claudeStatus.blocked,
        cliCommand: claudeAddCommand(launch),
        snippet: JSON.stringify({ mcpServers: { solemcp: claudeEntry } }, null, 2),
        installLabel: "Connect Claude Code",
      },
      {
        id: "codex",
        title: "Codex",
        summary: "Connect the Codex CLI on this Mac.",
        configPath: paths.codex,
        installed: codexStatus.installed,
        blocked: codexStatus.blocked,
        cliCommand: codexAddCommand(launch),
        snippet: codexTomlSnippet(launch),
        installLabel: "Connect Codex",
      },
    ],
  };
}

export async function installClient(
  client: ClientName,
  opts?: { env?: NodeJS.ProcessEnv; launch?: BridgeLaunch },
): Promise<{ wrote: boolean; reason?: string; configPath: string }> {
  const env = opts?.env ?? process.env;
  const launch = opts?.launch ?? resolveBridgeLaunch();
  const paths = defaultClientPaths(env);
  const backupDir = defaultBackupDir(env);

  if (client === "cursor") {
    const result = await installCursor({
      configPath: paths.cursor,
      backupDir,
      launch,
    });
    return { wrote: result.wrote, reason: result.reason, configPath: paths.cursor };
  }
  if (client === "claude-code") {
    const result = await installClaudeCode({
      configPath: paths["claude-code"],
      backupDir,
      launch,
    });
    return {
      wrote: result.wrote,
      reason: result.reason ?? result.printedCommand,
      configPath: paths["claude-code"],
    };
  }
  const result = await installCodex({
    configPath: paths.codex,
    backupDir,
    launch,
  });
  return { wrote: result.wrote, reason: result.reason, configPath: paths.codex };
}
