import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./env.js";

const port = Number(process.env.PORT) || 3000;

const TYPES = { ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".js": "text/javascript", ".svg": "image/svg+xml" };
const STATIC = new Set(["/index.html", "/me.jpg", "/app.js", "/intro.js", "/favicon.svg"]);

const vercel = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
const SECURITY = Object.fromEntries(vercel.headers.flatMap((rule) => rule.headers.map((h) => [h.key, h.value])));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  for (const [key, value] of Object.entries(SECURITY)) res.setHeader(key, value);
  try {
    const fn = url.pathname.match(/^\/api\/(chat|transcribe|speak)$/);
    if (fn) {
      const mod = await import(pathToFileURL(join(root, "api", `${fn[1]}.js`)).href);
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      headers.set("x-forwarded-for", req.socket.remoteAddress || "local");
      const response = await mod.POST(new Request(url, { method: "POST", headers, body: Buffer.concat(chunks) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    const path = url.pathname === "/" ? "/index.html" : posix.normalize(url.pathname);
    if (!STATIC.has(path)) {
      res.writeHead(404).end("Not found");
      return;
    }
    const body = await readFile(join(root, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch (err) {
    console.error(err);
    res.writeHead(500).end("Server error");
  }
}).listen(port, () => {
  console.log(`Voice bot running at http://localhost:${port}`);
  if (!process.env.GROQ_API_KEY || !process.env.OPENAI_API_KEY) console.log("Some keys are missing. Copy .env.example to .env.local and fill it in.");
});
