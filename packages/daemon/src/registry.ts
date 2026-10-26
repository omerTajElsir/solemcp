import { SLUG_PATTERN } from "@solemcp/schema";

export const REGISTRY_BASE = "https://registry.modelcontextprotocol.io";

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

export type RegistryHit = {
  name: string;
  title: string;
  description: string;
  version: string;
};

export type RegistryEnvVar = {
  name: string;
  description: string;
  required: boolean;
  secret: boolean;
};

export type RegistryInstallRequest = {
  name: string;
  version?: string;
  secrets?: Record<string, string>;
};

export type RegistryNeedsEnv = {
  status: "needs_env";
  title: string;
  catalogId: string;
  variables: RegistryEnvVar[];
};

export type RegistryReady = {
  status: "ready";
  title: string;
  catalogId: string;
  slugBase: string;
  transport: "stdio" | "http";
  argv?: string[];
  url?: string;
  sseFallback?: boolean;
  secretRefs: string[];
  headerRefs?: Record<string, string>;
  secrets: Record<string, string>;
};

export type RegistryPlan = RegistryNeedsEnv | RegistryReady;

type FetchLike = typeof fetch;

const UNREACHABLE =
  "The MCP registry is unreachable. Ready-made tools on this Mac still work.";

export async function searchOfficialRegistry(
  query: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ servers: RegistryHit[] }> {
  const url = new URL("/v0.1/servers", REGISTRY_BASE);
  const trimmed = query.trim();
  if (trimmed) url.searchParams.set("search", trimmed);
  url.searchParams.set("version", "latest");
  url.searchParams.set("limit", "20");
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new RegistryError(UNREACHABLE);
  }
  if (!response.ok) throw new RegistryError(UNREACHABLE);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RegistryError(UNREACHABLE);
  }
  return { servers: parseRegistryList(body) };
}

export async function installRegistryServer(
  request: RegistryInstallRequest,
  fetchImpl: FetchLike = fetch,
): Promise<RegistryPlan> {
  const name = request.name.trim();
  if (!name) throw new RegistryError("Registry server name is required");
  const version = request.version?.trim() || "latest";
  const url = `${REGISTRY_BASE}/v0.1/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new RegistryError(UNREACHABLE);
  }
  if (!response.ok) throw new RegistryError(UNREACHABLE);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RegistryError(UNREACHABLE);
  }
  return planRegistryServer(body, request.secrets ?? {});
}

/** Turn one official registry server document into a quarantined install plan. */
export function planRegistryServer(
  body: unknown,
  provided: Record<string, string> = {},
): RegistryPlan {
  const server = serverObject(body);
  const name = stringField(server, "name");
  if (!name) throw new RegistryError("Registry server is missing a name");
  const title = stringField(server, "title") || name.split("/").pop() || name;
  const variables = envVars(server);
  const missing = variables.filter((variable) => {
    if (!variable.required && !variable.secret) return false;
    return !provided[variable.name]?.trim();
  });
  if (missing.length > 0) {
    return { status: "needs_env", title, catalogId: name, variables };
  }

  const secrets: Record<string, string> = {};
  const secretRefs: string[] = [];
  for (const variable of variables) {
    const value = provided[variable.name]?.trim();
    if (!value) continue;
    secrets[variable.name] = value;
    secretRefs.push(variable.name);
  }

  const argv = stdioArgv(server);
  if (argv) {
    return {
      status: "ready",
      title,
      catalogId: name,
      slugBase: registrySlugBase(name),
      transport: "stdio",
      argv,
      secretRefs,
      secrets,
    };
  }

  const remote = firstRemote(server);
  if (!remote) {
    throw new RegistryError(
      "This registry server has no remote URL or package SoleMCP can install.",
    );
  }
  const headerRefs: Record<string, string> = {};
  if (secrets.Authorization) headerRefs.Authorization = "Authorization";
  return {
    status: "ready",
    title,
    catalogId: name,
    slugBase: registrySlugBase(name),
    transport: "http",
    url: remote.url,
    sseFallback: remote.type === "sse",
    secretRefs,
    ...(Object.keys(headerRefs).length ? { headerRefs } : {}),
    secrets,
  };
}

export function registrySlugBase(name: string): string {
  const last = name.split("/").pop() ?? name;
  const slug = last
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  if (!SLUG_PATTERN.test(slug) || slug === "solemcp") return "mcp-server";
  return slug;
}

function parseRegistryList(body: unknown): RegistryHit[] {
  if (!isRecord(body) || !Array.isArray(body.servers)) return [];
  const hits: RegistryHit[] = [];
  for (const item of body.servers) {
    const server = serverObject(item);
    const name = stringField(server, "name");
    if (!name) continue;
    hits.push({
      name,
      title: stringField(server, "title") || name.split("/").pop() || name,
      description: stringField(server, "description"),
      version: stringField(server, "version"),
    });
  }
  return hits;
}

function serverObject(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) return {};
  if (isRecord(body.server)) return body.server;
  return body;
}

function envVars(server: Record<string, unknown>): RegistryEnvVar[] {
  const packages = Array.isArray(server.packages) ? server.packages : [];
  const variables: RegistryEnvVar[] = [];
  const seen = new Set<string>();
  for (const pkg of packages) {
    if (!isRecord(pkg) || !Array.isArray(pkg.environmentVariables)) continue;
    for (const raw of pkg.environmentVariables) {
      if (!isRecord(raw) || typeof raw.name !== "string" || seen.has(raw.name)) continue;
      seen.add(raw.name);
      variables.push({
        name: raw.name,
        description: typeof raw.description === "string" ? raw.description : "",
        required: raw.isRequired === true,
        secret: raw.isSecret === true,
      });
    }
  }
  return variables;
}

function firstRemote(
  server: Record<string, unknown>,
): { type: string; url: string } | null {
  if (!Array.isArray(server.remotes)) return null;
  for (const remote of server.remotes) {
    if (!isRecord(remote) || typeof remote.url !== "string") continue;
    const type = typeof remote.type === "string" ? remote.type : "";
    if (type === "streamable-http" || type === "sse" || type === "http") {
      return { type: type === "http" ? "streamable-http" : type, url: remote.url };
    }
  }
  return null;
}

function stdioArgv(server: Record<string, unknown>): string[] | null {
  if (!Array.isArray(server.packages)) return null;
  for (const pkg of server.packages) {
    if (!isRecord(pkg) || typeof pkg.identifier !== "string") continue;
    const registryType = typeof pkg.registryType === "string" ? pkg.registryType : "";
    const runtimeArgs = runtimeArgumentValues(pkg.runtimeArguments);
    if (registryType === "npm") {
      const bin = typeof pkg.runtimeHint === "string" && pkg.runtimeHint ? pkg.runtimeHint : "npx";
      const args = runtimeArgs.length > 0 ? runtimeArgs : ["-y"];
      return [bin, ...args, pkg.identifier];
    }
    if (registryType === "pypi") {
      const bin = typeof pkg.runtimeHint === "string" && pkg.runtimeHint ? pkg.runtimeHint : "uvx";
      return [bin, ...runtimeArgs, pkg.identifier];
    }
  }
  return null;
}

function runtimeArgumentValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (isRecord(item) && typeof item.value === "string") out.push(item.value);
    else if (typeof item === "string") out.push(item);
  }
  return out;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
