import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { Link, navigate } from "../lib/router.jsx";
import ReelCard from "../components/ReelCard.jsx";
import { IconClipboard, IconLink, IconUpload } from "../components/Icons.jsx";

const LANGS = [
  ["auto", "Auto-detect"],
  ["hinglish", "Hinglish"],
  ["hi", "Hindi"],
  ["pa", "Punjabi"],
  ["en", "English"],
];
const CURRENCIES = ["auto", "INR", "CAD", "USD", "GBP", "EUR", "AUD", "AED"];

function load(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

export default function Home() {
  const [mode, setMode] = useState("link");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [language, setLanguage] = useState(() => load("ra.lang", "auto"));
  const [currency, setCurrency] = useState(() => load("ra.currency", "auto"));
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(null);
  const [error, setError] = useState(() => {
    const p = new URLSearchParams(location.search).get("share_error");
    if (!p) return "";
    return p === "no-link" ? "The shared item didn't include a link or a video. Copy the reel's link and paste it here." : p;
  });
  const [health, setHealth] = useState(null);
  const [recent, setRecent] = useState([]);
  const [maxMb, setMaxMb] = useState(200);
  const fileInput = useRef(null);

  useEffect(() => {
    api.health().then((h) => { setHealth(h); setMaxMb(h.max_upload_mb); }).catch(() => {});
    api.list().then((r) => setRecent(r.slice(0, 4))).catch(() => {});
    if (location.search.includes("share_error")) history.replaceState(null, "", "/");
  }, []);

  useEffect(() => save("ra.lang", language), [language]);
  useEffect(() => save("ra.currency", currency), [currency]);

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setUrl(t.trim());
    } catch {
      setError("Your browser blocked clipboard access — long-press the box and choose Paste.");
    }
  }

  function pickFile(f) {
    setError("");
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) {
      setError(`That file is ${(f.size / 1048576).toFixed(0)} MB. The limit is ${maxMb} MB.`);
      return;
    }
    setFile(f);
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      let res;
      if (mode === "link") {
        if (!url.trim()) throw new Error("Paste a reel link first.");
        res = await api.submitLink({ url: url.trim(), language, currency });
      } else {
        if (!file) throw new Error("Choose a video first.");
        setUploadPct(0);
        res = await api.upload(file, { language, currency }, setUploadPct);
      }
      navigate(`/reel/${res.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setUploadPct(null);
    }
  }

  const missing = health && [!health.claude && "ANTHROPIC_API_KEY", !health.whisper && "OPENAI_API_KEY", !health.ffmpeg && "ffmpeg"].filter(Boolean);

  return (
    <div className="space-y-5">
      <section className="pt-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Turn any reel into <span className="bg-gradient-to-r from-brand-600 to-fuchsia-500 bg-clip-text text-transparent">business ideas</span>
        </h1>
        <p className="mt-1.5 text-zinc-600 dark:text-zinc-400">
          Paste an Instagram, TikTok or YouTube Shorts link — or upload the video — and get a scene-by-scene breakdown, the hook, the business behind it, and ideas you can use.
        </p>
      </section>

      {missing?.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          Server setup incomplete: <b>{missing.join(", ")}</b> {missing.length > 1 ? "are" : "is"} missing. See the README.
        </div>
      )}

      <form onSubmit={submit} className="card space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
          {[["link", "Paste link", <IconLink key="l" width={16} height={16} />], ["upload", "Upload video", <IconUpload key="u" width={16} height={16} />]].map(([m, label, icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(""); }}
              className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition ${mode === m ? "bg-white shadow-sm dark:bg-zinc-900" : "text-zinc-500"}`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {mode === "link" ? (
          <div className="flex gap-2">
            <input
              className="input"
              type="url"
              inputMode="url"
              placeholder="https://www.instagram.com/reel/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
            />
            <button type="button" className="btn-ghost shrink-0 !px-3" onClick={paste} aria-label="Paste from clipboard">
              <IconClipboard />
              <span className="hidden sm:inline">Paste</span>
            </button>
          </div>
        ) : (
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 px-4 py-8 text-center transition hover:border-brand-500 dark:border-zinc-700"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
          >
            <IconUpload width={28} height={28} className="text-brand-600" />
            {file ? (
              <p className="mt-2 font-medium">{file.name} <span className="text-zinc-500">({(file.size / 1048576).toFixed(1)} MB)</span></p>
            ) : (
              <>
                <p className="mt-2 font-medium">Tap to choose a video</p>
                <p className="text-sm text-zinc-500">MP4, MOV or screen recording · up to {maxMb} MB</p>
              </>
            )}
            <input ref={fileInput} type="file" accept="video/*,.mp4,.mov,.m4v,.webm" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-zinc-600 dark:text-zinc-400">Spoken language</span>
            <select className="input !py-2.5" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-zinc-600 dark:text-zinc-400">Cost currency</span>
            <select className="input !py-2.5" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c === "auto" ? "Auto" : c}</option>)}
            </select>
          </label>
        </div>

        {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">{error}</div>}

        {uploadPct !== null && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-zinc-500"><span>Uploading…</span><span>{Math.round(uploadPct * 100)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${uploadPct * 100}%` }} />
            </div>
          </div>
        )}

        <button className="btn-primary w-full !py-3 text-base" disabled={busy}>
          {busy ? (mode === "upload" ? "Uploading…" : "Starting…") : "Analyze reel"}
        </button>
      </form>

      {recent.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Recent</h2>
            <Link to="/library" className="text-sm font-medium text-brand-600">See all</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {recent.map((r) => <ReelCard key={r.id} reel={r} />)}
          </div>
        </section>
      )}

      <p className="text-center text-xs text-zinc-500">
        Tip: install this app on your phone (browser menu → “Add to Home screen”). On Android you can then share a reel straight to Reel Analyzer.
      </p>
    </div>
  );
}
