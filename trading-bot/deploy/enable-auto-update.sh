#!/usr/bin/env bash
# One-time: make the server update itself every 10 minutes.
#   sudo bash ~/himanshubashambu08/trading-bot/deploy/enable-auto-update.sh
# Turn off again:  sudo systemctl disable --now trading-bot-update.timer
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cat > /etc/systemd/system/trading-bot-update.service <<UNIT
[Unit]
Description=Pull latest trading-bot code, test, restart
[Service]
Type=oneshot
ExecStart=/usr/bin/bash $DIR/auto-update.sh
UNIT
cat > /etc/systemd/system/trading-bot-update.timer <<UNIT
[Unit]
Description=Check for trading-bot updates every 10 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now trading-bot-update.timer
systemctl start trading-bot-update.service
echo "Auto-update ON. History: journalctl -u trading-bot-update -n 20"
