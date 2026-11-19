#!/usr/bin/env bash
# Runs every 10 minutes (systemd timer). If the branch has new code: pull it, run the tests,
# restart the bot. If the tests fail, go back to the old code and keep the bot as it was.
set -uo pipefail
cd "$(dirname "$0")/../.."                       # repo root
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin "$BRANCH" || { echo "fetch failed"; exit 0; }
OLD=$(git rev-parse HEAD); NEW=$(git rev-parse "origin/$BRANCH")
[ "$OLD" = "$NEW" ] && exit 0
echo "new code: ${OLD:0:7} -> ${NEW:0:7}"
git merge -q --ff-only "origin/$BRANCH" || { echo "cannot fast-forward, skipping"; exit 0; }
cd trading-bot
if python3 -m unittest discover -s tests -t . >/tmp/trading-bot-tests.log 2>&1; then
  systemctl restart trading-bot
  echo "updated to ${NEW:0:7} and restarted"
else
  echo "tests FAILED on ${NEW:0:7}, rolling back to ${OLD:0:7} (see /tmp/trading-bot-tests.log)"
  cd .. && git reset -q --hard "$OLD"
fi
