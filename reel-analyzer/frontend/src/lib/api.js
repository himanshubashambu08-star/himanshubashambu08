async function json(res) {
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const d = body?.detail;
    const msg = typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join(", ") : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

export const api = {
  health: () => fetch("/api/health").then(json),
  list: (params = {}) => fetch("/api/reels?" + new URLSearchParams(params)).then(json),
  tags: () => fetch("/api/tags").then(json),
  get: (id) => fetch(`/api/reels/${id}`).then(json),
  status: (id) => fetch(`/api/reels/${id}/status`).then(json),
  patch: (id, body) => fetch(`/api/reels/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json),
  remove: (id) => fetch(`/api/reels/${id}`, { method: "DELETE" }).then(json),
  retry: (id) => fetch(`/api/reels/${id}/retry`, { method: "POST" }).then(json),
  submitLink: (body) => fetch("/api/reels/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json),
  messages: (id) => fetch(`/api/reels/${id}/messages`).then(json),
  clearMessages: (id) => fetch(`/api/reels/${id}/messages`, { method: "DELETE" }).then(json),

  // XHR so we can show upload progress for big files on slow phone connections
  upload(file, fields, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/reels/upload");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* empty */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(typeof body?.detail === "string" ? body.detail : `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Upload failed — check your connection and try again."));
      xhr.send(fd);
    });
  },

  async chat(id, question, onDelta) {
    const res = await fetch(`/api/reels/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) await json(res);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).replace(/^data: /, "");
        buf = buf.slice(i + 2);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === "delta") { text += ev.text; onDelta(text); }
        else if (ev.type === "final") { text = ev.text; onDelta(text); }
        else if (ev.type === "error") throw new Error(ev.text);
      }
    }
    return text;
  },
};

export const frameUrl = (id, file) => (file ? `/media/${id}/${file}` : null);

export const PLATFORMS = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  upload: "Upload",
  other: "Link",
};

export function formatDate(ts) {
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
