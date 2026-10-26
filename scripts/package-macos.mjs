import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { arch, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Versioned macOS tarball of the esbuild bundle, UI, and a launcher.
 * The launcher needs Node.js 22 or newer on PATH.
 *
 * Node's single-executable loader still executes the embedded blob as
 * CommonJS (checked on Node 24.5.0: embedderRunCjs rejects import.meta).
 * The SoleMCP bundle is ESM, so this script does not pretend to ship a
 * Node-free binary.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = (process.env.SOLEMCP_VERSION || pkg.version || "0.0.0").replace(/^v/, "");
const targetArch = process.env.SOLEMCP_ARCH || arch();
const releaseDir = join(root, "dist", "release");
const stage = join(releaseDir, "stage");
const artifact = `solemcp-${version}-macos-${targetArch}.tar.gz`;

if (platform() !== "darwin" && process.env.SOLEMCP_PACK_ANY !== "1") {
  console.error("package-macos: this packager is for macOS");
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "bin"), { recursive: true });
cpSync(join(root, "dist", "solemcp.mjs"), join(stage, "solemcp.mjs"));
cpSync(join(root, "dist", "ui"), join(stage, "ui"), { recursive: true });

const launcher = `#!/bin/sh
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo "solemcp needs Node.js 22 or newer on PATH" >&2
  exit 1
fi
exec node "$ROOT/solemcp.mjs" "$@"
`;
writeFileSync(join(stage, "bin", "solemcp"), launcher, { mode: 0o755 });
chmodSync(join(stage, "bin", "solemcp"), 0o755);
writeFileSync(
  join(stage, "INSTALL.txt"),
  [
    `SoleMCP ${version} for macOS (${targetArch}).`,
    "",
    "This archive is the bundled CLI plus the local UI.",
    "It still needs Node.js 22 or newer. A Node single-executable",
    "build is not included: Node runs SEA blobs as CommonJS, and this",
    "bundle is ESM.",
    "",
    "Run: bin/solemcp",
    "Then: bin/solemcp service install",
    "",
  ].join("\n"),
);

mkdirSync(releaseDir, { recursive: true });
const tar = spawnSync(
  "tar",
  ["-czf", join(releaseDir, artifact), "-C", stage, "."],
  { stdio: "inherit" },
);
if (tar.status !== 0) process.exit(tar.status ?? 1);

const bytes = readFileSync(join(releaseDir, artifact));
const digest = createHash("sha256").update(bytes).digest("hex");
const sums = `${digest}  ${artifact}\n`;
writeFileSync(join(releaseDir, "SHA256SUMS"), sums);
console.log(sums.trim());
console.log(`wrote ${join(releaseDir, artifact)}`);
console.log("codesign is a separate step and does not run from this packager");
