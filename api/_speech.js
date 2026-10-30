// Rewrites a reply so a text to speech voice pronounces it right: acronyms
// spelled out, product names said the way Manas says them. Only the spoken
// copy goes through this; the transcript keeps the original text.

const SAY = [
  // Names and products
  [/\bNeoFab\.AI\b/g, "Neo Fab A I"],
  [/\bNeoFab\b/g, "Neo Fab"],
  [/\bLegally AI\b/g, "Legally A I"],
  [/\bInLegalBERT\b/g, "In Legal Bert"],
  [/\bFAISS\b/gi, "face"],
  [/\bpgvector\b/gi, "P G vector"],
  [/\bPostgreSQL\b/g, "Postgres"],
  [/\bFastAPI\b/g, "Fast A P I"],
  [/\b(Next|Three|Node|Express)\.js\b/g, "$1 J S"],
  [/\bgpt-oss\b/gi, "G P T O S S"],
  [/\bGPT-(\d)/g, "G P T $1"],
  [/\bLLaMA\b/g, "Llama"],
  [/\bGroq\b/g, "Grock"],
  [/\bOLA\b/g, "Ola"],
  [/\bE-Cell\b/gi, "E cell"],
  [/\bB\.Tech\b/g, "B Tech"],
  [/\(Hons\.?\)/g, "Honours"],
  [/\b100x\b/gi, "hundred X"],
  [/\b10-K\b/g, "ten K"],
  [/\b10-Q\b/g, "ten Q"],
  [/\bCI\/CD\b/g, "C I C D"],
  [/\bWebRTC\b/g, "Web R T C"],
  [/\bRBAC\b/g, "R back"],
  [/\bDOCX\b/g, "doc X"],
  [/\bRAG\b/g, "rag"],
  // Metrics
  [/\b[pP](50|90|95|99)\b/g, (_, n) => `p ${{ 50: "fifty", 90: "ninety", 95: "ninety five", 99: "ninety nine" }[n]}`],
  [/(\d)\s?ms\b/g, "$1 milliseconds"],
  // Acronyms read letter by letter, with an optional plural s
  [/\b(MUJ|RFQ|LLM|API|MCP|PII|SEC|OCR|SQL|UI|AWS|GCP|STT|TTS|ETL|AIML|ML|AI)(s?)\b/g,
    (_, word, plural) => word.split("").join(" ") + (plural ? "s" : "")],
];

export function forSpeech(text) {
  let out = String(text || "");
  for (const [pattern, replacement] of SAY) out = out.replace(pattern, replacement);
  return out.replace(/\s{2,}/g, " ").trim();
}
