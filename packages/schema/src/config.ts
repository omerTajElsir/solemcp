import { z } from "zod";
import { httpUrlSchema } from "./http-url.ts";
import { ulidSchema } from "./id.ts";
import { slugSchema } from "./slug.ts";
import { toolPolicySchema } from "./tool-policy.ts";

const quarantineStateSchema = z.enum(["pending", "approved"]);

const quarantineToolSchema = z.strictObject({
  inputSchemaHash: z.string().min(1),
  state: quarantineStateSchema,
});

/**
 * Approved connectors record the hash that was approved.
 * Pending connectors do not carry a previous approval.
 */
const quarantineSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("pending"),
    tools: z.record(z.string().min(1), quarantineToolSchema),
  }),
  z.strictObject({
    state: z.literal("approved"),
    approvedCommandHash: z.string().min(1),
    tools: z.record(z.string().min(1), quarantineToolSchema),
  }),
]);

const connectorOriginSchema = z.enum(["local", "cloud-template"]);

const connectorCommon = {
  id: ulidSchema,
  slug: slugSchema,
  commandHash: z.string().min(1),
  secretRefs: z.array(z.string()),
  origin: connectorOriginSchema,
  quarantine: quarantineSchema,
  /** Catalog service id, when this connector came from the ready-made list. */
  catalogId: z.string().min(1).max(64).optional(),
  /** Person-facing name for this login, such as "Work". */
  accountLabel: z.string().min(1).max(40).optional(),
};

/**
 * `cwd` is stored only when set. Omitted means the daemon cwd at runtime.
 * Defaulting it here would change the canonical v1 example, which omits the field.
 */
const stdioConnectorSchema = z.strictObject({
  ...connectorCommon,
  transport: z.literal("stdio"),
  argv: z.array(z.string()),
  http: z.null(),
  cwd: z.enum(["daemon", "project"]).optional(),
});

const httpConnectorSchema = z.strictObject({
  ...connectorCommon,
  transport: z.literal("http"),
  argv: z.null(),
  http: z.strictObject({
    url: httpUrlSchema,
    sseFallback: z.boolean(),
    headerRefs: z.record(z.string(), z.string()),
  }),
});

const connectorSchema = z.discriminatedUnion("transport", [
  stdioConnectorSchema,
  httpConnectorSchema,
]);

const assignmentSchema = z.strictObject({
  connectorId: ulidSchema,
  toolPolicy: toolPolicySchema,
});

const projectSchema = z.strictObject({
  id: ulidSchema,
  originUrl: z.string().min(1).nullable(),
  paths: z.array(z.string()),
  adopted: z.boolean(),
  assignments: z.array(assignmentSchema),
});

const clientsSchema = z.strictObject({
  cursor: z.strictObject({
    installed: z.boolean(),
    configPath: z.string().optional(),
    serverKey: z.string().optional(),
  }),
  "claude-code": z.strictObject({
    installed: z.boolean(),
    scope: z.string().optional(),
  }),
  codex: z.strictObject({
    installed: z.boolean(),
  }),
});

const tombstoneSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["connector", "project", "assignment"]),
  deletedAt: z.string().min(1),
});

/**
 * Sync cursor values are unspecified. The v1 example is an empty object, kept
 * so a later sync does not need a new top-level field.
 */
const syncSchema = z.strictObject({
  cursors: z.record(z.string(), z.unknown()),
  tombstones: z.array(tombstoneSchema),
});

export const configSchema = z.strictObject({
  schemaVersion: z.literal(1),
  connectors: z.array(connectorSchema),
  projects: z.array(projectSchema),
  clients: clientsSchema,
  sync: syncSchema,
});

export type Config = z.infer<typeof configSchema>;
export type Connector = Config["connectors"][number];
export type StdioConnector = Extract<Connector, { transport: "stdio" }>;
export type HttpConnector = Extract<Connector, { transport: "http" }>;
export type HttpEndpoint = HttpConnector["http"];
export type Project = Config["projects"][number];
export type Assignment = Project["assignments"][number];
export type Clients = Config["clients"];
export type CursorClient = Clients["cursor"];
export type ClaudeCodeClient = Clients["claude-code"];
export type CodexClient = Clients["codex"];
export type SyncState = Config["sync"];
export type SyncCursors = SyncState["cursors"];
export type Tombstone = SyncState["tombstones"][number];
export type Quarantine = Connector["quarantine"];
export type QuarantineTool = Quarantine["tools"][string];
export type QuarantineState = Quarantine["state"];
export type ConnectorOrigin = Connector["origin"];
export type { ToolPolicy } from "./tool-policy.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pure migration. Missing `schemaVersion` fails closed.
 * Version 1 is the identity: the same document is returned, unvalidated.
 */
export function migrateConfig(input: unknown): unknown {
  if (!isPlainObject(input) || !Object.hasOwn(input, "schemaVersion")) {
    throw new Error("missing schemaVersion");
  }
  if (input.schemaVersion !== 1) {
    throw new Error("unsupported schemaVersion");
  }
  return input;
}

/** Migrate, then validate as a version 1 config. */
export function parseConfig(input: unknown): Config {
  return configSchema.parse(migrateConfig(input));
}
