import { describe, expect, it } from "vitest";
import { resolveSession } from "./resolve-session.ts";

describe("resolveSession", () => {
  it("uses Claude env over a different cwd", () => {
    const result = resolveSession(
      {
        cwd: "/cwd",
        claudeProjectDir: "/claude-root",
        cursorArgvRoot: "/cursor-root",
      },
      {
        exists: (p) => p === "/claude-root" || p === "/cursor-root",
        gitTopLevel: () => "/git-root",
        originForPath: () => null,
      },
    );
    expect(result).toEqual({ kind: "project", root: "/claude-root" });
  });

  it("uses Cursor argv root over a different cwd when Claude env is absent", () => {
    const result = resolveSession(
      {
        cwd: "/cwd",
        cursorArgvRoot: "/cursor-root",
      },
      {
        exists: (p) => p === "/cursor-root",
        gitTopLevel: () => "/git-root",
        originForPath: () => null,
      },
    );
    expect(result).toEqual({ kind: "project", root: "/cursor-root" });
  });

  it("uses git toplevel when Claude and Cursor roots are absent", () => {
    const result = resolveSession(
      { cwd: "/cwd" },
      {
        exists: () => false,
        gitTopLevel: (cwd) => (cwd === "/cwd" ? "/git-root" : null),
        originForPath: () => null,
      },
    );
    expect(result).toEqual({ kind: "project", root: "/git-root" });
  });

  it("falls back to cwd when git toplevel is absent", () => {
    const result = resolveSession(
      { cwd: "/cwd" },
      {
        exists: () => false,
        gitTopLevel: () => null,
        originForPath: () => null,
      },
    );
    expect(result).toEqual({ kind: "project", root: "/cwd" });
  });

  it("prefers an explicit pin path", () => {
    const result = resolveSession(
      {
        cwd: "/cwd",
        pinPath: "/pinned",
        claudeProjectDir: "/claude-root",
      },
      {
        exists: () => true,
        gitTopLevel: () => "/git-root",
        originForPath: () => null,
      },
    );
    expect(result).toEqual({ kind: "project", root: "/pinned" });
  });

  it("yields status-only when two different origins appear in one session", () => {
    const origins: Record<string, string | null> = {
      "/root-a": "https://github.com/a/one",
      "/root-b": "https://github.com/a/two",
    };
    const result = resolveSession(
      {
        cwd: "/root-a",
        pinPath: "/root-a",
        extraRoots: ["/root-b"],
      },
      {
        exists: () => true,
        gitTopLevel: () => null,
        originForPath: (p) => origins[p] ?? null,
      },
    );
    expect(result).toEqual({ kind: "status-only" });
  });

  it("keeps project when extra roots share the same origin", () => {
    const result = resolveSession(
      {
        cwd: "/root-a",
        pinPath: "/root-a",
        extraRoots: ["/root-a-checkout"],
      },
      {
        exists: () => true,
        gitTopLevel: () => null,
        originForPath: () => "https://github.com/a/one",
      },
    );
    expect(result).toEqual({ kind: "project", root: "/root-a" });
  });
});
