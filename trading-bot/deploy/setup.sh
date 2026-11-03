#!/usr/bin/env bash
# One-time VPS setup (Ubuntu). Run from the trading-bot folder:
#   sudo bash deploy/setup.sh
# Re-running it is safe: it keeps your .env, config.json and the bot's memory.
set -euo pipefail

BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BOT_DIR"
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo bash deploy/setup.sh"; exit 1; }

echo "== 1/5 Installing Python, git and tzdata"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 git tzdata curl >/dev/null
python3 -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ needed"'

echo "== 2/5 OANDA login (stored only on this server, in $BOT_DIR/.env)"
if [ ! -f .env ]; then
  read -rp "OANDA account ID (e.g. 101-001-1234567-001): " ACCT
  read -rsp "OANDA API token (hidden while typing): " TOKEN; echo
  umask 077
  printf 'OANDA_ACCOUNT_ID=%s\nOANDA_TOKEN=%s\n' "$ACCT" "$TOKEN" > .env
else
  echo ".env already exists - keeping it"
fi
chmod 600 .env
[ -f config.json ] || cp config.example.json config.json

echo "== 3/5 Checking the OANDA connection with a short backtest"
set -a; . ./.env; set +a
if ! python3 run.py backtest --instruments EUR_USD --bars 600 --port 0; then
  echo "Could not reach OANDA. Check the account ID and token in $BOT_DIR/.env, then run this script again."
  exit 1
fi

echo "== 4/5 Installing the 24/5 service"
sed "s#/opt/trading-bot#$BOT_DIR#g" trading-bot.service > /etc/systemd/system/trading-bot.service
systemctl daemon-reload
systemctl enable --now trading-bot
systemctl restart trading-bot
sleep 3
systemctl --no-pager --lines=5 status trading-bot || true

echo "== 5/5 Private dashboard link with Tailscale"
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
tailscale status >/dev/null 2>&1 || tailscale up        # prints a login link: open it on your phone
tailscale serve --bg 8050 || echo "If it asks you to enable HTTPS, open the link it shows, then run: sudo tailscale serve --bg 8050"
echo
echo "Done. Open the https://...ts.net link above in Safari on your phone (Tailscale app must be on)."
echo "Logs:   journalctl -u trading-bot -f"
echo "Stop:   sudo systemctl stop trading-bot"
