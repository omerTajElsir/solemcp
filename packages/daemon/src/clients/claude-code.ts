import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { backupFile } from "./backup.ts";
import { claudeBridgeEntry, type BridgeLaunch } from "./bridge-launch.ts";

export function claudeAddCommand(launch: BridgeLaunch): string {
  const parts = [launch.command, ...launch.prefixArgs, "bridge"].map(shellQuote);
  return `claude mcp add solemcp --scope user -- ${parts.join(" ")}`;
}

export const CLAUDE_ADD_COMMAND = "claude mcp add solemcp --scope user -- solemcp bridge";

export const CLAUDE_SOLEMCP_ENTRY = {
  command: "solemcp",
  args: ["bridge"],
} as const;

export interface ClaudeInstallOptions {
  configPath: string;
  backupDir: string;
  dryRun?: boolean;
  launch?: BridgeLaunch;
}

export interface ClaudeInstallResult {
  wrote: boolean;
  backupPath?: string;
  printedCommand?: string;
  reason?: string;
}

export async function installClaudeCode(
  options: ClaudeInstallOptions,
): Promise<ClaudeInstallResult> {
  const launch = options.launch;
  if (options.dryRun) {
    return {
      wrote: false,
      printedCommand: launch ? claudeAddCommand(launch) : CLAUDE_ADD_COMMAND,
    };
  }

  const { configPath, backupDir } = options;
  const entry = claudeBridgeEntry(launch);
  let doc: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };

  if (existsSync(configPath)) {
    const raw = await readFile(configPath, "utf8");
    if (raw.trim()) {
      doc = JSON.parse(raw) as typeof doc;
    }
  }

  const servers = { ...(doc.mcpServers ?? {}) };
  const existing = servers.solemcp;
  if (JSON.stringify(existing) === JSON.stringify(entry)) {
    return { wrote: false, reason: "already installed" };
  }

  await mkdir(dirname(configPath), { recursive: true });
  const backupPath = await backupFile(configPath, backupDir);
  servers.solemcp = { ...entry };
  await writeFile(
    configPath,
    `${JSON.stringify({ ...doc, mcpServers: servers }, null, 2)}\n`,
    "utf8",
  );
  return { wrote: true, backupPath };
}

export function claudeInstalled(configPath: string): { installed: boolean; blocked?: string } {
  if (!existsSync(configPath)) return { installed: false };
  try {
    const doc = JSON.parse(readFileSync(configPath, "utf8")) as {
      mcpServers?: Record<string, { args?: string[]; command?: string }>;
    };
    const existing = doc.mcpServers?.solemcp;
    if (!existing) return { installed: false };
    if (Array.isArray(existing.args) && existing.args.includes("bridge")) {
      return { installed: true };
    }
    return { installed: Boolean(existing.command) };
  } catch {
    return { installed: false, blocked: "Claude settings file is not valid JSON" };
  }
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
