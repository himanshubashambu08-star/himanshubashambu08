# ✂️ Clip Studio

**YouTube link daalo → 1 button → viral vertical clips → Instagram Reels + TikTok.**

```
YouTube link
   │  yt-dlp            download (up to 1080p)
   │  faster-whisper    speech → text with word timings (runs on your computer, free)
   │  Claude / heuristic  best 3 moments + title, caption, hashtags
   │  OpenCV            face found? crop around it : full frame on blurred background
   │  ffmpeg            1080×1920, word-by-word yellow pop captions, loudness -14 LUFS
   ▼
clip_01.mp4, clip_02.mp4, clip_03.mp4  ──►  Instagram Reels API  +  TikTok Content Posting API
```

---

## 1. Install (one time, on your laptop/PC)

You need **Python 3.10+** and **ffmpeg**.

| | |
|---|---|
| Windows | `winget install Python.Python.3.12 Gyan.FFmpeg` |
| Mac | `brew install python ffmpeg` |

```bash
git clone https://github.com/himanshubashambu08-star/himanshubashambu08.git
cd himanshubashambu08/clip-studio
python -m venv .venv
# Windows: .venv\Scripts\activate     Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env
```

## 2. Run it

```bash
python run.py            # opens on http://localhost:8000
python run.py --phone    # same, but you can open it from your iPhone on the same Wi-Fi
```

Paste the link → **Clip & Post**. Clips also get saved in `clip-studio/output/`.
Terminal version: `python run.py clip "<youtube link>" --post instagram,tiktok`

Without any keys it already works: it makes the clips and you can download them.
To post automatically, connect the accounts below. `python run.py check` shows what's connected.

## 3. Better clip picks with Claude (optional, recommended)

Get a key at console.anthropic.com → put it in `.env` as `ANTHROPIC_API_KEY=...`.
Claude reads the transcript and picks the hook-to-payoff moments, and writes the on-screen title, caption and hashtags.
Without the key, moments are picked by loudness + speech speed + hype words ("no way", "bro", "!").

## 4. Connect Instagram (one time)

Instagram only allows posting through its API for **Business or Creator** accounts.

1. Instagram app → Settings → Account type → switch to **Creator** (free).
2. Go to developers.facebook.com → **Create app** → use case **"Manage messaging & content on Instagram"**.
3. In the app: **Instagram → API setup with Instagram login** → **Add account** → log in with your Instagram → **Generate token**.
   Make sure the permission `instagram_business_content_publish` is included.
4. Paste the token in `.env` as `IG_ACCESS_TOKEN=...`.

The token lasts 60 days; Clip Studio refreshes it automatically every time you post (as long as you post at least once every ~2 months).

## 5. Connect TikTok (one time)

1. developers.tiktok.com → **Manage apps → Connect an app**.
2. Add products **Login Kit** and **Content Posting API**. Turn on **Direct Post** if you want direct posting.
3. Scopes: `user.info.basic`, `video.upload`, `video.publish`.
4. In Login Kit, add a **Redirect URI**, e.g. your website or `https://himanshubashambu08-star.github.io/himanshubashambu08/` (any https page you own works, because you only need to copy the address from it).
5. Put `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` in `.env`.
6. Run `python run.py tiktok-login`, open the link, allow access, paste back the address you land on. Done, it refreshes itself after that.

**Important TikTok rule:** until TikTok **audits** your app (you apply from the dev portal), apps can't post public videos.
- `TIKTOK_MODE=draft` (default): the clip lands in your TikTok **inbox/drafts** and you tap Post (paste the caption, it's shown in the web app). Works right away.
- `TIKTOK_MODE=direct` + `TIKTOK_PRIVACY=PUBLIC_TO_EVERYONE`: fully automatic. This only works once the audit is approved.

## Settings (`.env`)

| Setting | Default | What it does |
|---|---|---|
| `CLIPS_PER_VIDEO` | 3 | clips per link |
| `CLIP_MIN_SECONDS` / `CLIP_MAX_SECONDS` | 20 / 55 | clip length |
| `WHISPER_MODEL` | small | `medium` is more accurate for Hindi/Hinglish but slower |
| `CAPTION_FONT` | Arial Black | any installed font (e.g. install *Anton* or *Montserrat Black*) |
| `DEFAULT_HASHTAGS` | | added to every post |
| `YTDLP_COOKIES_FROM_BROWSER` | | `chrome`/`edge`/`firefox` if YouTube asks "confirm you're not a bot" |

## ⚠️ Copyright: read this

Reposting someone else's videos (game trailers, streamers, movies) can get your account **copyright strikes, muted audio or a ban**, and the views can't be monetised.
Safe ways to use it: **your own videos/streams**, creators who **allow clipping** (many streamers run paid clipping programs), or podcasts that give permission.
The tool adds a `🎥 <channel>` credit to every caption, but a credit is **not** permission.

## Troubleshooting

- **"Sign in to confirm you're not a bot"** → set `YTDLP_COOKIES_FROM_BROWSER=chrome` (be logged in to YouTube there), and `pip install -U yt-dlp`.
- **Instagram "Application does not have permission"** → the token is missing `instagram_business_content_publish`, or the account isn't Creator/Business.
- **TikTok `unaudited_client_can_only_post_to_private_accounts`** → use `TIKTOK_MODE=draft`, or set your TikTok account to private while testing, or get the app audited.
- **Captions in Hindi (Devanagari) show boxes** → set `CAPTION_FONT=Noto Sans Devanagari` (install it first).
