# Gold Alerts — XAUUSD news → WhatsApp (Hinglish)

A 24/7 Node.js + TypeScript service that watches market-moving news and events for gold and sends WhatsApp alerts to your main number, usually within about a minute. Each alert comes with a short Claude analysis in simple Hinglish: **bullish / bearish / neutral for gold**, a confidence score, and how important it is.

```
🚨 HIGH IMPACT | Gold: BEARISH (75%)
Trump ne Truth Social pe tariff pause announce kiya.
Risk-on mood -> safe haven demand kam, gold pe pressure aa sakta hai.
Source: Truth Social | 2:14 PM
```

> ⚠️ **Unofficial WhatsApp method.** The bot uses [Baileys](https://github.com/WhiskeySockets/Baileys), an open-source library that acts like WhatsApp Web. It is not the official WhatsApp Business API. WhatsApp may restrict or ban the **bot account** at any time. Use a spare number for the bot (never your main number). The bot only messages your own number, at most one message every 5 seconds, to keep the risk low, but there is no guarantee.

---

## What it does

| Feature | How |
|---|---|
| **Economic calendar** | ForexFactory weekly JSON (free). USD high/medium events (NFP, CPI, PPI, FOMC, Fed speakers, jobless claims, GDP, PCE…). Reminders **30 min** and **5 min** before each high-impact release, then **actual vs forecast** after it. |
| **Market hours & holidays** | `config/cme-holidays.json` (COMEX/Globex gold). Today's session in the morning briefing, plus warnings **60** and **15 min** before any early close. |
| **Breaking news** | RSS: Reuters, AP, Kitco, FXStreet, CNBC (via Google News when direct feeds block servers), Investing.com, Bloomberg. Optional **Finnhub** API. |
| **Market movers** | Donald Trump on Truth Social (public RSS mirror). X accounts (Musk, Fed, White House, …) behind a feature flag (`ENABLE_X`), through an RSS bridge, since the X API is paid. |
| **AI analysis** | Claude (Haiku by default) returns JSON: `relevant`, `impact`, `gold_bias`, `confidence`, and a Hinglish explanation. |
| **Routing** | High impact → sent immediately with 🚨. Medium → a digest every 30 min. Low/irrelevant → dropped. |
| **Dedupe** | SQLite stores hashes of every title and URL. Near-duplicate headlines are merged with a similarity check, so one story from several outlets goes out **once** (with "+CNBC, Bloomberg" credit). |
| **Schedule** | 7:00 AM briefing (events, session hours/holidays, top overnight headlines). Sunday 6 PM weekly outlook. |
| **Commands** | From your main number only: `test`, `today`, `week`, `digest`, `mute 1h`, `unmute`, `help`. |
| **Resilience** | Every source fails on its own (logged, the others keep running). Messages are queued in SQLite and survive restarts. WhatsApp reconnects automatically. |

Times are shown in **America/Toronto** (London, Ontario).

---

## Setup (about 15 minutes)

### 1. Requirements
- **Node.js 22 LTS** or newer (`node -v`). Node 20 reached end-of-life in April 2026, and the SQLite driver now needs 22+.
- A **spare phone number with WhatsApp** for the bot (the "BOT number").
- A **Claude API key**: <https://console.anthropic.com> → API Keys.
- Optional: a free **Finnhub** key: <https://finnhub.io/register>.

### 2. Install
```bash
git clone <this repo>
cd gold-alerts
npm ci
cp .env.example .env
```

### 3. Fill in `.env`
At minimum:
```ini
MY_WHATSAPP_NUMBER=15195551234   # your MAIN number: country code + number, digits only
ANTHROPIC_API_KEY=sk-ant-...
FINNHUB_API_KEY=...              # optional
```

### 4. Test each data source (no WhatsApp needed)
```bash
npm run test:source calendar   # this week's USD events
npm run test:source hours      # next 10 days of gold session times + holidays
npm run test:source rss        # every enabled RSS feed (✓/✗ each)
npm run test:source truth      # Trump's latest Truth Social posts
npm run test:source finnhub    # needs FINNHUB_API_KEY
npm run test:source ai         # 3 sample headlines → Claude → Hinglish JSON
npm run test:source x          # X bridge feeds (see "X accounts" below)
```
A ✗ on one feed is fine. The bot logs it and carries on with the rest.

### 5. Dry run (everything except WhatsApp)
```bash
DRY_RUN=true npm run dev
```
Messages print in the terminal. You can type the commands (`test`, `today`, `mute 30m`, …) and press Enter.

### 6. Link the bot number (one time)
```bash
npm run build
npm run pair
```
A **QR code** prints in the terminal. On the **BOT phone**: WhatsApp → Settings → **Linked devices** → **Link a device** → scan it.
Once you see `✅ Linked!`, the session is saved in `data/whatsapp-auth/`, so restarts don't need a new scan.

*QR hard to scan over SSH?* Put the bot number in `.env` as `BOT_PAIRING_NUMBER=1XXXXXXXXXX` and run `npm run pair` again. It prints an 8-character code instead. On the bot phone, choose "Link with phone number instead" and type the code.

### 7. Start
```bash
npm start
```
Your main number gets `✅ Gold Alert Bot online hai`. Send **`test`** to the bot number to see the status report.

---

## Commands (send from your main number to the bot number)

| Command | What it does |
|---|---|
| `test` | Status: WhatsApp, last news check, calendar sync, Claude status, each source ✅/❌, today's counts |
| `today` | Today's briefing again (fresh) |
| `week` | Week's outlook |
| `digest` | Send pending medium-impact updates now |
| `mute 1h` / `mute 30m` / `mute 2h` | Pause alerts. 🚨 items during the mute arrive as one catch-up digest afterwards |
| `unmute` | Alerts back on (plus the catch-up digest) |
| `help` | List commands |

Messages from **any other number, groups, or broadcasts are ignored**.

---

## How alerts flow

```
 every 60s ─► sources (RSS, Finnhub, Truth Social, X) ─► dedupe (SQLite hashes + similarity)
                                                            │ new items only
                                                            ▼
                                          Claude Haiku (batches of 10) → JSON
                                                            │
           relevant & HIGH ──► 🚨 instant      MEDIUM ──► digest every 30 min      LOW ──► dropped
                                                            │
                                  outbox (SQLite, 1 msg / 5 s, waits for WhatsApp) ──► your WhatsApp
```

- **Quiet hours** (default 22:00–07:00): medium digests pause, and the 7:00 briefing covers the night. 🚨 alerts **always** go out.
- **Same story, several outlets:** the first report is alerted. Later ones are merged into it, not resent.
- **Release results:** the free ForexFactory JSON **does not include actual figures**. Right after a high-impact release, the bot searches fresh headlines (Google News plus everything it has collected) and has Claude pull out the actual number and compare it with the forecast. It retries for about 20 minutes. If no headline states the number, you get a short "release ho gaya, number confirm nahi hua" note rather than a guess.

---

## Config files (edit any time, no restart needed)

| File | What's in it |
|---|---|
| `config/feeds.json` | RSS feeds. Set `"enabled": false` to turn one off, or add your own (`id`, `source`, `url`, optional `filter` keywords). |
| `config/social-accounts.json` | Truth Social accounts (RSS mirror URL) and the X account list. |
| `config/cme-holidays.json` | CME gold holiday closures, early closes and reopen times, in US Eastern time. **Update every year** from <https://www.cmegroup.com/trading-hours.html#holidayCalendar>. Entries marked `"verify": true` are best estimates. From November on, the briefing reminds you if next year is missing. |

### X accounts (optional)
The official X API costs about $200/month, so X is **off** (`ENABLE_X=false`). To use it:
1. Run an RSS bridge you control, e.g. a self-hosted [Nitter](https://github.com/zedeus/nitter) or [RSSHub](https://docs.rsshub.app/routes/social-media#x-twitter). Public instances break often.
2. In `.env`: `ENABLE_X=true` and `X_RSS_URL_TEMPLATE=https://your-bridge/{handle}/rss` (or give each account its own `rssUrl` in `config/social-accounts.json`).
3. Check with `npm run test:source x`.

---

## Deploy 24/7

The bot must run as **exactly one copy** (two copies would fight over the WhatsApp session). Keep the `data/` folder: it holds the DB and the WhatsApp login.

### Option A — small VPS with pm2 (recommended, ~$4–6/month)
Any 1 GB Ubuntu VPS works (Hetzner, DigitalOcean, Vultr, Lightsail).
```bash
# on the VPS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm i -g pm2

git clone <this repo> && cd <repo>/gold-alerts
npm ci && npm run build
cp .env.example .env && nano .env        # fill in

npm run pair                             # scan the QR with the BOT phone (one time)
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                              # run the command it prints, so the bot starts on reboot
```
Useful: `pm2 logs gold-alerts`, `pm2 restart gold-alerts`, `pm2 status`.
Updating: `git pull && npm ci && npm run build && pm2 restart gold-alerts`.

### Option B — Docker
```bash
cp .env.example .env && nano .env
mkdir -p data && sudo chown 1000:1000 data       # container runs as user "node" (uid 1000)
docker compose build
docker compose run --rm gold-alerts node dist/index.js --pair-only   # scan QR once
docker compose up -d
docker compose logs -f
```

### Option C — Replit Reserved VM
1. Import the repo into Replit and open the `gold-alerts` folder.
2. Put every `.env` value into **Secrets** (MY_WHATSAPP_NUMBER, ANTHROPIC_API_KEY, …).
3. Shell: `npm ci && npm run build && npm run pair`, then scan the QR shown in the Shell. Use `BOT_PAIRING_NUMBER` if the QR is cut off.
4. **Deploy → Reserved VM** (not Autoscale, which sleeps). Build command `npm ci && npm run build`, run command `npm start`.
5. Replit deployments may not keep files written at runtime. If you have to re-scan after each redeploy, run the pairing from the deployment's shell, or use Option A.

---

## Costs (rough)
- **Claude Haiku 5.5:** items go in batches of 10, about 1–2k tokens in and under 1k out per batch. A busy news day of a few hundred items comes to a few cents, so **roughly $1–3/month**. Check your real usage in the Anthropic console.
- **Finnhub free, RSS, ForexFactory:** $0.
- **VPS:** ~$4–6/month.

## Known limitations
- **WhatsApp:** unofficial, so the bot number can be restricted (see top). If WhatsApp logs the bot out, the logs show `*** WhatsApp session LOGGED OUT ***`, the saved session is cleared, and a fresh QR is printed. Run `pm2 logs` and scan again.
- **Feed blocking:** CNBC and FXStreet often return 403 to datacenter IPs, so their Google News versions are on as backup. Google News can lag a few minutes behind the outlet.
- **Truth Social** comes through a third-party mirror (trumpstruth.org). If it stops, swap the `rssUrl` in `config/social-accounts.json`.
- **ForexFactory** throttles aggressive polling, so the calendar refreshes every 15 min (plus a few forced refreshes right after releases). Reminders run from the stored calendar every minute.
- **Actual release numbers** come from headlines, not an official feed, so double-check the chart. Only high-impact releases get a result message.
- AI output can be wrong. Treat the bias as a second opinion, not a trade signal.

## Development
```bash
npm run dev          # run with tsx
npm test             # unit tests (dedupe, routing, reminders, early close, commands, owner-only filter)
npm run typecheck
```
Folders: `src/sources/` (calendar, rss, finnhub, social, market-hours), `src/analysis/` (Claude, dedupe, pipeline), `src/delivery/` (WhatsApp, outbox, formatting, commands), `src/scheduler/` (cron jobs), `src/config/` (env + JSON config), `src/storage/` (SQLite).
