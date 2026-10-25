import { isAbsolute } from "node:path";
import { resolveSession } from "@solemcp/core";
import type { ResolveSessionDeps, SessionResolution } from "@solemcp/core";

export type ResolveBridgeRootDeps = ResolveSessionDeps & {
  cwd: string;
  /** Explicit pin for this client session (`solemcp project pin`). */
  pinPath?: string | null;
  /** Additional roots (e.g. from roots/list). */
  extraRoots?: readonly string[];
};

/**
 * Resolve the project root for a bridge process.
 *
 * Cursor: last argv string that looks like an absolute path.
 * Claude Code: `CLAUDE_PROJECT_DIR`.
 * Codex / fallback: injectable `gitTopLevel`, then cwd.
 */
export function resolveBridgeRoot(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  deps: ResolveBridgeRootDeps,
): SessionResolution {
  const { cwd, pinPath, extraRoots, exists, gitTopLevel, originForPath } = deps;
  return resolveSession(
    {
      cwd,
      pinPath,
      claudeProjectDir: env.CLAUDE_PROJECT_DIR ?? null,
      cursorArgvRoot: lastAbsolutePathArg(argv),
      extraRoots,
    },
    { exists, gitTopLevel, originForPath },
  );
}

/** Last argv entry that looks like an absolute filesystem path. */
export function lastAbsolutePathArg(argv: readonly string[]): string | null {
  for (let i = argv.length - 1; i >= 0; i--) {
    const arg = argv[i]!;
    if (arg.startsWith("-")) continue;
    if (isAbsolute(arg)) return arg;
  }
  return null;
}
