import type { ClientName } from "../argv.ts";

export interface ImportSourceFile {
  client: ClientName;
  path: string;
  text: string;
}

export interface ImportPreviewConnector {
  slug: string;
  transport: "stdio" | "http";
  argv?: string[];
  url?: string;
  sourceClient: ClientName;
  sourcePath: string;
}

export interface ImportPreview {
  connectors: ImportPreviewConnector[];
  /** Always false from preview — writing requires confirm + control client. */
  wouldWrite: false;
}

/**
 * Build an import preview from client config texts. Does not write anything.
 */
export function previewImport(files: readonly ImportSourceFile[]): ImportPreview {
  const connectors: ImportPreviewConnector[] = [];

  for (const file of files) {
    if (file.client === "codex") {
      continue; // TOML import parsing deferred; preview still does not write
    }
    let parsed: { mcpServers?: Record<string, unknown> };
    try {
      parsed = JSON.parse(file.text) as typeof parsed;
    } catch {
      continue;
    }
    const servers = parsed.mcpServers ?? {};
    for (const [slug, entry] of Object.entries(servers)) {
      if (slug === "solemcp") continue;
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.url === "string") {
        connectors.push({
          slug,
          transport: "http",
          url: rec.url,
          sourceClient: file.client,
          sourcePath: file.path,
        });
        continue;
      }
      const command = typeof rec.command === "string" ? rec.command : undefined;
      const args = Array.isArray(rec.args)
        ? rec.args.filter((a): a is string => typeof a === "string")
        : [];
      if (command) {
        connectors.push({
          slug,
          transport: "stdio",
          argv: [command, ...args],
          sourceClient: file.client,
          sourcePath: file.path,
        });
      }
    }
  }

  return { connectors, wouldWrite: false };
}
