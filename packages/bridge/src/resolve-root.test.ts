import { describe, expect, it } from "vitest";
import { lastAbsolutePathArg, resolveBridgeRoot } from "./resolve-root.ts";

describe("lastAbsolutePathArg", () => {
  it("returns the last absolute path in argv", () => {
    expect(lastAbsolutePathArg(["bridge", "/tmp/a", "--flag", "/tmp/b"])).toBe("/tmp/b");
  });

  it("returns null when no absolute path is present", () => {
    expect(lastAbsolutePathArg(["bridge", "relative"])).toBeNull();
  });
});

describe("resolveBridgeRoot", () => {
  const baseDeps = {
    exists: (p: string) => p === "/claude" || p === "/cursor",
    gitTopLevel: () => "/git",
    originForPath: () => null as string | null,
  };

  it("prefers Claude CLAUDE_PROJECT_DIR over Cursor argv and git", () => {
    const result = resolveBridgeRoot(["bridge", "/cursor"], { CLAUDE_PROJECT_DIR: "/claude" }, {
      ...baseDeps,
      cwd: "/cwd",
    });
    expect(result).toEqual({ kind: "project", root: "/claude" });
  });

  it("uses Cursor absolute argv root when Claude env is absent", () => {
    const result = resolveBridgeRoot(["bridge", "/cursor"], {}, {
      ...baseDeps,
      cwd: "/cwd",
    });
    expect(result).toEqual({ kind: "project", root: "/cursor" });
  });

  it("uses injectable gitTopLevel when Claude and Cursor roots are absent", () => {
    const result = resolveBridgeRoot(["bridge"], {}, {
      ...baseDeps,
      exists: () => false,
      cwd: "/cwd",
    });
    expect(result).toEqual({ kind: "project", root: "/git" });
  });

  it("yields status-only when extra roots map to different origins", () => {
    const origins: Record<string, string | null> = {
      "/git": "https://github.com/a/one",
      "/other": "https://github.com/a/two",
    };
    const result = resolveBridgeRoot(["bridge"], {}, {
      cwd: "/cwd",
      exists: () => false,
      gitTopLevel: () => "/git",
      originForPath: (p) => origins[p] ?? null,
      extraRoots: ["/other"],
    });
    expect(result).toEqual({ kind: "status-only" });
  });
});
