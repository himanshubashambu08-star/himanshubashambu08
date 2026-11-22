/* Shared data: languages, default settings, helpers.
 * Loaded in content scripts, popup, options, and the background worker. */

var VT_LANGS = [
  // Indian languages first
  { code: "hi", name: "Hindi", native: "हिन्दी", whisper: "hindi" },
  { code: "en", name: "English", native: "English", whisper: "english" },
  { code: "bn", name: "Bengali", native: "বাংলা", whisper: "bengali" },
  { code: "ta", name: "Tamil", native: "தமிழ்", whisper: "tamil" },
  { code: "te", name: "Telugu", native: "తెలుగు", whisper: "telugu" },
  { code: "mr", name: "Marathi", native: "मराठी", whisper: "marathi" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી", whisper: "gujarati" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ", whisper: "kannada" },
  { code: "ml", name: "Malayalam", native: "മലയാളം", whisper: "malayalam" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ", whisper: "punjabi" },
  { code: "or", name: "Odia", native: "ଓଡ଼ିଆ", whisper: "odia" },
  { code: "as", name: "Assamese", native: "অসমীয়া", whisper: "assamese" },
  { code: "ur", name: "Urdu", native: "اردو", whisper: "urdu" },
  { code: "ne", name: "Nepali", native: "नेपाली", whisper: "nepali" },
  { code: "sa", name: "Sanskrit", native: "संस्कृतम्", whisper: "sanskrit" },
  // World languages
  { code: "es", name: "Spanish", native: "Español", whisper: "spanish" },
  { code: "fr", name: "French", native: "Français", whisper: "french" },
  { code: "de", name: "German", native: "Deutsch", whisper: "german" },
  { code: "pt", name: "Portuguese", native: "Português", whisper: "portuguese" },
  { code: "it", name: "Italian", native: "Italiano", whisper: "italian" },
  { code: "ru", name: "Russian", native: "Русский", whisper: "russian" },
  { code: "uk", name: "Ukrainian", native: "Українська", whisper: "ukrainian" },
  { code: "pl", name: "Polish", native: "Polski", whisper: "polish" },
  { code: "nl", name: "Dutch", native: "Nederlands", whisper: "dutch" },
  { code: "tr", name: "Turkish", native: "Türkçe", whisper: "turkish" },
  { code: "ar", name: "Arabic", native: "العربية", whisper: "arabic" },
  { code: "fa", name: "Persian", native: "فارسی", whisper: "persian" },
  { code: "zh", name: "Chinese", native: "中文", whisper: "chinese" },
  { code: "ja", name: "Japanese", native: "日本語", whisper: "japanese" },
  { code: "ko", name: "Korean", native: "한국어", whisper: "korean" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", whisper: "indonesian" },
  { code: "ms", name: "Malay", native: "Bahasa Melayu", whisper: "malay" },
  { code: "th", name: "Thai", native: "ไทย", whisper: "thai" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt", whisper: "vietnamese" },
  { code: "si", name: "Sinhala", native: "සිංහල", whisper: "sinhala" },
  { code: "sw", name: "Swahili", native: "Kiswahili", whisper: "swahili" }
];

var VT_STT_PRESETS = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "whisper-1" },
  custom: { baseUrl: "", model: "whisper-1" }
};

var VT_DEFAULTS = {
  enabled: true,            // master switch
  targetLang: "hi",         // the language you want to watch in
  knownLangs: ["hi", "en"], // languages you already understand -> no translation
  outputMode: "subtitles",  // "subtitles" | "dub" | "both"
  showOriginal: false,      // also show the original line under the translation
  fontSize: 22,
  sttProvider: "groq",
  sttBaseUrl: VT_STT_PRESETS.groq.baseUrl,
  sttModel: VT_STT_PRESETS.groq.model,
  apiKey: "",
  chunkSeconds: 4,          // audio segment length sent for transcription
  duckVolume: 0.2,          // original video volume while the dub voice speaks
  disabledSites: []         // hostnames where the extension stays off
};

function vtNormLang(code) {
  if (!code) return "";
  code = String(code).trim().toLowerCase();
  if (!code || code === "und" || code === "auto") return "";
  // Whisper-style names ("hindi", "English")
  for (var i = 0; i < VT_LANGS.length; i++) {
    if (VT_LANGS[i].whisper === code || VT_LANGS[i].name.toLowerCase() === code) return VT_LANGS[i].code;
  }
  // BCP-47 like "hi-IN", "zh-CN", "en_US"
  var base = code.split(/[-_]/)[0];
  if (base === "iw") return "he";
  if (base === "in") return "id";
  if (base === "jw") return "jv";
  return base;
}

function vtLangName(code) {
  for (var i = 0; i < VT_LANGS.length; i++) if (VT_LANGS[i].code === code) return VT_LANGS[i].name;
  return code ? code.toUpperCase() : "Unknown";
}
