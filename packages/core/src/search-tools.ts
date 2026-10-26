export type SearchHit = {
  name: string;
  description: string;
};

/**
 * Substring match on namespaced tool name and description.
 * An empty query returns the whole list. No code is executed.
 */
export function searchTools(
  tools: readonly SearchHit[],
  query: string,
): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return tools.map((tool) => ({ name: tool.name, description: tool.description }));
  return tools
    .filter((tool) => {
      const name = tool.name.toLowerCase();
      const description = tool.description.toLowerCase();
      return name.includes(needle) || description.includes(needle);
    })
    .map((tool) => ({ name: tool.name, description: tool.description }));
}
