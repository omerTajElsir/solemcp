import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export type UiActivityEvent = { at: string; message: string };

export type UiServerHandlers = {
  status: () => unknown | Promise<unknown>;
  projects: () => unknown | Promise<unknown>;
  connectors: () => unknown | Promise<unknown>;
  doctor: () => unknown | Promise<unknown>;
  activity: () => UiActivityEvent[];
  approveConnector: (slug: string) => Promise<void>;
  approveTool: (slug: string, tool: string) => Promise<void>;
  connectorAdd: (body: Record<string, unknown>) => Promise<unknown>;
  assign: (slug: string, projectId: string) => Promise<unknown>;
  adopt: (path: string) => Promise<unknown>;
  clients: () => unknown | Promise<unknown>;
  clientInstall: (client: string) => Promise<unknown>;
  catalog: () => unknown | Promise<unknown>;
  catalogInstall: (body: Record<string, unknown>) => Promise<unknown>;
  catalogOauthStatus: (sessionId: string) => Promise<unknown>;
};

export type UiServerHandle = {
  port: number;
  token: string;
  close: () => Promise<void>;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

/**
 * Resolve static UI directory: dist/ui next to the bundled binary, or packages/daemon/ui in source.
 */
export function resolveUiRoot(moduleUrl: string = import.meta.url): string {
  const here = fileURLToPath(moduleUrl);
  if (here.endsWith(`${join("src", "ui-server.ts")}`) || here.endsWith(`${join("src", "ui-server.js")}`)) {
    return join(here, "..", "..", "ui");
  }
  // Bundled entry (dist/solemcp.mjs) or any other built file: sibling ui/
  return join(dirname(here), "ui");
}

export async function startUiServer(opts: {
  handlers: UiServerHandlers;
  uiRoot?: string;
  /** Injected for tests. */
  listenHost?: string;
}): Promise<UiServerHandle> {
  const token = randomBytes(24).toString("base64url");
  const uiRoot = opts.uiRoot ?? resolveUiRoot();
  const host = opts.listenHost ?? "127.0.0.1";

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res, {
      token,
      host,
      port: (server.address() as { port: number } | null)?.port ?? 0,
      uiRoot,
      handlers: opts.handlers,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("UI server failed to bind");
  }

  return {
    port: address.port,
    token,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    token: string;
    host: string;
    port: number;
    uiRoot: string;
    handlers: UiServerHandlers;
  },
): Promise<void> {
  try {
    if (!hostAllowed(req, ctx.host, ctx.port)) {
      json(res, 403, { error: "host not allowed" });
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req, ctx.port));
      res.end();
      return;
    }
    if (req.headers.origin && !originAllowed(req.headers.origin, ctx.port)) {
      json(res, 403, { error: "origin not allowed" });
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${ctx.port}`);

    if (url.pathname.startsWith("/api/")) {
      if (!tokenOk(req, ctx.token)) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
      await handleApi(req, res, url, ctx.handlers);
      return;
    }

    await serveStatic(res, ctx.uiRoot, url.pathname);
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : "error" });
  }
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  handlers: UiServerHandlers,
): Promise<void> {
  if (req.method === "GET" && url.pathname === "/api/status") {
    json(res, 200, await handlers.status());
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/projects") {
    json(res, 200, { projects: await handlers.projects() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/connectors") {
    json(res, 200, { connectors: await handlers.connectors() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/doctor") {
    json(res, 200, await handlers.doctor());
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/activity") {
    json(res, 200, { events: handlers.activity() });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/approve/connector") {
    const body = await readJson(req);
    await handlers.approveConnector(String(body.slug ?? ""));
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/approve/tool") {
    const body = await readJson(req);
    await handlers.approveTool(String(body.slug ?? ""), String(body.tool ?? ""));
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/connectors") {
    const body = await readJson(req);
    const result = await handlers.connectorAdd(body);
    json(res, 200, { ok: true, result });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/assign") {
    const body = await readJson(req);
    const result = await handlers.assign(String(body.slug ?? ""), String(body.projectId ?? ""));
    json(res, 200, { ok: true, result });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/adopt") {
    const body = await readJson(req);
    const path = String(body.path ?? "").trim();
    if (!path) {
      json(res, 400, { error: "path is required" });
      return;
    }
    const result = await handlers.adopt(path);
    json(res, 200, { ok: true, result });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/clients") {
    json(res, 200, await handlers.clients());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/clients/install") {
    const body = await readJson(req);
    const client = String(body.client ?? "");
    if (client !== "cursor" && client !== "claude-code" && client !== "codex") {
      json(res, 400, { error: "client must be cursor|claude-code|codex" });
      return;
    }
    const result = await handlers.clientInstall(client);
    json(res, 200, { ok: true, result });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/catalog") {
    json(res, 200, await handlers.catalog());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/catalog/install") {
    const body = await readJson(req);
    const result = await handlers.catalogInstall(body);
    json(res, 200, { ok: true, result });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/catalog/oauth/")) {
    const sessionId = url.pathname.slice("/api/catalog/oauth/".length);
    if (!sessionId) {
      json(res, 400, { error: "sessionId required" });
      return;
    }
    const result = await handlers.catalogOauthStatus(sessionId);
    json(res, 200, result);
    return;
  }
  json(res, 404, { error: "not found" });
}

async function serveStatic(res: ServerResponse, uiRoot: string, pathname: string): Promise<void> {
  let rel = pathname === "/" ? "/index.html" : pathname;
  if (rel.includes("..")) {
    json(res, 400, { error: "bad path" });
    return;
  }
  const file = join(uiRoot, rel.replace(/^\//, ""));
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

function tokenOk(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && auth.slice(7) === token) return true;
  const header = req.headers["x-solemcp-ui-token"];
  return typeof header === "string" && header === token;
}

function hostAllowed(req: IncomingMessage, host: string, port: number): boolean {
  const raw = req.headers.host ?? "";
  return raw === `${host}:${port}` || raw === `127.0.0.1:${port}` || raw === `localhost:${port}`;
}

function originAllowed(origin: string, port: number): boolean {
  return (
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}`
  );
}

function corsHeaders(req: IncomingMessage, port: number): Record<string, string> {
  const origin = req.headers.origin;
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Solemcp-Ui-Token",
  };
  if (origin && originAllowed(origin, port)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
