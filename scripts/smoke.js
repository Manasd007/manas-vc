import { mkdirSync, writeFileSync } from "node:fs";
import { root } from "./env.js";
import { config, VOICE_STYLE } from "../api/_config.js";

const ok = (msg) => console.log(`  \x1b[32mPASS\x1b[0m ${msg}`);
const bad = (msg) => console.log(`  \x1b[31mFAIL\x1b[0m ${msg}`);
const info = (msg) => console.log(`       ${msg}`);
let failures = 0;
const fail = (msg) => { failures++; bad(msg); };

async function call(url, key, body) {
  const started = Date.now();
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    let detail = await res.text();
    try { detail = JSON.parse(detail).error?.message || detail; } catch {}
    throw new Error(`HTTP ${res.status}: ${String(detail).slice(0, 200)}`);
  }
  return { res, ms };
}

function masked(key) {
  return key ? `${key.slice(0, 7)}...${key.slice(-4)} (${key.length} chars)` : "missing";
}

async function checkOpenAI() {
  console.log("\nOpenAI");
  const key = config.openaiKey;
  info(`key: ${masked(key)}`);
  if (!key) return fail("OPENAI_API_KEY is empty in .env.local");

  try {
    const { res } = await call("https://api.openai.com/v1/models", key);
    const ids = (await res.json()).data.map((m) => m.id).sort();
    ok(`key works, ${ids.length} models available`);
    const chat = ids.filter((id) => /^(gpt-|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding|moderation|codex)/.test(id));
    info(`chat models: ${chat.join(", ") || "none"}`);
    info(`voice models: ${ids.filter((id) => /tts|realtime/.test(id)).join(", ") || "none"}`);
    if (!ids.includes(config.openaiModel)) fail(`chat model "${config.openaiModel}" is not on this key. Set OPENAI_MODEL to one of the chat models above.`);
    if (!ids.includes(config.ttsModel)) fail(`voice model "${config.ttsModel}" is not on this key. Set OPENAI_TTS_MODEL to one of the voice models above.`);
    if (!ids.includes(config.sttModel)) fail(`transcription model "${config.sttModel}" is not on this key. Set OPENAI_STT_MODEL to one of: ${ids.filter((id) => /transcribe/.test(id)).join(", ")}`);
  } catch (err) {
    return fail(`listing models: ${err.message}`);
  }

  try {
    const { res, ms } = await call("https://api.openai.com/v1/chat/completions", key, {
      model: config.openaiModel,
      messages: [{ role: "user", content: "Reply with exactly: smoke test ok" }],
      max_completion_tokens: 300,
    });
    const text = (await res.json()).choices?.[0]?.message?.content?.trim();
    text ? ok(`chat with ${config.openaiModel} in ${ms} ms: "${text}"`) : fail(`chat with ${config.openaiModel} returned an empty reply`);
  } catch (err) {
    fail(`chat with ${config.openaiModel}: ${err.message}`);
  }

  mkdirSync(`${root}smoke-output`, { recursive: true });
  const line = "Hey, I'm Manas. I built Legally AI and Conduit, and I spent a year at NeoFab A I working on their procurement agent.";
  for (const voice of [...new Set([config.voice, "ash", "echo", "verse", "onyx"])]) {
    try {
      const { res, ms } = await call("https://api.openai.com/v1/audio/speech", key, {
        model: config.ttsModel, voice, input: line, instructions: VOICE_STYLE, response_format: "mp3",
      });
      const audio = Buffer.from(await res.arrayBuffer());
      writeFileSync(`${root}smoke-output/voice-${voice}.mp3`, audio);
      ok(`voice "${voice}" in ${ms} ms, saved smoke-output/voice-${voice}.mp3 (${Math.round(audio.length / 1024)} KB)`);
    } catch (err) {
      fail(`voice "${voice}": ${err.message}`);
    }
  }
}

async function checkGroq() {
  console.log("\nGroq");
  const key = config.groqKey;
  info(`key: ${masked(key)}`);
  if (!key) return fail("GROQ_API_KEY is empty in .env.local");

  try {
    const { res } = await call("https://api.groq.com/openai/v1/models", key);
    const ids = (await res.json()).data.map((m) => m.id);
    ok(`key works, ${ids.length} models available`);
    for (const model of [config.groqModel, config.groqFallbackModel, config.groqSttModel]) {
      ids.includes(model) ? ok(`${model} available`) : fail(`${model} is not available on this key`);
    }
  } catch (err) {
    return fail(`listing models: ${err.message}`);
  }

  try {
    const { res, ms } = await call("https://api.groq.com/openai/v1/chat/completions", key, {
      model: config.groqModel,
      messages: [{ role: "user", content: "Reply with exactly: smoke test ok" }],
      max_completion_tokens: 300,
      reasoning_effort: "low",
      include_reasoning: false,
    });
    const text = (await res.json()).choices?.[0]?.message?.content?.trim();
    text ? ok(`chat with ${config.groqModel} in ${ms} ms: "${text}"`) : fail(`chat with ${config.groqModel} returned an empty reply`);
  } catch (err) {
    fail(`chat with ${config.groqModel}: ${err.message}`);
  }
}

await checkOpenAI();
await checkGroq();
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exitCode = failures ? 1 : 0;
