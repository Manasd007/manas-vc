// Everything the page does: recording with silence detection, asking the
// server, playing the answer in Manas's voice with a live caption, and the
// ring around his photo that moves with the voice.

import { runIntro } from "./intro.js";

const SILENCE_MS = 1200;      // stop after this much quiet once speech was heard
const NO_SPEECH_MS = 8000;    // give up if nothing is said at all
const MAX_RECORD_MS = 30000;  // hard stop
const HISTORY_TURNS = 6;
const REQUEST_TIMEOUT_MS = 40000;

const MSG = {
  blocked: "Your browser blocked the mic. You can type your question instead.",
  noMic: "No microphone found. You can type your question instead.",
  noRecorder: "This browser can't record audio. You can type your question instead.",
  missed: "Didn't catch that, try again.",
  slow: "That took too long. Try again.",
  offline: "Couldn't reach the server. Check your connection and try again.",
  generic: "Something went wrong. Try again.",
};

// What the talk button says, and the status line next to the name.
const STATUS = {
  idle: "Talk",
  listening: "Done? Tap to send",
  thinking: '<span class="dots">Thinking</span>',
  speaking: "Ask another",
};
const LIVE = {
  idle: "Ready when you are",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};
const $ = (id) => document.getElementById(id);
const talkBtn = $("talk"), liveEl = $("live"), callEl = document.querySelector(".call");
const stopBtn = $("stop"), statusEl = $("status"), errorEl = $("error");
const panelEl = $("panel"), captionEl = $("caption"), askedEl = $("asked"), saidEl = $("said");
const logEl = $("log"), entriesEl = $("entries"), form = $("ask"), input = $("question");

let state = "idle";
let history = [];
let turn = 0;              // bumps on every new question so stale replies are ignored
let rec = null;            // the active recording, if any
let audioCtx = null;
let micLevel = 0;          // 0..1 while listening
let outLevel = 0;          // 0..1 while speaking
let ttsAvailable = true;   // false once the server says there's no OpenAI voice
let current = null;        // the answer on screen; it moves to the log when the next one starts
const introEl = $("intro");
let introOpen = Boolean(introEl);   // Space and Esc wait until the intro is gone

// Answers come back in the language of the question. Hindi ones are written in
// Devanagari, which is how the backup voice knows which language to speak.
const langOf = (text) => (/[\u0900-\u097F]/.test(text) ? "hi" : "en");

// New content eases in: a short fade and rise. Skipped for reduced motion.
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function enter(el, { y = 8, scale = 1, dur = 450 } = {}) {
  if (reduceMotion) return;
  el.animate(
    [{ opacity: 0, transform: `translateY(${y}px) scale(${scale})` }, { opacity: 1, transform: "none" }],
    { duration: dur, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
}

// The photo ring and the mic halo only move with a voice: the mic while
// listening, the reply while speaking. Eased so they swell and settle instead
// of jittering, and the loop sleeps once nothing is talking.
let shownLevel = 0;
let ringAwake = false;
function ringLevel() {
  const active = state === "listening" || state === "speaking";
  const target = state === "listening" ? micLevel : state === "speaking" ? outLevel : 0;
  shownLevel += (target - shownLevel) * 0.18;
  if (!active && shownLevel < 0.002) {
    shownLevel = 0;
    ringAwake = false;
  } else {
    requestAnimationFrame(ringLevel);
  }
  callEl.style.setProperty("--level", shownLevel.toFixed(3));
}
function wakeRing() {
  if (ringAwake) return;
  ringAwake = true;
  requestAnimationFrame(ringLevel);
}

function setState(next) {
  const changed = next !== state;
  const stopWasHidden = stopBtn.hidden;
  state = next;
  document.body.dataset.state = next;
  statusEl.innerHTML = STATUS[next];
  liveEl.textContent = LIVE[next];
  talkBtn.setAttribute("aria-label", next === "listening" ? "Stop recording and send" : "Start talking");
  stopBtn.hidden = !(next === "thinking" || next === "speaking");
  if (changed) enter(statusEl, { y: 3, dur: 250 });
  if (stopWasHidden && !stopBtn.hidden) enter(stopBtn, { y: 0, scale: 0.94, dur: 300 });
  if (next === "listening" || next === "speaking") wakeRing();
}

const showError = (text) => { errorEl.textContent = text; enter(errorEl, { y: 4, dur: 300 }); };
const clearError = () => { errorEl.textContent = ""; };

// The caption shows the answer word by word as it's spoken.
let captionWords = [];
function showQuestion(question) {
  captionEl.hidden = false;
  askedEl.textContent = question;
  saidEl.textContent = "";
  saidEl.classList.remove("done");
  captionWords = [];
  panelEl.scrollTop = 0;
  enter(askedEl);
}
function showAnswer(text) {
  saidEl.textContent = "";
  saidEl.classList.remove("done");
  const words = text.split(/\s+/).filter(Boolean);
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  let at = 0;
  captionWords = words.map((word, i) => {
    const span = document.createElement("span");
    span.textContent = word;
    saidEl.append(span, i < words.length - 1 ? " " : "");
    at += word.length + 1;
    return { span, until: at / total };
  });
  enter(saidEl, { y: 4, dur: 400 });
}
function setCaptionProgress(fraction) {
  let last = null;
  for (const w of captionWords) {
    const on = w.until <= fraction + 0.02;
    w.span.classList.toggle("on", on);
    if (on) last = w.span;
  }
  // Long answers: keep the spoken part in view inside the panel.
  if (last && last.offsetTop - panelEl.scrollTop > panelEl.clientHeight * 0.7) {
    panelEl.scrollTo({ top: last.offsetTop - panelEl.clientHeight * 0.35, behavior: "smooth" });
  }
}
const finishCaption = () => saidEl.classList.add("done");

function archiveCurrent() {
  if (current) addEntry(current);
  current = null;
}

function addEntry({ question, reply, spoken, spokenSig }) {
  logEl.hidden = false;
  const el = document.createElement("article");
  el.className = "entry";
  const q = document.createElement("p");
  q.className = "q";
  q.textContent = question;
  const a = document.createElement("p");
  a.className = "a";
  a.textContent = reply;
  const replay = document.createElement("button");
  replay.type = "button";
  replay.className = "replay";
  replay.textContent = "Play again";
  replay.addEventListener("click", () => {
    unlockAudio();
    cancelRecording();
    archiveCurrent();
    const mine = ++turn;
    clearError();
    showQuestion(question);
    showAnswer(reply);
    setState("speaking");
    say(spoken, spokenSig, mine).then(() => { if (mine === turn) { finishCaption(); setState("idle"); } });
  });
  el.append(q, a, replay);
  entriesEl.prepend(el);
  enter(el);
}

const player = new Audio();
player.setAttribute("playsinline", "");
player.preload = "auto";
let audioUnlocked = false;
let outAnalyser = null;
let outBuffer = null;
let stopPlayback = null;   // ends the current say() call

function ensureAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx && !audioCtx) audioCtx = new Ctx();
  audioCtx?.resume?.();
}

// A tiny silent WAV, played inside the first tap so iPhones allow audio later.
function silentWav() {
  const rate = 8000, samples = 400, buf = new ArrayBuffer(44 + samples * 2), v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); str(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

function unlockAudio() {
  ensureAudioContext();
  if (audioUnlocked) return;
  audioUnlocked = true;
  player.src = silentWav();
  player.play().catch(() => {});
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  }
}

// Route the player through an analyser so the ring moves with the voice. Only
// once the audio context is running, otherwise Safari would play silence.
function connectOutputAnalyser() {
  if (outAnalyser || !audioCtx || audioCtx.state !== "running") return;
  try {
    const source = audioCtx.createMediaElementSource(player);
    outAnalyser = audioCtx.createAnalyser();
    outAnalyser.fftSize = 512;
    outBuffer = new Float32Array(outAnalyser.fftSize);
    source.connect(outAnalyser);
    outAnalyser.connect(audioCtx.destination);
  } catch {
    outAnalyser = null;
  }
}

function rmsOf(analyser, buffer) {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const s of buffer) sum += s * s;
  return Math.sqrt(sum / buffer.length);
}

// Splits on sentence ends, including the Hindi full stop.
const sentencesOf = (text) => text.replace(/([.!?।])\s+/g, "$1\u0000").split("\u0000").map((s) => s.trim()).filter(Boolean);

// First sentence on its own so the voice starts fast; the rest in chunks the
// server accepts. All chunks are requested at once and played in order.
function chunkForSpeech(text) {
  const chunks = [];
  let chunk = "";
  for (const sentence of sentencesOf(text)) {
    const firstReady = chunks.length === 0 && chunk.length >= 40;
    if (chunk && (firstReady || (chunk + " " + sentence).length > 600)) {
      chunks.push(chunk);
      chunk = sentence;
    } else {
      chunk = chunk ? `${chunk} ${sentence}` : sentence;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

// The server only voices its own replies, so each chunk goes with the whole
// reply and the signature the chat endpoint gave it.
async function fetchVoice(text, spoken, sig) {
  if (!ttsAvailable) return null;
  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, spoken, sig }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 503) ttsAvailable = false;
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

function playChunk(url, onProgress) {
  return new Promise((resolve) => {
    let raf = 0;
    const end = () => {
      cancelAnimationFrame(raf);
      player.onended = player.onerror = null;
      outLevel = 0;
      stopPlayback = null;
      URL.revokeObjectURL(url);
      resolve();
    };
    stopPlayback = () => { player.pause(); end(); };
    player.onended = end;
    player.onerror = end;
    player.src = url;
    connectOutputAnalyser();
    player.play().catch(end);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (player.duration > 0) onProgress(Math.min(1, player.currentTime / player.duration));
      if (outAnalyser) {
        outLevel = Math.min(1, rmsOf(outAnalyser, outBuffer) * 5);
      } else {
        // No analyser (Safari before the context runs): a gentle fake pulse.
        const t = performance.now() / 1000;
        outLevel = player.paused ? 0 : 0.35 + 0.25 * Math.sin(t * 9) * Math.sin(t * 3.7) + 0.1 * Math.random();
      }
    };
    tick();
  });
}

// The browser's own voice, used when the OpenAI voice isn't available. One
// for English and one for Hindi, preferring Indian male voices.
const browserVoices = { en: null, hi: null };
function pickBrowserVoices() {
  if (!("speechSynthesis" in window)) return;
  const voices = speechSynthesis.getVoices();
  const male = /\b(male|rishi|ravi|prabhat|hemant|madhur|daniel|arthur|oliver|aaron|alex|david|guy|mark)\b/i;
  const best = (codes, fallback) => {
    for (const code of codes) {
      const matches = voices.filter((v) => v.lang.replace("_", "-").toLowerCase() === code);
      if (matches.length) return matches.find((v) => male.test(v.name) && !/female/i.test(v.name)) || matches[0];
    }
    return voices.find((v) => fallback.test(v.lang)) || null;
  };
  browserVoices.en = best(["en-in", "en-gb", "en-us"], /^en/i);
  browserVoices.hi = best(["hi-in"], /^hi/i);
}
if ("speechSynthesis" in window) {
  pickBrowserVoices();
  speechSynthesis.addEventListener?.("voiceschanged", pickBrowserVoices);
}

function browserSay(text, onProgress) {
  const lang = langOf(text);
  if (!("speechSynthesis" in window)) return Promise.resolve();
  return new Promise((resolve) => {
    const sentences = chunkForSpeech(text).flatMap(sentencesOf);
    const total = text.length;
    let spokenBefore = 0;
    let quietSince = 0;
    let pulse = 0;
    const done = () => {
      clearInterval(poll);
      cancelAnimationFrame(pulse);
      outLevel = 0;
      stopPlayback = null;
      resolve();
    };
    stopPlayback = () => { speechSynthesis.cancel(); done(); };
    if (speechSynthesis.paused) speechSynthesis.resume();
    sentences.forEach((sentence, i) => {
      const u = new SpeechSynthesisUtterance(sentence);
      const voice = browserVoices[lang];
      if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = lang === "hi" ? "hi-IN" : "en-IN"; }
      const offset = spokenBefore;
      u.onboundary = (e) => onProgress((offset + (e.charIndex || 0)) / total);
      u.onend = () => { onProgress((offset + sentence.length + 1) / total); if (i === sentences.length - 1) done(); };
      spokenBefore += sentence.length + 1;
      speechSynthesis.speak(u);
    });
    const animate = () => {
      const t = performance.now() / 1000;
      outLevel = speechSynthesis.speaking ? 0.3 + 0.25 * Math.abs(Math.sin(t * 8) * Math.sin(t * 2.9)) : 0;
      pulse = requestAnimationFrame(animate);
    };
    animate();
    // Safety net for browsers that never fire onend.
    const poll = setInterval(() => {
      if (speechSynthesis.speaking || speechSynthesis.pending) { quietSince = 0; return; }
      quietSince = quietSince || Date.now();
      if (Date.now() - quietSince > 1500) done();
    }, 250);
  });
}

function stopSpeaking() {
  if (stopPlayback) stopPlayback();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

// Speaks a reply, OpenAI voice first and the browser voice as a backup.
async function say(spoken, sig, mine) {
  stopSpeaking();
  const chunks = chunkForSpeech(spoken);
  const total = chunks.reduce((n, c) => n + c.length, 0) || 1;
  const pending = chunks.map((chunk) => fetchVoice(chunk, spoken, sig));
  let before = 0;
  for (let i = 0; i < chunks.length; i++) {
    const url = await pending[i];
    if (mine !== turn) {
      pending.slice(i).forEach((p) => p.then((u) => u && URL.revokeObjectURL(u)));
      return;
    }
    if (!url) {
      const rest = chunks.slice(i).join(" ");
      const startAt = before;
      await browserSay(rest, (f) => setCaptionProgress((startAt + f * rest.length) / total));
      return;
    }
    const startAt = before;
    await playChunk(url, (f) => setCaptionProgress((startAt + f * chunks[i].length) / total));
    if (mine !== turn) return;
    before += chunks[i].length;
  }
}

async function api(path, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(path, { ...options, signal: controller.signal });
  } catch (err) {
    throw new Error(err.name === "AbortError" ? MSG.slow : MSG.offline);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || MSG.generic);
  return data;
}

async function ask(question) {
  const mine = ++turn;
  clearError();
  stopSpeaking();
  archiveCurrent();
  showQuestion(question);
  setState("thinking");
  try {
    const { reply, spoken, replySig, spokenSig } = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question, history }),
    });
    if (mine !== turn) return;
    history = [...history, { role: "user", content: question }, { role: "assistant", content: reply, sig: replySig }].slice(-HISTORY_TURNS);
    showAnswer(reply);
    current = { question, reply, spoken, spokenSig };
    setState("speaking");
    await say(spoken, spokenSig, mine);
    if (mine === turn) { finishCaption(); setState("idle"); }
  } catch (err) {
    if (mine !== turn) return;
    captionEl.hidden = true;
    showError(err.message);
    setState("idle");
  }
}

async function transcribeAndAsk(blob) {
  const mine = ++turn;
  setState("thinking");
  try {
    const { text } = await api("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob,
    });
    if (mine !== turn) return;
    if (!text) { showError(MSG.missed); setState("idle"); return; }
    await ask(text);
  } catch (err) {
    if (mine !== turn) return;
    showError(err.message);
    setState("idle");
  }
}

function pickMimeType() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

async function startListening() {
  clearError();
  stopSpeaking();
  turn++;
  unlockAudio();

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showError(MSG.noRecorder);
    setState("idle");
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    const name = err && err.name;
    showError(name === "NotAllowedError" || name === "SecurityError" ? MSG.blocked
      : name === "NotFoundError" || name === "OverconstrainedError" ? MSG.noMic
      : MSG.generic);
    setState("idle");
    return;
  }

  const mimeType = pickMimeType();
  let recorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    showError(MSG.noRecorder);
    setState("idle");
    return;
  }

  const session = {
    stream, recorder, chunks: [], reason: null,
    startedAt: performance.now(), heardSpeech: false, quietSince: 0,
    noiseFloor: 0, samples: 0, loudFrames: 0, level: 0,
  };
  rec = session;

  recorder.ondataavailable = (e) => { if (e.data && e.data.size) session.chunks.push(e.data); };
  recorder.onstop = () => onRecordingStopped(session);

  if (audioCtx) {
    session.source = audioCtx.createMediaStreamSource(stream);
    session.analyser = audioCtx.createAnalyser();
    session.analyser.fftSize = 1024;
    session.source.connect(session.analyser);
    session.buffer = new Float32Array(session.analyser.fftSize);
  }

  recorder.start(250);
  setState("listening");
  session.timer = setInterval(() => watchLevels(session), 50);
}

// Silence detection: learn the room's noise level for the first 300 ms, only
// start the silence timer after real speech, then stop after SILENCE_MS of quiet.
function watchLevels(session) {
  const elapsed = performance.now() - session.startedAt;
  if (elapsed >= MAX_RECORD_MS) return finishListening(session, "limit");
  if (!session.analyser) return; // no Web Audio: only the tap or the hard stop ends it

  const rms = rmsOf(session.analyser, session.buffer);
  session.level = session.level * 0.6 + rms * 0.4;
  micLevel = Math.min(1, session.level * 12);

  if (elapsed < 300) {
    session.samples++;
    session.noiseFloor += (rms - session.noiseFloor) / session.samples;
    return;
  }

  const speechLevel = Math.max(0.015, session.noiseFloor * 2.5);
  const loud = session.level > speechLevel;
  const quiet = session.level < speechLevel * 0.7;

  if (!session.heardSpeech) {
    session.loudFrames = loud ? session.loudFrames + 1 : 0;
    if (session.loudFrames >= 3) session.heardSpeech = true; // ~150 ms of speech
    else if (elapsed > NO_SPEECH_MS) finishListening(session, "nothing");
    return;
  }

  if (quiet) {
    session.quietSince = session.quietSince || performance.now();
    if (performance.now() - session.quietSince >= SILENCE_MS) finishListening(session, "silence");
  } else if (loud) {
    session.quietSince = 0;
  }
}

function finishListening(session, reason) {
  if (session.reason) return;
  session.reason = reason;
  clearInterval(session.timer);
  micLevel = 0;
  if (session.recorder.state !== "inactive") session.recorder.stop();
  else onRecordingStopped(session);
}

function releaseMic(session) {
  session.stream.getTracks().forEach((t) => t.stop());
  try { session.source?.disconnect(); } catch {}
  if (rec === session) rec = null;
}

function onRecordingStopped(session) {
  releaseMic(session);
  if (session.reason === "cancel") return;
  if (session.reason === "nothing") {
    showError(MSG.missed);
    setState("idle");
    return;
  }
  const blob = new Blob(session.chunks, { type: session.recorder.mimeType || pickMimeType() || "audio/webm" });
  if (blob.size < 1000) {
    showError(MSG.missed);
    setState("idle");
    return;
  }
  transcribeAndAsk(blob);
}

function cancelRecording() {
  if (rec) finishListening(rec, "cancel");
}

function toggleMic() {
  if (state === "listening" && rec) finishListening(rec, "manual");
  else startListening();
}

function stopEverything() {
  turn++;
  cancelRecording();
  stopSpeaking();
  finishCaption();
  setState("idle");
}

talkBtn.addEventListener("click", toggleMic);
stopBtn.addEventListener("click", stopEverything);

$("samples").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  unlockAudio();
  cancelRecording();
  ask(btn.querySelector(".q").textContent.trim());
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const question = input.value.trim();
  if (!question) return;
  unlockAudio();
  cancelRecording();
  input.value = "";
  input.blur();
  ask(question);
});

// Space to talk, Escape to stop (not while typing or during the intro).
document.addEventListener("keydown", (e) => {
  if (introOpen || e.target.closest?.("input, textarea")) return;
  if (e.code === "Space" && !e.repeat) {
    e.preventDefault();
    toggleMic();
  } else if (e.key === "Escape") {
    stopEverything();
  }
});

// The page sits behind the intro, inert, until "Start talking". That tap also
// counts as the gesture iPhones need before they'll play audio.
const pageEls = [document.querySelector("header"), document.querySelector("main")];
if (introEl) {
  pageEls.forEach((el) => { el.inert = true; });
  const fontsOrTimeout = Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 700))]);
  fontsOrTimeout.then(() => runIntro(introEl, {
    page: pageEls,
    onEnter: () => {
      unlockAudio();
      pageEls.forEach((el) => { el.inert = false; });
    },
    afterExit: () => { introOpen = false; },
  }));
}

setState("idle");
