import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { LOG_DIR, solemcpHome } from "@solemcp/ipc";

export const LAUNCH_AGENT_LABEL = "com.solemcp.daemon";

export type LaunchAgentSpec = {
  nodePath: string;
  entryPath: string;
  home: string;
  logDir: string;
};

/** launchd plist that starts the daemon at login and restarts it if it exits. */
export function renderLaunchAgentPlist(spec: LaunchAgentSpec): string {
  const out = join(spec.logDir, "daemon.out.log");
  const err = join(spec.logDir, "daemon.err.log");
  const args = [spec.nodePath, spec.entryPath, "daemon"].map(plistString).join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    ${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(out)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(err)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escapeXml(spec.home)}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
`;
}

export async function installLaunchAgent(opts: {
  home: string;
  nodePath: string;
  entryPath: string;
  launchAgentsDir: string;
  bootstrap?: (plistPath: string, label: string) => Promise<void>;
}): Promise<{ plistPath: string }> {
  const logDir = join(solemcpHome(opts.home), LOG_DIR);
  await mkdir(logDir, { recursive: true });
  await mkdir(opts.launchAgentsDir, { recursive: true });
  const plistPath = join(opts.launchAgentsDir, `${LAUNCH_AGENT_LABEL}.plist`);
  const body = renderLaunchAgentPlist({
    nodePath: opts.nodePath,
    entryPath: opts.entryPath,
    home: opts.home,
    logDir,
  });
  await writeFile(plistPath, body, { mode: 0o644 });
  if (opts.bootstrap) await opts.bootstrap(plistPath, LAUNCH_AGENT_LABEL);
  return { plistPath };
}

export async function uninstallLaunchAgent(opts: {
  launchAgentsDir: string;
  bootout?: (plistPath: string, label: string) => Promise<void>;
}): Promise<{ plistPath: string }> {
  const plistPath = join(opts.launchAgentsDir, `${LAUNCH_AGENT_LABEL}.plist`);
  if (opts.bootout) await opts.bootout(plistPath, LAUNCH_AGENT_LABEL);
  await rm(plistPath, { force: true });
  return { plistPath };
}

export function defaultLaunchAgentsDir(home: string): string {
  return join(home, "Library", "LaunchAgents");
}

export function plistTargetsHome(plist: string, home: string): boolean {
  return plist.includes(join(solemcpHome(home), LOG_DIR));
}

function plistString(value: string): string {
  return `<string>${escapeXml(value)}</string>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function launchAgentLogDir(home: string): string {
  return join(solemcpHome(home), LOG_DIR);
}

const exec = promisify(execFile);

/** Load the plist into the current user's GUI domain and start it. */
export async function bootstrapLaunchAgent(plistPath: string, label: string): Promise<void> {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("launchd install requires macOS");
  const domain = `gui/${uid}`;
  await exec("launchctl", ["bootout", domain, plistPath]).catch(() => undefined);
  await exec("launchctl", ["bootstrap", domain, plistPath]);
  await exec("launchctl", ["enable", `${domain}/${label}`]).catch(() => undefined);
  await exec("launchctl", ["kickstart", "-k", `${domain}/${label}`]);
}

export async function bootoutLaunchAgent(plistPath: string): Promise<void> {
  const uid = process.getuid?.();
  if (uid === undefined) return;
  await exec("launchctl", ["bootout", `gui/${uid}`, plistPath]).catch(() => undefined);
}
