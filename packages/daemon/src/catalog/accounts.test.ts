import { describe, expect, it } from "vitest";
import { allocateAccountSlug, catalogServiceOf, planAccountInstance } from "./accounts.ts";

describe("catalog accounts", () => {
  it("matches a connector to its catalog service", () => {
    const ids = ["github", "gitlab", "notion"];
    expect(catalogServiceOf({ slug: "notion", catalogId: "notion" }, ids)).toBe("notion");
    expect(catalogServiceOf({ slug: "notion-work" }, ids)).toBe("notion");
    expect(catalogServiceOf({ slug: "gitlab" }, ids)).toBe("gitlab");
    expect(catalogServiceOf({ slug: "my-tool" }, ids)).toBeNull();
    expect(
      catalogServiceOf({ slug: "files", catalogId: "io.github.example/filesystem" }, ids),
    ).toBe("io.github.example/filesystem");
  });

  it("keeps the first account on the catalog slug and names the next one", () => {
    expect(allocateAccountSlug("notion", [], "Work")).toBe("notion");
    expect(allocateAccountSlug("notion", ["notion"], "Work")).toBe("notion-work");
    expect(allocateAccountSlug("notion", ["notion", "notion-work"])).toBe("notion-2");
  });

  it("requires a name once a service already has an account", () => {
    const first = planAccountInstance({
      baseSlug: "notion",
      oauthBearerRef: "NOTION_OAUTH_TOKEN",
      takenSlugs: [],
      existingAccounts: 0,
    });
    expect(first).toMatchObject({
      slug: "notion",
      bearerRef: "NOTION_OAUTH_TOKEN",
      accountPrefix: "oauth:notion",
    });

    expect(() =>
      planAccountInstance({
        baseSlug: "notion",
        oauthBearerRef: "NOTION_OAUTH_TOKEN",
        takenSlugs: ["notion"],
        existingAccounts: 1,
      }),
    ).toThrow(/Name this account/);

    const second = planAccountInstance({
      baseSlug: "notion",
      oauthBearerRef: "NOTION_OAUTH_TOKEN",
      takenSlugs: ["notion"],
      existingAccounts: 1,
      accountLabel: "Personal",
    });
    expect(second.slug).toBe("notion-personal");
    expect(second.bearerRef).toBe("NOTION_PERSONAL_OAUTH_TOKEN");
    expect(second.accountPrefix).toBe("oauth:notion-personal");
  });
});
