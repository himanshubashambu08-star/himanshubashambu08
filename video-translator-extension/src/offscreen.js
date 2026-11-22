/* Offscreen document (Chrome/Edge): captures the tab's audio, keeps it audible,
 * cuts it into short segments, sends them for transcription and forwards the
 * result to the tab's content script. */

let stream = null;
let audioCtx = null;
let running = false;
let tabId = null;
let seq = 0;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function pickMime() {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return c.find((m) => MediaRecorder.isTypeSupported(m)) || "";
}

function recordSegment(ms) {
  return new Promise((resolve) => {
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const parts = [];
    rec.ondataavailable = (e) => e.data && e.data.size && parts.push(e.data);
    rec.onstop = () => resolve(new Blob(parts, { type: rec.mimeType || mime }));
    rec.start();
    setTimeout(() => rec.state !== "inactive" && rec.stop(), ms);
  });
}

async function loop(chunkMs) {
  while (running) {
    const blob = await recordSegment(chunkMs);
    if (!running) break;
    if (blob.size < 2000) continue;
    const mySeq = ++seq;
    const sentAt = Date.now();
    blobToBase64(blob)
      .then((audio) => chrome.runtime.sendMessage({ type: "transcribe", audio, mime: blob.type }))
      .then((r) =>
        chrome.runtime.sendMessage({
          type: "forward-to-tab",
          tabId,
          payload: { type: "tab-transcript", seq: mySeq, sentAt, ...(r || {}) }
        })
      )
      .catch(() => {});
  }
}

async function start(msg) {
  stop();
  tabId = msg.tabId;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: msg.streamId } },
    video: false
  });
  // Capturing a tab mutes it for the user — route the audio back to the speakers.
  audioCtx = new AudioContext();
  audioCtx.createMediaStreamSource(stream).connect(audioCtx.destination);
  running = true;
  loop(Math.max(2, msg.chunkSeconds || 4) * 1000);
}

function stop() {
  running = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close().catch(() => {});
  stream = null;
  audioCtx = null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen") return false;
  if (msg.type === "offscreen-start") {
    start(msg).then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ error: String(e && e.message) })
    );
    return true;
  }
  if (msg.type === "offscreen-stop") {
    stop();
    sendResponse({ ok: true });
  }
  return false;
});
