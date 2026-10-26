# macOS release

The GitHub Actions workflow `.github/workflows/release.yml` runs on version tags and on manual dispatch.

## What the artifact is

`scripts/package-macos.mjs` writes `dist/release/solemcp-<version>-macos-<arch>.tar.gz` and `dist/release/SHA256SUMS`.

The tarball contains:

- `solemcp.mjs`, the esbuild bundle
- `ui/`, the local window
- `bin/solemcp`, a launcher

The launcher needs Node.js 22 or newer on PATH. It does not embed Node.

A Node single-executable was tried and not shipped. On Node 24.5.0, `node --experimental-sea-config` plus `postject` runs the blob through `embedderRunCjs`. An ESM entry fails with `Cannot use 'import.meta' outside a module`. The SoleMCP bundle is ESM, so a Node-free binary is deferred rather than faked.

## Signing

`scripts/codesign-macos.sh` signs Mach-O files only when `CSC_LINK` and `CSC_KEY_PASSWORD` are set and the imported certificate contains a Developer ID Application identity. Without those, it prints `codesign skipped` and exits 0. Checksums are still written by the packager.

Notarization is skipped unless `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are set, and the current artifact is a tarball rather than an app bundle, so notarization does not run against it.

This machine had Apple Development and Apple Distribution certificates and no Developer ID Application certificate. `CSC_LINK` was unset. Nothing was signed with those development certificates.

## npm

The npm job publishes with provenance only when `package.json` is not private and `NPM_TOKEN` is set. Otherwise it prints a skip line and exits 0. Publish is deferred; see [name-gate.md](name-gate.md).

## Homebrew

`packaging/homebrew/solemcp.rb` points at the release asset URL pattern and uses `sha256 "PLACEHOLDER_SHA256"`. After a tag exists, replace that digest with:

```bash
packaging/homebrew/fill-checksum.sh dist/release/SHA256SUMS solemcp-<version>-macos-arm64.tar.gz
```
