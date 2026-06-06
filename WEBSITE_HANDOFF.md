# stekel-site — handoff for Claude Code

## What this is
An Apple-grade static recreation of **stekel.org**: a curated learning library — ~270 books, 38 museums, 22 languages, timelines, founding documents — organized by Dewey Decimal. The full catalog was built from stekel.org's live sitemap (388 pages); each book's author/cover/Dewey class resolved from Open Library at build time. **353 pages of original page text are mirrored verbatim** and open in an in-app reader.

## Architecture (no framework, no build step to run)
A multi-page static site driven by a tiny client-side hash router (`#/item/<slug>`). Browser back + shareable deep links work. To run:
```
cd stekel-site
python3 -m http.server 8000   # → http://localhost:8000
# (or just: open index.html — works on file://, server avoids minor quirks)
```

## File inventory
**The site itself (these four are the whole runtime):**
| File | Role | Size |
|---|---|---|
| `index.html` | page shell / mount point | ~5 KB |
| `styles.css` | design system (warm-paper palette, serif display + system sans, dark mode, responsive) | ~58 KB |
| `app.js` | renders content; wires router, ⌘K full-text search, filtering, scrollspy, favorites, theme | ~58 KB |
| `data.js` | catalog metadata — titles, authors, Dewey classes, COVERS/KEYS/DESCRIPTIONS maps | ~80 KB |

**Data layer (large — NOT in the code bundle; see "Heavy data" below):**
| File | Role | Size |
|---|---|---|
| `content.js` | full mirrored page text for 353 items | ~9.8 MB |
| `assets/` | real cover images + screenshots | ~43 MB |
| `manifest.webmanifest`, `sw.js` | PWA manifest + service worker | small |

**Dev tooling (optional, regenerates the data layer — included in bundle):**
`crawl.mjs` (pull stekel.org sitemap) → `build-data.mjs` (assemble catalog) → `resolve-covers.mjs` / `resolve-desc.mjs` / `resolve-all.mjs` (Open Library enrichment) → `shoot.mjs` (Playwright screenshots). Plus `server.mjs`, `package.json`, and build-output JSON (`buckets.json`, `catalog-raw.json`, `covers.json`, `desc.json`, `slugs.txt`). `node_modules/` is regenerable via `npm install` — not included.

## Heavy data (content.js + assets/) — how to get it
The 52 MB of mirrored text + covers was too large to attach over the bridge. Two ways to restore it:
1. **From the Mac-mini workspace:** the complete build (incl. `content.js` + `assets/`) lives at `~/.openclaw/workspace/stekel-site/` and is committed to the workspace git repo — pull it directly there.
2. **Regenerate from scratch:** run the dev pipeline (`node crawl.mjs` → `node build-data.mjs` → `node resolve-all.mjs`) against stekel.org's sitemap + Open Library; it rebuilds `data.js` / `content.js` / covers. (Requires `npm install` first.)

The code bundle alone (this zip) renders the **full UI and layout**; item full-text + real covers light up once `content.js` + `assets/` are alongside it.

## Current state (done)
Feature-complete per the README: ⌘K command palette searching titles/authors **and** the full text of all 353 pages; every item opens as its own linkable page (cover, description streaming live from Open Library, Dewey class, prev/next within class); sections (Timelines, Languages, Documents, Study, Voices) as pages; favorites (`#/saved`), recently-viewed, "more in this shelf," surprise-me, light/dark/system theme, reading-time, responsive w/ slide-in menu, scroll reveals (respects `prefers-reduced-motion`).

## How to extend
Add an item to the right Dewey class's `items` array in `data.js`:
```js
{ t: "Title", a: "Author", k: "book" }   // k: "book" | "museum" | "guide"
```
Cover/description: add to the `COVERS` / `KEYS` / `DESCRIPTIONS` maps at the bottom of `data.js` (keyed by title). Auto-classification may put a few long-tail titles in a neighbouring class — just move the entry.

## Suggested next steps (open ideas)
- The earlier ⌘K topic-overview / AI-synthesis cross-reference feature (per git history) — re-confirm it's wired in `app.js`.
- Any polish on the reader view / mobile menu.
- (Whatever you're handing CC to do — drop the ask and the structure above is the map.)
