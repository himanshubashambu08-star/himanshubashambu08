"""One-page web app: paste a link, press the button."""
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

from . import pipeline
from .config import OUTPUT_DIR, env, load_tokens

app = Flask(__name__)
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()  # one video at a time keeps the computer responsive


def connected() -> dict:
    tokens = load_tokens()
    return {
        "instagram": bool(env("IG_ACCESS_TOKEN") or tokens.get("ig_access_token")),
        "tiktok": bool(tokens.get("tiktok_refresh_token")),
        "claude": bool(env("ANTHROPIC_API_KEY")),
    }


def worker(job_id: str, url: str, post_to: list[str]) -> None:
    job = JOBS[job_id]

    def log(msg: str) -> None:
        job["log"].append(f"{time.strftime('%H:%M:%S')}  {msg}")

    def progress(pct: float, stage: str) -> None:
        job["progress"], job["stage"] = round(pct, 1), stage

    if LOCK.locked():
        job["stage"] = "Waiting for the previous video to finish"
    with LOCK:
        job["status"], job["started"] = "running", time.time()
        try:
            result = pipeline.run(url, post_to, log, progress)
            job["clips"] = [
                {"name": Path(c["file"]).name,
                 "url": f"/media/{Path(c['file']).parent.name}/{Path(c['file']).name}",
                 "title": c.get("title", ""), "text": c["post_text"], "posted": c["posted"],
                 "start": c["start"], "end": c["end"]}
                for c in result["clips"]
            ]
            job["status"] = "done"
        except Exception as e:
            log(f"✗ {e}")
            job["status"] = "failed"


@app.post("/api/jobs")
def create_job():
    body = request.get_json(force=True)
    url = (body.get("url") or "").strip()
    if not url:
        return jsonify({"error": "Paste a YouTube link"}), 400
    job_id = uuid.uuid4().hex[:8]
    JOBS[job_id] = {"status": "queued", "log": [], "clips": [], "progress": 0, "stage": "Starting"}
    threading.Thread(target=worker, args=(job_id, url, body.get("post_to") or []), daemon=True).start()
    return jsonify({"id": job_id})


@app.get("/api/jobs/<job_id>")
def job_status(job_id):
    job = JOBS.get(job_id) or abort(404)
    return jsonify({**job, "elapsed": time.time() - job["started"] if "started" in job else 0})


@app.get("/api/status")
def status():
    return jsonify(connected())


@app.get("/media/<folder>/<name>")
def media(folder, name):
    path = (OUTPUT_DIR / folder).resolve()
    if OUTPUT_DIR.resolve() not in path.parents:
        abort(404)
    return send_from_directory(path, name)


@app.get("/")
def index():
    return PAGE


PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clip Studio</title>
<style>
:root{--bg:#0f0a14;--panel:#1a1220;--line:#2e2236;--text:#f3eaf6;--muted:#a493ad;--pink:#ff4f9a;--ok:#5ee0a0;--bad:#ff6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:44px;letter-spacing:-1px;margin:0;font-weight:900}h1 span{color:var(--pink)}
.sub{color:var(--muted);margin:4px 0 28px;font-family:ui-monospace,monospace;font-size:13px;text-transform:uppercase;letter-spacing:1px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}
input[type=text]{width:100%;padding:16px;border-radius:12px;border:1px solid var(--line);background:#0b0710;color:var(--text);font-size:16px}
.row{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0;align-items:center}
label.chk{display:flex;gap:8px;align-items:center;cursor:pointer}
.pill{font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
.pill.on{color:var(--ok);border-color:var(--ok)}
button{width:100%;padding:18px;border:0;border-radius:12px;background:var(--pink);color:#fff;font-size:18px;font-weight:800;cursor:pointer}
button:disabled{opacity:.5;cursor:wait}
.bar{height:10px;background:#0b0710;border:1px solid var(--line);border-radius:99px;overflow:hidden;margin-top:20px}
.bar i{display:block;height:100%;width:0;background:var(--pink);transition:width .6s}
.stage{display:flex;justify-content:space-between;gap:8px;margin-top:8px;font-size:14px}.stage span:last-child{color:var(--muted);white-space:nowrap}
pre{background:#0b0710;border:1px solid var(--line);border-radius:12px;padding:14px;font-size:13px;white-space:pre-wrap;max-height:280px;overflow:auto;margin:20px 0 0}
.clips{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;margin-top:20px}
.clip{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.clip video{width:100%;aspect-ratio:9/16;background:#000;display:block}
.clip div{padding:10px 12px;font-size:13px}.clip b{display:block;margin-bottom:4px}
.ok{color:var(--ok)}.bad{color:var(--bad)}a{color:var(--pink)}
</style></head><body><main>
<h1>CLIP STUDIO <span>/</span></h1>
<div class="sub">YouTube link → viral clips → Instagram + TikTok</div>
<div class="card">
  <input id="url" type="text" placeholder="Paste a YouTube link…" autocomplete="off">
  <div class="row">
    <label class="chk"><input type="checkbox" id="ig" checked> Instagram Reels <span class="pill" id="s-ig">not set up</span></label>
    <label class="chk"><input type="checkbox" id="tt" checked> TikTok <span class="pill" id="s-tt">not set up</span></label>
    <span class="pill" id="s-ai">heuristic picks</span>
  </div>
  <button id="go">✂️ Clip &amp; Post</button>
  <div id="prog" hidden><div class="bar"><i id="fill"></i></div>
    <div class="stage"><span id="stage">Starting…</span><span id="eta"></span></div></div>
  <pre id="log" hidden></pre>
</div>
<div class="clips" id="clips"></div>
</main><script>
const $=id=>document.getElementById(id);
fetch('/api/status').then(r=>r.json()).then(s=>{
  if(s.instagram){$('s-ig').textContent='connected';$('s-ig').classList.add('on')}else{$('ig').checked=false}
  if(s.tiktok){$('s-tt').textContent='connected';$('s-tt').classList.add('on')}else{$('tt').checked=false}
  if(s.claude){$('s-ai').textContent='Claude picks the moments';$('s-ai').classList.add('on')}
});
$('go').onclick=async()=>{
  const post_to=[...($('ig').checked?['instagram']:[]),...($('tt').checked?['tiktok']:[])];
  $('go').disabled=true;$('log').hidden=false;$('prog').hidden=false;$('fill').style.width='0';$('eta').textContent='';$('log').textContent='Starting…';$('clips').innerHTML='';
  const r=await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:$('url').value,post_to})});
  const j=await r.json();if(!r.ok){$('log').textContent=j.error;$('go').disabled=false;return}
  const tick=async()=>{
    const s=await (await fetch('/api/jobs/'+j.id)).json();
    $('log').textContent=s.log.join('\\n')||'Waiting…';$('log').scrollTop=1e9;
    const p=s.progress||0;$('fill').style.width=p+'%';
    $('stage').textContent=(s.status==='failed'?'Failed':s.stage)+' · '+Math.floor(p)+'%';
    // rough ETA from average speed so far; needs a few % of progress to be meaningful
    $('eta').textContent=s.status==='done'?'done in '+fmt(s.elapsed):s.status==='failed'?'':p>=3?'~'+fmt(s.elapsed*(100-p)/p)+' left':fmt(s.elapsed)+' elapsed';
    if(s.status==='done'||s.status==='failed'){$('go').disabled=false;render(s.clips);return}
    setTimeout(tick,1500)};tick();
};
function fmt(s){s=Math.round(s);return s<60?s+'s':Math.floor(s/60)+'m '+(s%60)+'s'}
function esc(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML}
function render(clips){
  $('clips').innerHTML=clips.map(c=>`<div class="clip"><video src="${c.url}" controls playsinline preload="metadata"></video>
  <div><b>${esc(c.title||c.name)}</b>${Object.entries(c.posted).map(([p,v])=>`<div class="${String(v).startsWith('FAILED')?'bad':'ok'}">${p}: ${String(v).startsWith('http')?`<a href="${v}" target="_blank">open</a>`:esc(v)}</div>`).join('')}
  <a href="${c.url}" download>download</a></div></div>`).join('');
}
</script></body></html>"""
