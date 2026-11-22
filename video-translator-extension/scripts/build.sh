#!/usr/bin/env bash
# Packages the extension into dist/ as zip files ready for the Chrome Web Store,
# Edge Add-ons and Firefox Add-ons (AMO). For Safari see README.md.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
rm -f "dist/video-auto-translator-$VERSION.zip"
zip -qr "dist/video-auto-translator-$VERSION.zip" manifest.json src icons -x '*.DS_Store'
echo "Built dist/video-auto-translator-$VERSION.zip"
