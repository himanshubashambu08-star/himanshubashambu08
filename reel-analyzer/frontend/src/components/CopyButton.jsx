import { useState } from "react";
import { IconCheck, IconCopy } from "./Icons.jsx";

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for http:// on phones (no clipboard API outside secure contexts)
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export default function CopyButton({ text, label = "Copy", className = "btn-ghost", small }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`${className} ${small ? "!px-2.5 !py-1.5 !text-xs" : ""}`}
      onClick={async () => {
        if (await copyText(typeof text === "function" ? text() : text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }
      }}
    >
      {done ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />}
      {done ? "Copied" : label}
    </button>
  );
}
