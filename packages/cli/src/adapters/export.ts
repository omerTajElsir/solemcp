import { cursorBridgeEntry, resolveBridgeLaunch, codexTomlSnippet } from "@solemcp/daemon";

/** Print-only managed entry. Never writes. */
export function exportClientEntry(format: "json" | "toml"): string {
  const launch = resolveBridgeLaunch();
  if (format === "toml") {
    return codexTomlSnippet(launch);
  }
  return `${JSON.stringify(
    {
      mcpServers: {
        solemcp: cursorBridgeEntry(launch),
      },
    },
    null,
    2,
  )}\n`;
}
