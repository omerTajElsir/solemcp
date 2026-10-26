import { join } from "node:path";

/** Config directory name under the user home directory. */
export const HOME_DIR_NAME = ".solemcp";
export const CONFIG_FILE = "config.json";
export const LOCK_FILE = "config.lock";
export const BACKUP_DIR = "backups";
export const RUN_DIR = "run";
export const SOCKET_NAME = "daemon.sock";
export const LOG_DIR = "logs";
export const RESERVED_SLUG = "solemcp";
export const STATUS_TOOL = "solemcp__status";
export const NAMESPACE_SEPARATOR = "__";
export const KEYCHAIN_SERVICE = "solemcp";
export const DAEMON_TOKEN_ACCOUNT = "daemon-token";

export function solemcpHome(home: string): string {
  return join(home, HOME_DIR_NAME);
}

export function socketPath(home: string): string {
  return join(solemcpHome(home), RUN_DIR, SOCKET_NAME);
}

export type Role = "bridge" | "cli";

/**
 * First message on the Unix socket, before MCP framing.
 * A 4-byte big-endian length prefix wraps this JSON object.
 * Bridge connections speak MCP only after a valid hello.
 * CLI connections speak {@link ControlRequest} frames only.
 */
export interface HelloMessage {
  type: "hello";
  token: string;
  role: Role;
  /** Detected project root. Required for role "bridge". */
  root?: string;
  /** Client session key used by `solemcp project pin`. */
  sessionKey?: string;
}

export type ToolPolicy =
  | { mode: "all-approved" }
  | { allow: string[] }
  | { deny: string[] };

export type ControlRequest =
  | { id: string; method: "status" }
  | { id: string; method: "listProjects" }
  | { id: string; method: "approveConnector"; slug: string }
  | { id: string; method: "approveTool"; slug: string; tool: string }
  | { id: string; method: "reload" }
  | { id: string; method: "shutdown" }
  | { id: string; method: "adopt"; path: string }
  | { id: string; method: "pin"; path: string; sessionKey: string }
  | {
      id: string;
      method: "connectorAdd";
      slug: string;
      transport: "stdio" | "http";
      argv?: string[];
      url?: string;
      sseFallback?: boolean;
      secretRefs?: string[];
      headerRefs?: Record<string, string>;
      cwd?: "daemon" | "project";
      catalogId?: string;
      accountLabel?: string;
    }
  | {
      id: string;
      method: "connectorAssign";
      slug: string;
      projectId: string;
      toolPolicy?: ToolPolicy;
    }
  | {
      id: string;
      method: "connectorUnassign";
      slug: string;
      projectId: string;
    }
  | { id: string; method: "doctor" }
  | { id: string; method: "backup" }
  | { id: string; method: "rollback"; backupId?: string }
  | {
      id: string;
      method: "importPreview";
      files: { client: "cursor" | "claude-code" | "codex"; path: string; text: string }[];
    }
  | { id: string; method: "importApply"; confirmRemove: boolean }
  | { id: string; method: "startUi" }
  | { id: string; method: "stopUi" }
  | { id: string; method: "listConnectors" }
  | { id: string; method: "activity" };

export interface ControlResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

const CONTROL_METHODS = new Set<ControlRequest["method"]>([
  "status",
  "listProjects",
  "approveConnector",
  "approveTool",
  "reload",
  "shutdown",
  "adopt",
  "pin",
  "connectorAdd",
  "connectorAssign",
  "connectorUnassign",
  "doctor",
  "backup",
  "rollback",
  "importPreview",
  "importApply",
  "startUi",
  "stopUi",
  "listConnectors",
  "activity",
]);

export function parseHello(value: unknown): HelloMessage {
  if (!isRecord(value) || value.type !== "hello") {
    throw new Error("expected hello");
  }
  if (typeof value.token !== "string" || value.token.length === 0) {
    throw new Error("hello token missing");
  }
  if (value.role !== "bridge" && value.role !== "cli") {
    throw new Error("hello role invalid");
  }
  if (value.role === "bridge" && typeof value.root !== "string") {
    throw new Error("bridge hello requires root");
  }
  const hello: HelloMessage = {
    type: "hello",
    token: value.token,
    role: value.role,
  };
  if (typeof value.root === "string") hello.root = value.root;
  if (typeof value.sessionKey === "string") hello.sessionKey = value.sessionKey;
  return hello;
}

export function parseControlRequest(value: unknown): ControlRequest {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.method !== "string") {
    throw new Error("control request missing id or method");
  }
  if (!CONTROL_METHODS.has(value.method as ControlRequest["method"])) {
    throw new Error(`unknown control method ${value.method}`);
  }
  return value as ControlRequest;
}

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function createFrameDecoder(onMessage: (value: unknown) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (buffer.length < 4 + length) return;
      const body = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      onMessage(JSON.parse(body.toString("utf8")) as unknown);
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
