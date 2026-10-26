import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  installLaunchAgent,
  LAUNCH_AGENT_LABEL,
  renderLaunchAgentPlist,
  uninstallLaunchAgent,
} from "./launchd.ts";

describe("launchd agent", () => {
  it("writes a login agent under a temp LaunchAgents directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "solemcp-home-"));
    const launchAgentsDir = await mkdtemp(join(tmpdir(), "solemcp-agents-"));
    const bootstrapped: string[] = [];
    const { plistPath } = await installLaunchAgent({
      home,
      nodePath: "/usr/local/bin/node",
      entryPath: "/opt/solemcp/solemcp.mjs",
      launchAgentsDir,
      bootstrap: async (path) => {
        bootstrapped.push(path);
      },
    });

    expect(plistPath).toBe(join(launchAgentsDir, `${LAUNCH_AGENT_LABEL}.plist`));
    expect(bootstrapped).toEqual([plistPath]);
    const plist = await readFile(plistPath, "utf8");
    expect(plist).toContain("<string>com.solemcp.daemon</string>");
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/opt/solemcp/solemcp.mjs</string>");
    expect(plist).toContain("<string>daemon</string>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<true/>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain(join(home, ".solemcp", "logs", "daemon.out.log"));
    expect(plist).toContain(join(home, ".solemcp", "logs", "daemon.err.log"));
    expect(plist).not.toContain("/Users/");

    const removed: string[] = [];
    await uninstallLaunchAgent({
      launchAgentsDir,
      bootout: async (path) => {
        removed.push(path);
      },
    });
    expect(removed).toEqual([plistPath]);
    await expect(readFile(plistPath, "utf8")).rejects.toThrow();
  });

  it("renders logs under the given home", () => {
    const plist = renderLaunchAgentPlist({
      nodePath: "/bin/node",
      entryPath: "/bin/solemcp.mjs",
      home: "/tmp/example-home",
      logDir: "/tmp/example-home/.solemcp/logs",
    });
    expect(plist).toContain("/tmp/example-home/.solemcp/logs/daemon.out.log");
  });
});
