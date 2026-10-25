export type ResolveSessionDeps = {
  /** Injected existence check; core never touches the real filesystem. */
  exists: (path: string) => boolean;
  gitTopLevel: (cwd: string) => string | null;
  originForPath: (path: string) => string | null;
};

export type ResolveSessionInput = {
  cwd: string;
  /** Explicit pin for this client session. */
  pinPath?: string | null;
  /** Claude Code `CLAUDE_PROJECT_DIR` when set. */
  claudeProjectDir?: string | null;
  /** Cursor argv workspace folder when set. */
  cursorArgvRoot?: string | null;
  /** Additional roots (e.g. Claude Code working directories). */
  extraRoots?: readonly string[];
};

export type SessionResolution =
  | { kind: "project"; root: string }
  | { kind: "status-only" };

/**
 * Resolve one project root for a bridge session.
 * Order: pin → Claude env (if exists) → Cursor argv (if exists) → git toplevel → cwd.
 * Extra roots that map to a different non-null origin yield status-only.
 */
export function resolveSession(
  input: ResolveSessionInput,
  deps: ResolveSessionDeps,
): SessionResolution {
  const root = chooseRoot(input, deps);
  const rootOrigin = deps.originForPath(root);

  for (const extra of input.extraRoots ?? []) {
    if (extra === root) continue;
    const extraOrigin = deps.originForPath(extra);
    if (extraOrigin !== null && extraOrigin !== rootOrigin) {
      return { kind: "status-only" };
    }
  }

  return { kind: "project", root };
}

function chooseRoot(input: ResolveSessionInput, deps: ResolveSessionDeps): string {
  if (input.pinPath) return input.pinPath;

  if (input.claudeProjectDir && deps.exists(input.claudeProjectDir)) {
    return input.claudeProjectDir;
  }

  if (input.cursorArgvRoot && deps.exists(input.cursorArgvRoot)) {
    return input.cursorArgvRoot;
  }

  const gitRoot = deps.gitTopLevel(input.cwd);
  if (gitRoot) return gitRoot;

  return input.cwd;
}
