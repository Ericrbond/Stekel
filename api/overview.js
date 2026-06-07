/* Vercel serverless function — POST /api/overview
   Mirrors the logic of server.mjs's /api/overview handler.
   Pre-built cache entries are bundled at deploy time (read-only).
   New synthesis results are cached in-memory per instance.
*/
const { readFileSync, readdirSync, existsSync } = require("fs");
const { join } = require("path");
const { createHash } = require("crypto");
const fetch = globalThis.fetch || require("node-fetch");

const MODEL = process.env.STEKEL_MODEL || "claude-sonnet-4-6";
const API_KEY = process.env.ANTHROPIC_API_KEY || "";

// Load all pre-built cache files at cold-start (they live in /cache/*.json in the deployment)
const CACHE = new Map();
const CACHE_DIR = join(process.cwd(), "cache");
try {
  if (existsSync(CACHE_DIR)) {
    for (const file of readdirSync(CACHE_DIR).filter(f => f.endsWith(".json"))) {
      try {
        const data = JSON.parse(readFileSync(join(CACHE_DIR, file), "utf8"));
        if (data.ok && data.term) CACHE.set(data.term.trim().toLowerCase(), data);
      } catch {}
    }
  }
} catch {}

const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);

const RATE = new Map(); // ip -> {count, resetAt}
function checkRate(ip) {
  const now = Date.now();
  const r = RATE.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > r.resetAt) { r.count = 0; r.resetAt = now + 60000; }
  r.count++;
  RATE.set(ip, r);
  return r.count <= 10; // 10 synthesis requests per minute per IP
}

function buildPrompt(term, sources) {
  const corpus = sources.map(s =>
    `[[${s.n}]] "${s.title}"${s.author ? " by " + s.author : ""} (${s.kind}):\n` +
    s.passages.map(p => "  - " + p).join("\n")
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

async function callAnthropic(prompt) {
  if (!API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
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
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!text) throw new Error("empty response from model");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "POST") {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || "unknown";
    if (!checkRate(ip)) return res.status(429).json({ ok: false, error: "rate limited — try again in a minute" });
  }

  // GET ?q=term → check cache only
  if (req.method === "GET") {
    const q = (req.query?.q || "").trim();
    if (!q) return res.status(400).json({ ok: false, error: "missing q" });
    const cached = CACHE.get(q.toLowerCase());
    if (cached) return res.status(200).json({ ...cached, cached: true });
    return res.status(204).end();
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method not allowed" });

  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return res.status(400).json({ ok: false, error: "bad json" }); }
  }

  const term = String(payload?.term || "").trim();
  const sources = Array.isArray(payload?.sources) ? payload.sources.slice(0, 16) : [];
  if (!term || !sources.length) return res.status(400).json({ ok: false, error: "term + sources required" });

  if (!payload?.fresh) {
    const cached = CACHE.get(term.toLowerCase());
    if (cached) return res.status(200).json({ ...cached, cached: true });
  }

  try {
    const narrative = await callAnthropic(buildPrompt(term, sources));
    const result = { ok: true, term, narrative, model: MODEL, at: new Date().toISOString() };
    CACHE.set(term.toLowerCase(), result);
    return res.status(200).json({ ...result, cached: false });
  } catch (e) {
    if (e.name === "AbortError") return res.status(504).json({ ok: false, error: "synthesis timed out" });
    return res.status(502).json({ ok: false, error: String(e.message || e) });
  }
}
