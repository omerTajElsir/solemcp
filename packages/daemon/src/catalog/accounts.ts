const SLUG_MAX = 32;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export type ServiceIdentity = {
  slug: string;
  catalogId?: string;
};

/** Which catalog service a connector belongs to, if any. */
export function catalogServiceOf(
  connector: ServiceIdentity,
  catalogIds: readonly string[],
): string | null {
  if (connector.catalogId) return connector.catalogId;
  const ids = [...catalogIds].sort((a, b) => b.length - a.length);
  for (const id of ids) {
    if (connector.slug === id || connector.slug.startsWith(`${id}-`)) return id;
  }
  return null;
}

export function cleanAccountLabel(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const label = raw.trim().replace(/\s+/g, " ");
  if (!label) return undefined;
  if (label.length > 40) {
    throw new Error("Account name must be 40 characters or fewer");
  }
  return label;
}

/**
 * First account keeps the catalog slug. Later accounts get their own slug
 * so each login has its own keychain entry.
 */
export function allocateAccountSlug(
  base: string,
  taken: readonly string[],
  label?: string,
): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  const suffix = label ? labelToSuffix(label) : "";
  if (suffix) {
    const named = fitSlug(`${base}-${suffix}`);
    if (named && named !== base && !used.has(named)) return named;
  }
  for (let n = 2; n < 50; n++) {
    const candidate = fitSlug(`${base}-${n}`);
    if (candidate && !used.has(candidate)) return candidate;
  }
  throw new Error("could not name another account");
}

export function planAccountInstance(input: {
  baseSlug: string;
  oauthBearerRef?: string;
  takenSlugs: readonly string[];
  existingAccounts: number;
  accountLabel?: string;
}): { slug: string; bearerRef: string; accountPrefix: string; accountLabel?: string } {
  const accountLabel = cleanAccountLabel(input.accountLabel);
  if (input.existingAccounts > 0 && !accountLabel) {
    throw new Error("Name this account so you can tell it apart");
  }
  const slug = allocateAccountSlug(input.baseSlug, input.takenSlugs, accountLabel);
  const bearerRef =
    slug === input.baseSlug && input.oauthBearerRef
      ? input.oauthBearerRef
      : `${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_OAUTH_TOKEN`;
  return {
    slug,
    bearerRef,
    accountPrefix: `oauth:${slug}`,
    ...(accountLabel ? { accountLabel } : {}),
  };
}

function labelToSuffix(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16)
    .replace(/-+$/g, "");
}

function fitSlug(slug: string): string | null {
  const cut = slug.slice(0, SLUG_MAX).replace(/-+$/g, "");
  if (!SLUG_PATTERN.test(cut)) return null;
  return cut;
}
