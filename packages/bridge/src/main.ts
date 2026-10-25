import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DAEMON_TOKEN_ACCOUNT } from "@solemcp/ipc";
import { ensureDaemonRunning, MacKeychain } from "@solemcp/daemon";
import { createBridgeServer, defaultConnect } from "./server.ts";
import { resolveBridgeRoot } from "./resolve-root.ts";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";

/**
 * Thin entry used by the CLI: resolve root, connect to the daemon, serveStdio.
 * Starts the daemon automatically when ~/.solemcp/run/daemon.sock is missing
 * (so Cursor/Claude can spawn the bridge without a prior `solemcp daemon`).
 */
export async function runBridgeMain(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<StdioServerHandle> {
  const home = env.SOLEMCP_HOME ?? env.HOME ?? env.USERPROFILE;
  if (!home) throw new Error("HOME is required to locate ~/.solemcp");

  await ensureDaemonRunning(home, { env });

  const token =
    env.SOLEMCP_TOKEN ?? (await new MacKeychain().get(DAEMON_TOKEN_ACCOUNT));
  if (!token) {
    throw new Error(
      "SOLEMCP_TOKEN missing and daemon-token not in keychain; start `solemcp daemon` once",
    );
  }

  const cwd = env.PWD ?? process.cwd();
  const resolution = resolveBridgeRoot(argv, env, {
    cwd,
    exists: (path) => existsSync(path),
    gitTopLevel: defaultGitTopLevel,
    originForPath: () => null,
  });

  const root = resolution.kind === "project" ? resolution.root : cwd;
  const forceStatusOnly = resolution.kind === "status-only";

  return createBridgeServer({
    home,
    token,
    root,
    forceStatusOnly,
    connect: defaultConnect,
  });
}

function defaultGitTopLevel(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
