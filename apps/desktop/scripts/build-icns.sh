#!/usr/bin/env bash
# Build resources/icon.icns from resources/icon.png using only the built-in
# macOS tools `sips` and `iconutil`. Run scripts/generate-icon.py first if the
# source art changed.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="resources/icon.png"
ICONSET="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET"

# Standard macOS iconset sizes (points @1x and @2x).
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o resources/icon.icns
rm -rf "$(dirname "$ICONSET")"
echo "wrote resources/icon.icns"
sips -g pixelWidth -g pixelHeight resources/icon.icns | tail -2
