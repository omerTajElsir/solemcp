import { describe, expect, it } from "vitest";
import { ghInstalled, readGhAuthToken } from "./github-auth.ts";

describe("github auth helpers", () => {
  it("reports whether gh is on PATH", () => {
    expect(typeof ghInstalled()).toBe("boolean");
  });

  it("readGhAuthToken returns a structured result", async () => {
    const result = await readGhAuthToken();
    if (result.ok) {
      expect(result.token.length).toBeGreaterThan(0);
      expect(result.source).toBe("gh");
    } else {
      expect(result.reason.length).toBeGreaterThan(0);
      expect(typeof result.ghInstalled).toBe("boolean");
    }
  });
});
