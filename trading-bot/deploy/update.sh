#!/usr/bin/env bash
# Get the latest code and restart. Keeps .env, config.json, memory and reports.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
sudo systemctl restart trading-bot
echo "Updated and restarted."
