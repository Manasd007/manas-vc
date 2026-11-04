export const config = {
  get openaiKey() { return process.env.OPENAI_API_KEY || ""; },
  get groqKey() { return process.env.GROQ_API_KEY || ""; },

  get openaiModel() { return process.env.OPENAI_MODEL || "gpt-4.1"; },
  get groqModel() { return process.env.GROQ_MODEL || "openai/gpt-oss-120b"; },
  get groqFallbackModel() { return process.env.GROQ_FALLBACK_MODEL || "openai/gpt-oss-20b"; },

  get sttModel() { return process.env.OPENAI_STT_MODEL || "gpt-transcribe"; },
  get groqSttModel() { return process.env.GROQ_STT_MODEL || "whisper-large-v3"; },

  get ttsModel() { return process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts"; },
  get voice() { return process.env.OPENAI_VOICE || "verse"; },
};

export const VOICE_STYLE =
  "A young Indian software engineer in his late twenties on a relaxed video call with an interviewer. " +
  "Youthful, bright and energetic. Light, clear voice, never deep, gravelly, husky or tired. " +
  "Natural modern Indian English accent, like a young tech professional in Delhi or Bangalore, not exaggerated. " +
  "Upbeat and quick conversational pace, crisp words, nothing drawn out, no slow or heavy delivery. " +
  "Friendly and confident with a slight smile. No announcer, narrator or news reader tone. " +
  "Sound like he's thinking while he talks: a real pause on fillers like hmm, so, I mean, or you know, " +
  "a little lift on a self-correction, and natural breaths between sentences.";

export const VOICE_STYLE_HI =
  "A young Indian software engineer from Delhi in his late twenties on a relaxed video call, speaking everyday Hindi " +
  "mixed with English the way people in Delhi tech actually talk. English words like project, latency or pipeline " +
  "are said with a natural Indian English accent, not Hindi-ised. Youthful, bright and energetic. Light, clear voice, " +
  "never deep, gravelly or tired. Quick, warm and conversational, with real pauses on fillers like hmm, matlab, " +
  "dekhiye or actually. Never formal, never like a news reader.";
