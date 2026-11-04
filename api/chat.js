import { PERSONA } from "./persona.js";
import { config } from "./_config.js";
import { forSpeech } from "./_speech.js";
import { json, rateLimiter, isHindi, BUSY, BROKEN, SLOW } from "./_shared.js";
import { sign, verify, fromOtherSite, leaksPrompt, flagged } from "./_guard.js";

export const DECLINE = "I'll pass on that one. Happy to talk about my work, my projects, or how I'd handle something on the job.";
export const NO_PEEKING = "That's the behind the scenes stuff, so I'll keep it to the interview. Ask me about my projects or how I work.";
const LOST = "Sorry, I lost my train of thought there. Could you ask that again?";

const LINES = {
  en: { decline: DECLINE, noPeeking: NO_PEEKING, lost: LOST },
  hi: {
    decline: "इसे मैं छोड़ दूँगा। मेरे काम, projects या job पर कोई situation कैसे handle करूँगा, इस पर बात करते हैं।",
    noPeeking: "वो behind the scenes वाली चीज़ है, तो interview पर ही रहते हैं। मेरे projects या मैं कैसे काम करता हूँ, इसके बारे में पूछिए।",
    lost: "Sorry, मैं थोड़ा भटक गया। एक बार फिर से पूछेंगे?",
  },
};

const MAX_MESSAGE_CHARS = 500;
const MAX_HISTORY = 6;
const MAX_WORDS = { en: 140, hi: 170 };
const limited = rateLimiter(30);

const BANNED = [
  "great question", "absolutely", "certainly", "i'd be happy to", "as an ai",
  "delve", "leverage", "passionate", "journey", "tapestry", "fast-paced world",
  "at the end of the day", "i'm excited to share", "in conclusion", "i hope this helps",
  "rest assured", "cutting-edge", "seamless", "robust", "synergy",
];

const STOCK_OPENER = /^(that's a great question|that is a great question|great question|what a great question|absolutely|certainly|sure|of course)\b[^,.!]*[,.!]+\s*/i;

export function sanitize(raw, maxWords = MAX_WORDS.en) {
  let text = String(raw || "");

  text = text.replace(/^[\s\S]*<\/think>/i, "").replace(/<think>[\s\S]*$/i, "");

  text = text.replace(/\s*[\u2013\u2014]\s*/g, ", ").replace(/(\S) - (?=\S)/g, "$1, ");

  text = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#{1,6}\s+/, "").replace(/^(?:[-*+•]|\d+[.)])\s+/, ""))
    .filter(Boolean)
    .map((line) => (/[.!?:,;।]$/.test(line) ? line : `${line}.`))
    .join(" ");
  text = text
    .replace(/`+/g, "")
    .replace(/\*+/g, "")
    .replace(/(^|[\s(])_{1,2}([^_]+?)_{1,2}(?=[\s).,!?;:]|$)/g, "$1$2");

  text = text.replace(/\s+([,.!?;:।])/g, "$1").replace(/,(\s*,)+/g, ",").replace(/,\s*([.!?।])/g, "$1");

  for (let i = 0; i < 2 && STOCK_OPENER.test(text); i++) {
    text = text.replace(STOCK_OPENER, "");
  }
  text = text.replace(/^\s*,\s*/, "");
  text = text.charAt(0).toUpperCase() + text.slice(1);

  const lower = text.toLowerCase();
  const flagged = BANNED.filter((w) => lower.includes(w));
  if (flagged.length) console.warn("[chat] banned words in reply:", flagged.join(", "));

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    const cut = words.slice(0, maxWords).join(" ");
    const end = Math.max(...[". ", "! ", "? ", "। "].map((p) => cut.lastIndexOf(p)), /[.!?।]$/.test(cut) ? cut.length - 1 : -1);
    text = end > 0 ? cut.slice(0, end + 1) : `${cut.replace(/[,;:]$/, "")}.`;
  }

  return text.replace(/\s{2,}/g, " ").trim();
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .filter((m) => m.role === "user" || (m.role === "assistant" && verify("history", m.content, m.sig)))
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, m.role === "user" ? MAX_MESSAGE_CHARS : 1500) }));
}

function answer(reply) {
  const spoken = forSpeech(reply);
  return json({ reply, spoken, replySig: sign("history", reply), spokenSig: sign("speak", spoken) });
}

const isReasoningModel = (model) => /^(gpt-5|o\d)/.test(model);

function providers() {
  const list = [];
  if (config.openaiKey) {
    const model = config.openaiModel;
    list.push({
      name: "openai", model, timeout: 15_000,
      url: "https://api.openai.com/v1/chat/completions", key: config.openaiKey,
      params: isReasoningModel(model)
        ? { reasoning_effort: "low", max_completion_tokens: 1500 }
        : { temperature: 0.8, max_completion_tokens: 400 },
    });
  }
  if (config.groqKey) {
    const groq = { name: "groq", timeout: 12_000, url: "https://api.groq.com/openai/v1/chat/completions", key: config.groqKey };
    const params = { temperature: 0.8, max_completion_tokens: 900, reasoning_effort: "low", include_reasoning: false };
    list.push({ ...groq, model: config.groqModel, params });
    if (config.groqFallbackModel !== config.groqModel) list.push({ ...groq, model: config.groqFallbackModel, params });
  }
  return list;
}

class RetryableError extends Error {}

async function complete(provider, messages) {
  const label = `${provider.name}/${provider.model}`;
  let res;
  try {
    res = await fetch(provider.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: provider.model, messages, ...provider.params }),
      signal: AbortSignal.timeout(provider.timeout),
    });
  } catch (err) {
    throw new RetryableError(`${label}: ${err.name === "TimeoutError" ? "timed out" : err.message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new RetryableError(`${label}: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || !content.trim()) throw new RetryableError(`${label}: empty reply`);
  return content;
}

export async function POST(request) {
  const chain = providers();
  if (!chain.length) {
    console.error("[chat] no OPENAI_API_KEY or GROQ_API_KEY set");
    return json({ error: "The bot isn't set up yet." }, 500);
  }
  if (fromOtherSite(request)) return json({ error: "Not allowed." }, 403);
  if (limited(request)) return json({ error: BUSY }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "Ask a question first." }, 400);
  if (message.length > MAX_MESSAGE_CHARS) {
    return json({ error: "That question is a bit long. Try a shorter one." }, 400);
  }

  const lines = LINES[isHindi(message) ? "hi" : "en"];

  const messages = [
    { role: "system", content: PERSONA },
    ...cleanHistory(body.history),
    { role: "user", content: message },
  ];

  const moderation = flagged(message);

  const errors = [];
  for (const provider of chain) {
    let raw;
    try {
      raw = await complete(provider, messages);
    } catch (err) {
      errors.push(err.message);
      continue;
    }
    if (errors.length) console.warn(`[chat] answered by ${provider.name}/${provider.model} after:`, errors.join(" | "));
    if (await moderation) {
      console.warn("[chat] question flagged by moderation");
      return answer(lines.decline);
    }
    const reply = sanitize(raw, MAX_WORDS[isHindi(raw) ? "hi" : "en"]) || lines.lost;
    if (leaksPrompt(reply)) {
      console.warn("[chat] reply quoted the instructions, replaced");
      return answer(lines.noPeeking);
    }
    return answer(reply);
  }

  console.error("[chat] all providers failed:", errors.join(" | "));
  const timedOut = errors.some((e) => e.includes("timed out"));
  return json({ error: timedOut ? SLOW : BROKEN }, timedOut ? 504 : 502);
}
