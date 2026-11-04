#!/usr/bin/env bash
# Switch on the Manager robot's brain (Claude + web search). Run once:
#   bash ~/himanshubashambu08/trading-bot/deploy/enable-brain.sh
# Needs an Anthropic API key from https://console.anthropic.com (paid, billed per use).
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== Installing the anthropic package"
if ! python3 -c "import anthropic" 2>/dev/null; then
  sudo apt-get install -y -qq python3-pip >/dev/null
  sudo pip3 install -q --break-system-packages anthropic
fi
python3 -c "import anthropic; print('anthropic', anthropic.__version__)"
if grep -q '^ANTHROPIC_API_KEY=' .env 2>/dev/null; then
  echo "API key already in .env - keeping it (delete that line from .env to change it)"
else
  read -rsp "Anthropic API key (hidden while typing): " KEY; echo
  [ -n "$KEY" ] || { echo "No key entered."; exit 1; }
  printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" >> .env
  chmod 600 .env
fi
sudo systemctl restart trading-bot
echo "Done. Dashboard pe '💬 Pucho' tab kholo."
