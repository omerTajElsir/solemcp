const REDACTED = "[redacted]";

/** Header names whose values must never leave the process. */
const HEADER_NAMES = ["Authorization", "X-API-Key", "api_key"] as const;

/**
 * Redact known secrets, sensitive headers, and URL userinfo from text.
 * Empty secret values are ignored. An empty secret list skips secret replacement
 * but still redacts headers and userinfo.
 */
export function redact(text: string, secretValues: readonly string[]): string {
  let out = text;
  out = redactUrlUserinfo(out);
  out = redactHeaders(out);

  const secrets = secretValues
    .filter((s) => s.length > 0)
    .slice()
    .sort((a, b) => b.length - a.length);

  for (const secret of secrets) {
    if (!out.includes(secret)) continue;
    out = out.split(secret).join(REDACTED);
  }

  return out;
}

function redactHeaders(text: string): string {
  let out = text;
  for (const name of HEADER_NAMES) {
    // HTTP header line or key: value / "key": "value" forms
    const line = new RegExp(`(${escapeRegExp(name)})(\\s*:\\s*)([^\\r\\n]+)`, "gi");
    out = out.replace(line, `$1$2${REDACTED}`);

    const json = new RegExp(
      `("${escapeRegExp(name)}")(\\s*:\\s*")([^"]*)(")`,
      "gi",
    );
    out = out.replace(json, `$1$2${REDACTED}$4`);
  }
  return out;
}

function redactUrlUserinfo(text: string): string {
  // scheme://userinfo@host → scheme://[redacted]@host
  return text.replace(
    /([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi,
    `$1${REDACTED}@`,
  );
}

/**
 * Credential-shaped tokens that should not be written even when the exact
 * secret value is not in the known list. Applied after {@link redact}.
 */
const CREDENTIAL_SHAPED =
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}|ghp_[A-Za-z0-9]{12,}|gho_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}\b/g;

export function redactCredentialShaped(text: string): string {
  return text.replace(CREDENTIAL_SHAPED, "[redacted]");
}

/** Known secrets, headers, userinfo, then credential-shaped tokens. */
export function redactForLog(text: string, secretValues: readonly string[]): string {
  return redactCredentialShaped(redact(text, secretValues));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
