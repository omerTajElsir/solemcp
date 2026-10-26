import type { ToolPolicy } from "@solemcp/schema";
import type { ToolAnnotations } from "./quarantine.ts";

/**
 * A tool is a write when it is unannotated, when `readOnlyHint` is not true,
 * or when `destructiveHint` is set. `readOnlyHint: true` is a read unless it
 * is also marked destructive.
 */
export function countsAsWrite(annotations?: ToolAnnotations): boolean {
  if (annotations?.destructiveHint === true) return true;
  if (annotations?.readOnlyHint === true) return false;
  return true;
}

/**
 * When the project is not reads-only, the policy-filtered list is unchanged.
 * When it is, writes stay hidden unless the assignment names them in `allow`.
 */
export function filterReadsOnly<T extends { name: string; annotations?: ToolAnnotations }>(
  tools: readonly T[],
  policy: ToolPolicy,
  readsOnly: boolean,
): T[] {
  if (!readsOnly) return [...tools];
  const named = "allow" in policy ? new Set(policy.allow) : null;
  return tools.filter((tool) => {
    if (!countsAsWrite(tool.annotations)) return true;
    return named?.has(tool.name) === true;
  });
}
