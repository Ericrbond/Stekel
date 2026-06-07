# stekel.org — Claude Code Instructions

## Project Overview
Stekel is a curated Dewey Decimal learning library hosted as a pure static SPA (no framework, no build step) on Vercel, deployed automatically from GitHub on every push to `main`.

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS — no React, no bundler, no TypeScript
- **Hosting:** Vercel (static) + GitHub auto-deploy (`git push origin main` = live in ~30s)
- **Serverless:** `api/overview.js` — CommonJS (`require`/`module.exports`), NOT ES modules
- **AI:** Anthropic Claude (`claude-sonnet-4-6`) via `/api/overview` for synthesis
- **Node:** v24.16.0 via NVM (`source ~/.nvm/nvm.sh` before using node/npm)
- **Images:** Book covers in `assets/covers/` (git-tracked, 182 files). Page images in `assets/stekel/` (NOT committed — 1.4GB, CDN pending)

## Project Layout
```
/Users/eric/Desktop/Stekel/
├── index.html          # Static shell — nav, footer, palette, router target (#view)
├── app.js              # All routing, rendering, search, xref — single IIFE
├── styles.css          # Design system — CSS custom properties, dark mode
├── data.js             # DEWEY[], COVERS{}, DOCUMENTS[], TIMELINES[], LANGUAGES[], INTERVIEWS{}, RESEARCH[]
├── content.js          # CONTENT{} — 10MB, one key per slug, HTML string values
├── api/overview.js     # Vercel serverless function — POST for AI synthesis, GET for cache check
├── assets/covers/      # 182 book cover images (git-tracked)
├── assets/stekel/      # 3,418 page images (NOT in git — too large)
└── vercel.json         # Cache headers only — NO outputDirectory (that breaks serverless functions)
```

## Workflow — How to Ship Changes
```bash
# Edit files locally, then:
cd /Users/eric/Desktop/Stekel
git add <files>
git commit -m "description"
git push origin main        # Vercel auto-deploys in ~30 seconds
```
Live URL: **stekel-gamma.vercel.app**
GitHub: `git@github.com:Ericrbond/Stekel.git`

## Critical Rules

**Never add `outputDirectory` to vercel.json.** It was there before and broke the `/api/overview` serverless function by serving it as a static file.

**api/overview.js must use CommonJS** (`require`, `module.exports`). The repo has `"type": "commonjs"` in package.json. Never use `import`/`export default` there.

**content.js is 10MB and single-line.** Never use the Edit tool on it directly. Always use Python to append:
```python
with open('content.js', 'r') as f: c = f.read()
addition = ',\n"slug":"<html>"'
with open('content.js', 'w') as f: f.write(c.rstrip('\n')[:-2] + addition + '};\n')
```

**No smart/curly quotes in JS files.** Agents sometimes introduce `"` `"` `'` `'` — these crash the browser parser. After any agent edits app.js, run: `source ~/.nvm/nvm.sh && node --check app.js`

**CSS must use `var(--token)` for all colors.** Hardcoded hex values break dark mode. All colors are defined in `:root` in styles.css.

## Data Architecture

- `data.js` → `DEWEY[]` — array of Dewey classes, each with `items[]` (books, museums, guides)
- Each item needs: `t` (title), `a` (author), `y` (year), `p` (publisher), `k` (kind: book/museum/guide), `code` (Dewey), `slug`, `d` (description)
- `COVERS{}` — keyed by book title, value: `{ local: "filename.jpg", c: 12345 }` (Open Library ID)
- `content.js` → `CONTENT{}` — keyed by slug, value: HTML string
- Every slug in `data.js` needs a matching entry in `content.js` or users see a blank page
- Duplicate slugs in `data.js` cause routing bugs — always check before adding

## Known Issues / Active Work
- **24 slugs** in data.js have no content.js entry (users see blank pages) — being fixed
- **2 duplicate slugs:** `basics-real-estate` and `basics-stock-market-investing` — being fixed
- **Page images** (assets/stekel/) not on Vercel — CDN setup pending (Cloudflare R2)
- **DNS** — stekel.org still points to Squarespace; cutover to Vercel pending

## Code Conventions
- Router is hash-based: `#/`, `#/catalog`, `#/item/:slug`, `#/xref/:term`
- All views render into `<main id="view">` via `view.innerHTML = "..."` or `view.append(el)`
- All HTML output uses `esc()` helper — never interpolate raw user strings
- Images: `COVERS_BASE = "assets/covers/"` for book covers; `CDN_BASE = window.STEKEL_CDN || "assets/stekel/"` for page images
- Event delegation preferred over per-element listeners
- `revealIn(container)` triggers IntersectionObserver reveal animations after render

## Environment Variables (Vercel)
- `ANTHROPIC_API_KEY` — set in Vercel dashboard → Project → Settings → Environment Variables
- `STEKEL_MODEL` — optional override (defaults to `claude-sonnet-4-6`)
- `STEKEL_CDN` — optional R2 URL override set via `window.STEKEL_CDN` in index.html
