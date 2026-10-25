import { NAMESPACE_SEPARATOR, RESERVED_SLUG } from "@solemcp/ipc";

/** Upstream tool name under a connector slug. Rejects the reserved `solemcp` slug. */
export function namespaceTool(slug: string, tool: string): string {
  if (slug === RESERVED_SLUG) {
    throw new Error(`slug ${RESERVED_SLUG} is reserved`);
  }
  return `${slug}${NAMESPACE_SEPARATOR}${tool}`;
}
