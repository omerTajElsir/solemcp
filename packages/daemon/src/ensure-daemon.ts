import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { socketPath } from "@solemcp/ipc";
import { resolveSolemcpEntryPath } from "./clients/bridge-launch.ts";

/**
 * If the control socket is missing, spawn a detached `solemcp daemon` and wait.
 * Used by `solemcp ui` and by the Cursor/Claude bridge so clients work without a
 * manually started daemon.
 */
export async function ensureDaemonRunning(
  home: string,
  opts?: {
    entryPath?: string;
    nodePath?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  const sock = socketPath(home);
  try {
    await access(sock);
    return;
  } catch {
    // start daemon
  }

  const entry = opts?.entryPath ?? resolveSolemcpEntryPath();
  const nodePath = opts?.nodePath ?? process.execPath;
  const child = spawn(nodePath, [entry, "daemon"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...(opts?.env ?? process.env),
      SOLEMCP_HOME: home,
    },
  });
  child.unref();

  const deadline = Date.now() + (opts?.timeoutMs ?? 8000);
  while (Date.now() < deadline) {
    try {
      await access(sock);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error(
    `timed out waiting for solemcp daemon socket at ${sock}; try: solemcp daemon`,
  );
}
