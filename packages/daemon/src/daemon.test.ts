import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFrameDecoder,
  encodeFrame,
  STATUS_TOOL,
  type ControlResponse,
} from "@solemcp/ipc";
import { inputSchemaHash } from "@solemcp/core";
import { MemoryKeychain, startDaemon, type DaemonHandle } from "./index.ts";

const FIXTURE = join(import.meta.dirname, "fixtures", "stdio-mcp-server.mjs");

const ECHO_SCHEMA = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
};

describe("daemon M2", () => {
  const homes: string[] = [];
  const daemons: DaemonHandle[] = [];

  afterEach(async () => {
    while (daemons.length) {
      const d = daemons.pop()!;
      await d.close().catch(() => undefined);
    }
    while (homes.length) {
      const h = homes.pop()!;
      await rm(h, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function boot(keychain = new MemoryKeychain()) {
    const home = await mkdtemp(join(tmpdir(), "solemcp-daemon-"));
    homes.push(home);
    const daemon = await startDaemon({
      home,
      keychain,
      peerCheck: () => null,
    });
    daemons.push(daemon);
    return { home, keychain, daemon };
  }

  function connect(sockPath: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const sock = createConnection(sockPath);
      sock.once("connect", () => resolve(sock));
      sock.once("error", reject);
    });
  }

  function frameReader(sock: Socket): {
    next: () => Promise<unknown>;
    close: () => void;
  } {
    const queue: unknown[] = [];
    const waiters: Array<(v: unknown) => void> = [];
    const decoder = createFrameDecoder((value) => {
      const w = waiters.shift();
      if (w) w(value);
      else queue.push(value);
    });
    const onData = (chunk: Buffer) => decoder(chunk);
    sock.on("data", onData);
    return {
      next: () =>
        new Promise((resolve) => {
          if (queue.length) resolve(queue.shift()!);
          else waiters.push(resolve);
        }),
      close: () => sock.off("data", onData),
    };
  }

  async function cliRequest(
    daemon: DaemonHandle,
    body: Record<string, unknown>,
  ): Promise<ControlResponse> {
    const sock = await connect(daemon.socketPath);
    const reader = frameReader(sock);
    sock.write(
      encodeFrame({ type: "hello", token: daemon.token, role: "cli" }),
    );
    sock.write(encodeFrame(body));
    const response = (await reader.next()) as ControlResponse;
    reader.close();
    sock.end();
    return response;
  }

  async function bridgeToolsList(
    daemon: DaemonHandle,
    root: string,
  ): Promise<Array<{ name: string }>> {
    const sock = await connect(daemon.socketPath);
    const reader = frameReader(sock);
    sock.write(
      encodeFrame({
        type: "hello",
        token: daemon.token,
        role: "bridge",
        root,
      }),
    );
    sock.write(
      encodeFrame({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      }),
    );
    await reader.next();
    sock.write(
      encodeFrame({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    );
    const listed = (await reader.next()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    reader.close();
    sock.end();
    return listed.result?.tools ?? [];
  }

  it("rejects a wrong token", async () => {
    const { daemon } = await boot();
    const sock = await connect(daemon.socketPath);
    const closed = new Promise<void>((resolve) => sock.once("close", () => resolve()));
    sock.write(
      encodeFrame({ type: "hello", token: "wrong-token", role: "cli" }),
    );
    await closed;
    expect(sock.destroyed || sock.readableEnded).toBe(true);
  });

  it("cli hello cannot tools/list", async () => {
    const { daemon } = await boot();
    const sock = await connect(daemon.socketPath);
    const reader = frameReader(sock);
    sock.write(
      encodeFrame({ type: "hello", token: daemon.token, role: "cli" }),
    );
    sock.write(
      encodeFrame({
        jsonrpc: "2.0",
        id: "1",
        method: "tools/list",
        params: {},
      }),
    );
    const response = (await reader.next()) as ControlResponse;
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/cli cannot call MCP/i);
    reader.close();
    sock.end();
  });

  it("bridge unadopted root tools/list is exactly solemcp__status", async () => {
    const { daemon } = await boot();
    const tools = await bridgeToolsList(daemon, "/tmp/unadopted-repo");
    expect(tools.map((t) => t.name)).toEqual([STATUS_TOOL]);
  });

  it("adopted root with approved stdio fixture lists namespaced tools", async () => {
    const { daemon } = await boot();
    const projectRoot = "/tmp/adopted-repo-a";

    const adopt = await cliRequest(daemon, {
      id: "1",
      method: "adopt",
      path: projectRoot,
    });
    expect(adopt.ok).toBe(true);
    const projectId = (adopt.result as { projectId: string }).projectId;

    const add = await cliRequest(daemon, {
      id: "2",
      method: "connectorAdd",
      slug: "fixture",
      transport: "stdio",
      argv: [process.execPath, FIXTURE],
    });
    expect(add.ok).toBe(true);

    const assign = await cliRequest(daemon, {
      id: "3",
      method: "connectorAssign",
      slug: "fixture",
      projectId,
      toolPolicy: { mode: "all-approved" },
    });
    expect(assign.ok).toBe(true);

    const approveC = await cliRequest(daemon, {
      id: "4",
      method: "approveConnector",
      slug: "fixture",
    });
    expect(approveC.ok).toBe(true);

    // Trigger upstream discovery then approve the echo tool.
    await bridgeToolsList(daemon, projectRoot);
    const approveT = await cliRequest(daemon, {
      id: "5",
      method: "approveTool",
      slug: "fixture",
      tool: "echo",
    });
    expect(approveT.ok).toBe(true);

    // Ensure hash matches fixture schema (approveTool may have used placeholder).
    // Re-approve after discovery so visibleTools hash-matches.
    await cliRequest(daemon, {
      id: "5b",
      method: "approveTool",
      slug: "fixture",
      tool: "echo",
    });

    const tools = await bridgeToolsList(daemon, projectRoot);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([STATUS_TOOL, "fixture__echo"].sort());
    // Sanity: fixture schema hash is what we expect
    expect(inputSchemaHash(ECHO_SCHEMA)).toMatch(/^sha256:/);
  });

  it("second project session does not see first project's tools while sharing upstream", async () => {
    const { daemon } = await boot();
    const rootA = "/tmp/project-a";
    const rootB = "/tmp/project-b";

    const adoptA = await cliRequest(daemon, {
      id: "a1",
      method: "adopt",
      path: rootA,
    });
    const projectA = (adoptA.result as { projectId: string }).projectId;

    await cliRequest(daemon, {
      id: "b1",
      method: "adopt",
      path: rootB,
    });

    await cliRequest(daemon, {
      id: "c1",
      method: "connectorAdd",
      slug: "shared",
      transport: "stdio",
      argv: [process.execPath, FIXTURE],
    });
    // Assign to both projects so the upstream is shared; B later gets an empty allow list.
    const adoptB = await cliRequest(daemon, {
      id: "b1b",
      method: "listProjects",
    });
    expect(adoptB.ok).toBe(true);
    const projects = (adoptB.result as { projects: Array<{ id: string; paths: string[] }> })
      .projects;
    const projectB = projects.find((p) => p.paths.includes(rootB))!.id;

    await cliRequest(daemon, {
      id: "c2",
      method: "connectorAssign",
      slug: "shared",
      projectId: projectA,
      toolPolicy: { mode: "all-approved" },
    });
    await cliRequest(daemon, {
      id: "c3",
      method: "connectorAssign",
      slug: "shared",
      projectId: projectB,
      toolPolicy: { mode: "all-approved" },
    });
    await cliRequest(daemon, {
      id: "c4",
      method: "approveConnector",
      slug: "shared",
    });

    await bridgeToolsList(daemon, rootA);
    await cliRequest(daemon, {
      id: "c5",
      method: "approveTool",
      slug: "shared",
      tool: "echo",
    });

    // Both assigned → both would see tools; narrow B so isolation is observable
    // while the same upstream process still serves A.
    await cliRequest(daemon, {
      id: "c6",
      method: "connectorAssign",
      slug: "shared",
      projectId: projectB,
      toolPolicy: { allow: [] },
    });

    const toolsA = await bridgeToolsList(daemon, rootA);
    const toolsB = await bridgeToolsList(daemon, rootB);

    expect(toolsA.map((t) => t.name).sort()).toEqual(
      [STATUS_TOOL, "shared__echo"].sort(),
    );
    expect(toolsB.map((t) => t.name)).toEqual([STATUS_TOOL]);
  });

  it("backup created before config write", async () => {
    const { home, daemon } = await boot();
    const backupDir = join(home, ".solemcp", "backups");

    await cliRequest(daemon, {
      id: "1",
      method: "adopt",
      path: "/tmp/backup-project",
    });

    const names = await readdir(backupDir);
    expect(names.some((n) => n.includes("config.json"))).toBe(true);
  });

  it("doctor reports missing secret ref without printing the value", async () => {
    const keychain = new MemoryKeychain();
    const secretValue = "super-secret-value-do-not-leak";
    // Intentionally do NOT store MISSING_TOKEN; store a decoy that must not appear either
    // if doctor ever looked it up incorrectly — only the missing ref name should appear.
    await keychain.set("OTHER_TOKEN", secretValue);

    const { daemon } = await boot(keychain);

    await cliRequest(daemon, {
      id: "1",
      method: "connectorAdd",
      slug: "needs-secret",
      transport: "stdio",
      argv: [process.execPath, FIXTURE],
      secretRefs: ["MISSING_TOKEN"],
    });

    // Place the secret value into the keychain under a different account and
    // also into a ref that doctor might resolve — ensure output never contains it.
    await keychain.set("MISSING_TOKEN_PLACEHOLDER", secretValue);

    const doctor = await cliRequest(daemon, { id: "2", method: "doctor" });
    expect(doctor.ok).toBe(true);
    const result = doctor.result as { ok: boolean; issues: string[] };
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    expect(text).toContain("MISSING_TOKEN");
    expect(text).not.toContain(secretValue);
  });
});
