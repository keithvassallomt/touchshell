#!/usr/bin/env bash
# Build the EGO-submittable ZIP in ./dist/.
# This is exactly what we'll upload to extensions.gnome.org, so it's also
# the right thing to feed into shexli for review-parity linting.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/dist"
UUID="touchshell@touchshell.com"

mkdir -p "$OUT"
rm -f "$OUT/$UUID.shell-extension.zip"

cd "$REPO"
gnome-extensions pack \
    --force \
    --out-dir="$OUT" \
    --extra-source=LICENSE \
    --extra-source=README.md \
    --extra-source=lib \
    .

ZIP="$OUT/$UUID.shell-extension.zip"
echo "built: $ZIP"
ls -la "$ZIP"
