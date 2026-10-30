// POST { text, spoken, sig } -> audio/mpeg
// Reads one chunk of a reply out loud with OpenAI text to speech. Returns 503
// when no OpenAI key is set, so the page falls back to the browser's voice.
// Only speaks text the server wrote: `spoken` is the whole reply as /api/chat
// returned it, `sig` its spokenSig, and `text` must be a piece of it. Otherwise
// anyone could make the voice say anything.

import { config, VOICE_STYLE, VOICE_STYLE_HI } from "./_config.js";
import { json, rateLimiter, isHindi, BUSY, BROKEN, SLOW } from "./_shared.js";
import { verify, fromOtherSite } from "./_guard.js";

const MAX_CHARS = 700;
const limited = rateLimiter(90);
const squash = (s) => s.replace(/\s+/g, " ").trim();

export async function POST(request) {
  if (!config.openaiKey) return json({ error: "No voice configured." }, 503);
  if (fromOtherSite(request)) return json({ error: "Not allowed." }, 403);
  if (limited(request)) return json({ error: BUSY }, 429);

  let text, spoken, sig;
  try {
    ({ text, spoken, sig } = (await request.json()) || {});
    text = squash(String(text || ""));
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  if (!text) return json({ error: "Nothing to say." }, 400);
  if (text.length > MAX_CHARS) return json({ error: "Too long." }, 413);
  if (!verify("speak", spoken, sig) || !squash(spoken).includes(text)) {
    return json({ error: "Not allowed." }, 403);
  }

  let res;
  try {
    res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ttsModel,
        voice: config.voice,
        input: text,
        instructions: isHindi(text) ? VOICE_STYLE_HI : VOICE_STYLE,
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error("[speak]", err.message);
    return json({ error: err.name === "TimeoutError" ? SLOW : BROKEN }, 504);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[speak] OpenAI ${res.status} ${detail.slice(0, 300)}`);
    return json({ error: BROKEN }, 502);
  }

  // Stream the audio straight through as it's generated.
  return new Response(res.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
