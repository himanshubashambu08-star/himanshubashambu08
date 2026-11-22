/* Network services shared by the extension background and the userscript:
 * Whisper speech-to-text and the free Google Translate endpoint. */

/* ---------- Speech to text (OpenAI-compatible Whisper endpoint) ---------- */

// Phrases Whisper tends to invent on silence / music.
var VT_HALLUCINATIONS = [
  /^thank(s| you)( so much)? for watching[.!]*$/i,
  /^thanks for watching[.!]*$/i,
  /subtitles? by/i,
  /amara\.org/i,
  /^please subscribe/i,
  /^\[?(music|applause|silence|no speech)\]?\.?$/i,
  /^you$/i,
  /^\.+$/
];

function vtBase64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function vtTranscribe(s, { audio, mime }) {
  if (!s.apiKey) return { error: "NO_KEY" };
  const base = (s.sttBaseUrl || "").replace(/\/+$/, "");
  if (!base) return { error: "NO_BASE_URL" };

  const type = (mime || "audio/webm").split(";")[0];
  const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : "webm";
  const fd = new FormData();
  fd.append("file", new Blob([vtBase64ToBytes(audio)], { type }), "chunk." + ext);
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
  if (!text || VT_HALLUCINATIONS.some((re) => re.test(text))) text = "";

  return { text, lang: vtNormLang(j.language) };
}

/* ---------- Free translation fallback (Google Translate web endpoint) ---------- */

async function vtGtxTranslate({ text, from, to }, getJson) {
  getJson = getJson || (async (u) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t" +
    "&sl=" + encodeURIComponent(from || "auto") +
    "&tl=" + encodeURIComponent(to) +
    "&q=" + encodeURIComponent(text);
  try {
    const data = await getJson(url);
    const out = (data[0] || []).map((p) => p[0]).join("");
    return { text: out, detected: vtNormLang(data[2]) };
  } catch (e) {
    return { error: e.message };
  }
}
