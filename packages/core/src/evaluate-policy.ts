import type { ToolPolicy } from "@solemcp/schema";

export type PolicyEvaluation = {
  names: string[];
  unknownNames: string[];
};

/**
 * Filter approved upstream tool names by assignment policy.
 * Unknown allow/deny names are reported; they do not drop the connector.
 */
export function evaluatePolicy(
  approvedToolNames: readonly string[],
  policy: ToolPolicy,
): PolicyEvaluation {
  const approved = new Set(approvedToolNames);

  if ("mode" in policy) {
    return { names: [...approvedToolNames], unknownNames: [] };
  }

  if ("allow" in policy) {
    const names: string[] = [];
    const unknownNames: string[] = [];
    for (const name of policy.allow) {
      if (approved.has(name)) names.push(name);
      else unknownNames.push(name);
    }
    return { names, unknownNames };
  }

  const deny = new Set(policy.deny);
  const unknownNames = policy.deny.filter((name) => !approved.has(name));
  const names = approvedToolNames.filter((name) => !deny.has(name));
  return { names, unknownNames };
}
