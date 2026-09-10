#!/usr/bin/env bash
# Proves (does not merely trust the filename) that a packaged macOS .app's
# main executable is a true universal binary containing both arm64 and
# x86_64 slices. Exits non-zero if either architecture is missing.
#
# Usage: scripts/verify-mac-universal.sh "dist/mac-universal/My Star Atlas.app"
set -euo pipefail

APP_PATH="${1:?Usage: verify-mac-universal.sh <path-to-.app>}"
PRODUCT_NAME="My Star Atlas"
BINARY="$APP_PATH/Contents/MacOS/$PRODUCT_NAME"

if [ ! -f "$BINARY" ]; then
  echo "FAIL: main executable not found at $BINARY" >&2
  exit 1
fi

echo "Inspecting: $BINARY"
file "$BINARY"
ARCHES="$(lipo -archs "$BINARY")"
echo "lipo -archs: $ARCHES"

for want in arm64 x86_64; do
  if ! grep -qw "$want" <<<"$ARCHES"; then
    echo "FAIL: expected architecture '$want' not present in universal binary (found: $ARCHES)" >&2
    exit 1
  fi
done

echo "OK: universal binary contains both arm64 and x86_64."
