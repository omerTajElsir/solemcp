import { describe, expect, it } from "vitest";
import { MemoryKeychain } from "../keychain.ts";
import { listPopularCatalog, prepareCatalogInstall } from "./install.ts";
import { POPULAR_CATALOG } from "./popular.ts";

describe("popular catalog", () => {
  it("lists curated entries with oauth for hosted tools", () => {
    expect(POPULAR_CATALOG.map((e) => e.id)).toEqual([
      "github",
      "notion",
      "linear",
      "gitlab",
      "jira",
      "sentry",
      "vercel",
      "supabase",
      "stripe",
      "posthog",
      "cloudflare",
      "filesystem",
      "fetch",
      "playwright",
    ]);
    expect(POPULAR_CATALOG.find((e) => e.id === "github")?.authMode).toBe("github");
    expect(POPULAR_CATALOG.find((e) => e.id === "notion")?.authMode).toBe("oauth");
    expect(POPULAR_CATALOG.find((e) => e.id === "jira")?.url).toBe(
      "https://mcp.atlassian.com/v2/mcp",
    );
    expect(POPULAR_CATALOG.find((e) => e.id === "posthog")?.url).toBe(
      "https://mcp.posthog.com/mcp?mode=cli",
    );
    expect(POPULAR_CATALOG.find((e) => e.id === "fetch")?.authMode).toBe("none");
    expect(POPULAR_CATALOG.find((e) => e.id === "playwright")?.authMode).toBe("none");
    for (const id of [
      "gitlab",
      "jira",
      "sentry",
      "vercel",
      "supabase",
      "stripe",
      "posthog",
      "cloudflare",
    ]) {
      const entry = POPULAR_CATALOG.find((e) => e.id === id);
      expect(entry?.authMode).toBe("oauth");
      expect(entry?.transport).toBe("http");
      expect(entry?.url).toMatch(/^https:\/\//);
    }
  });

  it("prepareCatalogInstall refuses oauth entries", async () => {
    const keychain = new MemoryKeychain();
    await expect(
      prepareCatalogInstall("github", { keychain, secrets: {} }),
    ).rejects.toThrow(/dedicated install flow/);
  });

  it("prepareCatalogInstall fills filesystem path", async () => {
    const keychain = new MemoryKeychain();
    const prepared = await prepareCatalogInstall("filesystem", {
      keychain,
      path: "/tmp/allowed",
    });
    expect(prepared.add.argv).toEqual([
      "npx",
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/tmp/allowed",
    ]);
  });

  it("prepareCatalogInstall builds the Playwright command", async () => {
    const keychain = new MemoryKeychain();
    const prepared = await prepareCatalogInstall("playwright", { keychain });
    expect(prepared.add).toEqual({
      slug: "playwright",
      transport: "stdio",
      argv: ["npx", "-y", "@playwright/mcp@latest"],
    });
  });

  it("listPopularCatalog marks installed slugs and authMode", async () => {
    const keychain = new MemoryKeychain();
    const list = await listPopularCatalog({
      keychain,
      installedSlugs: new Set(["fetch"]),
    });
    expect(list.find((e) => e.id === "fetch")?.installed).toBe(true);
    expect(list.find((e) => e.id === "github")?.authMode).toBe("github");
  });
});
