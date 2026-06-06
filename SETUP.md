# stekel-site — setup on a new machine

## What this is
Apple-grade recreation of stekel.org — Eric's curated Dewey Decimal learning library.
~270 books, 38 museums, 22 languages, timelines, founding documents.
Features: ⌘K full-text search, bookcase shelf, AI cross-reference synthesis, PWA.

## Prerequisites
- Node.js (any recent version)
- The `assets/stekel/` image folder (1.4GB, transferred separately via AirDrop)
- An `ANTHROPIC_API_KEY` in a `.env` file (for the AI synthesis feature)

## First-time setup

```bash
# 1. Install dependencies
npm install

# 2. Create .env with your API key
echo "ANTHROPIC_API_KEY=your_key_here" > .env

# 3. Drop the assets/stekel/ folder here (came via AirDrop)
#    Final structure: stekel-site/assets/stekel/  (3,418 image files, 1.4GB)

# 4. Start the server
STEKEL_PORT=8765 node server.mjs
# → open http://localhost:8765
```

## File roles

| File | Role |
|---|---|
| `index.html` | Page shell, all routes |
| `styles.css` | Design system (warm-paper, dark mode, responsive) |
| `app.js` | Router, ⌘K search, galleries, AI synthesis client |
| `data.js` | Catalog: DEWEY classes, COVERS (with local: paths), PAGE_IMAGES map |
| `content.js` | Mirrored page text for 353 pages, with inline figure injections |
| `sw.js` | Service worker (network-first, offline fallback) |
| `server.mjs` | Static server + POST /api/overview (AI synthesis via Anthropic API) |
| `assets/stekel/` | 3,418 real images from stekel.org (covers, maps, diagrams, portraits) |
| `assets/og-image.png` | Share card for link previews |
| `manifest.webmanifest` | PWA manifest |
| `.env` | `ANTHROPIC_API_KEY=...` — never committed |

## Deploying to Vercel

Vercel hosts the static site. The AI synthesis (`/api/overview`) needs a server,
so deploy `server.mjs` as a Vercel serverless function OR keep the Node server
running separately and point the frontend at it.

**Simplest Vercel static deploy (no AI synthesis):**
```bash
# The site works fully without the AI feature (graceful fallback)
# Just deploy the static files — Vercel picks up index.html automatically
vercel --prod
```

**With AI synthesis (serverless):**
- Add `ANTHROPIC_API_KEY` as a Vercel environment variable
- The `/api/overview` POST endpoint needs to be extracted into `api/overview.js`
  (Vercel serverless function format) — see server.mjs for the logic

**assets/stekel/ on Vercel:**
GitHub can't hold 1.4GB. Options:
1. Use Vercel's large file support or a CDN (Cloudflare R2, S3) and update the
   `assets/stekel/` base path in `data.js` and `app.js`
2. For now: keep running `node server.mjs` locally and access via local URL

## Pushing to GitHub

```bash
git init
git add .          # .gitignore excludes: .env, node_modules/, cache/, _harvest/, assets/stekel/
git commit -m "stekel-site: full rebuild with Eric's images"
git remote add origin https://github.com/your-username/stekel-site.git
git push -u origin main
```

## The image problem on GitHub/Vercel

`assets/stekel/` is 1.4GB / 3,418 files — over GitHub's limits.
Three paths:
1. **Git LFS** — `git lfs track "assets/stekel/**"` then push (needs LFS quota)
2. **External CDN** — upload to Cloudflare R2 or S3, swap the `assets/stekel/` prefix
3. **Self-host** — keep `node server.mjs` on a machine that has the files; Vercel
   hosts the static shell, server hosts the images

For now the fastest path: AirDrop `assets/stekel/` to the target machine,
run `node server.mjs` there, access at http://localhost:8765.
