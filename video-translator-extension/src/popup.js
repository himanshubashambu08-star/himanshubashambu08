const $ = (id) => document.getElementById(id);
let settings = { ...VT_DEFAULTS };
let tab = null;
let host = "";

function fillLangSelect(sel, value) {
  sel.innerHTML = "";
  VT_LANGS.forEach((l) => {
    const o = document.createElement("option");
    o.value = l.code;
    o.textContent = `${l.native} — ${l.name}`;
    sel.appendChild(o);
  });
  sel.value = value;
}

function save(patch) {
  Object.assign(settings, patch);
  chrome.storage.sync.set(patch);
}

async function refreshStatus() {
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: "status" }, { frameId: 0 }, (r) => {
    void chrome.runtime.lastError;
    const el = $("status");
    if (!r) {
      el.textContent = "Is page par extension nahi chal sakta (browser ka internal page?).";
      return;
    }
    $("force").hidden = !r.skip;
    if (!r.videos) el.textContent = "Is page par abhi koi video nahi mili (iframe ke andar ho sakti hai).";
    else if (!r.hasActive) el.textContent = `${r.videos} video mili. Play karein — translation apne aap shuru hogi.`;
    else if (r.skip) el.textContent = `Video ki language ${vtLangName(r.lang)} hai — aap samajhte hain, isliye translate nahi kiya.`;
    else {
      const src = r.source === "captions" ? "captions se" : r.source === "audio" ? "audio se (AI)" : "";
      el.textContent = r.lang
        ? `${vtLangName(r.lang)} → ${vtLangName(settings.targetLang)} ${src}`
        : `Language detect ho rahi hai… ${src}`;
    }
  });
}

async function refreshTabAudio() {
  const r = await chrome.runtime.sendMessage({ type: "tab-audio-status" });
  const on = r && r.tabId === tab.id;
  $("tabAudio").textContent = on ? "⏹ Tab audio translation band karo" : "🎧 Tab audio se translate";
  $("tabAudio").dataset.on = on ? "1" : "";
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    host = new URL(tab.url).hostname;
  } catch (_) {}
  $("host").textContent = host || "—";

  settings = await chrome.storage.sync.get(VT_DEFAULTS);
  $("enabled").checked = settings.enabled;
  $("siteEnabled").checked = !settings.disabledSites.includes(host);
  fillLangSelect($("targetLang"), settings.targetLang);
  $("outputMode").value = settings.outputMode;

  $("enabled").onchange = (e) => save({ enabled: e.target.checked });
  $("siteEnabled").onchange = (e) => {
    const list = settings.disabledSites.filter((h) => h !== host);
    if (!e.target.checked) list.push(host);
    save({ disabledSites: list });
  };
  $("targetLang").onchange = (e) => save({ targetLang: e.target.value });
  $("outputMode").onchange = (e) => save({ outputMode: e.target.value });
  $("openOptions").onclick = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  };
  $("force").onclick = () => {
    chrome.tabs.sendMessage(tab.id, { type: "force-translate" });
    setTimeout(refreshStatus, 500);
  };

  // Tab capture exists only in Chromium browsers (Chrome, Edge, Brave, Opera).
  if (chrome.tabCapture && chrome.offscreen) {
    $("tabAudioBox").hidden = false;
    refreshTabAudio();
    $("tabAudio").onclick = async () => {
      if ($("tabAudio").dataset.on) {
        await chrome.runtime.sendMessage({ type: "stop-tab-audio" });
        return refreshTabAudio();
      }
      if (!settings.apiKey) {
        $("status").textContent = "Pehle Settings mein Speech API key daalein.";
        return;
      }
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          $("status").textContent = "Tab audio capture nahi ho paya: " + (chrome.runtime.lastError?.message || "");
          return;
        }
        const r = await chrome.runtime.sendMessage({ type: "start-tab-audio", tabId: tab.id, streamId });
        if (r && r.error) $("status").textContent = "Error: " + r.error;
        refreshTabAudio();
      });
    };
  }

  refreshStatus();
  setInterval(refreshStatus, 1500);
}

init();
