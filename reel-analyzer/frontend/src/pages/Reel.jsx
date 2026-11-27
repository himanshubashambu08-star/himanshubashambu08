import { useEffect, useState } from "react";
import { api, formatDate, frameUrl, PLATFORMS } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { contentIdeaMd, downloadFile, money, slug, toMarkdown } from "../lib/exportMd.js";
import CopyButton from "../components/CopyButton.jsx";
import Chat from "../components/Chat.jsx";
import { IconDownload, IconEdit, IconExternal, IconPdf, IconRetry, IconTrash } from "../components/Icons.jsx";

const STAGES = [
  ["Downloading video", 5],
  ["Reading video", 20],
  ["Extracting key frames", 25],
  ["Transcribing speech", 35],
  ["Analyzing with Claude", 55],
];

function Progress({ status }) {
  const pct = status?.progress ?? 0;
  return (
    <div className="card space-y-4">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <p className="font-semibold">{status?.stage || "Starting"}…</p>
          <p className="text-sm tabular-nums text-zinc-500">{pct}%</p>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-fuchsia-500 transition-all duration-700" style={{ width: `${Math.max(pct, 3)}%` }} />
        </div>
      </div>
      <ol className="space-y-1.5 text-sm">
        {STAGES.map(([label, at], i) => {
          const next = STAGES[i + 1]?.[1] ?? 100;
          const state = pct >= next ? "done" : pct >= at ? "now" : "todo";
          return (
            <li key={label} className={`flex items-center gap-2 ${state === "todo" ? "text-zinc-400" : ""}`}>
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${
                state === "done" ? "bg-emerald-500 text-white" : state === "now" ? "animate-pulse bg-brand-600 text-white" : "bg-zinc-200 dark:bg-zinc-800"
              }`}>{state === "done" ? "✓" : i + 1}</span>
              {label}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-zinc-500">Most reels take 30–90 seconds. You can leave this page — it keeps going and lands in your library.</p>
    </div>
  );
}

function Section({ id, n, title, children, action }) {
  return (
    <section id={id} className="card scroll-mt-28">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-lg font-bold tracking-tight">
          <span className="mr-1.5 text-brand-600">{n}.</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const Bullets = ({ items }) => (
  <ul className="space-y-1.5">
    {(items || []).map((x, i) => (
      <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" /><span>{x}</span></li>
    ))}
  </ul>
);

const Label = ({ children }) => <h3 className="mt-4 mb-1.5 text-xs font-bold tracking-wider text-zinc-500 uppercase first:mt-0">{children}</h3>;

function Header({ reel, onChange }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(reel.title || "");
  const [tags, setTags] = useState((reel.tags || []).join(", "));

  async function save() {
    const updated = await api.patch(reel.id, { title, tags: tags.split(",").map((t) => t.replace(/^#/, "").trim()).filter(Boolean) });
    onChange(updated);
    setEditing(false);
  }

  return (
    <div className="space-y-3">
      {editing ? (
        <div className="card no-print space-y-2">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, separated by commas" />
          <div className="flex gap-2">
            <button className="btn-primary" onClick={save}>Save</button>
            <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl leading-tight font-bold tracking-tight">{reel.title || "Untitled reel"}</h1>
            <button className="no-print shrink-0 rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setEditing(true)} aria-label="Edit title and tags">
              <IconEdit width={18} height={18} />
            </button>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-zinc-500">
            <span>{PLATFORMS[reel.platform] || "Link"}</span>·<span>{formatDate(reel.created_at)}</span>
            {reel.duration ? <>·<span>{Math.round(reel.duration)}s</span></> : null}
            {reel.uploader ? <>·<span>@{reel.uploader}</span></> : null}
            {reel.language ? <>·<span className="uppercase">{reel.language}</span></> : null}
            {reel.source_url && (
              <a href={reel.source_url} target="_blank" rel="noreferrer" className="no-print inline-flex items-center gap-0.5 font-medium text-brand-600">
                · Original <IconExternal width={13} height={13} />
              </a>
            )}
          </p>
          {reel.tags?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {reel.tags.map((t) => (
                <a key={t} href={`/library?tag=${encodeURIComponent(t)}`} onClick={(e) => { e.preventDefault(); navigate(`/library?tag=${encodeURIComponent(t)}`); }} className="chip">#{t}</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Frames({ reel }) {
  if (!reel.frames?.length) return null;
  return (
    <div className="no-print -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {reel.frames.map((f) => (
        <figure key={f.file} className="relative w-24 shrink-0 snap-start">
          <img src={frameUrl(reel.id, f.file)} alt={`Frame at ${f.t}s`} loading="lazy" className="aspect-[9/16] w-full rounded-xl bg-zinc-200 object-cover dark:bg-zinc-800" />
          <figcaption className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] font-medium text-white">{Math.floor(f.t / 60)}:{String(Math.floor(f.t % 60)).padStart(2, "0")}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function Analysis({ reel }) {
  const a = reel.analysis || {};
  const h = a.how_to || {};
  const nav = [["scenes", "Video"], ["hook", "Hook"], ["concept", "Business"], ["howto", "How to"], ["remix", "Remix"], ["ideas", "Reel ideas"], ["chat", "Ask"]];

  return (
    <>
      <nav className="no-print sticky top-14 z-10 -mx-4 flex gap-1.5 overflow-x-auto bg-zinc-50/90 px-4 py-2 backdrop-blur [scrollbar-width:none] dark:bg-zinc-950/90">
        {nav.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-900">{label}</a>
        ))}
      </nav>

      {a.warnings?.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          {a.warnings.join(" ")} The analysis is based on the visuals only.
        </div>
      )}

      <Section id="scenes" n={1} title="What's in the video">
        <ol className="space-y-3">
          {(a.scenes || []).map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{s.time}</span>
              <span>{s.description}</span>
            </li>
          ))}
        </ol>
        {a.on_screen_text?.length > 0 && (
          <>
            <Label>On-screen text</Label>
            <div className="flex flex-wrap gap-1.5">
              {a.on_screen_text.map((t, i) => <span key={i} className="rounded-lg bg-zinc-100 px-2 py-1 text-sm dark:bg-zinc-800">{t}</span>)}
            </div>
          </>
        )}
        {reel.transcript && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-brand-600">Transcript</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-zinc-100 p-3 font-sans text-sm whitespace-pre-wrap dark:bg-zinc-800">{reel.transcript}</pre>
          </details>
        )}
      </Section>

      {a.hook && (
        <Section id="hook" n={2} title="Main message & hook">
          <blockquote className="rounded-xl border-l-4 border-brand-500 bg-brand-50 p-3 font-medium dark:bg-brand-500/10">“{a.hook.hook_line}”</blockquote>
          <p className="mt-3">{a.hook.main_message}</p>
          <Label>Why it works</Label>
          <Bullets items={a.hook.why_it_works} />
          <Label>What grabs attention</Label>
          <Bullets items={a.hook.attention_grabbers} />
          <Label>Who it's for</Label>
          <p>{a.hook.target_audience}</p>
        </Section>
      )}

      {a.concept && (
        <Section id="concept" n={3} title="Business or concept behind it">
          <p>{a.concept.summary}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-800"><p className="text-xs font-bold text-zinc-500 uppercase">Category</p><p className="font-medium">{a.concept.category}</p></div>
            <div className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-800"><p className="text-xs font-bold text-zinc-500 uppercase">Product / service</p><p className="font-medium">{a.concept.product_or_service}</p></div>
          </div>
          <Label>How it makes money</Label>
          <Bullets items={a.concept.how_it_makes_money} />
        </Section>
      )}

      {a.how_to && (
        <Section id="howto" n={4} title="How you could do it">
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
              <p className="text-xs font-bold text-emerald-700 uppercase dark:text-emerald-300">Starting cost</p>
              <p className="text-lg font-bold">{money(h.cost_estimate)}</p>
            </div>
            <div className="rounded-xl bg-sky-50 p-3 dark:bg-sky-500/10">
              <p className="text-xs font-bold text-sky-700 uppercase dark:text-sky-300">Time to start</p>
              <p className="font-semibold">{h.time_to_start}</p>
            </div>
          </div>
          <Label>Steps</Label>
          <ol className="space-y-2">
            {(h.steps || []).map((s, i) => (
              <li key={i} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span><span>{s}</span></li>
            ))}
          </ol>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <div><Label>Tools</Label><Bullets items={h.tools} /></div>
            <div><Label>Skills needed</Label><Bullets items={h.skills} /></div>
          </div>
          {h.cost_estimate?.breakdown?.length > 0 && (<><Label>Cost breakdown</Label><Bullets items={h.cost_estimate.breakdown} /></>)}
          {h.cost_estimate?.notes && <p className="mt-2 text-sm text-zinc-500">{h.cost_estimate.notes}</p>}
        </Section>
      )}

      {a.remixes?.length > 0 && (
        <Section id="remix" n={5} title="Idea remix — same concept, new businesses">
          <div className="grid gap-3">
            {a.remixes.map((r, i) => (
              <div key={i} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                <p className="font-semibold"><span className="text-brand-600">{i + 1}.</span> {r.niche}</p>
                <p className="mt-1">{r.idea}</p>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400"><b>How it maps:</b> {r.how_it_maps}</p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400"><b>First step:</b> {r.first_step}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {a.content_ideas?.length > 0 && (
        <Section id="ideas" n={6} title="Reel ideas you can make">
          <div className="space-y-4">
            {a.content_ideas.map((c, i) => (
              <div key={i} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold"><span className="text-brand-600">{i + 1}.</span> {c.title}</p>
                  <span className="no-print"><CopyButton small text={() => contentIdeaMd(c, i)} label="Copy" /></span>
                </div>
                <p className="mt-2 rounded-lg bg-fuchsia-50 p-2 text-sm dark:bg-fuchsia-500/10"><b>Hook:</b> {c.hook}</p>
                <Label>Script outline</Label>
                <ol className="list-decimal space-y-1 pl-5">{(c.script_outline || []).map((s, j) => <li key={j}>{s}</li>)}</ol>
                <div className="mt-3 flex items-center justify-between">
                  <Label>Caption</Label>
                  <span className="no-print"><CopyButton small text={() => `${c.caption}\n\n${(c.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}`} label="Copy caption" /></span>
                </div>
                <p className="whitespace-pre-wrap">{c.caption}</p>
                <p className="mt-1 text-sm text-brand-600">{(c.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

export default function Reel({ id }) {
  const [reel, setReel] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [pollKey, setPollKey] = useState(0);

  useEffect(() => {
    let stop = false, timer;
    async function tick() {
      try {
        const s = await api.status(id);
        if (stop) return;
        setStatus(s);
        if (s.status === "done" || s.status === "error") {
          setReel(await api.get(id));
          return;
        }
      } catch (e) {
        if (!stop) setError(e.message);
        return;
      }
      timer = setTimeout(tick, 1500);
    }
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [id, pollKey]);

  async function retry() {
    await api.retry(id);
    setReel(null);
    setStatus({ status: "queued", progress: 0, stage: "Waiting to start" });
    setPollKey((k) => k + 1);
  }

  async function remove() {
    if (!confirm("Delete this reel and its analysis?")) return;
    await api.remove(id);
    navigate("/library", { replace: true });
  }

  function printPdf() {
    const prev = document.title;
    document.title = slug(reel?.title);
    window.print();
    setTimeout(() => (document.title = prev), 500);
  }

  if (error) return <div className="card text-center"><p className="font-semibold">{error}</p><button className="btn-ghost mt-3" onClick={() => navigate("/library")}>Back to library</button></div>;

  const processing = !reel || reel.status === "queued" || reel.status === "processing";

  return (
    <div className="space-y-4">
      {reel ? <Header reel={reel} onChange={setReel} /> : <div className="h-8 w-2/3 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />}

      {processing && reel?.status !== "error" ? (
        <Progress status={status} />
      ) : reel.status === "error" ? (
        <div className="card space-y-3 border-red-200 dark:border-red-500/30">
          <p className="font-semibold text-red-700 dark:text-red-400">This reel couldn't be analyzed</p>
          <p className="text-sm">{reel.error}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={retry}><IconRetry width={16} height={16} /> Try again</button>
            <button className="btn-ghost" onClick={() => navigate("/")}>Upload the file instead</button>
            <button className="btn-ghost text-red-600" onClick={remove}><IconTrash width={16} height={16} /> Delete</button>
          </div>
        </div>
      ) : (
        <>
          <div className="no-print flex flex-wrap gap-2">
            <CopyButton text={() => toMarkdown(reel)} label="Copy all" />
            <button className="btn-ghost" onClick={printPdf}><IconPdf width={16} height={16} /> PDF</button>
            <button className="btn-ghost" onClick={() => downloadFile(`${slug(reel.title)}.md`, toMarkdown(reel))}><IconDownload width={16} height={16} /> .md</button>
            <button className="btn-ghost ml-auto text-red-600" onClick={remove} aria-label="Delete"><IconTrash width={16} height={16} /></button>
          </div>
          <Frames reel={reel} />
          <Analysis reel={reel} />
          <Chat reel={reel} />
        </>
      )}
    </div>
  );
}
