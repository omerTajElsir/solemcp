import { randomBytes } from "node:crypto";
import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import {
  applyToolList,
  commandHash,
  evaluatePolicy,
  filterReadsOnly,
  inputSchemaHash,
  namespaceTool,
  redact,
  searchTools,
  visibleTools,
  type ListedTool,
} from "@solemcp/core";
import {
  BACKUP_DIR,
  CALL_LOG_FILE,
  CALL_TOOL,
  createFrameDecoder,
  DAEMON_TOKEN_ACCOUNT,
  encodeFrame,
  LOG_DIR,
  parseControlRequest,
  parseHello,
  RESERVED_SLUG,
  RUN_DIR,
  SEARCH_TOOL,
  STATUS_TOOL,
  socketPath,
  solemcpHome,
  type ControlRequest,
  type ControlResponse,
  type HelloMessage,
} from "@solemcp/ipc";
import {
  newId,
  type Config,
  type HttpConnector,
  type Project,
  type StdioConnector,
} from "@solemcp/schema";
import { ConfigStore } from "./config-store.ts";
import { HttpUpstreamManager } from "./http.ts";
import type { Keychain } from "./keychain.ts";
import { assertPeerAllowed, defaultPeerCheck, type PeerCheck } from "./peer.ts";
import { UpstreamManager, type UpstreamTiming } from "./upstream.ts";
import { startUiServer, type UiActivityEvent, type UiServerHandle } from "./ui-server.ts";
import {
  buildClientConnectGuide,
  installClient,
  type ClientName,
} from "./clients/connect.ts";
import { catalogServiceOf, cleanAccountLabel, planAccountInstance } from "./catalog/accounts.ts";
import { listPopularCatalog, prepareCatalogInstall } from "./catalog/install.ts";
import { getCatalogEntry, POPULAR_CATALOG } from "./catalog/popular.ts";
import {
  GITHUB_PAT_CREATE_URL,
  readGhAuthToken,
  runGhWebLogin,
} from "./catalog/github-auth.ts";
import { OAuthInstallManager } from "./oauth/install-session.ts";
import { CallLog } from "./call-log.ts";
import {
  installRegistryServer,
  RegistryError,
  searchOfficialRegistry,
  type RegistryInstallRequest,
} from "./registry.ts";

const RUN_MODE = 0o700;
const SOCKET_MODE = 0o600;

export type DaemonOptions = {
  home: string;
  keychain: Keychain;
  peerCheck?: PeerCheck;
  /** Override version reported in status. */
  version?: string;
  /** Override static UI root (tests). */
  uiRoot?: string;
  /** Override crash backoff. Production keeps the 1s/2s/4s, cap 30s, 5-in-5-minutes policy. */
  upstreamTiming?: Partial<UpstreamTiming>;
};

export type DaemonHandle = {
  socketPath: string;
  token: string;
  close: () => Promise<void>;
};

/**
 * Start the SoleMCP daemon: Unix socket, control RPC (cli), MCP session (bridge).
 */
export async function startDaemon(opts: DaemonOptions): Promise<DaemonHandle> {
  const peerCheck = opts.peerCheck ?? defaultPeerCheck;
  const version = opts.version ?? "0.0.0";
  const store = new ConfigStore({ home: opts.home });
  await store.ensureLayout();

  const root = solemcpHome(opts.home);
  await mkdir(join(root, RUN_DIR), { recursive: true, mode: RUN_MODE });
  await chmod(join(root, RUN_DIR), RUN_MODE);
  await mkdir(join(root, LOG_DIR), { recursive: true, mode: RUN_MODE });
  await mkdir(join(root, BACKUP_DIR), { recursive: true, mode: RUN_MODE });

  let token = await opts.keychain.get(DAEMON_TOKEN_ACCOUNT);
  if (!token) {
    token = randomBytes(32).toString("base64url");
    await opts.keychain.set(DAEMON_TOKEN_ACCOUNT, token);
  }

  let config = await store.read();
  const upstreams = new UpstreamManager(opts.keychain, opts.upstreamTiming);
  const httpUpstreams = new HttpUpstreamManager(opts.keychain);
  const sock = socketPath(opts.home);

  try {
    await unlink(sock);
  } catch {
    // absent is fine
  }

  let shuttingDown = false;
  const sockets = new Set<Socket>();
  let ui: UiServerHandle | null = null;
  const activity: UiActivityEvent[] = [];
  const callLog = new CallLog(join(root, LOG_DIR, CALL_LOG_FILE));
  await callLog.load();
  const oauthInstalls = new OAuthInstallManager(opts.keychain);

  function noteActivity(message: string): void {
    activity.unshift({ at: new Date().toISOString(), message });
    if (activity.length > 100) activity.length = 100;
  }

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    try {
      handleConnection(socket);
    } catch {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(sock, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await chmod(sock, SOCKET_MODE);

  const pidPath = join(root, RUN_DIR, "daemon.pid");
  await writeFile(pidPath, `${process.pid}\n`, { mode: SOCKET_MODE });

  await reconcileUpstreams();

  type SessionView = {
    root: string;
    project: Project | null;
    adopted: boolean;
  };

  type AdvertisedTool = {
    name: string;
    description: string;
    inputSchema: unknown;
    upstreamName: string;
    slug: string;
  };

  async function reloadConfig(): Promise<void> {
    config = await store.read();
    await reconcileUpstreams();
  }

  async function reconcileUpstreams(): Promise<void> {
    const desiredStdio = stdioConnectorsToRun(config);
    const desiredHttp = httpConnectorsToRun(config);
    await upstreams.syncDesired(desiredStdio, (c) =>
      c.cwd === "project" ? undefined : undefined,
    );
    await httpUpstreams.syncDesired(desiredHttp);
    // Refresh tool quarantine from live upstreams for approved connectors.
    for (const connector of desiredStdio) {
      try {
        const tools = await upstreams.listTools(connector);
        await persistToolList(connector.id, tools);
      } catch {
        // leave failure state on upstream manager
      }
    }
    for (const connector of desiredHttp) {
      try {
        const tools = await httpUpstreams.listTools(connector);
        await persistToolList(connector.id, tools);
      } catch {
        // leave failure state on http manager
      }
    }
  }

  async function persistToolList(connectorId: string, tools: ListedTool[]): Promise<void> {
    const connector = config.connectors.find((c) => c.id === connectorId);
    if (!connector) return;
    const updated = applyToolList(connector, tools);
    if (JSON.stringify(updated.quarantine) === JSON.stringify(connector.quarantine)) return;
    config = await store.update((cfg) => ({
      ...cfg,
      connectors: cfg.connectors.map((c) => (c.id === updated.id ? updated : c)),
    }));
  }

  function handleConnection(socket: Socket): void {
    try {
      assertPeerAllowed(socket, peerCheck);
    } catch {
      socket.destroy();
      return;
    }

    let role: HelloMessage["role"] | null = null;
    let session: SessionView | null = null;

    const decoder = createFrameDecoder((value) => {
      void (async () => {
        if (role === null) {
          let hello: HelloMessage;
          try {
            hello = parseHello(value);
          } catch {
            socket.destroy();
            return;
          }
          if (hello.token !== token) {
            socket.destroy();
            return;
          }
          role = hello.role;
          if (role === "bridge") {
            session = resolveProjectSession(config, hello.root!);
          }
          return;
        }

        if (role === "cli") {
          await handleCliFrame(socket, value);
          return;
        }

        if (session) {
          // Refresh project view from latest config each request.
          session = resolveProjectSession(config, session.root);
          await handleMcpMessage(socket, value, session).catch((err) => {
            if (isRecord(value) && "id" in value) {
              writeFrame(socket, {
                jsonrpc: "2.0",
                id: value.id,
                error: {
                  code: -32603,
                  message: err instanceof Error ? err.message : "internal error",
                },
              });
            }
          });
        }
      })();
    });

    socket.on("data", (chunk) => decoder(chunk));
  }

  async function handleCliFrame(socket: Socket, value: unknown): Promise<void> {
    // CLI must not speak MCP tools methods.
    if (
      isRecord(value) &&
      typeof value.method === "string" &&
      (value.method === "tools/list" || value.method.startsWith("tools/"))
    ) {
      const id = typeof value.id === "string" || typeof value.id === "number" ? value.id : "unknown";
      writeResponse(socket, {
        id: String(id),
        ok: false,
        error: "cli cannot call MCP tools methods",
      });
      return;
    }

    let req: ControlRequest;
    try {
      req = parseControlRequest(value);
    } catch (err) {
      const id =
        isRecord(value) && typeof value.id === "string" ? value.id : "unknown";
      writeResponse(socket, {
        id,
        ok: false,
        error: err instanceof Error ? err.message : "bad request",
      });
      return;
    }
    const response = await handleControl(req);
    writeResponse(socket, response);
    if (req.method === "shutdown") {
      void close();
    }
  }

  function resolveProjectSession(cfg: Config, rootPath: string): SessionView {
    const project =
      cfg.projects.find((p) => p.paths.some((pPath) => pathsEqual(pPath, rootPath))) ?? null;
    return {
      root: rootPath,
      project,
      adopted: project?.adopted === true,
    };
  }

  async function handleMcpMessage(
    socket: Socket,
    value: unknown,
    session: SessionView,
  ): Promise<void> {
    if (!isRecord(value) || value.jsonrpc !== "2.0") return;
    // Notifications (no id)
    if (!("id" in value)) return;

    const id = value.id;
    const method = value.method;
    if (typeof method !== "string") {
      writeFrame(socket, {
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "invalid request" },
      });
      return;
    }

    if (method === "initialize") {
      writeFrame(socket, {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "solemcp", version },
        },
      });
      return;
    }

    if (method === "tools/list") {
      const tools = await listSessionTools(session);
      writeFrame(socket, {
        jsonrpc: "2.0",
        id,
        result: { tools },
      });
      return;
    }

    if (method === "tools/call") {
      const params = isRecord(value.params) ? value.params : {};
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments;
      const started = Date.now();
      try {
        const result = await callSessionTool(session, name, args);
        await recordCall(session, name, true, Date.now() - started, undefined, result);
        writeFrame(socket, {
          jsonrpc: "2.0",
          id,
          result,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "tool call failed";
        await recordCall(session, name, false, Date.now() - started, message, undefined);
        throw err;
      }
      return;
    }

    if (method === "ping") {
      writeFrame(socket, { jsonrpc: "2.0", id, result: {} });
      return;
    }

    writeFrame(socket, {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `method not found: ${method}` },
    });
  }

  const statusTool = {
    name: STATUS_TOOL,
    description: "SoleMCP session status",
    inputSchema: { type: "object", properties: {} },
  };

  const searchTool = {
    name: SEARCH_TOOL,
    description:
      "Search this project's approved tools by name or description. Returns names and descriptions only.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
    },
  };

  const callTool = {
    name: CALL_TOOL,
    description: "Call one approved tool by its namespaced name. Does not execute code.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        arguments: { type: "object" },
      },
      required: ["name"],
    },
  };

  async function listSessionTools(session: SessionView): Promise<
    Array<{ name: string; description: string; inputSchema: unknown }>
  > {
    if (!session.adopted || !session.project) {
      return [statusTool];
    }
    if (session.project.searchMode === true) {
      return [statusTool, searchTool, callTool];
    }
    const approved = await approvedSessionTools(session);
    return [statusTool, ...approved.map(advertise)];
  }

  function advertise(tool: AdvertisedTool): {
    name: string;
    description: string;
    inputSchema: unknown;
  } {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  }

  async function approvedSessionTools(session: SessionView): Promise<AdvertisedTool[]> {
    if (!session.project) return [];
    const readsOnly = session.project.readsOnly === true;
    const out: AdvertisedTool[] = [];
    for (const assignment of session.project.assignments) {
      const connector = config.connectors.find((c) => c.id === assignment.connectorId);
      if (!connector || connector.quarantine.state !== "approved") continue;

      let listed: ListedTool[] = [];
      try {
        if (connector.transport === "stdio") {
          listed = await upstreams.listTools(connector);
        } else {
          listed = await httpUpstreams.listTools(connector);
        }
        await persistToolList(connector.id, listed);
      } catch {
        continue;
      }

      const live = config.connectors.find((c) => c.id === connector.id) ?? connector;
      const approved = visibleTools(live, listed);
      const policy = evaluatePolicy(
        approved.map((t) => t.name),
        assignment.toolPolicy,
      );
      const allowed = new Set(policy.names);
      const gated = filterReadsOnly(
        approved.filter((tool) => allowed.has(tool.name)),
        assignment.toolPolicy,
        readsOnly,
      );
      for (const tool of gated) {
        out.push({
          name: namespaceTool(live.slug, tool.name),
          description: tool.description,
          inputSchema: tool.inputSchema,
          upstreamName: tool.name,
          slug: live.slug,
        });
      }
    }
    return out;
  }

  async function callSessionTool(
    session: SessionView,
    name: string,
    args: unknown,
    viaSearch = false,
  ): Promise<unknown> {
    if (name === STATUS_TOOL) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(buildStatus(session), null, 2),
          },
        ],
      };
    }

    if (!session.adopted || !session.project) {
      throw new Error("project not adopted");
    }

    if (session.project.searchMode === true && !viaSearch) {
      if (name === SEARCH_TOOL) {
        const query = isRecord(args) && typeof args.query === "string" ? args.query : "";
        const hits = searchTools(await approvedSessionTools(session), query);
        return {
          content: [{ type: "text", text: JSON.stringify(hits) }],
        };
      }
      if (name === CALL_TOOL) {
        const record = isRecord(args) ? args : {};
        const inner = typeof record.name === "string" ? record.name : "";
        if (!inner || inner === CALL_TOOL || inner === SEARCH_TOOL) {
          throw new Error("solemcp__call requires a namespaced tool name");
        }
        return callSessionTool(session, inner, record.arguments, true);
      }
      throw new Error(`tool not advertised in search mode: ${name}`);
    }

    if (session.project.searchMode === true && viaSearch && (name === CALL_TOOL || name === SEARCH_TOOL)) {
      throw new Error(`tool not allowed: ${name}`);
    }

    const allowed = await approvedSessionTools(session);
    const match = allowed.find((tool) => tool.name === name);
    if (!match) throw new Error(`tool not allowed: ${name}`);

    const connector = config.connectors.find((c) => c.slug === match.slug);
    if (!connector) throw new Error(`unknown tool ${name}`);

    if (connector.transport === "stdio") {
      return upstreams.callTool(connector, match.upstreamName, args);
    }
    return httpUpstreams.callTool(connector, match.upstreamName, args);
  }

  async function recordCall(
    session: SessionView,
    tool: string,
    ok: boolean,
    durationMs: number,
    errorText: string | undefined,
    result: unknown,
  ): Promise<void> {
    const secretValues = await collectSecretValues();
    await callLog.record({
      projectId: session.project?.id ?? null,
      tool,
      ok,
      durationMs,
      errorText,
      resultText: result === undefined ? undefined : safeJson(result),
      secretValues,
    });
  }

  function listConnectorViews(): Array<Record<string, unknown>> {
    return config.connectors.map((c) => ({
      id: c.id,
      slug: c.slug,
      transport: c.transport,
      origin: c.origin,
      commandHash: c.commandHash,
      quarantine: c.quarantine,
      secretRefs: c.secretRefs,
      catalogId: c.catalogId ?? null,
      accountLabel: c.accountLabel ?? null,
      argv: c.transport === "stdio" ? c.argv : null,
      http: c.transport === "http" ? c.http : null,
      upstreamStatus:
        c.transport === "stdio" ? upstreams.getStatus(c.id) : httpUpstreams.getStatus(c.id),
    }));
  }

  function buildStatus(session?: SessionView): Record<string, unknown> {
    const pending = config.connectors.reduce((n, c) => {
      let count = c.quarantine.state === "pending" ? 1 : 0;
      for (const t of Object.values(c.quarantine.tools)) {
        if (t.state === "pending") count += 1;
      }
      return n + count;
    }, 0);

    const assignedSlugs =
      session?.project?.assignments
        .map((a) => config.connectors.find((c) => c.id === a.connectorId)?.slug)
        .filter((s): s is string => typeof s === "string") ?? [];

    return {
      version,
      projectId: session?.project?.id ?? null,
      adopted: session?.adopted ?? false,
      root: session?.root ?? null,
      connectors: assignedSlugs,
      quarantinePending: pending,
      readsOnly: session?.project?.readsOnly === true,
      searchMode: session?.project?.searchMode === true,
      upstreams: config.connectors.map((c) => ({
        slug: c.slug,
        status:
          c.transport === "stdio"
            ? upstreams.getStatus(c.id)
            : httpUpstreams.getStatus(c.id),
      })),
      failures: config.connectors
        .filter((c) => upstreamStatus(c) === "failed")
        .map((c) => ({ slug: c.slug, status: "failed" as const })),
    };
  }

  function upstreamStatus(c: Config["connectors"][number]): string {
    return c.transport === "stdio" ? upstreams.getStatus(c.id) : httpUpstreams.getStatus(c.id);
  }

  async function handleControl(req: ControlRequest): Promise<ControlResponse> {
    try {
      switch (req.method) {
        case "status":
          return { id: req.id, ok: true, result: buildStatus() };
        case "reload":
          await reloadConfig();
          return { id: req.id, ok: true, result: { reloaded: true } };
        case "shutdown":
          return { id: req.id, ok: true, result: { shuttingDown: true } };
        case "backup": {
          const name = await store.backup();
          return { id: req.id, ok: true, result: { backup: name } };
        }
        case "doctor":
          return { id: req.id, ok: true, result: await runDoctor() };
        case "approveConnector":
          await approveConnector(req.slug);
          noteActivity(`approved connector ${req.slug}`);
          return { id: req.id, ok: true, result: { approved: req.slug } };
        case "approveTool":
          await approveTool(req.slug, req.tool);
          noteActivity(`approved tool ${req.slug}/${req.tool}`);
          return { id: req.id, ok: true, result: { approved: `${req.slug}/${req.tool}` } };
        case "adopt":
          return { id: req.id, ok: true, result: await adoptPath(req.path) };
        case "connectorAdd":
          return { id: req.id, ok: true, result: await connectorAdd(req) };
        case "connectorAssign":
          return { id: req.id, ok: true, result: await connectorAssign(req) };
        case "connectorUnassign":
          return { id: req.id, ok: true, result: await connectorUnassign(req) };
        case "listProjects":
          return {
            id: req.id,
            ok: true,
            result: { projects: config.projects },
          };
        case "listConnectors":
          return {
            id: req.id,
            ok: true,
            result: { connectors: listConnectorViews() },
          };
        case "activity":
          return { id: req.id, ok: true, result: { events: activity } };
        case "calls":
          return { id: req.id, ok: true, result: { calls: callLog.recent() } };
        case "projectUpdate":
          await projectUpdate(req);
          noteActivity(
            `updated project ${req.projectId} (reads-only ${req.readsOnly === true ? "on" : req.readsOnly === false ? "off" : "unchanged"}, search ${req.searchMode === true ? "on" : req.searchMode === false ? "off" : "unchanged"})`,
          );
          return { id: req.id, ok: true, result: { updated: req.projectId } };
        case "connectorReconnect": {
          await connectorReconnect(req.slug);
          noteActivity(`reconnected ${req.slug}`);
          return { id: req.id, ok: true, result: { reconnected: req.slug } };
        }
        case "startUi": {
          if (!ui) {
            ui = await startUiServer({
              uiRoot: opts.uiRoot,
              handlers: {
                status: () => buildStatus(),
                projects: () => config.projects,
                connectors: () => listConnectorViews(),
                doctor: () => runDoctor(),
                activity: () => activity,
                approveConnector: async (slug) => {
                  await approveConnector(slug);
                  noteActivity(`approved connector ${slug}`);
                },
                approveTool: async (slug, tool) => {
                  await approveTool(slug, tool);
                  noteActivity(`approved tool ${slug}/${tool}`);
                },
                connectorAdd: async (body) => {
                  const transport = body.transport === "http" ? "http" : "stdio";
                  const headerRefs =
                    body.headerRefs &&
                    typeof body.headerRefs === "object" &&
                    !Array.isArray(body.headerRefs)
                      ? Object.fromEntries(
                          Object.entries(body.headerRefs as Record<string, unknown>).map(
                            ([k, v]) => [k, String(v)],
                          ),
                        )
                      : undefined;
                  const result = await connectorAdd({
                    id: "ui",
                    method: "connectorAdd",
                    slug: String(body.slug ?? ""),
                    transport,
                    argv: Array.isArray(body.argv)
                      ? body.argv.map(String)
                      : undefined,
                    url: typeof body.url === "string" ? body.url : undefined,
                    sseFallback: body.sseFallback === true,
                    secretRefs: Array.isArray(body.secretRefs)
                      ? body.secretRefs.map(String)
                      : undefined,
                    headerRefs,
                  });
                  noteActivity(`added connector ${result.slug} (${transport}, quarantined)`);
                  return result;
                },
                assign: async (slug, projectId) => {
                  const result = await connectorAssign({
                    id: "ui",
                    method: "connectorAssign",
                    slug,
                    projectId,
                  });
                  noteActivity(`assigned ${slug} → ${projectId}`);
                  return result;
                },
                unassign: async (slug, projectId) => {
                  const result = await connectorUnassign({
                    id: "ui",
                    method: "connectorUnassign",
                    slug,
                    projectId,
                  });
                  noteActivity(`unassigned ${slug} from ${projectId}`);
                  return result;
                },
                adopt: async (path) => {
                  const result = await adoptPath(path);
                  noteActivity(`adopted project ${result.projectId} @ ${path}`);
                  return result;
                },
                clients: () => buildClientConnectGuide(),
                clientInstall: async (client) => {
                  const result = await installClient(client as ClientName);
                  noteActivity(
                    result.wrote
                      ? `installed SoleMCP into ${client} (${result.configPath})`
                      : `client install ${client}: ${result.reason ?? "no change"}`,
                  );
                  return result;
                },
                catalog: async () => ({
                  entries: await listPopularCatalog({
                    keychain: opts.keychain,
                    installedSlugs: new Set(config.connectors.map((c) => c.slug)),
                    accounts: config.connectors.map((c) => ({
                      slug: c.slug,
                      catalogId: c.catalogId,
                    })),
                  }),
                }),
                catalogInstall: async (body) => {
                  const entryId = String(body.id ?? "");
                  const entry = getCatalogEntry(entryId);
                  if (!entry) throw new Error(`unknown catalog entry: ${entryId}`);
                  const projectId =
                    typeof body.projectId === "string" && body.projectId.length > 0
                      ? body.projectId
                      : undefined;
                  const accountLabel =
                    typeof body.accountLabel === "string" ? body.accountLabel : undefined;
                  assertProjectAcceptsService(projectId, entry.id);
                  const catalogIds = POPULAR_CATALOG.map((item) => item.id);
                  const instance = planAccountInstance({
                    baseSlug: entry.slug,
                    oauthBearerRef: entry.oauthBearerRef,
                    takenSlugs: config.connectors.map((c) => c.slug),
                    existingAccounts: config.connectors.filter(
                      (c) => catalogServiceOf(c, catalogIds) === entry.id,
                    ).length,
                    accountLabel,
                  });
                  const linkToProject = async (slug: string) => {
                    if (!projectId) return;
                    await connectorAssign({
                      id: "ui",
                      method: "connectorAssign",
                      slug,
                      projectId,
                    });
                    noteActivity(`assigned ${slug} → ${projectId}`);
                  };

                  if (entry.authMode === "oauth") {
                    const status = await oauthInstalls.start(
                      entry,
                      async (payload) => {
                        assertProjectAcceptsService(projectId, entry.id);
                        const result = await connectorAdd({
                          id: "ui",
                          method: "connectorAdd",
                          slug: payload.slug,
                          transport: "http",
                          url: payload.url,
                          sseFallback: payload.sseFallback,
                          headerRefs: { Authorization: payload.bearerRef },
                          catalogId: entry.id,
                          ...(instance.accountLabel ? { accountLabel: instance.accountLabel } : {}),
                        });
                        noteActivity(
                          `catalog: OAuth connected ${result.slug} (http, quarantined)`,
                        );
                        await linkToProject(result.slug);
                        return result;
                      },
                      {
                        slug: instance.slug,
                        bearerRef: instance.bearerRef,
                        accountPrefix: instance.accountPrefix,
                      },
                    );
                    noteActivity(`catalog: open browser to sign in for ${instance.slug}`);
                    return {
                      auth: "oauth" as const,
                      ...status,
                    };
                  }

                  if (entry.authMode === "github") {
                    const anotherAccount = instance.slug !== entry.slug;
                    const action = String(body.action ?? "connect");
                    if (action === "gh-login") {
                      if (anotherAccount) {
                        throw new Error(
                          "This Mac's GitHub login is already connected. Paste an access token for the other account.",
                        );
                      }
                      await runGhWebLogin();
                      noteActivity("catalog: finished GitHub CLI browser login");
                    }

                    const secrets =
                      body.secrets && typeof body.secrets === "object"
                        ? (body.secrets as Record<string, unknown>)
                        : {};
                    const provided = String(
                      secrets[instance.bearerRef] ?? secrets.GITHUB_OAUTH_TOKEN ?? secrets.GITHUB_PAT ?? "",
                    ).trim();
                    let token: string | null = null;
                    if (provided) {
                      token = provided;
                    } else if (!anotherAccount) {
                      const gh = await readGhAuthToken();
                      if (gh.ok) token = gh.token;
                    }

                    if (!token) {
                      const gh = await readGhAuthToken();
                      return {
                        auth: "github" as const,
                        status: "needs_auth" as const,
                        ghInstalled: anotherAccount ? false : gh.ok ? true : gh.ghInstalled,
                        createUrl: GITHUB_PAT_CREATE_URL,
                        message: anotherAccount
                          ? "Paste an access token for this GitHub account. The login already on this Mac stays with the first account."
                          : "Sign in with GitHub on this Mac, or paste an access token.",
                      };
                    }

                    await opts.keychain.set(instance.bearerRef, `Bearer ${token}`);
                    const result = await connectorAdd({
                      id: "ui",
                      method: "connectorAdd",
                      slug: instance.slug,
                      transport: "http",
                      url: entry.url,
                      sseFallback: entry.sseFallback ?? true,
                      headerRefs: { Authorization: instance.bearerRef },
                      catalogId: entry.id,
                      ...(instance.accountLabel ? { accountLabel: instance.accountLabel } : {}),
                    });
                    await linkToProject(result.slug);
                    noteActivity(
                      `catalog: added ${result.slug} via ${provided ? "PAT" : "gh"} (quarantined)`,
                    );
                    return {
                      auth: "github" as const,
                      status: "complete" as const,
                      ...result,
                    };
                  }

                  const prepared = await prepareCatalogInstall(entryId, {
                    keychain: opts.keychain,
                    secrets:
                      body.secrets && typeof body.secrets === "object"
                        ? Object.fromEntries(
                            Object.entries(body.secrets as Record<string, unknown>).map(
                              ([k, v]) => [k, String(v)],
                            ),
                          )
                        : undefined,
                    path: typeof body.path === "string" ? body.path : undefined,
                    instanceSlug: instance.slug,
                  });
                  const result = await connectorAdd({
                    id: "ui",
                    method: "connectorAdd",
                    ...prepared.add,
                    catalogId: entry.id,
                    ...(instance.accountLabel ? { accountLabel: instance.accountLabel } : {}),
                  });
                  await linkToProject(result.slug);
                  noteActivity(
                    `catalog: added ${result.slug} (${prepared.entry.transport}, quarantined)`,
                  );
                  return {
                    auth: "none" as const,
                    ...result,
                    secretsStored: prepared.secretsStored,
                  };
                },
                catalogOauthStatus: async (sessionId) => {
                  const status = oauthInstalls.getStatus(sessionId);
                  if (!status) throw new Error("unknown OAuth session");
                  return status;
                },
                calls: () => callLog.recent(),
                projectUpdate: async (projectId, patch) => {
                  await projectUpdate({
                    id: "ui",
                    method: "projectUpdate",
                    projectId,
                    ...patch,
                  });
                },
                connectorReconnect: async (slug) => {
                  await connectorReconnect(slug);
                  noteActivity(`reconnected ${slug}`);
                },
                registrySearch: async (query) => searchOfficialRegistry(query),
                registryInstall: async (body) => {
                  const request: RegistryInstallRequest = {
                    name: String(body.name ?? ""),
                    version: typeof body.version === "string" ? body.version : undefined,
                    secrets:
                      body.secrets && typeof body.secrets === "object" && !Array.isArray(body.secrets)
                        ? Object.fromEntries(
                            Object.entries(body.secrets as Record<string, unknown>).map(([k, v]) => [
                              k,
                              String(v),
                            ]),
                          )
                        : undefined,
                  };
                  let planned;
                  try {
                    planned = await installRegistryServer(request);
                  } catch (err) {
                    if (err instanceof RegistryError) throw err;
                    throw err;
                  }
                  if (planned.status === "needs_env") return planned;
                  const projectId =
                    typeof body.projectId === "string" && body.projectId.length > 0
                      ? body.projectId
                      : undefined;
                  const accountLabel =
                    typeof body.accountLabel === "string" ? body.accountLabel : undefined;
                  assertProjectAcceptsService(projectId, planned.catalogId);
                  const catalogIds = [
                    ...POPULAR_CATALOG.map((item) => item.id),
                    planned.catalogId,
                  ];
                  const instance = planAccountInstance({
                    baseSlug: planned.slugBase,
                    takenSlugs: config.connectors.map((c) => c.slug),
                    existingAccounts: config.connectors.filter(
                      (c) => catalogServiceOf(c, catalogIds) === planned.catalogId,
                    ).length,
                    accountLabel,
                  });
                  for (const [ref, value] of Object.entries(planned.secrets)) {
                    if (value) await opts.keychain.set(ref, value);
                  }
                  const result = await connectorAdd({
                    id: "ui",
                    method: "connectorAdd",
                    slug: instance.slug,
                    transport: planned.transport,
                    argv: planned.argv,
                    url: planned.url,
                    sseFallback: planned.sseFallback,
                    secretRefs: planned.secretRefs,
                    headerRefs: planned.headerRefs,
                    catalogId: planned.catalogId,
                    ...(instance.accountLabel ? { accountLabel: instance.accountLabel } : {}),
                  });
                  if (projectId) {
                    await connectorAssign({
                      id: "ui",
                      method: "connectorAssign",
                      slug: result.slug,
                      projectId,
                    });
                  }
                  noteActivity(`registry: added ${result.slug} (quarantined)`);
                  return { status: "complete" as const, ...result, title: planned.title };
                },
              },
            });
            noteActivity(`UI listening on 127.0.0.1:${ui.port}`);
          }
          return {
            id: req.id,
            ok: true,
            result: { port: ui.port, token: ui.token },
          };
        }
        case "stopUi": {
          if (ui) {
            await ui.close();
            ui = null;
            noteActivity("UI stopped");
          }
          return { id: req.id, ok: true, result: { stopped: true } };
        }
        default:
          return { id: req.id, ok: false, error: `not implemented: ${req.method}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "error";
      const secretValues = await collectSecretValues();
      return { id: req.id, ok: false, error: redact(message, secretValues) };
    }
  }

  async function collectSecretValues(): Promise<string[]> {
    const refs = new Set<string>();
    for (const c of config.connectors) {
      for (const r of c.secretRefs) refs.add(r);
      if (c.transport === "http") {
        for (const r of Object.values(c.http.headerRefs)) refs.add(r);
      }
    }
    const values: string[] = [];
    for (const ref of refs) {
      const v = await opts.keychain.get(ref);
      if (v) values.push(v);
    }
    return values;
  }

  async function runDoctor(): Promise<{
    ok: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];
    const secretValues = await collectSecretValues();

    for (const connector of config.connectors) {
      for (const ref of connector.secretRefs) {
        const value = await opts.keychain.get(ref);
        if (value === null) {
          issues.push(
            redact(`connector ${connector.slug}: missing secret ref ${ref}`, secretValues),
          );
        }
      }
      if (connector.transport === "http") {
        for (const [header, ref] of Object.entries(connector.http.headerRefs)) {
          const value = await opts.keychain.get(ref);
          if (value === null) {
            issues.push(
              redact(
                `connector ${connector.slug}: missing header ref ${header}=${ref}`,
                secretValues,
              ),
            );
          }
        }
      }
      const status =
        connector.transport === "stdio"
          ? upstreams.getStatus(connector.id)
          : httpUpstreams.getStatus(connector.id);
      if (status === "failed") {
        issues.push(`connector ${connector.slug}: upstream marked failed`);
      }
    }

    return { ok: issues.length === 0, issues };
  }

  async function approveConnector(slug: string): Promise<void> {
    config = await store.update((cfg) => ({
      ...cfg,
      connectors: cfg.connectors.map((c) => {
        if (c.slug !== slug) return c;
        return {
          ...c,
          quarantine: {
            state: "approved" as const,
            approvedCommandHash: c.commandHash,
            tools: c.quarantine.tools,
          },
        };
      }),
    }));
    await reconcileUpstreams();
  }

  async function approveTool(slug: string, tool: string): Promise<void> {
    config = await store.update((cfg) => ({
      ...cfg,
      connectors: cfg.connectors.map((c) => {
        if (c.slug !== slug) return c;
        const prev = c.quarantine.tools[tool];
        const tools = {
          ...c.quarantine.tools,
          [tool]: {
            inputSchemaHash: prev?.inputSchemaHash ?? inputSchemaHash({ type: "object" }),
            state: "approved" as const,
          },
        };
        if (c.quarantine.state === "approved") {
          return {
            ...c,
            quarantine: {
              state: "approved" as const,
              approvedCommandHash: c.quarantine.approvedCommandHash,
              tools,
            },
          };
        }
        return { ...c, quarantine: { state: "pending" as const, tools } };
      }),
    }));
  }

  async function adoptPath(path: string): Promise<{ projectId: string }> {
    config = await store.update((cfg) => {
      const existing = cfg.projects.find((p) => p.paths.some((pPath) => pathsEqual(pPath, path)));
      if (existing) {
        return {
          ...cfg,
          projects: cfg.projects.map((p) =>
            p.id === existing.id
              ? { ...p, adopted: true, paths: uniquePaths([...p.paths, path]) }
              : p,
          ),
        };
      }
      const project: Project = {
        id: newId(),
        originUrl: null,
        paths: [path],
        adopted: true,
        assignments: [],
      };
      return { ...cfg, projects: [...cfg.projects, project] };
    });
    await reconcileUpstreams();
    const project = config.projects.find((p) => p.paths.some((pPath) => pathsEqual(pPath, path)))!;
    return { projectId: project.id };
  }

  function serviceConflictMessage(
    serviceId: string,
    other: { accountLabel?: string },
  ): string {
    const title = getCatalogEntry(serviceId)?.title ?? serviceId;
    const named = other.accountLabel ? `${title} (${other.accountLabel})` : title;
    return `This project already has ${named}. Remove it before linking another ${title} account.`;
  }

  function assertProjectAcceptsService(projectId: string | undefined, serviceId: string): void {
    if (!projectId) return;
    const project = config.projects.find((p) => p.id === projectId);
    if (!project) throw new Error(`unknown project ${projectId}`);
    const ids = POPULAR_CATALOG.map((entry) => entry.id);
    for (const assignment of project.assignments) {
      const other = config.connectors.find((c) => c.id === assignment.connectorId);
      if (other && catalogServiceOf(other, ids) === serviceId) {
        throw new Error(serviceConflictMessage(serviceId, other));
      }
    }
  }

  function accountFields(req: { catalogId?: string; accountLabel?: string }): {
    catalogId?: string;
    accountLabel?: string;
  } {
    const catalogId = req.catalogId?.trim();
    const accountLabel = cleanAccountLabel(req.accountLabel);
    return {
      ...(catalogId ? { catalogId } : {}),
      ...(accountLabel ? { accountLabel } : {}),
    };
  }

  async function connectorAdd(req: Extract<ControlRequest, { method: "connectorAdd" }>): Promise<{
    id: string;
    slug: string;
  }> {
    if (req.slug === RESERVED_SLUG) {
      throw new Error(`slug ${RESERVED_SLUG} is reserved`);
    }
    const meta = accountFields(req);
    if (req.transport === "http") {
      if (!req.url) throw new Error("http connector requires url");
      const hash = commandHash({ transport: "http", url: req.url });
      const connector: HttpConnector = {
        id: newId(),
        slug: req.slug,
        transport: "http",
        argv: null,
        http: {
          url: req.url,
          sseFallback: req.sseFallback ?? false,
          headerRefs: req.headerRefs ?? {},
        },
        commandHash: hash,
        secretRefs: req.secretRefs ?? [],
        origin: "local",
        quarantine: { state: "pending", tools: {} },
        ...meta,
      };
      config = await store.update((cfg) => {
        if (cfg.connectors.some((c) => c.slug === req.slug)) {
          throw new Error(`connector slug already exists: ${req.slug}`);
        }
        return { ...cfg, connectors: [...cfg.connectors, connector] };
      });
      return { id: connector.id, slug: connector.slug };
    }
    if (!req.argv || req.argv.length === 0) {
      throw new Error("stdio connector requires argv");
    }
    const hash = commandHash({
      transport: "stdio",
      argv: req.argv,
      cwd: req.cwd,
    });
    const connector: StdioConnector = {
      id: newId(),
      slug: req.slug,
      transport: "stdio",
      argv: req.argv,
      http: null,
      commandHash: hash,
      secretRefs: req.secretRefs ?? [],
      origin: "local",
      quarantine: { state: "pending", tools: {} },
      ...(req.cwd ? { cwd: req.cwd } : {}),
      ...meta,
    };
    config = await store.update((cfg) => {
      if (cfg.connectors.some((c) => c.slug === req.slug)) {
        throw new Error(`connector slug already exists: ${req.slug}`);
      }
      return { ...cfg, connectors: [...cfg.connectors, connector] };
    });
    return { id: connector.id, slug: connector.slug };
  }

  async function connectorAssign(
    req: Extract<ControlRequest, { method: "connectorAssign" }>,
  ): Promise<{ assigned: true }> {
    config = await store.update((cfg) => {
      const connector = cfg.connectors.find((c) => c.slug === req.slug);
      if (!connector) throw new Error(`unknown connector ${req.slug}`);
      const project = cfg.projects.find((p) => p.id === req.projectId);
      if (!project) throw new Error(`unknown project ${req.projectId}`);
      const ids = POPULAR_CATALOG.map((entry) => entry.id);
      const service = catalogServiceOf(connector, ids);
      if (service) {
        const conflict = project.assignments.find((assignment) => {
          if (assignment.connectorId === connector.id) return false;
          const other = cfg.connectors.find((c) => c.id === assignment.connectorId);
          return other ? catalogServiceOf(other, ids) === service : false;
        });
        if (conflict) {
          const other = cfg.connectors.find((c) => c.id === conflict.connectorId);
          throw new Error(serviceConflictMessage(service, other ?? {}));
        }
      }
      const toolPolicy = req.toolPolicy ?? { mode: "all-approved" as const };
      const assignments = project.assignments.filter((a) => a.connectorId !== connector.id);
      assignments.push({ connectorId: connector.id, toolPolicy });
      return {
        ...cfg,
        projects: cfg.projects.map((p) =>
          p.id === project.id ? { ...p, assignments } : p,
        ),
      };
    });
    await reconcileUpstreams();
    return { assigned: true };
  }

  async function projectUpdate(
    req: Extract<ControlRequest, { method: "projectUpdate" }>,
  ): Promise<void> {
    config = await store.update((cfg) => {
      const project = cfg.projects.find((p) => p.id === req.projectId);
      if (!project) throw new Error(`unknown project ${req.projectId}`);
      return {
        ...cfg,
        projects: cfg.projects.map((p) => {
          if (p.id !== project.id) return p;
          const next = { ...p };
          if (typeof req.readsOnly === "boolean") {
            if (req.readsOnly) next.readsOnly = true;
            else delete next.readsOnly;
          }
          if (typeof req.searchMode === "boolean") {
            if (req.searchMode) next.searchMode = true;
            else delete next.searchMode;
          }
          return next;
        }),
      };
    });
  }

  async function connectorReconnect(slug: string): Promise<void> {
    const connector = config.connectors.find((c) => c.slug === slug);
    if (!connector) throw new Error(`unknown connector ${slug}`);
    if (connector.quarantine.state !== "approved") {
      throw new Error(`connector ${slug} is not approved`);
    }
    if (connector.transport === "stdio") {
      await upstreams.reconnect(connector);
      return;
    }
    await httpUpstreams.reconnect(connector);
  }

  async function connectorUnassign(
    req: Extract<ControlRequest, { method: "connectorUnassign" }>,
  ): Promise<{ unassigned: true }> {
    config = await store.update((cfg) => {
      const connector = cfg.connectors.find((c) => c.slug === req.slug);
      if (!connector) throw new Error(`unknown connector ${req.slug}`);
      const project = cfg.projects.find((p) => p.id === req.projectId);
      if (!project) throw new Error(`unknown project ${req.projectId}`);
      return {
        ...cfg,
        projects: cfg.projects.map((p) =>
          p.id === project.id
            ? {
                ...p,
                assignments: p.assignments.filter((a) => a.connectorId !== connector.id),
              }
            : p,
        ),
      };
    });
    await reconcileUpstreams();
    return { unassigned: true };
  }

  async function close(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    if (ui) {
      await ui.close().catch(() => undefined);
      ui = null;
    }
    await oauthInstalls.close().catch(() => undefined);
    for (const s of sockets) {
      s.destroy();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await upstreams.stopAll();
    await httpUpstreams.stopAll();
    try {
      await unlink(sock);
    } catch {
      // ignore
    }
    try {
      await unlink(pidPath);
    } catch {
      // ignore
    }
  }

  return {
    socketPath: sock,
    token,
    close,
  };
}

function adoptedAssignmentIds(config: Config): Set<string> {
  const ids = new Set<string>();
  for (const project of config.projects) {
    if (!project.adopted) continue;
    for (const a of project.assignments) {
      ids.add(a.connectorId);
    }
  }
  return ids;
}

function stdioConnectorsToRun(config: Config): StdioConnector[] {
  const assigned = adoptedAssignmentIds(config);
  return config.connectors.filter(
    (c): c is StdioConnector =>
      c.transport === "stdio" &&
      c.quarantine.state === "approved" &&
      assigned.has(c.id),
  );
}

function httpConnectorsToRun(config: Config): HttpConnector[] {
  const assigned = adoptedAssignmentIds(config);
  return config.connectors.filter(
    (c): c is HttpConnector =>
      c.transport === "http" &&
      c.quarantine.state === "approved" &&
      assigned.has(c.id),
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function writeResponse(socket: Socket, response: ControlResponse): void {
  writeFrame(socket, response);
}

function writeFrame(socket: Socket, message: unknown): void {
  if (socket.destroyed) return;
  socket.write(encodeFrame(message));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathsEqual(a: string, b: string): boolean {
  return a === b || join(a) === join(b);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
