import { homedir } from "node:os";
import { ensureDaemonRunning } from "@solemcp/daemon";
import { SocketControlClient } from "./socket-client.ts";

/**
 * TTY-only: ensure daemon, mint UI session, open browser with token in the fragment.
 */
export async function runUiCommand(opts: {
  stdinIsTTY: boolean;
  home?: string;
  openUrl?: (url: string) => Promise<void>;
  ensureDaemon?: () => Promise<void>;
}): Promise<number> {
  if (!opts.stdinIsTTY) {
    console.error("solemcp ui requires a TTY; refusing non-interactive stdin");
    return 1;
  }

  const home = opts.home ?? process.env.SOLEMCP_HOME ?? homedir();
  const ensure = opts.ensureDaemon ?? (() => ensureDaemonRunning(home));
  await ensure();

  const client = new SocketControlClient(home);
  const res = await client.request({ method: "startUi" });
  if (!res.ok || !res.result || typeof res.result !== "object") {
    console.error(res.error ?? "failed to start UI");
    return 1;
  }
  const { port, token } = res.result as { port: number; token: string };
  const url = `http://127.0.0.1:${port}/#token=${encodeURIComponent(token)}`;
  console.log(`SoleMCP UI on ${url.replace(token, "***")}`);
  console.log(`Listening on http://127.0.0.1:${port}/ (token in URL fragment)`);

  const open = opts.openUrl ?? openBrowser;
  await open(url);
  return 0;
}

async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

export function uiHelpLine(): string {
  return "ui                  Open the loopback management UI (TTY required)";
}
