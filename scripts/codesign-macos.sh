#!/bin/sh
# Optional Developer ID sign. Exits 0 when credentials or a Mach-O binary are missing.
# Checksums are produced by scripts/package-macos.mjs and are not a signature.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
RELEASE_DIR="${1:-$ROOT/dist/release}"

if [ ! -d "$RELEASE_DIR" ]; then
  echo "codesign skipped: $RELEASE_DIR does not exist"
  exit 0
fi

if [ -z "${CSC_LINK:-}" ] || [ -z "${CSC_KEY_PASSWORD:-}" ]; then
  echo "codesign skipped: CSC_LINK or CSC_KEY_PASSWORD is not set. Checksums are unchanged."
  exit 0
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
if ! printf '%s' "$CSC_LINK" | base64 -D > "$WORK/cert.p12" 2>/dev/null; then
  printf '%s' "$CSC_LINK" | base64 -d > "$WORK/cert.p12"
fi
security create-keychain -p "" "$WORK/sign.keychain"
security unlock-keychain -p "" "$WORK/sign.keychain"
security import "$WORK/cert.p12" -k "$WORK/sign.keychain" -P "$CSC_KEY_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k "" "$WORK/sign.keychain" >/dev/null
IDENT=$(security find-identity -v -p codesigning "$WORK/sign.keychain" | awk -F '"' '/Developer ID Application/ { print $2; exit }')
if [ -z "$IDENT" ]; then
  echo "codesign skipped: imported certificate has no Developer ID Application identity"
  exit 0
fi

found=0
find "$RELEASE_DIR" -type f > "$WORK/files"
while IFS= read -r file; do
  if file "$file" | grep -q "Mach-O"; then
    codesign --force --options runtime --timestamp --sign "$IDENT" "$file"
    found=1
  fi
done < "$WORK/files"

if [ "$found" -eq 0 ]; then
  echo "codesign skipped: release directory has no Mach-O binary to sign"
  exit 0
fi

if [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "notarization skipped: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID is unset"
  exit 0
fi

echo "notarization skipped: the release asset is a tarball, not an app bundle to submit"
exit 0
