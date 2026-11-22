/* Background: speech-to-text calls, translation fallback, tab-audio (Chrome) orchestration. */

if (typeof VT_DEFAULTS === "undefined" && typeof importScripts === "function") {
  importScripts("lang.js");
}

const api = typeof browser !== "undefined" && browser.runtime ? browser : chrome;

async function getSettings() {
  return api.storage.sync.get(VT_DEFAULTS);
}

// Settings are always read with VT_DEFAULTS as fallback, so nothing to seed here.
api.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") api.runtime.openOptionsPage();
});

/* ---------- Speech to text (OpenAI-compatible Whisper endpoint) ---------- */

// Phrases Whisper tends to invent on silence / music.
const HALLUCINATIONS = [
  /^thank(s| you)( so much)? for watching[.!]*$/i,
  /^thanks for watching[.!]*$/i,
  /subtitles? by/i,
  /amara\.org/i,
  /^please subscribe/i,
  /^\[?(music|applause|silence|no speech)\]?\.?$/i,
  /^you$/i,
  /^\.+$/
];

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function transcribe({ audio, mime }) {
  const s = await getSettings();
  if (!s.apiKey) return { error: "NO_KEY" };
  const base = (s.sttBaseUrl || "").replace(/\/+$/, "");
  if (!base) return { error: "NO_BASE_URL" };

  const type = (mime || "audio/webm").split(";")[0];
  const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : "webm";
  const fd = new FormData();
  fd.append("file", new Blob([base64ToBytes(audio)], { type }), "chunk." + ext);
  fd.append("model", s.sttModel || "whisper-1");
  fd.append("response_format", "verbose_json");
  fd.append("temperature", "0");

  let res;
  try {
    res = await fetch(base + "/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + s.apiKey },
      body: fd
    });
  } catch (e) {
    return { error: "NETWORK: " + e.message };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  }
  const j = await res.json();
  let text = (j.text || "").trim();

  // Drop chunks that are mostly silence / music.
  if (Array.isArray(j.segments) && j.segments.length) {
    const speech = j.segments.filter((seg) => !(seg.no_speech_prob > 0.6 && seg.avg_logprob < -0.7));
    text = speech.map((seg) => seg.text).join(" ").replace(/\s+/g, " ").trim();
  }
  if (!text || HALLUCINATIONS.some((re) => re.test(text))) text = "";

  return { text, lang: vtNormLang(j.language) };
}

/* ---------- Free translation fallback (Google Translate web endpoint) ---------- */

async function gtxTranslate({ text, from, to }) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t" +
    "&sl=" + encodeURIComponent(from || "auto") +
    "&tl=" + encodeURIComponent(to) +
    "&q=" + encodeURIComponent(text);
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: "HTTP " + res.status };
    const data = await res.json();
    const out = (data[0] || []).map((p) => p[0]).join("");
    return { text: out, detected: vtNormLang(data[2]) };
  } catch (e) {
    return { error: e.message };
  }
}

async function testKey() {
  const s = await getSettings();
  if (!s.apiKey) return { ok: false, message: "API key khali hai." };
  try {
    const res = await fetch(s.sttBaseUrl.replace(/\/+$/, "") + "/models", {
      headers: { Authorization: "Bearer " + s.apiKey }
    });
    if (res.ok) return { ok: true, message: "Key sahi hai ✔" };
    return { ok: false, message: "HTTP " + res.status + " — key ya URL galat hai." };
  } catch (e) {
    return { ok: false, message: "Network error: " + e.message };
  }
}

/* ---------- Tab audio capture (Chrome / Edge only) ---------- */

const OFFSCREEN_URL = "src/offscreen.html";

// Service workers can be suspended, so the captured tab id lives in session storage.
const sessionStore = api.storage.session || api.storage.local;
async function getCapturedTab() {
  const { tabAudioTabId } = await sessionStore.get({ tabAudioTabId: null });
  return tabAudioTabId;
}
function setCapturedTab(id) {
  return sessionStore.set({ tabAudioTabId: id });
}

async function ensureOffscreen() {
  if (!api.offscreen) throw new Error("Offscreen documents not supported in this browser");
  const contexts = api.runtime.getContexts
    ? await api.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
    : [];
  if (contexts.length) return;
  await api.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA"],
    justification: "Capture tab audio to transcribe and translate the playing video."
  });
}

async function startTabAudio(tabId, streamId) {
  const current = await getCapturedTab();
  if (current !== null) await stopTabAudio();
  await ensureOffscreen();
  const s = await getSettings();
  await setCapturedTab(tabId);
  await api.runtime.sendMessage({
    target: "offscreen",
    type: "offscreen-start",
    streamId,
    tabId,
    chunkSeconds: s.chunkSeconds
  });
  api.tabs.sendMessage(tabId, { type: "tab-audio-state", active: true }).catch(() => {});
  return { ok: true };
}

async function stopTabAudio() {
  const tabId = await getCapturedTab();
  await setCapturedTab(null);
  try {
    await api.runtime.sendMessage({ target: "offscreen", type: "offscreen-stop" });
  } catch (_) {}
  try {
    await api.offscreen.closeDocument();
  } catch (_) {}
  if (tabId !== null) api.tabs.sendMessage(tabId, { type: "tab-audio-state", active: false }).catch(() => {});
  return { ok: true };
}

api.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === (await getCapturedTab())) stopTabAudio();
});

/* ---------- Message router ---------- */

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === "offscreen") return false;

  const handlers = {
    transcribe: () => transcribe(msg),
    gtx: () => gtxTranslate(msg),
    "test-key": () => testKey(),
    "start-tab-audio": () => startTabAudio(msg.tabId, msg.streamId),
    "stop-tab-audio": () => stopTabAudio(),
    "tab-audio-status": async () => ({ tabId: await getCapturedTab() }),
    // Offscreen doc -> content script of the captured tab (top frame only)
    "forward-to-tab": async () => {
      await api.tabs.sendMessage(msg.tabId, msg.payload, { frameId: 0 }).catch(() => {});
      return { ok: true };
    }
  };

  const h = handlers[msg.type];
  if (!h) return false;
  Promise.resolve()
    .then(h)
    .then(sendResponse, (e) => sendResponse({ error: String((e && e.message) || e) }));
  return true; // async response
});
