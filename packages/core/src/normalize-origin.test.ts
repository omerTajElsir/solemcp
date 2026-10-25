import { describe, expect, it } from "vitest";
import { normalizeOrigin } from "./normalize-origin.ts";

describe("normalizeOrigin", () => {
  it("maps SSH and HTTPS forms to the same key", () => {
    const a = normalizeOrigin("git@github.com:A/B.git");
    const b = normalizeOrigin("https://github.com/a/b");
    const c = normalizeOrigin("https://github.com/a/b/");
    expect(a).toBe("https://github.com/a/b");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("lowercases the host", () => {
    expect(normalizeOrigin("https://GitHub.COM/org/repo")).toBe(
      "https://github.com/org/repo",
    );
  });
});
