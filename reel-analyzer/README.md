# Reel Analyzer

Paste an Instagram Reel, TikTok or YouTube Shorts link — or upload the video — and get a deep AI breakdown plus business ideas you can act on.

**What you get for every video**

1. **What's in the video:** a scene-by-scene description, plus all on-screen text read from the frames.
2. **Main message and hook:** why it works and what grabs attention.
3. **The business behind it:** the product, service or idea, and how it makes money.
4. **How you could do it:** steps, tools, skills, starting cost and time to start.
5. **Idea remix:** the core concept applied to 5 other businesses or niches.
6. **Reel ideas:** 3 reels you could film yourself, each with a hook, script outline, caption and hashtags.
7. **Ask about this video:** a follow-up chat about the same video, saved with it.

Everything you analyze is saved in a **library** with a thumbnail, title, date and tags. You can search and filter it, and export any analysis as a PDF or Markdown file or copy it to the clipboard. The app works well on a phone and installs as a PWA, so on Android you can **share a reel straight to the app**.

## How it works

```
link ──yt-dlp──┐
               ├─> ffmpeg ─> ≤20 key frames (one every 1–2 s)
upload ────────┘        └──> audio ─> OpenAI Whisper (Hindi / Punjabi / English / Hinglish)
                                         │
                frames + transcript + creator caption ─> Claude (vision, structured JSON) ─> SQLite
```

- **Backend:** Python FastAPI (`backend/`). Jobs run in a background thread pool, and the UI polls for progress.
- **Frontend:** React + Tailwind (Vite) (`frontend/`). In production, FastAPI serves the built frontend.
- **AI:** Claude `claude-opus-5-5` reads the frames, including on-screen text, and the transcript, then returns the analysis as schema-checked JSON. Follow-up chat streams its replies. Server-side refusal fallback is turned on.
- **Database:** SQLite at `data/reels.db`. Frames are kept in `data/reels/<id>/frames/`. The source video and audio are deleted once the analysis succeeds.

## Run it

You need Python 3.11+, Node 18+ and **ffmpeg**: `brew install ffmpeg`, `sudo apt install ffmpeg` or `winget install ffmpeg`.

```bash
cd reel-analyzer
cp .env.example .env          # add ANTHROPIC_API_KEY and OPENAI_API_KEY

pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..

cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000. To use it on your phone on the same Wi-Fi, open `http://<your-computer-ip>:8000`.

**Development with hot reload:** run the backend as above (`--reload`), then `cd frontend && npm run dev` and open http://localhost:5173. Vite proxies `/api` to port 8000.

### Environment variables

| Variable | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude analysis and chat |
| `OPENAI_API_KEY` | yes* | Whisper transcription. Without it, videos are analyzed from the visuals only, with a warning. |
| `CLAUDE_MODEL` | no | Default `claude-opus-5-5` |
| `WHISPER_MODEL` | no | `whisper-1` (default, gives timestamps) or `gpt-4o-transcribe` |
| `YTDLP_COOKIES_FILE` | no | A Netscape `cookies.txt` for a logged-in Instagram session (see below) |
| `YTDLP_COOKIES_FROM_BROWSER` | no | e.g. `chrome`: read cookies from a browser profile on the same machine |
| `MAX_UPLOAD_MB` | no | Default 200 |
| `DATA_DIR` | no | Where the database and frames live. Default `reel-analyzer/data`. |

### Instagram links

Instagram often blocks anonymous downloads. When that happens the app tells you so and suggests uploading the file instead. To make links work reliably, export your Instagram cookies with a "Get cookies.txt" browser extension while logged in, save the file on the server and set `YTDLP_COOKIES_FILE=/path/to/cookies.txt`. Keep yt-dlp up to date (`pip install -U yt-dlp`), because the sites change often.

## Phone and "Share to app"

- **Android (Chrome):** open the app, then use the menu and choose **Install app** (or **Add to Home screen**). After that, in Instagram, TikTok or YouTube, tap **Share → Reel Analyzer** and the analysis starts right away. You can also share a video file from your gallery. Installing needs HTTPS (or `localhost`). If you host it yourself, put it behind HTTPS, for example with a Cloudflare Tunnel or Tailscale Funnel.
- **iPhone:** iOS doesn't let web apps appear in the share sheet. Copy the reel link and tap the 📋 button next to the link box, or save the video and upload it. You can still add the app to the home screen from Safari's **Share → Add to Home Screen**.

## Exports

- **PDF:** opens the print dialog with a print-friendly layout. Choose "Save as PDF". This keeps Hindi and Punjabi text rendering correctly.
- **Copy all / .md:** the full analysis and transcript as Markdown. Each reel idea and caption also has its own copy button.

## API (for scripts)

| Method | Path | |
|---|---|---|
| POST | `/api/reels/link` | `{url, title?, language?, currency?}` → `{id}` |
| POST | `/api/reels/upload` | multipart `file` (+ `language`, `currency`) → `{id}` |
| GET | `/api/reels/{id}/status` | progress, stage, error |
| GET | `/api/reels/{id}` | full record with analysis |
| GET | `/api/reels?q=&tag=&platform=` | search the library |
| POST | `/api/reels/{id}/chat` | `{question}` → Server-Sent Events stream |
| POST | `/api/reels/{id}/retry` · DELETE `/api/reels/{id}` | |

`language` is one of `auto`, `hinglish`, `hi`, `pa` or `en`. `currency` is `auto` or an ISO code such as `INR` or `CAD`.
