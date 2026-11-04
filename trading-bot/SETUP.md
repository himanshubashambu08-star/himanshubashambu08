# Setup guide (phone se bhi ho jayega)

Kharcha: sirf VPS ~$5/month. Baaki sab free hai.

## Step 1: OANDA demo account (free)

1. oanda.com pe **demo / practice account** banao. OANDA Canada mein bhi available hai.
2. Login karke **Manage API Access** pe jao, phir **Generate** dabao. Jo token mile, use copy karke kahin safe rakh lo.
3. Apna **account ID** bhi note kar lo (jaise `101-001-1234567-001`).

> Token kisi ko mat dena, chat mein bhi paste mat karna. Yeh sirf VPS pe daalna hai (Step 4).

## Step 2: VPS kharido (~$5/month)

DigitalOcean, Vultr ya Hetzner, koi bhi chalega. Sabse basic plan lo:
- **Ubuntu 24.04**, 1 GB RAM
- Location: **New York** ya **Toronto** (OANDA ke paas, kam delay)
- Login: password (phone ke liye aasaan) ya SSH key (laptop hai to)

VPS ka **IP address** note kar lo.

## Step 3: Phone pe 2 free apps

- **Termius:** VPS chalane ke liye. *New Host* mein IP, username `root` aur password daalo, phir **Connect**.
- **Tailscale:** dashboard dekhne ke liye. Google/Apple account se login karo.

## Step 4: VPS pe bot install karo (sirf 2 lines)

Termius mein VPS khulne ke baad yeh **2 lines** paste karo:

```bash
git clone -b claude/trading-skills-pack https://github.com/himanshubashambu08-star/himanshubashambu08.git
sudo bash himanshubashambu08/trading-bot/deploy/setup.sh
```

Script khud yeh sab karega:
1. Python install karega.
2. Aapka **OANDA account ID** aur **token** poochega. Token type karte waqt screen pe nahi dikhega, yeh normal hai.
3. OANDA se connection check karega (EUR/USD ka chhota backtest).
4. Bot ko 24/5 service bana dega. VPS restart ho jaye ya bot crash ho jaye, to bot khud wapas chalu ho jayega.
5. Tailscale install karke ek **login link** dikhayega. Woh link phone pe kholo aur **usi account** se login karo jo Step 3 mein Tailscale app mein use kiya tha.

Agar HTTPS enable karne ko bole, to jo link dikhaye use kholo, phir yeh chalao:
`sudo tailscale serve --bg 8050`

## Step 5: Phone pe dashboard

1. Phone pe Tailscale app **ON** rakho.
2. Script ke end mein `https://....ts.net` jaisa link dikhega. Use Safari mein kholo.
3. Saare charts side by side dikhenge. Yeh link sirf aapke Tailscale account wale devices pe khulta hai, internet pe public nahi hai.

Tip: Safari mein **Share** dabao, phir **Add to Home Screen**. Phir yeh app jaisa khulega.

## Roz ke kaam (Termius mein)

| Kya karna hai | Command |
|---|---|
| Bot kya kar raha hai (live log) | `journalctl -u trading-bot -f` (band karne ke liye Ctrl+C) |
| Aaj ki learning report | `cat ~/himanshubashambu08/trading-bot/reports/*.md \| tail -40` |
| Pehle poora backtest | `cd ~/himanshubashambu08/trading-bot && set -a && . ./.env && set +a && python3 run.py backtest --port 0` |
| Naye trades rokna (open trades chalte rahenge) | `touch ~/himanshubashambu08/trading-bot/STOP` |
| Wapas chalu karna | `rm ~/himanshubashambu08/trading-bot/STOP` |
| Saare trades abhi band karna | `cd ~/himanshubashambu08/trading-bot && set -a && . ./.env && set +a && python3 run.py flatten --port 0` |
| Bot band / chalu | `sudo systemctl stop trading-bot` / `sudo systemctl start trading-bot` |
| Naya code lena (haath se) | `bash ~/himanshubashambu08/trading-bot/deploy/update.sh` |
| Auto-update chalu (ek baar) | `sudo bash ~/himanshubashambu08/trading-bot/deploy/enable-auto-update.sh` |
| Auto-update ki history | `journalctl -u trading-bot-update -n 20 --no-pager` |
| Auto-update band | `sudo systemctl disable --now trading-bot-update.timer` |

## Kuch zaroori baatein

- Bot **demo (practice)** pe chalta hai. Live ke liye alag token, alag account aur `--i-understand-real-money` flag chahiye. Pehle kam se kam 4–8 hafte demo ke results dekho.
- Bot ki learning ke liye data chahiye. Pehle "rules it taught itself" kuch hafte baad aayenge.
- Settings (pairs, risk, session time) badalni hon to `config.json` edit karo (`nano config.json`), phir `sudo systemctl restart trading-bot` chalao.
