import { useEffect, useState } from "react";
import { api, PLATFORMS } from "../lib/api.js";
import { Link } from "../lib/router.jsx";
import ReelCard from "../components/ReelCard.jsx";
import { IconSearch } from "../components/Icons.jsx";

export default function Library() {
  const params = new URLSearchParams(location.search);
  const [q, setQ] = useState(params.get("q") || "");
  const [tag, setTag] = useState(params.get("tag") || "");
  const [platform, setPlatform] = useState(params.get("platform") || "");
  const [reels, setReels] = useState(null);
  const [tags, setTags] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => { api.tags().then(setTags).catch(() => {}); }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (tag) p.set("tag", tag);
    if (platform) p.set("platform", platform);
    const qs = p.toString();
    history.replaceState(null, "", `/library${qs ? "?" + qs : ""}`);
    const t = setTimeout(() => {
      api.list({ q: q.trim(), tag, platform }).then((r) => { setReels(r); setError(""); }).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, tag, platform]);

  const filtering = q || tag || platform;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Library</h1>

      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-zinc-400" />
        <input className="input !pl-10" type="search" placeholder="Search titles, tags, transcripts, ideas…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <select className="input !w-auto shrink-0 !py-1.5 text-sm" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
          <option value="">All sources</option>
          {Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {tags.map(({ tag: t, count }) => (
          <button
            key={t}
            onClick={() => setTag(tag === t ? "" : t)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              tag === t ? "border-brand-600 bg-brand-600 text-white" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            }`}
          >
            #{t} <span className="opacity-60">{count}</span>
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {reels === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="card h-[136px] animate-pulse" />)}
        </div>
      ) : reels.length === 0 ? (
        <div className="card py-10 text-center">
          <p className="font-medium">{filtering ? "No reels match." : "Your library is empty."}</p>
          {filtering ? (
            <button className="mt-3 text-sm font-medium text-brand-600" onClick={() => { setQ(""); setTag(""); setPlatform(""); }}>Clear filters</button>
          ) : (
            <Link to="/" className="btn-primary mt-4">Analyze your first reel</Link>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-500">{reels.length} reel{reels.length === 1 ? "" : "s"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {reels.map((r) => <ReelCard key={r.id} reel={r} onTag={(t) => setTag(t)} />)}
          </div>
        </>
      )}
    </div>
  );
}
