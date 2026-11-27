import { Link } from "../lib/router.jsx";
import { PLATFORMS, formatDate, frameUrl } from "../lib/api.js";

export default function ReelCard({ reel, onTag }) {
  const thumb = frameUrl(reel.id, reel.thumbnail);
  return (
    <Link to={`/reel/${reel.id}`} className="card group flex gap-3 !p-3 transition hover:border-brand-500/50">
      <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800">
        {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
        {reel.status !== "done" && (
          <span className={`absolute inset-x-1 bottom-1 rounded-md px-1 py-0.5 text-center text-[10px] font-semibold text-white ${reel.status === "error" ? "bg-red-600" : "bg-brand-600"}`}>
            {reel.status === "error" ? "Failed" : `${reel.progress}%`}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <h3 className="line-clamp-2 font-semibold leading-snug group-hover:text-brand-600">{reel.title || "Untitled reel"}</h3>
        <p className="mt-1 text-xs text-zinc-500">
          {PLATFORMS[reel.platform] || "Link"} · {formatDate(reel.created_at)}
          {reel.duration ? ` · ${Math.round(reel.duration)}s` : ""}
        </p>
        {reel.tags?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {reel.tags.slice(0, 5).map((t) => (
              <span
                key={t}
                className="chip cursor-pointer"
                onClick={onTag ? (e) => { e.preventDefault(); e.stopPropagation(); onTag(t); } : undefined}
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
