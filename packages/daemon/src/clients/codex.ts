import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { backupFile } from "./backup.ts";
import { type BridgeLaunch } from "./bridge-launch.ts";

export function codexAddCommand(launch: BridgeLaunch): string {
  const parts = [launch.command, ...launch.prefixArgs, "bridge"].map(shellQuote);
  return `codex mcp add solemcp -- ${parts.join(" ")}`;
}

export const CODEX_ADD_COMMAND = "codex mcp add solemcp -- solemcp bridge";

export function codexTomlSnippet(launch?: BridgeLaunch): string {
  const entry = launch
    ? { command: launch.command, args: [...launch.prefixArgs, "bridge"] }
    : { command: "solemcp", args: ["bridge"] };
  const args = JSON.stringify(entry.args);
  return `[mcp_servers.solemcp]\ncommand = ${tomlString(entry.command)}\nargs = ${args}\n`;
}

export const CODEX_TOML_SNIPPET = `[mcp_servers.solemcp]
command = "solemcp"
args = ["bridge"]
`;

export interface CodexInstallOptions {
  configPath: string;
  backupDir: string;
  dryRun?: boolean;
  launch?: BridgeLaunch;
}

export interface CodexInstallResult {
  wrote: boolean;
  backupPath?: string;
  printedCommand?: string;
  reason?: string;
}

function hasTomlComments(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) return true;
  }
  return false;
}

function replaceSolemcpTable(text: string, snippet: string): string {
  const tableRe = /\[mcp_servers\.solemcp\][\s\S]*?(?=\n\[|\s*$)/;
  if (tableRe.test(text)) {
    return text.replace(tableRe, snippet.trimEnd());
  }
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return snippet;
  return `${trimmed}\n\n${snippet}`;
}

function alreadyHasSolemcp(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n");
  return (
    normalized.includes("[mcp_servers.solemcp]") &&
    normalized.includes("bridge")
  );
}

export async function installCodex(options: CodexInstallOptions): Promise<CodexInstallResult> {
  const launch = options.launch;
  if (options.dryRun) {
    return {
      wrote: false,
      printedCommand: launch ? codexAddCommand(launch) : CODEX_ADD_COMMAND,
    };
  }

  const { configPath, backupDir } = options;
  const snippet = codexTomlSnippet(launch);
  let raw = "";
  if (existsSync(configPath)) {
    raw = await readFile(configPath, "utf8");
    if (hasTomlComments(raw) && !alreadyHasSolemcp(raw)) {
      return {
        wrote: false,
        reason:
          "Codex config.toml contains comments; refusing to rewrite. Prefer: " +
          (launch ? codexAddCommand(launch) : CODEX_ADD_COMMAND),
      };
    }
    if (alreadyHasSolemcp(raw)) {
      return { wrote: false, reason: "already installed" };
    }
  }

  await mkdir(dirname(configPath), { recursive: true });
  const backupPath = await backupFile(configPath, backupDir);
  const next = replaceSolemcpTable(raw, snippet);
  await writeFile(configPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  return { wrote: true, backupPath };
}

export function codexInstalled(configPath: string): { installed: boolean; blocked?: string } {
  if (!existsSync(configPath)) return { installed: false };
  const raw = readFileSync(configPath, "utf8");
  if (alreadyHasSolemcp(raw)) return { installed: true };
  if (hasTomlComments(raw)) {
    return { installed: false, blocked: "Codex settings file has comments that block auto-connect" };
  }
  return { installed: false };
}

function tomlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
