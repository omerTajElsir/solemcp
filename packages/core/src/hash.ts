import { createHash } from "node:crypto";

/** Canonical JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = sortKeys(record[key]);
  }
  return out;
}

function sha256Prefixed(canonical: string): string {
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export type StdioCommand = {
  transport: "stdio";
  argv: string[];
  cwd?: "daemon" | "project";
};

export type HttpCommand = {
  transport: "http";
  url: string;
};

export type CommandSpec = StdioCommand | HttpCommand;

/** SHA-256 of canonical command JSON, prefixed with `sha256:`. */
export function commandHash(spec: CommandSpec): string {
  if (spec.transport === "stdio") {
    return sha256Prefixed(
      canonicalJson({
        transport: "stdio",
        argv: spec.argv,
        cwd: spec.cwd ?? "daemon",
      }),
    );
  }
  return sha256Prefixed(canonicalJson({ transport: "http", url: spec.url }));
}

/** SHA-256 of canonical JSON Schema, prefixed with `sha256:`. */
export function inputSchemaHash(schema: unknown): string {
  return sha256Prefixed(canonicalJson(schema));
}
