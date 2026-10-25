import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Keychain } from "./keychain.ts";
import type { ListedTool } from "@solemcp/core";
import type { StdioConnector } from "@solemcp/schema";

const BACKOFF_CAP_MS = 30_000;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;

export type UpstreamStatus = "stopped" | "starting" | "running" | "failed";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

type ManagedUpstream = {
  connectorId: string;
  slug: string;
  argv: string[];
  secretRefs: string[];
  cwd?: string;
  process: ChildProcessWithoutNullStreams | null;
  status: UpstreamStatus;
  tools: ListedTool[];
  failures: number[];
  restartAttempt: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  pending: Map<number | string, Pending>;
  nextId: number;
  starting: Promise<void> | null;
};

/**
 * One stdio MCP process per connector, shared across sessions.
 * Crash backoff 1s, 2s, 4s capped 30s; after 5 failures in 5 minutes → failed.
 */
export class UpstreamManager {
  private readonly byId = new Map<string, ManagedUpstream>();

  constructor(private readonly keychain: Keychain) {}

  getStatus(connectorId: string): UpstreamStatus {
    return this.byId.get(connectorId)?.status ?? "stopped";
  }

  getTools(connectorId: string): ListedTool[] {
    return this.byId.get(connectorId)?.tools ?? [];
  }

  /** Ensure a connector process is running (or mark failed). */
  async ensureStarted(
    connector: StdioConnector,
    opts: { cwd?: string } = {},
  ): Promise<ManagedUpstream> {
    let managed = this.byId.get(connector.id);
    if (!managed) {
      managed = {
        connectorId: connector.id,
        slug: connector.slug,
        argv: connector.argv,
        secretRefs: connector.secretRefs,
        cwd: opts.cwd,
        process: null,
        status: "stopped",
        tools: [],
        failures: [],
        restartAttempt: 0,
        restartTimer: null,
        pending: new Map(),
        nextId: 1,
        starting: null,
      };
      this.byId.set(connector.id, managed);
    } else {
      managed.argv = connector.argv;
      managed.secretRefs = connector.secretRefs;
      managed.slug = connector.slug;
      if (opts.cwd !== undefined) managed.cwd = opts.cwd;
    }

    if (managed.status === "failed") {
      throw new Error(`connector ${connector.slug} is marked failed`);
    }
    if (managed.process && managed.status === "running") {
      return managed;
    }
    if (managed.starting) {
      await managed.starting;
      return managed;
    }

    managed.starting = this.spawnAndInit(managed);
    try {
      await managed.starting;
    } finally {
      managed.starting = null;
    }
    return managed;
  }

  async listTools(connector: StdioConnector, opts?: { cwd?: string }): Promise<ListedTool[]> {
    const managed = await this.ensureStarted(connector, opts);
    return managed.tools;
  }

  async callTool(
    connector: StdioConnector,
    name: string,
    args: unknown,
    opts?: { cwd?: string },
  ): Promise<unknown> {
    const managed = await this.ensureStarted(connector, opts);
    return this.request(managed, "tools/call", { name, arguments: args ?? {} });
  }

  /** Stop connectors that should not run; start those that should. */
  async syncDesired(
    desired: StdioConnector[],
    cwdFor: (c: StdioConnector) => string | undefined,
  ): Promise<void> {
    const desiredIds = new Set(desired.map((c) => c.id));
    for (const [id, managed] of this.byId) {
      if (!desiredIds.has(id)) {
        await this.stop(id);
      }
    }
    for (const connector of desired) {
      if (connector.quarantine.state !== "approved") continue;
      try {
        await this.ensureStarted(connector, { cwd: cwdFor(connector) });
      } catch {
        // Doctor / status surface failures; do not throw the sync.
      }
    }
  }

  async stop(connectorId: string): Promise<void> {
    const managed = this.byId.get(connectorId);
    if (!managed) return;
    if (managed.restartTimer) {
      clearTimeout(managed.restartTimer);
      managed.restartTimer = null;
    }
    const child = managed.process;
    managed.process = null;
    managed.status = "stopped";
    if (child && !child.killed) {
      child.kill("SIGTERM");
      const killer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5_000);
      await new Promise<void>((resolve) => {
        child.once("exit", () => {
          clearTimeout(killer);
          resolve();
        });
      });
    }
    for (const [, p] of managed.pending) {
      p.reject(new Error("upstream stopped"));
    }
    managed.pending.clear();
  }

  async stopAll(): Promise<void> {
    const ids = [...this.byId.keys()];
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  private async spawnAndInit(managed: ManagedUpstream): Promise<void> {
    if (managed.status === "failed") {
      throw new Error(`connector ${managed.slug} is marked failed`);
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const ref of managed.secretRefs) {
      const value = await this.keychain.get(ref);
      if (value === null) {
        managed.status = "failed";
        throw new Error(`missing secret ref ${ref}`);
      }
      env[ref] = value;
    }

    const [command, ...args] = managed.argv;
    if (!command) {
      managed.status = "failed";
      throw new Error(`connector ${managed.slug} has empty argv`);
    }

    managed.status = "starting";
    const child = spawn(command, args, {
      shell: false,
      env,
      cwd: managed.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    managed.process = child;

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg: unknown;
      try {
        msg = JSON.parse(line) as unknown;
      } catch {
        return;
      }
      this.onMessage(managed, msg);
    });

    child.stderr.on("data", () => {
      // Intentionally not logging process output (may contain secrets).
    });

    child.on("exit", () => {
      managed.process = null;
      for (const [, p] of managed.pending) {
        p.reject(new Error("upstream exited"));
      }
      managed.pending.clear();
      if (managed.status === "stopped") return;
      this.recordFailure(managed);
    });

    child.on("error", () => {
      managed.process = null;
      this.recordFailure(managed);
    });

    try {
      await this.request(managed, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "solemcp-daemon", version: "0.0.0" },
      });
      this.notify(managed, "notifications/initialized", {});
      const listed = (await this.request(managed, "tools/list", {})) as {
        tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
      };
      managed.tools = (listed.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? { type: "object" },
      }));
      managed.status = "running";
      managed.restartAttempt = 0;
    } catch (err) {
      managed.process = null;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      this.recordFailure(managed);
      throw err;
    }
  }

  private recordFailure(managed: ManagedUpstream): void {
    const now = Date.now();
    managed.failures = managed.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
    managed.failures.push(now);
    if (managed.failures.length >= MAX_FAILURES) {
      managed.status = "failed";
      return;
    }
    managed.status = "stopped";
    const delay = Math.min(1000 * 2 ** managed.restartAttempt, BACKOFF_CAP_MS);
    managed.restartAttempt += 1;
    if (managed.restartTimer) clearTimeout(managed.restartTimer);
    managed.restartTimer = setTimeout(() => {
      managed.restartTimer = null;
      void this.spawnAndInit(managed).catch(() => undefined);
    }, delay);
  }

  private onMessage(managed: ManagedUpstream, msg: unknown): void {
    if (!isRecord(msg)) return;
    if ("id" in msg && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = managed.pending.get(msg.id as number | string);
      if (!pending) return;
      managed.pending.delete(msg.id as number | string);
      if (msg.error) {
        const err = msg.error as { message?: string };
        pending.reject(new Error(err.message ?? "upstream error"));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private request(
    managed: ManagedUpstream,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    const child = managed.process;
    if (!child?.stdin.writable) {
      return Promise.reject(new Error("upstream not running"));
    }
    const id = managed.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      managed.pending.set(id, { resolve, reject });
      child.stdin.write(payload, (err) => {
        if (err) {
          managed.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private notify(managed: ManagedUpstream, method: string, params: unknown): void {
    const child = managed.process;
    if (!child?.stdin.writable) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    child.stdin.write(payload);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
