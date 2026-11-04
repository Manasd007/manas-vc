import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./_config.js";
import { SYSTEM_PROMPT } from "./persona.js";

function signingKey() {
  const base = process.env.SIGNING_SECRET || config.openaiKey || config.groqKey;
  return base ? createHmac("sha256", base).update("voice-bot signing v1").digest() : null;
}

export function sign(purpose, text) {
  const key = signingKey();
  return key ? createHmac("sha256", key).update(`${purpose}\n${text}`).digest("base64url") : "";
}

export function verify(purpose, text, sig) {
  if (typeof text !== "string" || typeof sig !== "string" || !sig) return false;
  const expected = Buffer.from(sign(purpose, text));
  const given = Buffer.from(sig);
  return expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given);
}

export function fromOtherSite(request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
}

const RULES = SYSTEM_PROMPT.split("\nBACKGROUND")[0];
const words = (text) => text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
const SHINGLE = 10;
const ruleShingles = new Set();
{
  const w = words(RULES);
  for (let i = 0; i + SHINGLE <= w.length; i++) ruleShingles.add(w.slice(i, i + SHINGLE).join(" "));
}
const SECTION_NAMES = /\b(HOW YOU TALK|HOW TO ANSWER|STAYING IN BOUNDS|TALKING POINTS|system prompt)\b/;

export function leaksPrompt(reply) {
  if (SECTION_NAMES.test(reply)) return true;
  const w = words(reply);
  for (let i = 0; i + SHINGLE <= w.length; i++) {
    if (ruleShingles.has(w.slice(i, i + SHINGLE).join(" "))) return true;
  }
  return false;
}

export async function flagged(text) {
  if (!config.openaiKey) return false;
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return false;
    return Boolean((await res.json())?.results?.[0]?.flagged);
  } catch {
    return false;
  }
}
