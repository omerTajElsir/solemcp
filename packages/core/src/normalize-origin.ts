/**
 * Normalize a git remote URL to a stable origin key.
 * Lowercases host (and path for equality with SSH forms), strips trailing
 * `.git` and `/`, and rewrites `git@host:path` to `https://host/path`.
 */
export function normalizeOrigin(raw: string): string {
  let url = raw.trim();

  const scp = /^git@([^:]+):(.+)$/i.exec(url);
  if (scp) {
    url = `https://${scp[1]}/${scp[2]}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return stripTrailing(url.toLowerCase());
  }

  const host = parsed.host.toLowerCase();
  let path = parsed.pathname;
  if (path.endsWith(".git")) path = path.slice(0, -4);
  if (path.endsWith("/")) path = path.slice(0, -1);
  path = path.toLowerCase();

  const protocol = parsed.protocol.toLowerCase() === "http:" ? "http:" : "https:";
  return `${protocol}//${host}${path}`;
}

function stripTrailing(value: string): string {
  let out = value;
  if (out.endsWith(".git")) out = out.slice(0, -4);
  if (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}
