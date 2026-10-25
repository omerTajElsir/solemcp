import { cpSync, mkdirSync, chmodSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "dist", "solemcp.mjs");
const uiSrc = join(root, "packages", "daemon", "ui");
const uiDest = join(root, "dist", "ui");

mkdirSync(join(root, "dist"), { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "packages", "cli", "src", "bin.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: outFile,
  // Workspace packages are bundled into one file.
  packages: "bundle",
  logLevel: "info",
});

// Shebang must be byte 0 of the file for execve; do not use esbuild banner
// (it can land after a BOM / generated comment).
const body = readFileSync(outFile, "utf8").replace(/^#!.*\r?\n/, "");
writeFileSync(outFile, `#!/usr/bin/env node\n${body}`);
chmodSync(outFile, 0o755);

try {
  mkdirSync(uiDest, { recursive: true });
  cpSync(uiSrc, uiDest, { recursive: true });
} catch (err) {
  if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
    writeFileSync(
      join(uiDest, "index.html"),
      "<!doctype html><title>SoleMCP</title><p>UI assets missing at build time.</p>\n",
    );
  } else {
    throw err;
  }
}

console.log(`built ${outFile}`);
console.log(`copied UI → ${uiDest}`);
