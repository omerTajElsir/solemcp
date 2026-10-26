import type { Keychain } from "../keychain.ts";
import { catalogServiceOf } from "./accounts.ts";
import {
  getCatalogEntry,
  POPULAR_CATALOG,
  type CatalogEntry,
} from "./popular.ts";

export type CatalogListItem = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  transport: "stdio" | "http";
  authMode: "oauth" | "github" | "secret" | "none";
  installed: boolean;
  accountCount: number;
  needsPath: boolean;
  pathLabel?: string;
  pathPlaceholder?: string;
  secrets: { ref: string; label: string; help: string; present: boolean }[];
  docsUrl?: string;
};

export async function listPopularCatalog(opts: {
  keychain: Keychain;
  installedSlugs: Set<string>;
  accounts?: { slug: string; catalogId?: string }[];
}): Promise<CatalogListItem[]> {
  const catalogIds = POPULAR_CATALOG.map((entry) => entry.id);
  const items: CatalogListItem[] = [];
  for (const entry of POPULAR_CATALOG) {
    const accountCount = opts.accounts
      ? opts.accounts.filter((account) => catalogServiceOf(account, catalogIds) === entry.id).length
      : opts.installedSlugs.has(entry.slug)
        ? 1
        : 0;
    const secrets = [];
    for (const s of entry.secrets) {
      const value = await opts.keychain.get(s.ref);
      secrets.push({
        ref: s.ref,
        label: s.label,
        help: s.help,
        present: value !== null && value.length > 0,
      });
    }
    items.push({
      id: entry.id,
      slug: entry.slug,
      title: entry.title,
      summary: entry.summary,
      transport: entry.transport,
      authMode: entry.authMode,
      installed: accountCount > 0,
      accountCount,
      needsPath: entry.needsPath === true,
      pathLabel: entry.pathLabel,
      pathPlaceholder: entry.pathPlaceholder,
      secrets,
      docsUrl: entry.docsUrl,
    });
  }
  return items;
}

/**
 * Store any provided secrets, then return a connectorAdd payload for secret/none entries.
 */
export async function prepareCatalogInstall(
  entryId: string,
  opts: {
    keychain: Keychain;
    secrets?: Record<string, string>;
    path?: string;
    instanceSlug?: string;
  },
): Promise<{
  entry: CatalogEntry;
  add: {
    slug: string;
    transport: "stdio" | "http";
    argv?: string[];
    url?: string;
    sseFallback?: boolean;
    secretRefs?: string[];
    headerRefs?: Record<string, string>;
  };
  secretsStored: string[];
}> {
  const entry = getCatalogEntry(entryId);
  if (!entry) throw new Error(`unknown catalog entry: ${entryId}`);
  if (entry.authMode === "oauth" || entry.authMode === "github") {
    throw new Error("use the dedicated install flow for this catalog entry");
  }

  const provided = opts.secrets ?? {};
  const secretsStored: string[] = [];
  const instanceSlug = opts.instanceSlug ?? entry.slug;

  for (const field of entry.secrets) {
    const ref = instanceSlug === entry.slug ? field.ref : `${instanceSlug}:${field.ref}`;
    const raw = (provided[ref] ?? provided[field.ref])?.trim();
    if (raw) {
      const value = `${field.valuePrefix ?? ""}${raw}`;
      await opts.keychain.set(ref, value);
      secretsStored.push(ref);
    } else {
      const existing = await opts.keychain.get(ref);
      if (!existing) {
        throw new Error(`missing secret ${field.ref} (${field.label})`);
      }
    }
  }

  let argv = entry.argv ? [...entry.argv] : undefined;
  if (entry.needsPath) {
    const path = opts.path?.trim();
    if (!path) throw new Error("path is required for this connector");
    argv = (argv ?? []).map((part) => (part === "{{path}}" ? path : part));
  }

  const headerRefs: Record<string, string> = {};
  const secretRefs: string[] = [];
  for (const field of entry.secrets) {
    const ref = instanceSlug === entry.slug ? field.ref : `${instanceSlug}:${field.ref}`;
    if (field.header) {
      headerRefs[field.header] = ref;
    } else {
      secretRefs.push(ref);
    }
  }

  return {
    entry,
    secretsStored,
    add: {
      slug: instanceSlug,
      transport: entry.transport,
      ...(argv ? { argv } : {}),
      ...(entry.url ? { url: entry.url } : {}),
      ...(entry.sseFallback !== undefined ? { sseFallback: entry.sseFallback } : {}),
      ...(secretRefs.length ? { secretRefs } : {}),
      ...(Object.keys(headerRefs).length ? { headerRefs } : {}),
    },
  };
}
