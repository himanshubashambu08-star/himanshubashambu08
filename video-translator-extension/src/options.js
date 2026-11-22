const $ = (id) => document.getElementById(id);
let settings;
let savedTimer = 0;

function flashSaved() {
  $("saved").classList.add("show");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $("saved").classList.remove("show"), 1200);
}

function save(patch) {
  Object.assign(settings, patch);
  chrome.storage.sync.set(patch, flashSaved);
}

async function init() {
  settings = await chrome.storage.sync.get(VT_DEFAULTS);

  const target = $("targetLang");
  VT_LANGS.forEach((l) => {
    const o = document.createElement("option");
    o.value = l.code;
    o.textContent = `${l.native} — ${l.name}`;
    target.appendChild(o);
  });
  target.value = settings.targetLang;
  target.onchange = () => {
    const known = new Set(settings.knownLangs);
    known.add(target.value); // you obviously understand your own language
    save({ targetLang: target.value, knownLangs: [...known] });
    renderKnown();
  };

  function renderKnown() {
    const box = $("knownLangs");
    box.innerHTML = "";
    VT_LANGS.forEach((l) => {
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = settings.knownLangs.includes(l.code);
      cb.onchange = () => {
        const set = new Set(settings.knownLangs);
        cb.checked ? set.add(l.code) : set.delete(l.code);
        save({ knownLangs: [...set] });
      };
      lab.append(cb, document.createTextNode(`${l.native} (${l.name})`));
      box.appendChild(lab);
    });
  }
  renderKnown();

  const bind = (id, key, parse = (v) => v, prop = "value") => {
    const el = $(id);
    el[prop] = prop === "value" ? String(settings[key]) : settings[key];
    el.onchange = () => save({ [key]: parse(el[prop]) });
  };
  bind("outputMode", "outputMode");
  bind("fontSize", "fontSize", Number);
  bind("duckVolume", "duckVolume", Number);
  bind("showOriginal", "showOriginal", Boolean, "checked");
  bind("chunkSeconds", "chunkSeconds", Number);
  bind("apiKey", "apiKey", (v) => v.trim());
  bind("sttBaseUrl", "sttBaseUrl", (v) => v.trim());
  bind("sttModel", "sttModel", (v) => v.trim());
  bind("enabled", "enabled", Boolean, "checked");

  $("sttProvider").value = settings.sttProvider;
  $("sttProvider").onchange = (e) => {
    const p = VT_STT_PRESETS[e.target.value];
    const patch = { sttProvider: e.target.value };
    if (p.baseUrl) patch.sttBaseUrl = p.baseUrl;
    patch.sttModel = p.model;
    save(patch);
    $("sttBaseUrl").value = settings.sttBaseUrl;
    $("sttModel").value = settings.sttModel;
  };

  $("disabledSites").value = settings.disabledSites.join("\n");
  $("disabledSites").onchange = (e) =>
    save({
      disabledSites: e.target.value
        .split(/\s+/)
        .map((s) => s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim())
        .filter(Boolean)
    });

  $("testKey").onclick = async () => {
    // make sure the latest typed key is stored before testing
    await chrome.storage.sync.set({ apiKey: $("apiKey").value.trim() });
    const msg = $("keyMsg");
    msg.className = "msg";
    msg.textContent = "Check kar rahe hain…";
    const r = await chrome.runtime.sendMessage({ type: "test-key" });
    msg.className = "msg " + (r && r.ok ? "ok" : "err");
    msg.textContent = (r && r.message) || "Unknown error";
  };
}

init();
