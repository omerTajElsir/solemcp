import { z } from "zod";
import { ulidSchema } from "./id.ts";
import { slugSchema } from "./slug.ts";
import { toolPolicySchema } from "./tool-policy.ts";

/** Keys a committed `.solemcp/project.json` must not contain, at any depth. */
export const FORBIDDEN_PROJECT_FILE_KEYS = [
  "argv",
  "command",
  "url",
  "env",
  "headers",
  "token",
  "path",
  "home",
  "commandHash",
  "quarantine",
] as const;

const forbiddenKeys: ReadonlySet<string> = new Set(FORBIDDEN_PROJECT_FILE_KEYS);

function rejectForbiddenKeys(value: unknown, seen: Set<object>): void {
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) rejectForbiddenKeys(item, seen);
    return;
  }
  for (const key of Object.keys(value)) {
    if (forbiddenKeys.has(key)) {
      throw new Error(`forbidden key: ${key}`);
    }
    rejectForbiddenKeys((value as Record<string, unknown>)[key], seen);
  }
}

export const projectFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: ulidSchema,
  connectors: z.array(slugSchema),
  toolPolicy: z.record(slugSchema, toolPolicySchema),
});

export type ProjectFile = z.infer<typeof projectFileSchema>;

/** Validate a committed `.solemcp/project.json`. Forbidden keys reject the file. */
export function parseProjectFile(input: unknown): ProjectFile {
  rejectForbiddenKeys(input, new Set());
  return projectFileSchema.parse(input);
}
