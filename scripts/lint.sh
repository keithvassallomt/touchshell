#!/usr/bin/env bash
# Lint the shippable package with shexli — parity with EGO's static analyser.
# Builds a fresh ZIP first so we're linting exactly what would be submitted.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
UUID="touchshell@touchshell.com"
ZIP="$REPO/dist/$UUID.shell-extension.zip"

"$REPO/scripts/pack.sh"

if [ ! -f "$REPO/venv/bin/shexli" ]; then
    echo "shexli venv missing. Run:"
    echo "  python3 -m venv venv && . venv/bin/activate && pip install -U shexli"
    exit 1
fi

# shellcheck disable=SC1091
. "$REPO/venv/bin/activate"
shexli "$ZIP"
