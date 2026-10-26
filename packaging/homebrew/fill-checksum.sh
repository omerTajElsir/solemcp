#!/bin/sh
# Print the sha256 line to paste into packaging/homebrew/solemcp.rb.
# Usage: packaging/homebrew/fill-checksum.sh dist/release/SHA256SUMS solemcp-0.0.0-macos-arm64.tar.gz
set -eu
sums=${1:?SHA256SUMS path}
name=${2:?artifact file name}
line=$(awk -v name="$name" '$2 == name { print $1 }' "$sums")
if [ -z "$line" ]; then
  echo "no checksum for $name in $sums" >&2
  exit 1
fi
printf 'sha256 "%s"\n' "$line"
