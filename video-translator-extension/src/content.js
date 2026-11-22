/* Content script: finds videos on any page, detects their language and shows a
 * live translation (subtitles and/or a dubbed voice) in the user's language.
 *
 * Two ways to get the spoken text:
 *   1. Caption tracks (<track> / textTracks) — free, in sync, no API key.
 *   2. Audio — the video's audio is captured in short segments and sent to a
 *      Whisper speech-to-text endpoint, which also reports the language.
 * Tab-audio mode (Chrome) feeds case 2 from the offscreen document instead. */

(() => {
  if (window.__vtLoaded) return;
  window.__vtLoaded = true;

  // The callback-style `chrome` namespace exists in Chrome, Edge, Firefox and Safari.
  const api = chrome;
  const HOST = location.hostname;
  const IS_TOP = window === window.top;
  // iPhone/iPad play video in Apple's native full-screen player, where page
  // elements (our overlay) are invisible. There we write the translation into a
  // real TextTrack instead, which the native player renders itself.
  const IS_IOS =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  let settings = { ...VT_DEFAULTS };
  let tabAudioActive = false;
  const controllers = new Map(); // video -> VideoController
  let activeController = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isKnown = (lang) => !!lang && settings.knownLangs.includes(lang);
  const enabledHere = () => settings.enabled && !settings.disabledSites.includes(HOST);

  function send(msg) {
    return new Promise((resolve) => {
      try {
        api.runtime.sendMessage(msg, (r) => {
          void api.runtime.lastError;
          resolve(r || {});
        });
      } catch (e) {
        resolve({ error: String(e) }); // extension reloaded / context invalidated
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Translation                                                         */
  /* ------------------------------------------------------------------ */

  const tCache = new Map();
  const builtinTranslators = new Map();

  async function builtinTranslate(text, from, to) {
    // Chrome 138+ on-device Translator API (private, free, fast).
    if (!from || typeof self.Translator === "undefined") return null;
    const key = from + ">" + to;
    try {
      let t = builtinTranslators.get(key);
      if (t === undefined) {
        // Some builds never settle these promises — don't let that block subtitles.
        const timeout = (p) => Promise.race([p, sleep(1500).then(() => { throw new Error("timeout"); })]);
        builtinTranslators.set(key, null); // concurrent callers use the fallback meanwhile
        const avail = await timeout(self.Translator.availability({ sourceLanguage: from, targetLanguage: to }));
        t = avail === "available" ? await timeout(self.Translator.create({ sourceLanguage: from, targetLanguage: to })) : null;
        builtinTranslators.set(key, t);
      }
      return t ? await Promise.race([t.translate(text), sleep(3000).then(() => null)]) : null;
    } catch (_) {
      builtinTranslators.set(key, null);
      return null;
    }
  }

  // Returns { text, detected } — detected is the source language when known.
  async function translate(text, from) {
    const to = settings.targetLang;
    if (from && from === to) return { text, detected: from };
    const key = (from || "auto") + "|" + to + "|" + text;
    if (tCache.has(key)) return tCache.get(key);
    const p = (async () => {
      const local = await builtinTranslate(text, from, to);
      const clean = (t) => t.replace(/^\s*[-–—]\s*/, "").trim();
      if (local) return { text: clean(local), detected: from };
      const r = await send({ type: "gtx", text, from: from || "auto", to });
      if (r.error || !r.text) return { text: "", detected: from, error: r.error || "empty" };
      return { text: clean(r.text), detected: from || r.detected };
    })();
    tCache.set(key, p);
    if (tCache.size > 500) tCache.delete(tCache.keys().next().value);
    return p;
  }

  /* ------------------------------------------------------------------ */
  /* Overlay (subtitles + notices)                                       */
  /* ------------------------------------------------------------------ */

  const overlay = (() => {
    const root = document.createElement("div");
    root.className = "vt-root";
    root.setAttribute("aria-live", "polite");
    const sub = document.createElement("div");
    sub.className = "vt-sub";
    const main = document.createElement("div");
    main.className = "vt-sub-main";
    const orig = document.createElement("div");
    orig.className = "vt-sub-orig";
    sub.append(main, orig);
    const note = document.createElement("div");
    note.className = "vt-note";
    root.append(sub, note);

    let anchor = null; // a <video> or <iframe> element, or null for viewport
    let hideTimer = 0;
    let noteTimer = 0;
    let raf = 0;

    function mount() {
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      const parent = fs && fs.tagName !== "VIDEO" ? fs : document.documentElement;
      if (root.parentNode !== parent) parent.appendChild(root);
    }

    function place() {
      raf = 0;
      if (!root.isConnected) return;
      let r = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : null;
      if (!r || r.width < 50 || r.height < 30) {
        r = { left: 0, top: 0, width: innerWidth, height: innerHeight };
      }
      root.style.left = r.left + "px";
      root.style.top = r.top + "px";
      root.style.width = r.width + "px";
      root.style.height = r.height + "px";
      const fs = Math.max(12, Math.min(settings.fontSize, r.width / 28));
      root.style.setProperty("--vt-font", fs + "px");
      if (root.classList.contains("vt-visible")) raf = requestAnimationFrame(place);
    }

    function show() {
      mount();
      root.classList.add("vt-visible");
      if (!raf) raf = requestAnimationFrame(place);
    }

    function maybeHideRoot() {
      if (!sub.classList.contains("vt-on") && !note.classList.contains("vt-on")) {
        root.classList.remove("vt-visible");
      }
    }

    document.addEventListener("fullscreenchange", () => root.classList.contains("vt-visible") && mount());
    document.addEventListener("webkitfullscreenchange", () => root.classList.contains("vt-visible") && mount());

    return {
      setAnchor(el) {
        anchor = el;
      },
      subtitle(text, original, holdMs) {
        clearTimeout(hideTimer);
        if (!text) return this.clearSubtitle();
        main.textContent = text;
        orig.textContent = settings.showOriginal && original && original !== text ? original : "";
        sub.classList.add("vt-on");
        show();
        if (holdMs) hideTimer = setTimeout(() => this.clearSubtitle(), holdMs);
      },
      clearSubtitle() {
        clearTimeout(hideTimer);
        sub.classList.remove("vt-on");
        maybeHideRoot();
      },
      notice(text, ms = 5000) {
        clearTimeout(noteTimer);
        note.textContent = text;
        note.classList.add("vt-on");
        show();
        noteTimer = setTimeout(() => {
          note.classList.remove("vt-on");
          maybeHideRoot();
        }, ms);
      }
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Dubbing (browser text-to-speech)                                    */
  /* ------------------------------------------------------------------ */

  const dubber = (() => {
    // iPhone/iPad ignore video.volume (it is read-only there), so the original
    // audio is muted while the translated voice speaks instead of turned down.
    let duckedVideo = null;
    let savedVolume = 1;
    let savedMuted = false;
    let usedMute = false;
    const hasTTS = typeof speechSynthesis !== "undefined";

    // iOS pauses a page's video whenever the page starts or stops speaking.
    // A pause right around a speech start/end is treated as that interruption
    // and the video is resumed; a pause at any other moment is the user's.
    let lastSpeechEvent = 0;
    let lastAutoResume = 0;
    const guarded = new WeakSet();
    function guard(video) {
      if (!video || guarded.has(video)) return;
      guarded.add(video);
      video.addEventListener("pause", () => {
        if (video.ended || Date.now() - lastSpeechEvent > 1200) return;
        if (Date.now() - lastAutoResume < 1500) return; // paused again right away: the user means it
        lastAutoResume = Date.now();
        setTimeout(() => {
          if (video.paused && !video.ended) video.play().catch(() => {});
        }, 60);
      });
    }

    function voiceFor(lang) {
      const voices = speechSynthesis.getVoices();
      const ok = (v) => v.lang.toLowerCase().replace("_", "-").startsWith(lang);
      return (
        voices.find((v) => ok(v) && /google|natural|neural|online|premium|enhanced|siri/i.test(v.name)) ||
        voices.find(ok) ||
        null
      );
    }

    function duck(video) {
      if (!video || duckedVideo === video) return;
      duckedVideo = video;
      usedMute = IS_IOS || settings.duckVolume === 0;
      if (usedMute) {
        savedMuted = video.muted;
        video.muted = true;
      } else {
        savedVolume = video.volume;
        video.volume = settings.duckVolume * savedVolume;
      }
    }

    function unduck() {
      if (!duckedVideo || speechSynthesis.speaking || speechSynthesis.pending) return;
      if (usedMute) {
        duckedVideo.muted = savedMuted;
      } else if (Math.abs(duckedVideo.volume - settings.duckVolume * savedVolume) < 0.02) {
        // Only restore if the user didn't change the volume meanwhile.
        duckedVideo.volume = savedVolume;
      }
      duckedVideo = null;
    }

    if (hasTTS) {
      speechSynthesis.getVoices();
      // iOS Safari only lets a page talk after a tap; unlock speech on the first one.
      let unlocked = false;
      const unlock = () => {
        if (unlocked) return;
        unlocked = true;
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        speechSynthesis.speak(u);
      };
      ["touchend", "click", "keydown"].forEach((ev) => document.addEventListener(ev, unlock, { capture: true, once: true }));
    }

    return {
      // durationSec: how long the line is on screen; the voice speeds up to fit it.
      speak(text, video, durationSec) {
        if (!hasTTS || !text) return;
        // Falling behind? Drop the backlog so we stay close to the video.
        const behind = speechSynthesis.pending || speechSynthesis.speaking;
        if (speechSynthesis.pending) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = settings.targetLang;
        const v = voiceFor(settings.targetLang);
        if (v) u.voice = v;
        let rate = 1.05;
        if (durationSec > 0.3) {
          const words = text.split(/\s+/).filter(Boolean).length;
          const needed = (words * 0.42) / durationSec; // ~2.4 words/s at rate 1
          rate = Math.max(rate, needed);
        }
        if (behind) rate += 0.2;
        u.rate = Math.min(rate, 1.7);
        guard(video);
        duck(video);
        u.onend = u.onerror = () => {
          lastSpeechEvent = Date.now();
          setTimeout(unduck, 300);
        };
        lastSpeechEvent = Date.now();
        speechSynthesis.speak(u);
      },
      stop() {
        if (hasTTS) speechSynthesis.cancel();
        setTimeout(unduck, 50);
      }
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Language decision + output, shared by every input source            */
  /* ------------------------------------------------------------------ */

  class Session {
    constructor() {
      this.reset();
    }
    reset() {
      this.lang = "";          // detected source language
      this.decided = false;    // language confirmed after a few samples
      this.skip = false;       // language is one the user understands
      this.samples = [];
    }
    get video() {
      return null;
    }

    // Feed a detection sample; returns true if this content should be translated.
    noteLanguage(lang) {
      if (this.decided) return !this.skip;
      if (lang) this.samples.push(lang);
      if (this.samples.length >= 2) {
        const count = {};
        this.samples.forEach((l) => (count[l] = (count[l] || 0) + 1));
        this.lang = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
        this.decided = true;
        this.skip = isKnown(this.lang);
        if (this.skip) {
          overlay.clearSubtitle();
          overlay.notice(`🎬 Video ki language: ${vtLangName(this.lang)} — translation ki zarurat nahi.`);
          this.onSkip();
        } else {
          overlay.notice(
            this.lang === settings.targetLang
              ? `🔊 ${vtLangName(this.lang)} captions → ${vtLangName(this.lang)} awaaz ON`
              : `🌐 ${vtLangName(this.lang)} → ${vtLangName(settings.targetLang)} translation ON`,
            3500
          );
        }
        return !this.skip;
      }
      if (lang) this.lang = lang;
      return !isKnown(lang);
    }
    onSkip() {}

    async output(original, from, holdMs) {
      const r = await translate(original, from);
      if (!r.text) {
        if (r.error) overlay.notice("⚠️ Translation fail: " + r.error, 4000);
        return;
      }
      const mode = settings.outputMode;
      if (mode === "subtitles" || mode === "both") overlay.subtitle(r.text, original, holdMs);
      if (mode === "dub" || mode === "both") dubber.speak(r.text, this.video);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Per-video controller                                                */
  /* ------------------------------------------------------------------ */

  function pickMime() {
    const c = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  class VideoController extends Session {
    constructor(video) {
      super();
      this.el = video;
      this.track = null;
      this.stream = null;
      this.recording = false;
      this.loopRunning = false;
      this.seq = 0;
      this.shownSeq = 0;
      this.warnedKey = false;
      this.onCue = () => this.handleCue();

      video.addEventListener("play", () => this.start());
      video.addEventListener("playing", () => this.start());
      video.addEventListener("pause", () => this.pause());
      video.addEventListener("ended", () => this.pause());
      video.addEventListener("emptied", () => this.newSource());
      video.textTracks && video.textTracks.addEventListener("addtrack", () => {
        if (!this.el.paused && !this.track) this.start();
      });
      if (!video.paused && video.readyState > 2) this.start();
    }

    get video() {
      return this.el;
    }

    newSource() {
      this.stop();
      this.nativeTrack = null;
      this.reset();
      this.stream = null;
    }

    onSkip() {
      // Restore the site's own captions and stop spending API calls.
      if (this.nativeTrack) this.nativeTrack.mode = "disabled";
      if (this.track) {
        this.track.removeEventListener("cuechange", this.onCue);
        this.track.mode = "showing";
      }
      this.recording = false;
    }

    start() {
      if (!enabledHere() || this.skip) return;
      if (this.el.offsetWidth < 120 && this.el.offsetHeight < 80 && !document.fullscreenElement) return; // tiny previews/ads
      setActive(this);
      if (this.useTextTrack()) return;
      if (tabAudioActive) return; // the offscreen document is already listening
      this.startAudio();
    }

    pause() {
      this.recording = false;
      if (this.track) return;
      dubber.stop();
    }

    stop() {
      this.recording = false;
      if (this.nativeTrack) this.nativeTrack.mode = "disabled";
      if (this.track) {
        this.track.removeEventListener("cuechange", this.onCue);
        if (this.track.mode === "hidden") this.track.mode = "showing";
        this.track = null;
      }
      dubber.stop();
      overlay.clearSubtitle();
    }

    /* ---- 1. caption tracks ---- */

    useTextTrack() {
      if (this.track) return true;
      const tracks = Array.from(this.el.textTracks || []).filter(
        (t) => t.kind === "subtitles" || t.kind === "captions"
      );
      if (!tracks.length) return false;
      const t = tracks.find((x) => x.mode === "showing") || tracks[0];
      const lang = vtNormLang(t.language);
      if (lang && isKnown(lang)) {
        this.decided = true;
        this.skip = true;
        this.lang = lang;
        overlay.notice(`🎬 Captions ${vtLangName(lang)} mein hain — translation ki zarurat nahi.`);
        return true;
      }
      this.track = t;
      this.trackLang = lang;
      if (lang) {
        this.decided = true;
        this.lang = lang;
      }
      t.mode = "hidden"; // keep cues flowing, hide the native rendering
      t.addEventListener("cuechange", this.onCue);
      this.handleCue();
      return true;
    }

    cueText(cue) {
      return (cue.text || "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+\n/g, "\n")
        .trim();
    }

    // iOS: put a translated cue into our own track (rendered by the native player).
    addNativeCue(cue, text) {
      if (!IS_IOS || !text || settings.outputMode === "dub" || typeof VTTCue === "undefined") return;
      if (!this.nativeTrack || this.nativeTrack.language !== settings.targetLang) {
        this.nativeTrack = this.el.addTextTrack(
          "subtitles",
          vtLangName(settings.targetLang) + " (auto-translated)",
          settings.targetLang
        );
        this.nativeCues = new WeakSet();
      }
      this.nativeTrack.mode = "showing";
      if (this.nativeCues.has(cue)) return;
      this.nativeCues.add(cue);
      try {
        this.nativeTrack.addCue(new VTTCue(cue.startTime, cue.endTime, text));
      } catch (_) {}
    }

    async handleCue() {
      const t = this.track;
      if (!t || this.skip) return;
      const active = Array.from(t.activeCues || []);
      const text = active.map((c) => this.cueText(c)).join("\n").trim();
      if (!text) return overlay.clearSubtitle();
      overlay.setAnchor(this.el);

      if (!this.decided) {
        const r = await translate(text, "");
        if (!this.noteLanguage(r.detected)) return;
      }
      const stamp = text;
      this.currentCue = stamp;
      const r = await translate(text, this.lang);
      if (this.currentCue !== stamp || !r.text) return;
      const mode = settings.outputMode;
      if (IS_IOS) active.forEach((c) => this.addNativeCue(c, r.text));
      else if (mode !== "dub") overlay.subtitle(r.text, text);
      if (mode !== "subtitles") {
        const endAt = Math.max(...active.map((c) => c.endTime));
        dubber.speak(r.text, this.el, (endAt - this.el.currentTime) / (this.el.playbackRate || 1));
      }

      // Prefetch upcoming cues so they're ready exactly on time.
      const now = this.el.currentTime;
      Array.from(t.cues || [])
        .filter((c) => c.startTime > now)
        .slice(0, IS_IOS ? 8 : 4)
        .forEach((c) =>
          translate(this.cueText(c), this.lang).then((x) => this.track === t && this.addNativeCue(c, x.text))
        );
    }

    /* ---- 2. audio -> speech-to-text ---- */

    captureAudio() {
      if (this.stream && this.stream.getAudioTracks().some((t) => t.readyState === "live")) return true;
      const cap = this.el.captureStream || this.el.mozCaptureStream;
      if (!cap) {
        overlay.notice(
          "⚠️ Is browser mein video ka audio capture nahi ho sakta. Captions wali video chalayein, ya Chrome/Edge mein extension icon → 'Tab audio se translate'.",
          8000
        );
        return false;
      }
      try {
        this.stream = cap.call(this.el);
        return true;
      } catch (e) {
        overlay.notice(
          "🔒 Is video ka audio protected hai. Extension icon par click karke 'Tab audio se translate' dabayein.",
          8000
        );
        return false;
      }
    }

    startAudio() {
      if (!this.el.captureStream && !this.el.mozCaptureStream) {
        // Safari (iPhone, iPad, Mac) never hands a video's audio to extensions.
        if (!this.warnedKey) {
          this.warnedKey = true;
          overlay.setAnchor(this.el);
          overlay.notice(
            IS_IOS
              ? "ℹ️ Is video mein captions nahi hain. iPhone Safari video ki awaaz extension ko nahi deta, isliye sirf captions wali videos translate hoti hain."
              : "ℹ️ Is video mein captions nahi hain, aur ye browser video ka audio nahi deta. Chrome/Edge/Firefox mein audio mode chalta hai.",
            7000
          );
        }
        return;
      }
      if (!settings.apiKey) {
        if (!this.warnedKey) {
          this.warnedKey = true;
          overlay.setAnchor(this.el);
          overlay.notice("🔑 Is video mein captions nahi hain. Audio translate karne ke liye Options mein Speech API key daalein.", 7000);
        }
        return;
      }
      if (!this.captureAudio()) return;
      overlay.setAnchor(this.el);
      this.recording = true;
      this.recordLoop();
    }

    recordSegment(ms) {
      return new Promise((resolve) => {
        const tracks = this.stream.getAudioTracks().filter((t) => t.readyState === "live");
        if (!tracks.length) return resolve(null);
        const mime = pickMime();
        let rec;
        try {
          rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime } : undefined);
        } catch (_) {
          return resolve(null);
        }
        const parts = [];
        rec.ondataavailable = (e) => e.data && e.data.size && parts.push(e.data);
        rec.onstop = () => resolve(new Blob(parts, { type: rec.mimeType || mime }));
        rec.onerror = () => resolve(null);
        rec.start();
        const startedAt = Date.now();
        const tick = setInterval(() => {
          if (!this.recording || Date.now() - startedAt >= ms) {
            clearInterval(tick);
            if (rec.state !== "inactive") rec.stop();
          }
        }, 100);
      });
    }

    async recordLoop() {
      if (this.loopRunning) return;
      this.loopRunning = true;
      try {
        while (this.recording && !this.el.paused && !this.skip && enabledHere() && !tabAudioActive) {
          const blob = await this.recordSegment(settings.chunkSeconds * 1000);
          if (!blob) {
            await sleep(500);
            if (!this.captureAudio()) break;
            continue;
          }
          if (blob.size > 2000) this.sendChunk(blob); // not awaited: record the next piece meanwhile
        }
      } finally {
        this.loopRunning = false;
      }
    }

    async sendChunk(blob) {
      const seq = ++this.seq;
      const audio = await blobToBase64(blob);
      const r = await send({ type: "transcribe", audio, mime: blob.type });
      this.onTranscript(r, seq);
    }

    async onTranscript(r, seq) {
      if (r.error) {
        if (r.error === "NO_KEY") overlay.notice("🔑 Options mein Speech API key daalein.", 6000);
        else overlay.notice("⚠️ Speech-to-text error: " + r.error, 6000);
        return;
      }
      if (!r.text || seq < this.shownSeq) return;
      if (!this.noteLanguage(r.lang)) return;
      this.shownSeq = seq;
      await this.output(r.text, this.lang || r.lang, (settings.chunkSeconds + 2.5) * 1000);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tab-audio session (Chrome offscreen capture -> top frame)           */
  /* ------------------------------------------------------------------ */

  class TabSession extends Session {
    constructor() {
      super();
      this.shownSeq = 0;
    }
    get video() {
      return activeController ? activeController.el : largestPlayingVideo();
    }
    anchor() {
      const v = this.video;
      if (v) return v;
      // Video is probably inside an iframe — anchor to the biggest visible one.
      let best = null;
      let area = 0;
      document.querySelectorAll("iframe").forEach((f) => {
        const r = f.getBoundingClientRect();
        const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) *
          Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
        if (a > area) {
          area = a;
          best = f;
        }
      });
      return area > 40000 ? best : null;
    }
    async handle(msg) {
      if (msg.error) {
        overlay.notice(msg.error === "NO_KEY" ? "🔑 Options mein Speech API key daalein." : "⚠️ " + msg.error, 6000);
        return;
      }
      if (!msg.text || msg.seq < this.shownSeq) return;
      if (!this.noteLanguage(msg.lang)) return;
      this.shownSeq = msg.seq;
      overlay.setAnchor(this.anchor());
      await this.output(msg.text, this.lang || msg.lang, (settings.chunkSeconds + 2.5) * 1000);
    }
    onSkip() {
      send({ type: "stop-tab-audio" });
    }
  }
  let tabSession = null;

  /* ------------------------------------------------------------------ */
  /* Video discovery                                                     */
  /* ------------------------------------------------------------------ */

  function largestPlayingVideo() {
    let best = null;
    let area = 0;
    controllers.forEach((c, v) => {
      if (!v.isConnected || v.paused) return;
      const a = v.offsetWidth * v.offsetHeight;
      if (a > area) {
        area = a;
        best = v;
      }
    });
    return best;
  }

  function setActive(c) {
    if (activeController && activeController !== c) activeController.stop();
    activeController = c;
  }

  function attach(video) {
    if (controllers.has(video)) return;
    controllers.set(video, new VideoController(video));
  }

  function scan(root) {
    if (root.tagName === "VIDEO") attach(root);
    if (!root.querySelectorAll) return;
    root.querySelectorAll("video").forEach(attach);
    // Open shadow roots of custom elements (web-component players)
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot && el.tagName.includes("-")) scan(el.shadowRoot);
    });
  }

  let scanQueued = false;
  const observer = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      scan(document);
    }, 1000);
  });

  // Catches videos we missed (e.g. inside closed shadow roots once they start).
  document.addEventListener("play", (e) => e.target && e.target.tagName === "VIDEO" && attach(e.target), true);

  /* ------------------------------------------------------------------ */
  /* Messages + settings                                                 */
  /* ------------------------------------------------------------------ */

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === "tab-audio-state") {
      tabAudioActive = !!msg.active;
      if (tabAudioActive) {
        controllers.forEach((c) => (c.recording = false));
        if (IS_TOP) {
          tabSession = new TabSession();
          overlay.notice("🎧 Tab audio se translation shuru…", 3000);
        }
      } else {
        tabSession = null;
        overlay.clearSubtitle();
        const c = activeController;
        if (c && !c.el.paused) c.start();
      }
    } else if (msg.type === "tab-transcript" && IS_TOP) {
      if (!tabSession) tabSession = new TabSession();
      tabSession.handle(msg);
    } else if (msg.type === "status") {
      const c = activeController;
      sendResponse({
        videos: controllers.size,
        hasActive: !!c,
        source: c ? (c.track ? "captions" : c.recording ? "audio" : "idle") : "none",
        lang: c ? c.lang : tabSession ? tabSession.lang : "",
        skip: c ? c.skip : false
      });
    } else if (msg.type === "force-translate") {
      // User says "translate anyway" even though the language is one they know.
      controllers.forEach((c) => {
        c.skip = false;
        c.decided = true;
      });
      if (activeController) activeController.start();
    }
    return false;
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const k in changes) settings[k] = changes[k].newValue;
    if (changes.targetLang || changes.knownLangs) {
      tCache.clear();
      controllers.forEach((c) => {
        c.stop();
        c.reset();
      });
    }
    if (!enabledHere()) {
      controllers.forEach((c) => c.stop());
      overlay.clearSubtitle();
    } else if (activeController && !activeController.el.paused) {
      activeController.start();
    }
  });

  api.storage.sync.get(VT_DEFAULTS, (s) => {
    settings = { ...VT_DEFAULTS, ...s };
    scan(document);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
})();
