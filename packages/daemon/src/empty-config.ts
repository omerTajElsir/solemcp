import type { Config } from "@solemcp/schema";

export function emptyConfig(): Config {
  return {
    schemaVersion: 1,
    connectors: [],
    projects: [],
    clients: {
      cursor: { installed: false },
      "claude-code": { installed: false },
      codex: { installed: false },
    },
    sync: { cursors: {}, tombstones: [] },
  };
}
