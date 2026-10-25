import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export const GITHUB_PAT_CREATE_URL =
  "https://github.com/settings/personal-access-tokens/new";

export type GithubTokenResult =
  | { ok: true; token: string; source: "gh" | "provided" }
  | { ok: false; reason: string; ghInstalled: boolean };

/** True when the `gh` binary is on PATH. */
export function ghInstalled(): boolean {
  try {
    execFileSync("gh", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
    });
    return true;
  } catch {
    // Fall back to PATH scan (covers odd PATH inheritance).
  }
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(process.platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    try {
      accessSync(join(dir, "gh"), constants.X_OK);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

/**
 * Read a token from an already-authenticated GitHub CLI session.
 * This is the seamless path: no DCR, no pasted PAT, if `gh auth login` was done once.
 */
export async function readGhAuthToken(): Promise<GithubTokenResult> {
  const installed = ghInstalled();
  if (!installed) {
    return {
      ok: false,
      reason: "GitHub CLI (gh) is not installed",
      ghInstalled: false,
    };
  }
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      encoding: "utf8",
      timeout: 8_000,
    });
    const token = stdout.trim();
    if (!token) {
      return { ok: false, reason: "gh auth token returned empty", ghInstalled: true };
    }
    return { ok: true, token, source: "gh" };
  } catch {
    return {
      ok: false,
      reason: "GitHub CLI is not logged in (run gh auth login)",
      ghInstalled: true,
    };
  }
}

/**
 * Open the GitHub CLI browser login flow. Blocks until the user finishes (or times out).
 */
export async function runGhWebLogin(): Promise<void> {
  if (!ghInstalled()) {
    throw new Error("GitHub CLI (gh) is not installed — brew install gh");
  }
  // All flags set so gh does not prompt for protocol/host; --web opens the browser.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "gh",
      [
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--web",
        "--skip-ssh-key",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("timed out waiting for GitHub CLI login"));
    }, 180_000);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdin.write("Y\n");
    child.stdin.end();
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `gh auth login exited ${code}`));
    });
  });
}
