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
    delete process.env.SOLEMCP_FIXTURE_TOOLS;
    while (daemons.length) {
      const d = daemons.pop()!;
      await d.close().catch(() => undefined);
    }
    while (homes.length) {
      const h = homes.pop()!;
      await rm(h, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function boot(
    keychain = new MemoryKeychain(),
    upstreamTiming?: { baseDelayMs: number; maxFailures: number; capMs: number },
  ) {
    const home = await mkdtemp(join(tmpdir(), "solemcp-daemon-"));
    homes.push(home);
    const daemon = await startDaemon({
      home,
      keychain,
      peerCheck: () => null,
      ...(upstreamTiming ? { upstreamTiming } : {}),
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

  async function bridgeCall(
    daemon: DaemonHandle,
    root: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ result?: unknown; error?: { message?: string } }> {
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
        method: "tools/call",
        params: { name, arguments: args },
      }),
    );
    const response = (await reader.next()) as {
      result?: unknown;
      error?: { message?: string };
    };
    reader.close();
    sock.end();
    return response;
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

  it("a project keeps one account per service and can drop that link", async () => {
    const { daemon } = await boot();
    const adoptA = await cliRequest(daemon, { id: "1", method: "adopt", path: "/tmp/proj-a" });
    const adoptB = await cliRequest(daemon, { id: "2", method: "adopt", path: "/tmp/proj-b" });
    const projectA = (adoptA.result as { projectId: string }).projectId;
    const projectB = (adoptB.result as { projectId: string }).projectId;

    const work = await cliRequest(daemon, {
      id: "3",
      method: "connectorAdd",
      slug: "notion",
      transport: "stdio",
      argv: [process.execPath, FIXTURE],
      catalogId: "notion",
      accountLabel: "Work",
    });
    const personal = await cliRequest(daemon, {
      id: "4",
      method: "connectorAdd",
      slug: "notion-personal",
      transport: "stdio",
      argv: [process.execPath, FIXTURE],
      catalogId: "notion",
      accountLabel: "Personal",
    });
    expect(work.ok).toBe(true);
    expect(personal.ok).toBe(true);

    const first = await cliRequest(daemon, {
      id: "5",
      method: "connectorAssign",
      slug: "notion",
      projectId: projectA,
    });
    expect(first.ok).toBe(true);

    const blocked = await cliRequest(daemon, {
      id: "6",
      method: "connectorAssign",
      slug: "notion-personal",
      projectId: projectA,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/already has Notion \(Work\)/);

    const otherProject = await cliRequest(daemon, {
      id: "7",
      method: "connectorAssign",
      slug: "notion-personal",
      projectId: projectB,
    });
    expect(otherProject.ok).toBe(true);

    const removed = await cliRequest(daemon, {
      id: "8",
      method: "connectorUnassign",
      slug: "notion",
      projectId: projectA,
    });
    expect(removed.ok).toBe(true);

    const replaced = await cliRequest(daemon, {
      id: "9",
      method: "connectorAssign",
      slug: "notion-personal",
      projectId: projectA,
    });
    expect(replaced.ok).toBe(true);
  });

  it("reads-only runs annotated reads and hides writes until they are named", async () => {
    process.env.SOLEMCP_FIXTURE_TOOLS = "annotated";
    const { daemon } = await boot();
    const root = "/tmp/reads-only-repo";
    const adopt = await cliRequest(daemon, { id: "1", method: "adopt", path: root });
    const projectId = (adopt.result as { projectId: string }).projectId;
    await cliRequest(daemon, {
      id: "2",
      method: "connectorAdd",
      slug: "fixture",
      transport: "stdio",
      argv: [process.execPath, FIXTURE],
    });
    await cliRequest(daemon, {
      id: "3",
      method: "connectorAssign",
      slug: "fixture",
      projectId,
      toolPolicy: { mode: "all-approved" },
    });
    await cliRequest(daemon, { id: "4", method: "approveConnector", slug: "fixture" });
    await bridgeToolsList(daemon, root);
    for (const tool of ["echo", "read_item", "delete_item", "mutate_item"]) {
      await cliRequest(daemon, { id: `5-${tool}`, method: "approveTool", slug: "fixture", tool });
    }

    const full = (await bridgeToolsList(daemon, root)).map((t) => t.name).sort();
    expect(full).toEqual(
      ["fixture__delete_item", "fixture__echo", "fixture__mutate_item", "fixture__read_item", STATUS_TOOL].sort(),
    );

    const updated = await cliRequest(daemon, {
      id: "6",
      method: "projectUpdate",
      projectId,
      readsOnly: true,
    });
    expect(updated.ok).toBe(true);
    expect((await bridgeToolsList(daemon, root)).map((t) => t.name).sort()).toEqual(
      ["fixture__read_item", STATUS_TOOL].sort(),
    );

    const denied = await bridgeCall(daemon, root, "fixture__echo", { message: "nope" });
    expect(denied.error?.message).toMatch(/not allowed/);

    await cliRequest(daemon, {
      id: "7",
      method: "connectorAssign",
      slug: "fixture",
      projectId,
      toolPolicy: { allow: ["echo", "read_item"] },
    });
    expect((await bridgeToolsList(daemon, root)).map((t) => t.name).sort()).toEqual(
      ["fixture__echo", "fixture__read_item", STATUS_TOOL].sort(),
    );

    await cliRequest(daemon, {
      id: "8",
      method: "projectUpdate",
      projectId,
      readsOnly: false,
    });
    await cliRequest(daemon, {
      id: "9",
      method: "connectorAssign",
      slug: "fixture",
      projectId,
      toolPolicy: { mode: "all-approved" },
    });
    expect((await bridgeToolsList(daemon, root)).map((t) => t.name)).toContain("fixture__mutate_item");
  });

  it("search mode advertises search and call instead of the tool list", async () => {
    process.env.SOLEMCP_FIXTURE_TOOLS = "annotated";
    const { daemon } = await boot();
    const root = "/tmp/search-mode-repo";
    const adopt = await cliRequest(daemon, { id: "1", method: "adopt", path: root });
    const projectId = (adopt.result as { projectId: string }).projectId;
    await cliRequest(daemon, {
      id: "2",
      method: "connectorAdd",
      slug: "fixture",
      transport: "stdio",
      argv: [process.execPath, FIXTURE],
    });
    await cliRequest(daemon, {
      id: "3",
      method: "connectorAssign",
      slug: "fixture",
      projectId,
    });
    await cliRequest(daemon, { id: "4", method: "approveConnector", slug: "fixture" });
    await bridgeToolsList(daemon, root);
    await cliRequest(daemon, { id: "5", method: "approveTool", slug: "fixture", tool: "read_item" });
    await cliRequest(daemon, { id: "6", method: "approveTool", slug: "fixture", tool: "echo" });

    const enabled = await cliRequest(daemon, {
      id: "7",
      method: "projectUpdate",
      projectId,
      searchMode: true,
    });
    expect(enabled.ok).toBe(true);
    expect((await bridgeToolsList(daemon, root)).map((t) => t.name).sort()).toEqual(
      ["solemcp__call", "solemcp__search", STATUS_TOOL].sort(),
    );

    const found = await bridgeCall(daemon, root, "solemcp__search", { query: "read" });
    const text = JSON.stringify(found.result);
    expect(text).toContain("fixture__read_item");
    expect(text).not.toContain("fixture__echo");

    const called = await bridgeCall(daemon, root, "solemcp__call", {
      name: "fixture__echo",
      arguments: { message: "hi" },
    });
    expect(JSON.stringify(called.result)).toContain("hi");
    expect(called.error).toBeUndefined();

    const direct = await bridgeCall(daemon, root, "fixture__read_item", {});
    expect(direct.error?.message).toMatch(/search mode/);

    await cliRequest(daemon, {
      id: "8",
      method: "projectUpdate",
      projectId,
      searchMode: false,
    });
    expect((await bridgeToolsList(daemon, root)).map((t) => t.name)).toContain("fixture__read_item");
  });

  it("call log omits arguments and redacts secrets from results and errors", async () => {
    const keychain = new MemoryKeychain();
    const secret = "super-secret-value-do-not-leak";
    await keychain.set("LEAK_TEST", secret);
    const { home, daemon } = await boot(keychain);
    const root = "/tmp/call-log-repo";
    const adopt = await cliRequest(daemon, { id: "1", method: "adopt", path: root });
    const projectId = (adopt.result as { projectId: string }).projectId;
    await cliRequest(daemon, {
      id: "2",
      method: "connectorAdd",
      slug: "fixture",
      transport: "stdio",
      argv: [process.execPath, FIXTURE],
      secretRefs: ["LEAK_TEST"],
    });
    await cliRequest(daemon, {
      id: "3",
      method: "connectorAssign",
      slug: "fixture",
      projectId,
    });
    await cliRequest(daemon, { id: "4", method: "approveConnector", slug: "fixture" });
    await bridgeToolsList(daemon, root);
    await cliRequest(daemon, { id: "5", method: "approveTool", slug: "fixture", tool: "echo" });

    const okCall = await bridgeCall(daemon, root, "fixture__echo", { message: secret });
    expect(JSON.stringify(okCall.result)).toContain(secret);

    const failCall = await bridgeCall(daemon, root, "fixture__echo", {
      message: `ERROR:${secret}`,
    });
    expect(failCall.error?.message).toContain(secret);

    const shaped = "ghp_abcdefghijklmnopqrstuvwxyz";
    await bridgeCall(daemon, root, "fixture__echo", { message: `ERROR:${shaped}` });

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(home, ".solemcp", "logs", "calls.json"), "utf8");
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain(shaped);
    expect(raw).not.toContain("arguments");
    expect(raw).not.toContain(`"message"`);
    const parsed = JSON.parse(raw) as { entries: Array<Record<string, unknown>> };
    expect(parsed.entries.some((entry) => entry.tool === "fixture__echo" && entry.ok === true)).toBe(
      true,
    );
    expect(parsed.entries.some((entry) => entry.ok === false && entry.error === "ERROR:[redacted]")).toBe(
      true,
    );
    for (const entry of parsed.entries) {
      expect(entry).not.toHaveProperty("arguments");
      expect(entry).not.toHaveProperty("result");
      expect(entry).not.toHaveProperty("resultText");
    }
  });

  it("a failed connector stays stopped until reconnect", async () => {
    const { daemon } = await boot(new MemoryKeychain(), {
      baseDelayMs: 10,
      maxFailures: 2,
      capMs: 40,
    });
    const root = "/tmp/failed-repo";
    const adopt = await cliRequest(daemon, { id: "1", method: "adopt", path: root });
    const projectId = (adopt.result as { projectId: string }).projectId;
    await cliRequest(daemon, {
      id: "2",
      method: "connectorAdd",
      slug: "crash",
      transport: "stdio",
      argv: [process.execPath, "-e", "process.exit(1)"],
    });
    await cliRequest(daemon, {
      id: "3",
      method: "connectorAssign",
      slug: "crash",
      projectId,
    });
    await cliRequest(daemon, { id: "4", method: "approveConnector", slug: "crash" });

    const started = Date.now();
    let failed = false;
    while (Date.now() - started < 4000) {
      await bridgeToolsList(daemon, root).catch(() => undefined);
      const listed = await cliRequest(daemon, { id: "5", method: "listConnectors" });
      const row = (
        listed.result as { connectors: Array<{ slug: string; upstreamStatus: string }> }
      ).connectors.find((c) => c.slug === "crash");
      if (row?.upstreamStatus === "failed") {
        failed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    expect(failed).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 120));
    const still = await cliRequest(daemon, { id: "6", method: "listConnectors" });
    const row = (
      still.result as { connectors: Array<{ slug: string; upstreamStatus: string }> }
    ).connectors.find((c) => c.slug === "crash");
    expect(row?.upstreamStatus).toBe("failed");

    const status = await bridgeCall(daemon, root, STATUS_TOOL, {});
    const text = (status.result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
    const body = JSON.parse(text) as { failures: Array<{ slug: string; status: string }> };
    expect(body.failures).toEqual([{ slug: "crash", status: "failed" }]);

    const again = await cliRequest(daemon, {
      id: "7",
      method: "connectorReconnect",
      slug: "crash",
    });
    expect(again.ok).toBe(false);
  });
});
