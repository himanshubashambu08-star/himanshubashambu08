import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { api } from "../lib/api.js";
import CopyButton from "./CopyButton.jsx";
import { IconSend } from "./Icons.jsx";

const SUGGESTIONS = [
  "How much can I earn from this in the first 3 months?",
  "Write a full 30-second script for idea #1 in Hinglish",
  "What equipment do I need to film this on a phone?",
  "How do I get my first 10 customers for this?",
];

export default function Chat({ reel }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => { api.messages(reel.id).then(setMessages).catch(() => {}); }, [reel.id]);

  async function ask(q) {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    setInput("");
    setError("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: question }, { role: "assistant", content: "", pending: true }]);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
    try {
      await api.chat(reel.id, question, (text) =>
        setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: text, pending: true }])
      );
      setMessages((m) => [...m.slice(0, -1), { ...m[m.length - 1], pending: false }]);
    } catch (e) {
      setError(e.message);
      setMessages((m) => m.slice(0, -2));
      setInput(question);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm("Clear this conversation?")) return;
    await api.clearMessages(reel.id);
    setMessages([]);
  }

  return (
    <section id="chat" className="card scroll-mt-28">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight"><span className="mr-1.5 text-brand-600">7.</span>Ask about this video</h2>
        {messages.length > 0 && <button className="no-print text-sm text-zinc-500 hover:text-red-600" onClick={clear}>Clear</button>}
      </div>

      {messages.length === 0 && (
        <div className="no-print mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="rounded-xl border border-zinc-200 px-3 py-2 text-left text-sm hover:border-brand-500 dark:border-zinc-700" onClick={() => ask(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-white">{m.content}</div>
          ) : (
            <div key={i} className="max-w-full rounded-2xl rounded-bl-md bg-zinc-100 px-3.5 py-2 dark:bg-zinc-800">
              {m.content ? (
                <div className="prose-chat break-words"><Markdown>{m.content}</Markdown></div>
              ) : (
                <span className="inline-flex gap-1 py-2">{[0, 1, 2].map((d) => <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d * 120}ms` }} />)}</span>
              )}
              {!m.pending && m.content && <div className="no-print mt-1 flex justify-end"><CopyButton small text={m.content} className="btn !text-zinc-500" /></div>}
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      <form className="no-print mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <textarea
          className="input max-h-40 min-h-[48px] resize-none"
          rows={1}
          placeholder="Ask a follow-up question…"
          value={input}
          onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); ask(); } }}
        />
        <button className="btn-primary h-12 w-12 shrink-0 !p-0" disabled={busy || !input.trim()} aria-label="Send"><IconSend /></button>
      </form>
    </section>
  );
}
