import { describe, expect, it } from "vitest";
import { redact, redactForLog } from "./redact.ts";

describe("redact", () => {
  it("replaces each secret value with [redacted]", () => {
    expect(redact("token=abc123 end", ["abc123"])).toBe("token=[redacted] end");
  });

  it("redacts a secret that is a substring of a longer token", () => {
    expect(redact("prefix-secret-suffix", ["secret"])).toBe(
      "prefix-[redacted]-suffix",
    );
  });

  it("redacts the same secret twice", () => {
    expect(redact("a SECRET and SECRET again", ["SECRET"])).toBe(
      "a [redacted] and [redacted] again",
    );
  });

  it("is a no-op for an empty secret list aside from headers and userinfo", () => {
    expect(redact("plain text", [])).toBe("plain text");
  });

  it("does not redact the empty string as a secret", () => {
    expect(redact("hello", [""])).toBe("hello");
  });

  it("redacts Authorization, X-API-Key, and api_key header values", () => {
    const text = [
      "Authorization: Bearer tok",
      "X-API-Key: key123",
      "api_key: sk-live",
    ].join("\n");
    const out = redact(text, []);
    expect(out).toContain("Authorization: [redacted]");
    expect(out).toContain("X-API-Key: [redacted]");
    expect(out).toContain("api_key: [redacted]");
    expect(out).not.toContain("Bearer tok");
    expect(out).not.toContain("key123");
    expect(out).not.toContain("sk-live");
  });

  it("redacts URL userinfo", () => {
    expect(redact("see https://user:pass@example.com/path", [])).toBe(
      "see https://[redacted]@example.com/path",
    );
  });

  it("redacts credential-shaped tokens even when they are not in the secret list", () => {
    const text = "result ghp_abcdefghijklmnopqrstuvwxyz and Bearer abcdefghijklmnop";
    const out = redactForLog(text, []);
    expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).toContain("[redacted]");
  });
});
