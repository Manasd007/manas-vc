# manas-vc

A voice bot that answers interview questions the way I would. Tap Talk, ask a question, and it answers out loud in English or Hindi. You can also type, or pick a sample question.

## How it works

1. The browser records the question and stops after a short silence.
2. `api/transcribe.js` turns it into text (OpenAI `gpt-transcribe`, Whisper on Groq as backup).
3. `api/chat.js` writes the answer from my persona in `api/persona.js` (OpenAI `gpt-4.1`, gpt-oss on Groq as backup).
4. `api/speak.js` reads it out (OpenAI `gpt-4o-mini-tts`). The browser's voice is the fallback.

Plain HTML, CSS and JS with Vercel functions in `api/`. No framework, no build step. The keys stay on the server.

## Run locally

Needs Node 20+. Copy `.env.example` to `.env.local` and add your OpenAI and Groq keys.

```bash
npm run dev
```

Open http://localhost:3000. Run the tests with `npm test`.

## Deploy

Import the repo into Vercel (framework preset: Other, no build command) and add `OPENAI_API_KEY` and `GROQ_API_KEY` as environment variables.

To change the answers, edit `api/persona.js` and redeploy.
