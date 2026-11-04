import { config } from "./_config.js";
import { json, rateLimiter, BUSY, BROKEN, SLOW } from "./_shared.js";
import { fromOtherSite } from "./_guard.js";

const MAX_BYTES = 3 * 1024 * 1024;
const TOO_LONG = "That recording is too long. Keep questions under 30 seconds.";
const limited = rateLimiter(30);

const PHANTOM = /^(thank you\.?|thanks for watching!?|you|bye\.?|\.+|धन्यवाद[।.!]?|शुक्रिया[।.!]?)$/i;

const NAMES = "NeoFab, Conduit, Legally AI, FinSight, Waypoint, RAG";

function fileNameFor(type) {
  if (type.includes("webm")) return "question.webm";
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "question.mp4";
  if (type.includes("ogg")) return "question.ogg";
  if (type.includes("wav")) return "question.wav";
  if (type.includes("mpeg") || type.includes("mp3")) return "question.mp3";
  return null;
}

function providers() {
  const list = [];
  if (config.openaiKey) {
    list.push({ name: "openai", url: "https://api.openai.com/v1/audio/transcriptions", key: config.openaiKey, model: config.sttModel, prompt: NAMES });
  }
  if (config.groqKey) {
    list.push({ name: "groq", url: "https://api.groq.com/openai/v1/audio/transcriptions", key: config.groqKey, model: config.groqSttModel });
  }
  return list;
}

export async function POST(request) {
  const chain = providers();
  if (!chain.length) {
    console.error("[transcribe] no OPENAI_API_KEY or GROQ_API_KEY set");
    return json({ error: "The bot isn't set up yet." }, 500);
  }
  if (fromOtherSite(request)) return json({ error: "Not allowed." }, 403);
  if (limited(request)) return json({ error: BUSY }, 429);

  const type = (request.headers.get("content-type") || "").toLowerCase();
  const fileName = fileNameFor(type);
  if (!type.startsWith("audio/") || !fileName) {
    return json({ error: "Send audio/webm or audio/mp4." }, 415);
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) return json({ error: TOO_LONG }, 413);

  const audio = await request.arrayBuffer();
  if (audio.byteLength > MAX_BYTES) return json({ error: TOO_LONG }, 413);
  if (audio.byteLength === 0) return json({ text: "" });

  const failures = [];
  for (const p of chain) {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: type.split(";")[0] }), fileName);
    form.append("model", p.model);
    form.append("response_format", "json");
    if (p.prompt) form.append("prompt", p.prompt);

    let res;
    try {
      res = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.key}` },
        body: form,
        signal: AbortSignal.timeout(12_000),
      });
    } catch (err) {
      failures.push({ name: p.name, status: err.name === "TimeoutError" ? 504 : 502, detail: err.message });
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      failures.push({ name: p.name, status: res.status, detail: detail.slice(0, 300) });
      continue;
    }

    if (failures.length) console.warn("[transcribe] answered by", p.name, "after:", failures.map((f) => `${f.name} ${f.status}`).join(", "));
    const text = ((await res.json())?.text || "").trim();
    return json({ text: PHANTOM.test(text) ? "" : text });
  }

  console.error("[transcribe] all providers failed:", failures.map((f) => `${f.name} ${f.status} ${f.detail}`).join(" | "));
  if (failures.every((f) => f.status === 429)) return json({ error: BUSY }, 429);
  const timedOut = failures.some((f) => f.status === 504);
  return json({ error: timedOut ? SLOW : BROKEN }, timedOut ? 504 : 502);
}
