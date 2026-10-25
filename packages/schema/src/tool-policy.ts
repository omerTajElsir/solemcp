import { z } from "zod";

const toolNameSchema = z.string().min(1);

/**
 * `{ mode: "all-approved" }`, `{ allow: string[] }`, or `{ deny: string[] }`.
 * The three shapes are exclusive.
 */
export const toolPolicySchema = z.union([
  z.strictObject({ mode: z.literal("all-approved") }),
  z.strictObject({ allow: z.array(toolNameSchema) }),
  z.strictObject({ deny: z.array(toolNameSchema) }),
]);

export type ToolPolicy = z.infer<typeof toolPolicySchema>;
