# iPhone / iPad Safari par chalana

iPhone Safari mein extension lagane ke 2 tareeke hain:

| | **Tareeka A — Userscripts app** | **Tareeka B — asli Safari extension** |
|---|---|---|
| Kya chahiye | Sirf iPhone | Mac + Xcode |
| Kharcha | Free | Free (7 din baad dobara install) / $99 saal (Apple Developer, permanent) |
| Settings | Script ke upar 1 jagah edit | Settings page (popup → ⚙️) |
| Kaam | Same | Same |

**Mac nahi hai to Tareeka A lo.**

---

## Tareeka A: Userscripts app (bina Mac, 5 minute)

1. App Store se **"Userscripts"** app install karein (free, developer: Justin Wasack).
2. App kholein → **Set Userscripts Directory** → Files mein koi folder chunein (jaise *On My iPhone → Userscripts*).
3. iPhone **Settings → Apps → Safari → Extensions → Userscripts** → ON karein,
   aur **All Websites → Allow** karein.
4. Script install karein — inmein se koi ek:
   - **Link se:** Safari mein `video-auto-translator.user.js` ka *raw* link kholein
     (GitHub par file kholein → **Raw**). Address bar ke **ᴀA / 🧩** button → **Userscripts** → **Install**.
     *(Repo private hai to link nahi khulega — neeche wala tareeka use karein.)*
   - **File se:** `video-auto-translator.user.js` ko Files app mein, step 2 wale folder mein save kar dein.
5. Bas! Ab kisi bhi site par captions wali video chalayein.

### Apni language set karna
Userscripts app (ya Safari mein 🧩 → Userscripts → script par tap) mein script kholein. Sabse upar ye hissa hai:

```js
const USER_SETTINGS = {
  targetLang: "hi",          // video kis language mein dekhni hai
  knownLangs: ["hi", "en"],  // ye languages aati hain -> translate mat karo
  outputMode: "subtitles",   // "subtitles" | "dub" | "both"
  ...
```

Language codes: `hi` Hindi, `en` English, `bn` Bengali, `ta` Tamil, `te` Telugu, `mr` Marathi,
`gu` Gujarati, `kn` Kannada, `ml` Malayalam, `pa` Punjabi, `or` Odia, `ur` Urdu.
Example — Tamil mein dekhna hai aur Tamil + English aati hai:
`targetLang: "ta", knownLangs: ["ta", "en"]`. Save karein, page reload karein.

---

## Tareeka B: Mac + Xcode se asli extension

```bash
xcrun safari-web-extension-converter video-translator-extension --app-name "Video Auto Translator"
```
1. Xcode project khulega. Upar scheme mein **Video Auto Translator (iOS)** chunein, iPhone USB se lagayein.
2. *Signing & Capabilities* mein apna Apple ID (Team) select karein → **Run ▶**.
3. iPhone: **Settings → Apps → Safari → Extensions → Video Auto Translator** → ON, **All Websites → Allow**.
4. Safari mein **ᴀA / 🧩 → Video Auto Translator → ⚙️ Settings** se language chunein.

Free Apple ID wala install 7 din chalta hai. Permanent ke liye Apple Developer Program ($99/saal) → TestFlight ya App Store.

---

## iPhone par kya chalega, kya nahi (sach-sach)

✅ **Jin videos mein captions/subtitles track hai** — language auto-detect hoti hai, aur aapki language mein
subtitles aate hain. **Full-screen mein bhi**: translation ek asli subtitle track ("Hindi (auto-translated)")
ban jaati hai jo iPhone ka apna video player dikhata hai. Lines pehle se translate hoti hain, isliye bilkul time par aati hain.

✅ Aapki language wali video (Hindi/English/jo list mein hai) — extension chupchap kuch nahi karta.

✅ Dub (awaaz) mode — iPhone ki built-in voice translated line bolti hai.

❌ **Bina captions wali videos** — iPhone Safari kisi bhi extension ko video ki *awaaz* nahi deta
(Apple ki restriction), isliye unhe sunkar translate karna iPhone par possible nahi. Aisi video par
"Is video mein captions nahi hain" message aayega.

❌ **YouTube / Instagram / Netflix** jaisi apps-wali sites apne captions apne tareeke se dikhati hain
(standard captions track nahi), isliye un par abhi ye kaam nahi karega. YouTube app mein video ke
⚙️ → Captions → **Auto-translate** → Hindi ka option hota hai — wahan wo use karein.
