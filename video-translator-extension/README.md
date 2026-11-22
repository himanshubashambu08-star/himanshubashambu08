# Video Auto Translator (browser extension)

Kisi bhi website par video chalao — agar uski language aapko samajh nahi aati, ye extension
**language auto-detect** karke video ko **aapki language** (default: Hindi) mein **live subtitles
ya awaaz (dub)** ke saath chalata hai. Kuch download nahi karna padta, video usi website par chalti hai.

Chrome, Edge, Brave, Opera, Firefox aur Safari par chalta hai (Manifest V3).

## Kaise kaam karta hai

```
Video play hua
   │
   ├─ Video mein captions/subtitles track hai?  ── haan ─▶ captions ka text lo (free, bilkul sync)
   │                                                          │
   └─ nahi ─▶ video ka audio 3–6 sec ke tukdon mein ─▶ Whisper AI (speech → text + language)
                                                              │
                          Language detect ──▶ aapki "samajh aati hai" list mein hai? ── haan ─▶ kuch nahi karta
                                                              │ nahi
                                                              ▼
                                  Translate (Chrome ka built-in on-device translator, warna Google Translate)
                                                              │
                                      ┌───────────────────────┴───────────────────────┐
                                 Subtitles video ke upar                Awaaz (dub) — original volume dheemi
```

- **Default language** aur **"ye languages mujhe aati hain"** list Settings mein set hoti hai
  (default: Hindi + English). Inke alawa koi bhi language ho to translation apne aap shuru.
- Language pehle 2 tukdon se confirm hoti hai. Agar video aapki known language mein hai, extension
  ruk jaata hai aur API calls bhi band ho jaati hain.
- Fullscreen, iframes (embedded videos) aur custom players (shadow DOM) support hain.
- Popup se: extension ON/OFF, sirf is site par OFF, language badlo, output badlo, "fir bhi translate karo".

## Install karna (developer mode — 1 minute)

### Chrome / Edge / Brave / Opera
1. Is folder (`video-translator-extension`) ko apne computer par download/clone karein.
2. `chrome://extensions` kholein (Edge: `edge://extensions`).
3. Upar-right **Developer mode** ON karein.
4. **Load unpacked** → `video-translator-extension` folder select karein.
5. Settings page apne aap khulega — apni language chunein.

### Firefox
1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `manifest.json` select karein.
2. `about:addons` → Video Auto Translator → **Permissions** → "Access your data for all websites" ON karein
   (Firefox MV3 mein ye by default off hota hai).
3. Permanent install ke liye `./scripts/build.sh` se zip banakar addons.mozilla.org par sign karwana padta hai.

### Safari — iPhone / iPad
👉 **[iphone/README.md](iphone/README.md)** dekhein. Bina Mac ke bhi chalta hai (free "Userscripts" app se,
file: `iphone/video-auto-translator.user.js`), ya Mac + Xcode se asli Safari extension.

### Safari — Mac
```bash
xcrun safari-web-extension-converter video-translator-extension --app-name "Video Auto Translator"
```
Xcode project khulega → **Run** karein → Safari → Settings → Extensions → enable.
(Unsigned extension ke liye Safari → Develop → *Allow Unsigned Extensions* ON karna padega.)

## Speech API key (sirf bina-caption wali videos ke liye)

Captions wali videos bina kisi key ke free chalti hain. Jin videos mein captions nahi hain, unka
audio Whisper AI se text banta hai — uske liye ek key chahiye:

| Provider | Kahan se key | Note |
|---|---|---|
| **Groq** (default) | console.groq.com → API Keys | `whisper-large-v3-turbo`, bahut fast, free tier |
| OpenAI | platform.openai.com → API keys | `whisper-1`, paid |
| Custom | koi bhi OpenAI-compatible `/audio/transcriptions` server | apna self-hosted Whisper bhi chalega |

Settings → *Speech-to-text* mein key daalein → **Test** dabayein. Key sirf aapke browser mein save hoti hai.

## Browser ke hisaab se kya chalta hai

| Feature | Chrome / Edge / Brave | Firefox | Safari |
|---|---|---|---|
| Captions wali videos ka translation | ✅ | ✅ | ✅ (iPhone full-screen mein bhi) |
| Bina captions — video ka audio → AI | ✅ | ✅ | ❌ (Safari video audio capture nahi karne deta) |
| "Tab audio se translate" (protected / iframe videos) | ✅ | ❌ | ❌ |
| On-device translator (offline, private) | ✅ Chrome 138+ | — (Google Translate) | — (Google Translate) |
| Dub (awaaz) | ✅ | ✅ | ✅ |

## Seemaayein (honest limitations)

- **Delay:** Audio mode mein subtitles video se ~3–6 second peeche aate hain (pehle audio sunna padta hai,
  phir AI text banata hai). Captions mode mein delay nahi hota. Settings mein 3s chunk chunkar delay kam karein.
- **DRM videos** (Netflix, Prime Video, Hotstar ki premium content): browser inka audio extension ko dene hi
  nahi deta, captureStream fail ho jaata hai. Chrome mein "Tab audio se translate" se kaafi sites chal jaati hain,
  lekin kuch DRM players tab capture ko bhi block kar dete hain. Inme aksar site ke apne subtitles hote hain —
  agar wo `<track>` ke through aate hain to captions mode chalega.
- **YouTube** apne captions custom tareeke se dikhata hai (textTracks se nahi), isliye wahan audio mode
  (API key) use hota hai.
- **Dub awaaz** browser ki built-in text-to-speech hai — har language ki voice har OS mein installed nahi hoti
  (Windows: Settings → Time & language → Speech se voices add karein).
- Google Translate fallback ek free, unofficial endpoint hai; bahut zyada use par rate-limit ho sakta hai.

## Files

```
manifest.json          MV3 manifest (Chrome + Firefox + Safari)
src/lang.js            languages list, default settings, helpers
src/content.js         video detection, language decision, subtitles overlay, dubbing
src/content.css        subtitle / notice styling
src/services.js        Whisper + Google Translate calls (shared with the userscript)
src/background.js      message router, tab-audio control
src/offscreen.*        Chrome tab-audio capture
src/popup.*            toolbar popup
src/options.*          settings page
scripts/build.sh       store-ready zip in dist/
scripts/build-userscript.js   builds iphone/video-auto-translator.user.js (run after editing src/)
iphone/                iPhone/iPad guide + ready-made userscript
```

## Privacy

- Audio ke tukde sirf aapke chune hue speech provider ko jaate hain, aur sirf tab jab video play ho rahi ho
  aur uske captions na hon.
- Translation ke liye text Chrome ke on-device translator mein, ya Google Translate ko jaata hai.
- Koi analytics, koi tracking, koi apna server nahi.
