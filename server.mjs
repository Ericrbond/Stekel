/* stekel — static file server + on-demand AI synthesis via the Anthropic API.
   Serves the site AND exposes POST /api/overview, which turns the library's own
   passages about a topic into one synthesized, cited narrative. Results cache to
   ./cache so repeats are instant and survive offline.

   Auth: set ANTHROPIC_API_KEY (in a gitignored .env file alongside this server,
   or in the environment). Works everywhere — no `claude` CLI dependency.

   Run:  node server.mjs           (defaults to 127.0.0.1:8765)
*/
import http from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const CACHE_DIR = join(ROOT, "cache");

// Load .env (simple KEY=VALUE lines) without a dependency, then fall back to process.env.
function loadEnv() {
  const out = {};
  const p = join(ROOT, ".env");
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}
const ENV = { ...loadEnv(), ...process.env };

const PORT = Number(ENV.STEKEL_PORT || 8765);
const HOST = ENV.STEKEL_HOST || "127.0.0.1";
const MODEL = ENV.STEKEL_MODEL || "claude-sonnet-4-5"; // full API model id (override via STEKEL_MODEL)
const API_KEY = ENV.ANTHROPIC_API_KEY || "";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

await mkdir(CACHE_DIR, { recursive: true }).catch(() => {});

const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const cachePath = (term) => join(CACHE_DIR, hash(term.trim().toLowerCase()) + ".json");

function buildPrompt(term, sources) {
  const corpus = sources.map((s) =>
    `[[${s.n}]] "${s.title}"${s.author ? " by " + s.author : ""} (${s.kind}):\n` +
    s.passages.map((p) => "  - " + p).join("\n")
  ).join("\n\n");
  return `You are a librarian-historian writing a synthesized overview of ONE topic for a digital library.
Compose a flowing, logically-ordered narrative — an essay, not a list — using ONLY the facts contained in the source passages below.
Order it by meaning, not by source: open with what the topic is / where it begins, move through its development, and close on its significance — adapt the arc to the material.
After every claim, cite the source it came from with a marker like [[1]], or [[2]][[5]] when a sentence draws on several. Use the source NUMBERS exactly as given below.
Never state a fact that isn't supported by the passages. Do not add headings, titles, a preamble, or a conclusion label.
Keep it tight and readable: 3 to 6 short paragraphs. Separate paragraphs with a blank line.
Output ONLY the narrative prose with inline [[n]] markers.

TOPIC: ${term}

SOURCES:
${corpus}`;
}

async function runClaude(prompt) {
  if (!API_KEY) throw new Error("ANTHROPIC_API_KEY not set (add it to .env)");
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json())?.error?.message || ""; } catch {}
      throw new Error(`Anthropic API ${r.status}${detail ? ": " + detail : ""}`);
    }
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!text) throw new Error("empty response from model");
    return text;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("synthesis timed out");
    throw e;
  } finally {
    clearTimeout(killer);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ""; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > 2_000_000) { reject(new Error("body too large")); req.destroy(); } b += c; });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };

async function handleOverview(req, res) {
  const url = new URL(req.url, "http://x");
  // GET ?q=&peek=1 → return cache only (offline-friendly)
  if (req.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return json(res, 400, { ok: false, error: "missing q" });
    const cp = cachePath(q);
    if (existsSync(cp)) { const data = JSON.parse(await readFile(cp, "utf8")); return json(res, 200, { ...data, cached: true }); }
    return json(res, 204, { ok: false, cached: false });
  }
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method" });
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch { return json(res, 400, { ok: false, error: "bad json" }); }
  const term = String(payload.term || "").trim();
  const sources = Array.isArray(payload.sources) ? payload.sources.slice(0, 16) : [];
  if (!term || !sources.length) return json(res, 400, { ok: false, error: "term + sources required" });

  const cp = cachePath(term);
  if (!payload.fresh && existsSync(cp)) {
    const data = JSON.parse(await readFile(cp, "utf8"));
    return json(res, 200, { ...data, cached: true });
  }
  try {
    const narrative = await runClaude(buildPrompt(term, sources));
    const data = { ok: true, term, narrative, model: MODEL, at: new Date().toISOString() };
    await writeFile(cp, JSON.stringify(data), "utf8").catch(() => {});
    json(res, 200, { ...data, cached: false });
  } catch (e) {
    json(res, 502, { ok: false, error: String(e.message || e) });
  }
}

async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") path = "/index.html";
  const full = normalize(join(ROOT, path));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  if (!existsSync(full)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
  try {
    const body = await readFile(full);
    const type = MIME[extname(full).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(body);
  } catch { res.writeHead(500); res.end("error"); }
}

http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/overview")) return await handleOverview(req, res);
    if (req.url.startsWith("/api/")) return json(res, 404, { ok: false, error: "no such api" });
    return await serveStatic(req, res);
  } catch (e) {
    json(res, 500, { ok: false, error: String(e.message || e) });
  }
}).listen(PORT, HOST, async () => {
  let cached = 0; try { cached = (await readdir(CACHE_DIR)).filter((f) => f.endsWith(".json")).length; } catch {}
  console.log(`stekel server on http://${HOST}:${PORT}  · model ${MODEL} · ${cached} cached overviews`);
});
