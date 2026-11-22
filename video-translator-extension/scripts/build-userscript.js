#!/usr/bin/env node
/* Builds iphone/video-auto-translator.user.js — the same content script packaged
 * as a userscript, for iPhone/iPad Safari via the free "Userscripts" app
 * (no Mac or Xcode needed). Also works in Tampermonkey/Violentmonkey. */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const version = JSON.parse(read("manifest.json")).version;

const header = `// ==UserScript==
// @name         Video Auto Translator
// @namespace    video-auto-translator
// @version      ${version}
// @description  Video ki language auto-detect karke aapki language mein live subtitles dikhata hai.
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @connect      translate.googleapis.com
// @connect      api.groq.com
// @connect      api.openai.com
// @run-at       document-end
// ==/UserScript==
`;

const userSettings = `
  /* ============ APNI SETTINGS YAHAN BADLEIN ============ */
  const USER_SETTINGS = {
    targetLang: "hi",          // video kis language mein dekhni hai: hi, en, bn, ta, te, mr, gu, kn, ml, pa, ur ...
    knownLangs: ["hi", "en"],  // ye languages aati hain -> translate mat karo
    outputMode: "subtitles",   // "subtitles" | "dub" | "both"
    showOriginal: false,       // translation ke neeche original line bhi
    fontSize: 20,
    // Sirf desktop (Tampermonkey) ke audio mode ke liye — iPhone par zarurat nahi:
    apiKey: "",
    sttBaseUrl: "https://api.groq.com/openai/v1",
    sttModel: "whisper-large-v3-turbo"
  };
  /* ==================================================== */
`;

const shim = `
  // Minimal stand-in for the extension APIs that content.js uses.
  function vtGetJson(url) {
    if (typeof GM !== "undefined" && GM.xmlHttpRequest) {
      return new Promise((resolve, reject) =>
        GM.xmlHttpRequest({
          method: "GET",
          url,
          onload: (r) => {
            try {
              if (r.status !== 200) throw new Error("HTTP " + r.status);
              resolve(JSON.parse(r.responseText));
            } catch (e) {
              reject(e);
            }
          },
          onerror: () => reject(new Error("network")),
          ontimeout: () => reject(new Error("timeout"))
        })
      );
    }
    return fetch(url).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  const vtSettings = Object.assign({}, VT_DEFAULTS, USER_SETTINGS);
  const vtHandlers = {
    gtx: (m) => vtGtxTranslate(m, vtGetJson),
    transcribe: (m) => vtTranscribe(vtSettings, m)
  };
  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        const h = vtHandlers[msg && msg.type];
        Promise.resolve(h ? h(msg) : {})
          .catch((e) => ({ error: String((e && e.message) || e) }))
          .then((r) => cb && cb(r));
      },
      onMessage: { addListener() {} }
    },
    storage: {
      sync: { get: (defs, cb) => setTimeout(() => cb(Object.assign({}, defs, USER_SETTINGS))) },
      onChanged: { addListener() {} }
    }
  };
`;

const css = read("src/content.css");
const out =
  header +
  "(function () {\n  'use strict';\n" +
  userSettings +
  read("src/lang.js") +
  "\n" +
  read("src/services.js") +
  shim +
  `  const vtStyle = document.createElement("style");\n  vtStyle.textContent = ${JSON.stringify(css)};\n  (document.head || document.documentElement).appendChild(vtStyle);\n\n` +
  read("src/content.js") +
  "\n})();\n";

fs.mkdirSync(path.join(root, "iphone"), { recursive: true });
const file = path.join(root, "iphone", "video-auto-translator.user.js");
fs.writeFileSync(file, out);
console.log("Built " + path.relative(root, file));
