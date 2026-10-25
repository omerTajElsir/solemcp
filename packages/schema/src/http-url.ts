import { z } from "zod";

const LOCAL_HTTP_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Userinfo is the authority section before `@`, including an empty `user@`.
 * `URL.username` stays empty for `https://@host`, so the raw authority is checked too.
 */
function authorityHasUserinfo(value: string): boolean {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(value);
  return match !== null && match[1].includes("@");
}

export function httpUrlIssue(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "invalid url";
  }
  if (url.username !== "" || url.password !== "" || authorityHasUserinfo(value)) {
    return "url userinfo is not allowed";
  }
  if (url.protocol === "https:") return undefined;
  if (url.protocol === "http:") {
    if (LOCAL_HTTP_HOSTS.has(url.hostname)) return undefined;
    return "http url host must be 127.0.0.1 or localhost";
  }
  return "url protocol must be https or local http";
}

export const httpUrlSchema = z.string().superRefine((value, ctx) => {
  const message = httpUrlIssue(value);
  if (message !== undefined) {
    ctx.addIssue({ code: "custom", message });
  }
});
