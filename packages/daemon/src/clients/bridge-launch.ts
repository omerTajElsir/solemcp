import { accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type BridgeLaunch = {
  /** Executable the client will spawn. */
  command: string;
  /** Args before `bridge` / `bridge ${workspaceFolder}`. */
  prefixArgs: string[];
  /** True when we fell back to node + absolute solemcp.mjs. */
  usesAbsoluteBinary: boolean;
  /** Absolute path to solemcp entry when known. */
  entryPath: string;
};

/**
 * Resolve how coding clients should launch the SoleMCP bridge.
 * Prefer `solemcp` on PATH; otherwise `node <absolute dist/solemcp.mjs>`.
 */
export function resolveBridgeLaunch(opts?: {
  entryPath?: string;
  whichSolemcp?: string | null;
  nodePath?: string;
}): BridgeLaunch {
  const entryPath = opts?.entryPath ?? resolveSolemcpEntryPath();
  const onPath = opts?.whichSolemcp !== undefined ? opts.whichSolemcp : which("solemcp");
  if (onPath) {
    return {
      command: "solemcp",
      prefixArgs: [],
      usesAbsoluteBinary: false,
      entryPath,
    };
  }
  return {
    command: opts?.nodePath ?? process.execPath,
    prefixArgs: [entryPath],
    usesAbsoluteBinary: true,
    entryPath,
  };
}

export function cursorBridgeEntry(launch: BridgeLaunch = resolveBridgeLaunch()): {
  type: "stdio";
  command: string;
  args: string[];
} {
  return {
    type: "stdio",
    command: launch.command,
    args: [...launch.prefixArgs, "bridge", "${workspaceFolder}"],
  };
}

export function claudeBridgeEntry(launch: BridgeLaunch = resolveBridgeLaunch()): {
  command: string;
  args: string[];
} {
  return {
    command: launch.command,
    args: [...launch.prefixArgs, "bridge"],
  };
}

export function codexBridgeArgs(launch: BridgeLaunch = resolveBridgeLaunch()): {
  command: string;
  args: string[];
} {
  return claudeBridgeEntry(launch);
}

export function resolveSolemcpEntryPath(): string {
  const arg = process.argv[1];
  if (arg && (arg.endsWith("solemcp.mjs") || arg.endsWith("bin.ts"))) {
    try {
      accessSync(arg, constants.R_OK);
      return arg;
    } catch {
      // fall through
    }
  }
  // Bundled: dist/solemcp.mjs next to this module when compiled into the bundle,
  // or packages/daemon → ../../dist/solemcp.mjs from source.
  const here = fileURLToPath(import.meta.url);
  const candidates = [
    join(dirname(here), "solemcp.mjs"),
    join(dirname(here), "..", "solemcp.mjs"),
    join(dirname(here), "..", "..", "..", "dist", "solemcp.mjs"),
  ];
  for (const c of candidates) {
    try {
      accessSync(c, constants.R_OK);
      return c;
    } catch {
      // try next
    }
  }
  return join(process.cwd(), "dist", "solemcp.mjs");
}

function which(bin: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  const parts = pathEnv.split(process.platform === "win32" ? ";" : ":");
  for (const dir of parts) {
    if (!dir) continue;
    const candidate = join(dir, bin);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}
