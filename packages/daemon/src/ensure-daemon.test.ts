import { mkdtemp, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { socketPath } from "@solemcp/ipc";
import { ensureDaemonRunning } from "./ensure-daemon.ts";

describe("ensureDaemonRunning", () => {
  it("spawns a daemon when the socket is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "solemcp-ensure-"));
    const entry = fileURLToPath(
      new URL("../../../dist/solemcp.mjs", import.meta.url),
    );
    await ensureDaemonRunning(home, {
      entryPath: entry,
      timeoutMs: 10000,
      env: { ...process.env, SOLEMCP_HOME: home },
    });
    await access(socketPath(home));
    const pid = Number((await readFile(join(home, ".solemcp", "run", "daemon.pid"), "utf8")).trim());
    if (Number.isFinite(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already exited
      }
    }
    expect(true).toBe(true);
  }, 15000);
});
