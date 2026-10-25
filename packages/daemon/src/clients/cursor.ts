import { readFileSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { backupFile } from "./backup.ts";
import { cursorBridgeEntry, type BridgeLaunch } from "./bridge-launch.ts";

export const CURSOR_SERVER_KEY = "solemcp";

/** Default shape when `solemcp` is on PATH. */
export const CURSOR_SOLEMCP_ENTRY = {
  type: "stdio",
  command: "solemcp",
  args: ["bridge", "${workspaceFolder}"],
} as const;

export interface CursorInstallOptions {
  configPath: string;
  backupDir: string;
  launch?: BridgeLaunch;
}

export interface CursorInstallResult {
  wrote: boolean;
  backupPath?: string;
  reason?: string;
}

/** True when the raw text looks like JSONC (line or block comments). */
export function hasJsonComments(text: string): boolean {
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
    } else {
      if (ch === '"') {
        inString = true;
        i++;
        continue;
      }
      if (ch === "/" && text[i + 1] === "/") return true;
      if (ch === "/" && text[i + 1] === "*") return true;
      i++;
    }
  }
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Install the managed SoleMCP entry into a Cursor mcp.json.
 * Aborts without writing when the file contains comments (JSONC not supported).
 */
export async function installCursor(options: CursorInstallOptions): Promise<CursorInstallResult> {
  const { configPath, backupDir } = options;
  const entry = cursorBridgeEntry(options.launch);
  let raw = "";
  let doc: { mcpServers?: Record<string, unknown>; [k: string]: unknown } = {
    mcpServers: {},
  };

  if (existsSync(configPath)) {
    raw = await readFile(configPath, "utf8");
    if (hasJsonComments(raw)) {
      return {
        wrote: false,
        reason: "Cursor mcp.json contains comments; JSONC is not supported yet",
      };
    }
    if (raw.trim().length > 0) {
      const parsed = JSON.parse(raw) as typeof doc;
      doc = parsed;
    }
  }

  const servers = { ...(doc.mcpServers ?? {}) };
  const existing = servers[CURSOR_SERVER_KEY];
  if (deepEqual(existing, entry)) {
    return { wrote: false, reason: "already installed" };
  }

  const backupPath = await backupFile(configPath, backupDir);
  servers[CURSOR_SERVER_KEY] = { ...entry };
  const next = { ...doc, mcpServers: servers };
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { wrote: true, backupPath };
}

export function cursorInstalled(
  configPath: string,
): { installed: boolean; blocked?: string } {
  if (!existsSync(configPath)) return { installed: false };
  const raw = readFileSync(configPath, "utf8");
  if (hasJsonComments(raw)) {
    return { installed: false, blocked: "Settings file has comments — open it and save as plain JSON, or replace it" };
  }
  try {
    const doc = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    const existing = doc.mcpServers?.[CURSOR_SERVER_KEY];
    if (!existing || typeof existing !== "object") return { installed: false };
    const args = (existing as { args?: unknown }).args;
    if (Array.isArray(args) && args.includes("bridge")) return { installed: true };
    return { installed: false };
  } catch {
    return { installed: false, blocked: "Settings file is not valid JSON" };
  }
}
