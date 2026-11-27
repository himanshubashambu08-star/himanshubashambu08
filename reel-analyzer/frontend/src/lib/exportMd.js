const list = (items, prefix = "- ") => (items || []).map((x) => `${prefix}${x}`).join("\n");
const numbered = (items) => (items || []).map((x, i) => `${i + 1}. ${x}`).join("\n");

export function money(cost) {
  if (!cost) return "";
  const fmt = (n) => {
    try {
      return new Intl.NumberFormat(cost.currency === "INR" ? "en-IN" : undefined, { style: "currency", currency: cost.currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${cost.currency} ${Math.round(n).toLocaleString()}`;
    }
  };
  return `${fmt(cost.low)} – ${fmt(cost.high)}`;
}

export function contentIdeaMd(c, i) {
  return [
    `### ${i + 1}. ${c.title}`,
    `**Hook:** ${c.hook}`,
    `**Script outline:**\n${numbered(c.script_outline)}`,
    `**Caption:**\n${c.caption}`,
    (c.hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "),
  ].join("\n\n");
}

export function toMarkdown(reel) {
  const a = reel.analysis || {};
  const out = [`# ${reel.title || a.title || "Reel analysis"}`];
  const meta = [reel.source_url, reel.tags?.length ? reel.tags.map((t) => `#${t}`).join(" ") : ""].filter(Boolean);
  if (meta.length) out.push(meta.join("\n\n"));

  out.push("## 1. What's in the video");
  out.push((a.scenes || []).map((s) => `- **${s.time}** — ${s.description}`).join("\n"));
  if (a.on_screen_text?.length) out.push(`**On-screen text:**\n${list(a.on_screen_text)}`);

  if (a.hook) {
    out.push("## 2. Main message & hook");
    out.push(`**Hook:** ${a.hook.hook_line}\n\n**Main message:** ${a.hook.main_message}\n\n**Target audience:** ${a.hook.target_audience}`);
    out.push(`**Why it works:**\n${list(a.hook.why_it_works)}`);
    out.push(`**What grabs attention:**\n${list(a.hook.attention_grabbers)}`);
  }
  if (a.concept) {
    out.push("## 3. Business / concept behind it");
    out.push(`${a.concept.summary}\n\n**Category:** ${a.concept.category}\n\n**Product / service:** ${a.concept.product_or_service}`);
    out.push(`**How it makes money:**\n${list(a.concept.how_it_makes_money)}`);
  }
  if (a.how_to) {
    const h = a.how_to;
    out.push("## 4. How you could do it");
    out.push(`**Steps:**\n${numbered(h.steps)}`);
    out.push(`**Tools:**\n${list(h.tools)}`);
    out.push(`**Skills needed:**\n${list(h.skills)}`);
    if (h.cost_estimate) out.push(`**Starting cost:** ${money(h.cost_estimate)}\n${list(h.cost_estimate.breakdown)}\n\n${h.cost_estimate.notes || ""}`);
    if (h.time_to_start) out.push(`**Time to start:** ${h.time_to_start}`);
  }
  if (a.remixes?.length) {
    out.push("## 5. Idea remix");
    out.push(a.remixes.map((r, i) => `### ${i + 1}. ${r.niche}\n${r.idea}\n\n*How it maps:* ${r.how_it_maps}\n\n*First step:* ${r.first_step}`).join("\n\n"));
  }
  if (a.content_ideas?.length) {
    out.push("## 6. Reel ideas you can make");
    out.push(a.content_ideas.map(contentIdeaMd).join("\n\n"));
  }
  if (reel.transcript) out.push(`## Transcript\n${reel.transcript}`);
  return out.filter(Boolean).join("\n\n") + "\n";
}

export function downloadFile(name, text, type = "text/markdown") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function slug(s) {
  return (s || "reel").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "reel";
}
