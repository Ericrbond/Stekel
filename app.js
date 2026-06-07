/* ============================================================================
   stekel.org — a multi-page library (client-side router)
   Home is a hub; the catalog and every item open as their own page.
   ============================================================================ */
(function () {
  "use strict";
  // CDN base URL for all images — update this to your Cloudflare R2 public URL once set up
  const CDN_BASE = window.STEKEL_CDN || "assets/stekel/";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const accents = ["#B0613B", "#5A5C44", "#C99A4E", "#7A5C8F", "#3E7C8C", "#B0613B", "#9A6A4F", "#5A5C44", "#C99A4E", "#8F4A2B"];
  const kindLabel = { book: "Book", museum: "Museum", guide: "Guide", language: "Language", document: "Document", timeline: "Timeline", interview: "Interview" };
  const ICON = {
    museum: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M4 10h16M5 10l7-5 7 5M6 10v8M10 10v8M14 10v8M18 10v8"/></svg>`,
    guide: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>`,
    book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/></svg>`,
  };
  // Strip HTML to plain text WITHOUT building DOM — regex is orders of magnitude faster than
  // setting innerHTML, which matters when indexing all 353 pages (9.7MB) for ⌘K full-text search.
  const decodeEntities = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&[a-z]+;/gi, " ");
  const plainFromHTML = (html) => decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const readingTime = (html) => Math.max(1, Math.round(plainFromHTML(html).split(" ").filter(Boolean).length / 200)) + " min read";
  const content = (slug) => (typeof CONTENT !== "undefined" && slug && CONTENT[slug]) || null;

  let activeRafId = null; // ribbon drift loop — hoisted so route() can cancel it

  /* ---- favorites (localStorage) ---- */
  const SAVE_KEY = "stekel-saved";
  let saved = new Set();
  try { const _sv = JSON.parse(localStorage.getItem(SAVE_KEY) || "[]"); saved = new Set(Array.isArray(_sv) ? _sv : []); } catch (e) {}
  const isSaved = (slug) => saved.has(slug);
  function persistSaved() { try { localStorage.setItem(SAVE_KEY, JSON.stringify([...saved])); } catch (e) {} updateSavedNav(); }
  function toggleSave(slug) { if (!slug) return; saved.has(slug) ? saved.delete(slug) : saved.add(slug); persistSaved(); }
  const STAR_O = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m12 3.3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3L12 17.6 6.4 20.6l1.1-6.3L2.9 9.9l6.3-.9z"/></svg>`;
  const STAR_F = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"><path d="m12 3.3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3L12 17.6 6.4 20.6l1.1-6.3L2.9 9.9l6.3-.9z"/></svg>`;
  const starBtn = (slug, big) => `<button class="star${big ? " star-lg" : ""}${isSaved(slug) ? " on" : ""}" data-save="${esc(slug || "")}" aria-label="Save to favorites" aria-pressed="${isSaved(slug)}">${isSaved(slug) ? STAR_F : STAR_O}${big ? `<span class="star-lbl">${isSaved(slug) ? "Saved" : "Save"}</span>` : ""}</button>`;
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-save]"); if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const slug = btn.getAttribute("data-save"); toggleSave(slug);
    $$(`[data-save="${(window.CSS && CSS.escape) ? CSS.escape(slug) : slug}"]`).forEach((b) => {
      const on = isSaved(slug), big = b.classList.contains("star-lg");
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
      b.innerHTML = (on ? STAR_F : STAR_O) + (big ? `<span class="star-lbl">${on ? "Saved" : "Save"}</span>` : "");
    });
    if (location.hash.startsWith("#/saved")) route();
  });

  /* ---- recently viewed ---- */
  const RECENT_KEY = "stekel-recent";
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch (e) {}
  if (!Array.isArray(recent)) recent = [];
  function recordView(slug) {
    if (!slug) return;
    recent = [slug, ...recent.filter((s) => s !== slug)].slice(0, 12);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch (e) {}
  }

  /* ---- random ---- */
  function goRandom() { const pool = ALL.filter((x) => x.slug); if (!pool.length) return; const x = pool[Math.floor(Math.random() * pool.length)]; location.hash = "#/item/" + encodeURIComponent(x.slug); }

  /* ---- keyboard prev/next on detail pages ---- */
  let kbdPrev = null, kbdNext = null;

  /* ---- flatten catalog ---- */
  const ALL = [];
  DEWEY.forEach((d) => d.items.forEach((it) => ALL.push({ ...it, code: d.code, section: d.name })));
  const classMeta = (code) => DEWEY.find((d) => d.code === code) || {};

  /* ---- cover art ---- */
  // Local covers live in assets/covers/ (git-tracked, 182 files).
  // Page images (assets/stekel/) use CDN_BASE which can point to R2.
  const COVERS_BASE = "assets/covers/";
  function coverSrc(cov, size) {
    if (cov && cov.local) return COVERS_BASE + cov.local;
    if (cov && cov.c) return `https://covers.openlibrary.org/b/id/${cov.c}-${size}.jpg`;
    return "";
  }
  function coverHTML(x, size) {
    const cov = x.k === "book" && typeof COVERS !== "undefined" && COVERS[x.t];
    if (cov) {
      const localSrc = cov.local ? COVERS_BASE + cov.local : "";
      const olSrc = cov.c ? `https://covers.openlibrary.org/b/id/${cov.c}-${size}.jpg` : "";
      const src = localSrc || olSrc;
      const onerr = localSrc && olSrc
        ? `this.onerror=null;this.src='${olSrc}';`
        : `this.parentElement.classList.add('failed')`;
      return `<div class="cover"><img loading="lazy" src="${src}" alt="${esc(x.t)} — cover" onerror="${onerr}"><span class="cover-fallback">${ICON.book}</span></div>`;
    }
    return `<div class="cover ph ph-${x.k}"><span class="ph-icon">${ICON[x.k] || ICON.book}</span></div>`;
  }

  /* ---- Eric's original page images — injected inline at section boundaries ---- */
  function prettyCaption(file) {
    let s = decodeURIComponent(file).replace(/\.[a-z0-9]+$/i, "").replace(/[_+]/g, " ");
    s = s.replace(/^\(?\s*(\d{3,4})\s*\)?\s+/, "$1 — ").replace(/\s+/g, " ").trim();
    return s;
  }
  function figHTML(f, inline) {
    const cap = prettyCaption(f);
    const cls = inline ? "pg-fig-inline" : "pg-fig";
    const err = inline ? "this.closest('.pg-fig-inline').remove()" : "this.closest('.pg-fig').remove()";
    return `<figure class="${cls}"><img loading="lazy" src="${CDN_BASE}${f}" alt="${esc(cap)}" onerror="${err}"><figcaption>${esc(cap)}</figcaption></figure>`;
  }
  // Returns the image list for a slug, optionally excluding the cover image.
  function pageImages(slug, skipCover) {
    const imgs = (typeof PAGE_IMAGES !== "undefined" && slug && PAGE_IMAGES[slug]) || [];
    if (!imgs.length) return [];
    let coverFile = null;
    if (skipCover && typeof COVERS !== "undefined") {
      const entry = REGISTRY && REGISTRY.get(slug);
      if (entry && entry.title && COVERS[entry.title] && COVERS[entry.title].local) {
        coverFile = COVERS[entry.title].local;
      }
    }
    return coverFile ? imgs.filter((f) => f !== coverFile) : imgs;
  }
  // Injects images inline at heading boundaries throughout article HTML.
  // Images are distributed evenly after </h1>, </h2>, </h3> split points.
  // When no headings exist, images are injected after every 3rd paragraph.
  // Falls back to a bottom gallery for pages with no article content (museums/guides with no text).
  function injectImagesInline(html, slug, skipCover) {
    const list = pageImages(slug, skipCover);
    if (!list.length) return html;
    if (!html) return `<div class="pg-inline-gallery">${list.map((f) => figHTML(f, true)).join("")}</div>`;
    // Already has inline images from the mirrored content — don't duplicate.
    if (html.includes("pg-fig-inline")) return html;
    // Split on heading close tags — natural reading boundaries.
    const HEADING_RE = /(<\/h[123]>)/gi;
    const parts = html.split(HEADING_RE);
    // Collect indices of heading-close captures (odd indices after split with capturing group).
    const headingSlots = [];
    for (let i = 1; i < parts.length; i += 2) headingSlots.push(i);
    if (headingSlots.length >= 1) {
      // Distribute images across heading slots.
      const imgsPerSlot = list.length / headingSlots.length;
      const result = [];
      headingSlots.forEach((slotIdx, i) => {
        const start = Math.floor(i * imgsPerSlot);
        const end = Math.floor((i + 1) * imgsPerSlot);
        const batch = list.slice(start, end);
        // Mark the slot's position: content up to and including the heading tag, then images.
        // parts[slotIdx] is the heading close tag (e.g. "</h1>").
        if (i === 0) result.push(...parts.slice(0, slotIdx + 1));
        else result.push(...parts.slice(headingSlots[i - 1] + 1, slotIdx + 1));
        if (batch.length) result.push(`<div class="pg-inline-gallery">${batch.map((f) => figHTML(f, true)).join("")}</div>`);
      });
      // Append any remaining parts after the last heading.
      result.push(...parts.slice(headingSlots[headingSlots.length - 1] + 1));
      return result.join("");
    }
    // No headings — inject after every 3rd </p>.
    const PARA_RE = /(<\/p>)/g;
    const pParts = html.split(PARA_RE);
    let result = "", paraCount = 0, imgIdx = 0;
    for (let i = 0; i < pParts.length; i++) {
      result += pParts[i];
      if (pParts[i] === "</p>") {
        paraCount++;
        if (paraCount % 3 === 0 && imgIdx < list.length) {
          // Inject 1–2 images every 3 paragraphs.
          const batch = list.slice(imgIdx, imgIdx + 2);
          result += `<div class="pg-inline-gallery">${batch.map((f) => figHTML(f, true)).join("")}</div>`;
          imgIdx += batch.length;
        }
      }
    }
    if (imgIdx < list.length) result += `<div class="pg-inline-gallery">${list.slice(imgIdx).map((f) => figHTML(f, true)).join("")}</div>`;
    return result;
  }
  // For pages with NO article text: shows a bottom image grid (museum/guide cover shots).
  function galleryHTML(slug, skipCover) {
    const list = pageImages(slug, skipCover);
    if (!list.length) return "";
    return `<section class="pg-gallery"><h3 class="pg-gallery-h">Images</h3><div class="pg-grid">${list.map((f) => figHTML(f, false)).join("")}</div></section>`;
  }

  /* ---- card (links to its page) ---- */
  function card(x) {
    const a = el("a", "card reveal");
    a.href = "#/item/" + encodeURIComponent(x.slug || "");
    a.innerHTML = `
      <div class="card-cover">${coverHTML(x, "M")}${x.slug ? starBtn(x.slug) : ""}</div>
      <div class="card-body">
        <span class="kind ${x.k}">${kindLabel[x.k] || x.k}</span>
        <h4>${esc(x.t)}</h4>
        <div class="by">${esc(x.a || "")}</div>
        <div class="sec">${x.code} · ${esc(x.section)}</div>
      </div>`;
    return a;
  }

  /* ===================== VIEWS ====================== */
  const view = $("#view");

  /* --- HOME (hub) --- */
  function viewHome() {
    const counts = {
      total: ALL.length,
      books: ALL.filter((x) => x.k === "book").length,
      museums: ALL.filter((x) => x.k === "museum").length,
      languages: ALL.filter((x) => x.k === "language").length,
      sections: new Set(ALL.map((x) => x.code).filter(Boolean)).size,
    };
    const root = el("div");
    root.innerHTML = `
      <section class="hero hero-home hero-dark">
        <div class="hero-bg"></div>
        <div class="wrap">
          <p class="eyebrow reveal">Knowledge, kept in order</p>
          <h1 class="reveal" data-d="1">A library of <em>everything,</em> arranged so you can wander.</h1>
          <p class="lede reveal" data-d="2">Ten classes. A thousand numbered rooms. Philosophy to zoology — and every road between. Wander in any direction. There is no wrong door.</p>
          <div class="hero-cta reveal" data-d="3">
            <a class="btn btn-primary" href="#/catalog">Browse the catalog <span class="arr">→</span></a>
            <button class="btn btn-ghost" id="homeSearch">Search everything ⌘K</button>
            <button class="btn btn-ghost" id="homeRandom">Surprise me 🎲</button>
          </div>
        </div>
        <div class="scroll-hint" aria-hidden="true"><span>Scroll</span><span class="line"></span></div>
      </section>
      <section class="wrap" style="padding-top:2.5rem;padding-bottom:0;background:transparent">
        <p class="stats-prose reveal">${counts.books}+ books, ${counts.museums} museums, ${counts.languages} language guides, timelines and the documents that shaped us — each one its own page, all organized the old, good way: 000 to 999.</p>
      </section>
      <section class="ribbon-sec" aria-hidden="true"><div class="ribbon"><div class="ribbon-track" id="ribbon"></div></div></section>
      <section class="wrap" id="recentSec" hidden style="padding-bottom:0">
        <div class="section-head reveal" style="margin-bottom:1.5rem"><p class="eyebrow">Pick up where you left off</p><h2>Recently viewed.</h2></div>
        <div class="grid" id="recentGrid"></div>
      </section>
      <section class="wrap" style="padding-top:2rem">
        <div class="section-head reveal"><p class="eyebrow">The ten classes</p><h2>Ten doors into the whole of human knowledge.</h2></div>
        <div class="spectrum" id="spectrum"></div>
      </section>
      <section class="wrap">
        <div class="section-head reveal"><p class="eyebrow">The collection at a glance</p><h2>How it all shelves out.</h2></div>
        <div class="distro" id="distro"></div>
      </section>
      <section class="wrap">
        <div class="section-head reveal"><p class="eyebrow">More to explore</p><h2>Beyond the books.</h2></div>
        <div class="hub" id="hub"></div>
      </section>`;
    view.append(root);

    // ribbon
    const track = $("#ribbon", root);
    const covered = ALL.filter((x) => x.k === "book" && typeof COVERS !== "undefined" && COVERS[x.t]);
    const make = () => covered.map((x) => {
      const cov = COVERS[x.t];
      const localSrc = cov.local ? COVERS_BASE + cov.local : "";
      const olSrc = cov.c ? `https://covers.openlibrary.org/b/id/${cov.c}-M.jpg` : "";
      const src = localSrc || olSrc;
      const onerr = localSrc && olSrc ? `this.onerror=null;this.src='${olSrc}';` : `this.closest('.ribbon-item').style.display='none'`;
      return `<a class="ribbon-item" href="#/item/${encodeURIComponent(x.slug)}" aria-label="${esc(x.t)}"><img loading="lazy" src="${src}" alt="" onerror="${onerr}"></a>`;
    }).join("");
    track.innerHTML = make() + make();
    // Auto-scrolling ribbon: drifts on load, stays hand-scrollable, seamlessly loops.
    // scrollLeft-driven so auto + manual scroll share one mechanism (no transform conflict).
    const ribbonBox = track.parentElement;
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let paused = false, pauseT, pos = 0; // pos: fractional scroll accumulator
    // gentle, non-vestibular drift — keep it (slower) even under reduce-motion; it's still hand-scrollable
    const SPEED = reduceMotion ? 0.25 : 0.4; // px per frame
    function pauseDrift() {
      paused = true;
      clearTimeout(pauseT);
      pauseT = setTimeout(() => { paused = false; pos = ribbonBox.scrollLeft; }, 1800);
    }
    ribbonBox.addEventListener("pointerdown", pauseDrift);
    ribbonBox.addEventListener("wheel", pauseDrift, { passive: true });
    ribbonBox.addEventListener("touchstart", pauseDrift, { passive: true });
    ribbonBox.addEventListener("mouseenter", () => { paused = true; });
    ribbonBox.addEventListener("mouseleave", () => { clearTimeout(pauseT); pos = ribbonBox.scrollLeft; paused = false; });
    function drift() {
      const half = track.scrollWidth / 2; // duplicated track → wrap at the halfway point
      if (!paused && half > 0) {
        pos += SPEED;
        if (pos >= half) pos -= half;       // seamless loop
        ribbonBox.scrollLeft = pos;          // assign the accumulated float (rounds, but pos keeps the remainder)
      }
      activeRafId = requestAnimationFrame(drift);
    }
    cancelAnimationFrame(activeRafId);
    // start once covers have laid out (scrollWidth needs real width); retry a few frames if 0
    let tries = 0;
    const startWhenReady = () => {
      if (track.scrollWidth / 2 > 10 || tries++ > 90) { pos = 0; ribbonBox.scrollLeft = 0; drift(); }
      else requestAnimationFrame(startWhenReady);
    };
    requestAnimationFrame(startWhenReady);

    // spectrum
    const spec = $("#spectrum", root);
    DEWEY.forEach((d, i) => {
      const a = el("a", "tile reveal");
      a.href = "#/class/" + d.code;
      a.style.setProperty("--accent", accents[i % accents.length]);
      a.dataset.d = String((i % 4) + 1);
      a.innerHTML = `<div class="code">${d.range}</div><h3>${esc(d.name)}</h3><p>${esc(d.blurb)}</p><span class="count"><b>${d.items.length}</b> in collection</span>`;
      spec.append(a);
    });

    // distribution chart
    const distro = $("#distro", root);
    const max = Math.max(...DEWEY.map((d) => d.items.length), 1);
    DEWEY.forEach((d, i) => {
      const a = el("a", "distro-row reveal");
      a.href = "#/class/" + d.code;
      a.dataset.d = String((i % 4) + 1);
      a.style.setProperty("--accent", accents[i % accents.length]);
      a.innerHTML = `
        <span class="distro-code">${d.code}</span>
        <span class="distro-name">${esc(d.name)}</span>
        <span class="distro-track"><span class="distro-bar" style="--w:${(d.items.length / max * 100).toFixed(1)}%"></span></span>
        <span class="distro-n">${d.items.length}</span>`;
      distro.append(a);
    });

    // recently viewed
    const recItems = recent.map((s) => ALL.find((x) => x.slug === s)).filter(Boolean).slice(0, 6);
    if (recItems.length) {
      $("#recentSec", root).hidden = false;
      const rg = $("#recentGrid", root);
      recItems.forEach((x) => rg.append(card(x)));
    }

    // hub cards
    const hub = $("#hub", root);
    const hubs = [
      { h: "#/timelines", t: "Timelines", d: "Four windows onto everything that ever happened." },
      { h: "#/languages", t: "Languages", d: "Two dozen pocket guides for the curious traveler." },
      { h: "#/documents", t: "Documents", d: "The charters and declarations that drew the lines." },
      { h: "#/study", t: "Study programs", d: "Structured coursework, for going deeper." },
      { h: "#/voices", t: "Voices", d: "Interviews and quotes — the people behind the pages." },
      { h: "#/research", t: "Research", d: "Original scholarly articles on climate, water, and the natural world." },
      { h: "#/catalog", t: "The full catalog", d: `Every one of ${ALL.length} entries, searchable.` },
      { h: "#/shelf", t: "The shelves", d: "Browse the collection as a wall of book spines." },
      { h: "#/saved", t: "★ Saved", d: saved.size ? `${saved.size} item${saved.size === 1 ? "" : "s"} you've starred.` : "Star items to build your own shelf." },
    ];
    hubs.forEach((x, i) => {
      const a = el("a", "hub-card reveal"); a.href = x.h; a.dataset.d = String((i % 4) + 1);
      a.innerHTML = `<h3>${x.t} <span class="arr">→</span></h3><p>${x.d}</p>`;
      hub.append(a);
    });
  }

  /* --- CATALOG --- */
  const cat = { q: "", kind: "all", code: null, sort: "title" };
  function viewCatalog(code) {
    cat.code = code || null;
    const cm = code ? classMeta(code) : null;
    const root = el("div", "wrap page");
    root.innerHTML = `
      ${crumb([["#/", "Home"], [null, code ? `${code} · ${cm.name}` : "Catalog"]])}
      <div class="section-head">
        <p class="eyebrow">${code ? `Class ${code}` : "Everything, searchable"}</p>
        <h2>${code ? esc(cm.name) : "The catalog."}</h2>
        <p>${code ? esc(cm.blurb) : "Every book, museum and guide in the collection. Search, filter, or sort."}</p>
      </div>
      <div class="catalog-controls">
        <label class="search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="searchInput" type="search" placeholder="Search the collection…" autocomplete="off" value="${esc(cat.q)}" />
        </label>
        <div class="chips" id="kindChips">
          ${["all", "book", "museum", "guide"].map((k) => `<button class="chip${cat.kind === k ? " active" : ""}" data-kind="${k}">${k === "all" ? "All" : kindLabel[k] + "s"}</button>`).join("")}
        </div>
        <select id="sortSel" class="sortsel" aria-label="Sort">
          <option value="title">Title A–Z</option>
          <option value="author">Author</option>
          <option value="class">Dewey class</option>
        </select>
      </div>
      <div class="catalog-meta" id="catalogMeta"></div>
      <div class="az" id="az" hidden></div>
      <div class="grid" id="catalogGrid"></div>`;
    view.append(root);
    $("#sortSel", root).value = cat.sort;
    const grid = $("#catalogGrid", root), meta = $("#catalogMeta", root);
    function draw() {
      const term = cat.q.trim().toLowerCase();
      let list = ALL.filter((x) => {
        if (cat.kind !== "all" && x.k !== cat.kind) return false;
        if (cat.code && x.code !== cat.code) return false;
        if (term && !(x.t.toLowerCase().includes(term) || (x.a || "").toLowerCase().includes(term) || x.section.toLowerCase().includes(term))) return false;
        return true;
      });
      list.sort((a, b) => cat.sort === "author" ? (a.a || "~").localeCompare(b.a || "~") || a.t.localeCompare(b.t)
        : cat.sort === "class" ? a.code.localeCompare(b.code) || a.t.localeCompare(b.t)
        : a.t.localeCompare(b.t));
      meta.innerHTML = "";
      meta.append(el("span", "result-count", `${list.length} ${list.length === 1 ? "entry" : "entries"}`));
      if (cat.code) { const p = el("a", "filter-pill", `Class ${cat.code} · ${classMeta(cat.code).name} <span class="x">✕</span>`); p.href = "#/catalog"; meta.append(p); }
      grid.innerHTML = "";
      const azEl = $("#az", root);
      if (!list.length) {
        const emptyEl = el("div", "empty catalog-empty");
        const termDisplay = term ? `"${cat.q.trim()}"` : null;
        const kindDisplay = cat.kind !== "all" ? kindLabel[cat.kind] + "s" : null;
        const classDisplay = cat.code ? `class ${cat.code}` : null;
        const filterParts = [termDisplay, kindDisplay, classDisplay].filter(Boolean);
        const filterDesc = filterParts.length ? filterParts.join(" · ") : null;
        emptyEl.innerHTML = filterDesc
          ? `<p class="empty-msg">No results for <em>${esc(filterDesc)}</em>.</p><p class="empty-hint">Try a broader search or <a href="#/catalog">browse the full catalog</a>.</p>`
          : `<p class="empty-msg">Nothing here yet.</p><p class="empty-hint"><a href="#/catalog">Browse the full catalog</a>.</p>`;
        grid.append(emptyEl); azEl.hidden = true; return;
      }
      const cardEls = list.map((x) => { const c = card(x); grid.append(c); return c; });
      revealIn(grid);
      // A–Z jump rail (only meaningful when sorted by title)
      if (cat.sort === "title" && list.length > 16) {
        const firstEl = {};
        list.forEach((x, i) => { let L = (x.t.trim()[0] || "#").toUpperCase(); if (/[0-9]/.test(L)) L = "#"; if (!/[A-Z#]/.test(L)) L = "#"; if (!firstEl[L]) firstEl[L] = cardEls[i]; });
        const letters = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
        azEl.innerHTML = letters.map((L) => `<button class="az-l${firstEl[L] ? "" : " off"}" data-l="${L}"${firstEl[L] ? "" : " disabled"}>${L}</button>`).join("");
        azEl.hidden = false;
        $$(".az-l:not(.off)", azEl).forEach((b) => b.addEventListener("click", () => firstEl[b.dataset.l].scrollIntoView({ behavior: "smooth", block: "start" })));
      } else azEl.hidden = true;
    }
    let drawT;
    $("#searchInput", root).addEventListener("input", (e) => { cat.q = e.target.value; clearTimeout(drawT); drawT = setTimeout(draw, 120); });
    $$("#kindChips .chip", root).forEach((c) => c.addEventListener("click", () => { cat.kind = c.dataset.kind; $$("#kindChips .chip", root).forEach((z) => z.classList.toggle("active", z === c)); draw(); }));
    $("#sortSel", root).addEventListener("change", (e) => { cat.sort = e.target.value; draw(); });
    draw();
  }

  /* --- ITEM DETAIL (book / museum / guide) --- */
  const descCache = {};
  async function fetchDesc(x) {
    if (typeof DESCRIPTIONS !== "undefined" && DESCRIPTIONS[x.t]) return DESCRIPTIONS[x.t];
    if (descCache[x.t] !== undefined) return descCache[x.t];
    const key = typeof KEYS !== "undefined" && KEYS[x.t];
    if (!key) return null;
    try {
      const j = await (await fetch("https://openlibrary.org" + key + ".json")).json();
      let d = j.description; if (d && typeof d !== "string") d = d.value;
      if (d) { d = d.split("\n")[0].split("([")[0].replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim(); if (/^(Duplicate of|Title:|This edition)/i.test(d) || d.includes("openlibrary.org")) d = ""; if (d.length > 360) { const c = d.slice(0, 360); const i = c.lastIndexOf(". "); d = i > 160 ? c.slice(0, i + 1) : c.trim() + "…"; } }
      descCache[x.t] = d || null;
    } catch (e) { descCache[x.t] = null; }
    return descCache[x.t];
  }
  function viewItem(x) {
    const full = content(x.slug);
    const known = (typeof DESCRIPTIONS !== "undefined" && DESCRIPTIONS[x.t]) || descCache[x.t] || null;
    const willFetch = !full && !known && x.k === "book" && typeof KEYS !== "undefined" && KEYS[x.t];
    const dw = classMeta(x.code);
    // neighbours within class
    const sibs = (dw.items || []).filter((i) => i.slug);
    const idx = sibs.findIndex((i) => i.slug === x.slug);
    const prev = idx > 0 ? sibs[idx - 1] : null, next = idx >= 0 && idx < sibs.length - 1 ? sibs[idx + 1] : null;
    const root = el("div", "wrap page detail");
    root.innerHTML = `
      ${crumb([["#/", "Home"], ["#/class/" + x.code, `${x.code} · ${dw.name}`], [null, x.t]])}
      <div class="detail-top">
        <div class="detail-cover">${coverHTML(x, "L")}</div>
        <div class="detail-meta">
          <span class="kind ${x.k}">${kindLabel[x.k] || x.k}${full ? ` · ${readingTime(full)}` : ""}</span>
          <h1>${esc(x.t)}</h1>
          ${x.a ? `<p class="detail-by">${esc(x.a)}</p>` : ""}
          <div class="detail-actions">
            ${x.slug ? starBtn(x.slug, true) : ""}
            <button class="share-btn" onclick="(() => { const url = location.href; const txt = '${esc(x.t)}${x.a ? ' by ' + esc(x.a) : ''}'; if (navigator.share) { navigator.share({title: txt, url}); } else { navigator.clipboard.writeText(url).then(() => { this.textContent = '✓ Copied'; setTimeout(() => this.textContent = '⤴ Share', 1500); }); } })()" title="Share this page">⤴ Share</button>
          </div>
          ${full ? "" : (known ? `<p class="m-desc">${esc(known)}</p>` : (willFetch ? `<p class="m-desc m-desc-loading" id="mDesc"></p>` : ""))}
          <a class="m-class" href="#/class/${x.code}">
            <div class="m-class-code">${x.code}</div>
            <div><div class="m-class-name">${esc(dw.name)}</div><div class="m-class-range">Dewey ${dw.range || ""} · browse all →</div></div>
          </a>
        </div>
      </div>
      ${full ? `<article class="mirror reading">${injectImagesInline(full, x.slug, x.k === "book")}</article>` : galleryHTML(x.slug, x.k === "book")}
      <nav class="prevnext">
        ${prev ? `<a class="pn pn-prev" href="#/item/${encodeURIComponent(prev.slug)}"><span class="pn-dir">← Previous</span><span class="pn-t">${esc(prev.t)}</span></a>` : "<span></span>"}
        ${next ? `<a class="pn pn-next" href="#/item/${encodeURIComponent(next.slug)}"><span class="pn-dir">Next →</span><span class="pn-t">${esc(next.t)}</span></a>` : "<span></span>"}
      </nav>`;
    // related items — scored by Dewey class match, author match, keyword overlap
    (function buildRelated() {
      const xWords = new Set((x.t + " " + (x.a || "") + " " + x.section).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
      const candidates = ALL.filter((r) => r.slug && r.slug !== x.slug);
      const scored = candidates.map((r) => {
        let score = 0;
        // Dewey class match — heavily weighted
        if (r.code === x.code) score += 10;
        else if (r.code && x.code && r.code.slice(0, 2) === x.code.slice(0, 2)) score += 4;
        else if (r.code && x.code && r.code.slice(0, 1) === x.code.slice(0, 1)) score += 1;
        // Author match
        if (x.a && r.a && x.a.toLowerCase() === r.a.toLowerCase()) score += 6;
        else if (x.a && r.a) {
          const xLast = x.a.split(/\s+/).pop().toLowerCase(), rLast = r.a.split(/\s+/).pop().toLowerCase();
          if (xLast.length > 2 && xLast === rLast) score += 3;
        }
        // Keyword overlap in title/section
        const rWords = (r.t + " " + (r.a || "") + " " + r.section).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3);
        rWords.forEach((w) => { if (xWords.has(w)) score += 1; });
        return { r, score };
      });
      scored.sort((a, b) => b.score - a.score || a.r.t.localeCompare(b.r.t));
      const pick = scored.filter((s) => s.score > 0).slice(0, 6).map((s) => s.r);
      if (pick.length) {
        const rel = el("section", "related");
        rel.innerHTML = `<div class="related-head"><h3>More in ${esc(dw.name)}</h3><a href="#/class/${x.code}">See all ${dw.items.length} →</a></div><div class="grid related-grid"></div>`;
        const g = $(".related-grid", rel);
        pick.forEach((r) => g.append(card(r)));
        root.append(rel);
      }
    })();
    view.append(root);
    kbdPrev = prev ? prev.slug : null; kbdNext = next ? next.slug : null;
    recordView(x.slug);
    if (willFetch) fetchDesc(x).then((d) => { const n = $("#mDesc", root); if (!n) return; if (d) { n.textContent = d; n.classList.remove("m-desc-loading"); } else n.remove(); });
    showProgress();
  }

  /* --- generic content page (language / document / era / interview) --- */
  function viewContentPage(opts) {
    const full = content(opts.slug);
    const root = el("div", "wrap page detail narrow");
    root.innerHTML = `
      ${crumb([["#/", "Home"], [opts.backHref || "#/", opts.backLabel || "Back"], [null, opts.title]])}
      <header class="page-head">
        <span class="kind ${opts.kind || "guide"}">${opts.label || ""}${full ? ` · ${readingTime(full)}` : ""}</span>
        <h1>${esc(opts.title)}</h1>
        ${opts.sub ? `<p class="detail-by">${opts.sub}</p>` : ""}
      </header>
      ${opts.extra || ""}
      ${full ? `<article class="mirror reading">${injectImagesInline(full, opts.slug, false)}</article>` : `<p class="m-blurb">${esc(opts.fallback || "No further content recorded.")}</p>${galleryHTML(opts.slug, false)}`}`;
    view.append(root);
  }

  /* --- CROSS-REFERENCE DOSSIER ---------------------------------------------
     One term → one newly-assembled page that gathers EVERY mention of it
     across all 350+ mirrored pages, grouped by source, with all passages. */
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function allIndices(hay, needle) {
    const out = []; let i = hay.indexOf(needle);
    while (i >= 0) { out.push(i); i = hay.indexOf(needle, i + needle.length); }
    return out;
  }
  function xrefSnip(slug, idx, term) {
    const raw = PLAINRAW[slug] || "", n = term.length;
    let start = Math.max(0, idx - 95), end = Math.min(raw.length, idx + n + 120);
    let frag = raw.slice(start, end);
    if (start > 0) frag = frag.replace(/^\S*\s+/, "");
    if (end < raw.length) frag = frag.replace(/\s+\S*$/, "");
    const re = new RegExp("(" + reEsc(term) + ")", "ig");
    return (start > 0 ? "… " : "") + esc(frag).replace(re, "<mark>$1</mark>") + (end < raw.length ? " …" : "");
  }
  // Split prose into sentences (good enough for compiled overviews).
  function splitSentences(text) {
    return text.split(/(?<=[.!?])\s+(?=["'"(]?[A-Z0-9])/).map((s) => s.trim()).filter(Boolean);
  }
  // Pull the most substantive on-topic sentences from one source, ranked.
  function topicSentences(slug, term, max) {
    const raw = PLAINRAW[slug] || "";
    const re = new RegExp(reEsc(term), "i");
    const startRe = new RegExp("^[\\s\"‘’(]*" + reEsc(term), "i");
    const out = [];
    for (let s of splitSentences(raw)) {
      if (s.length < 35 || s.length > 320) continue;
      if (!re.test(s)) continue;
      if (!/[a-z]/.test(s)) continue;                 // skip ALL-CAPS headers / nav junk
      if ((s.match(/[.,;:]/g) || []).length === 0 && s.length < 60) continue;
      let score = 0;
      if (!startRe.test(s)) score += 2;               // not just "<Term> is…" fragment
      if (s.length >= 70 && s.length <= 240) score += 2;
      if (/[A-Z]/.test(s[0] || "")) score += 1;       // proper sentence start
      if (/\b(is|are|was|were|has|have|developed|created|known|called|first|because|which|that)\b/i.test(s)) score += 1;
      out.push({ s, score });
    }
    out.sort((a, b) => b.score - a.score || a.s.length - b.s.length);
    return out.slice(0, max || 3).map((h) => h.s);
  }
  const citeKey = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 64);
  function markTerm(text, term) {
    return esc(text).replace(new RegExp("(" + reEsc(term) + ")", "ig"), "<mark>$1</mark>");
  }
  function viewXref(rawTerm) {
    const term = (rawTerm || "").trim().toLowerCase();
    const root = el("div", "wrap page xref");
    const searchBox = `<form class="xref-search" id="xrefForm"><input id="xrefInput" type="search" placeholder="Cross-reference another term…" value="${esc(rawTerm || "")}" autocomplete="off" spellcheck="false"><button type="submit">Cross-reference</button></form>`;
    if (term.length < 2) {
      root.innerHTML = crumb([["#/", "Home"], [null, "Cross-reference"]]) +
        `<div class="section-head"><p class="eyebrow">Cross-reference</p><h2>Gather every mention of one thing.</h2><p>Type a name, place, or idea and the library assembles every passage that mentions it into a single page.</p></div>${searchBox}`;
      view.append(root); wireXrefForm(root); return;
    }
    buildPlain();

    // 1) direct entries — title / author / subtitle matches
    const direct = [];
    for (const [slug, e] of REGISTRY) {
      const t = (e.title || "").toLowerCase(), s = (e.sub || "").toLowerCase();
      if (t.includes(term) || s.includes(term)) direct.push({ slug, e, inTitle: t.includes(term) });
    }
    direct.sort((a, b) => (b.inTitle - a.inTitle) || a.e.title.localeCompare(b.e.title));

    // 2) every textual mention, grouped by source page
    const sources = []; let totalMentions = 0; const kindCount = {};
    for (const slug in PLAIN) {
      if (!REGISTRY.has(slug)) continue;
      const idxs = allIndices(PLAIN[slug], term);
      if (!idxs.length) continue;
      totalMentions += idxs.length;
      const e = REGISTRY.get(slug);
      kindCount[e.kind] = (kindCount[e.kind] || 0) + 1;
      // de-cluster: skip occurrences that fall inside the previous snippet window
      const shownIdx = []; let last = -1e9;
      for (const i of idxs) { if (i - last > 150) { shownIdx.push(i); last = i; } if (shownIdx.length >= 6) break; }
      sources.push({ slug, e, count: idxs.length, snips: shownIdx.map((i) => xrefSnip(slug, i, term)) });
    }
    sources.sort((a, b) => b.count - a.count || a.e.title.localeCompare(b.e.title));

    if (!direct.length && !sources.length) {
      root.innerHTML = crumb([["#/", "Home"], ["#/xref", "Cross-reference"], [null, rawTerm]]) +
        `<div class="section-head"><p class="eyebrow">Cross-reference</p><h2>Nothing mentions "${esc(rawTerm)}".</h2><p>No title, author, or page in the library refers to that term. Try another spelling or a broader word.</p></div>${searchBox}`;
      view.append(root); wireXrefForm(root); return;
    }

    // synthesized summary line
    const order = ["book", "museum", "document", "language", "timeline", "interview", "guide"];
    const parts = order.filter((k) => kindCount[k]).map((k) => `${kindCount[k]} ${kindLabel[k].toLowerCase()}${kindCount[k] === 1 ? "" : "s"}`);
    const srcTotal = sources.length;
    let lead;
    if (totalMentions) {
      lead = `One narrative on <strong>"${esc(rawTerm)}"</strong>, synthesized from <strong>${srcTotal}</strong> ${srcTotal === 1 ? "source" : "sources"}` +
        (parts.length ? ` (${parts.join(", ")})` : "") +
        ` that mention it <strong>${totalMentions}</strong> time${totalMentions === 1 ? "" : "s"} — grounded in the library and cited line-by-line. Hover any number to see where it came from.`;
    } else {
      lead = `<strong>"${esc(rawTerm)}"</strong> isn't discussed in the page text, but it names ${direct.length} ${direct.length === 1 ? "entry" : "entries"} in the catalog.`;
    }

    let html = crumb([["#/", "Home"], ["#/xref", "Cross-reference"], [null, rawTerm]]);
    html += `<header class="xref-head"><p class="eyebrow">Topic overview · synthesized &amp; cited</p><h1>What the library says about "${esc(rawTerm)}"</h1><p class="xref-lead">${lead}</p>${searchBox}</header>`;

    // ---- build the corpus for synthesis: best passages from the top sources ----
    const seenSent = new Set();
    const corpusSources = [];
    for (const s of sources) {
      if (corpusSources.length >= 14) break;
      let passages = topicSentences(s.slug, term, 5).filter((t) => { const k = citeKey(t); if (seenSent.has(k)) return false; seenSent.add(k); return true; });
      if (passages.length < 2) {
        const frags = allIndices(PLAIN[s.slug], term).slice(0, 3).map((i) => plainContext(s.slug, i, term)).filter((f) => { const k = citeKey(f); if (seenSent.has(k)) return false; seenSent.add(k); return true; });
        passages = [...passages, ...frags];
      }
      passages = passages.slice(0, 5).map((p) => (p.length > 260 ? p.slice(0, 257) + "…" : p));
      if (!passages.length) continue;
      corpusSources.push({ n: corpusSources.length + 1, slug: s.slug, e: s.e, kind: s.e.kind, title: s.e.title, author: s.e.sub || "", count: s.count, passages });
    }
    if (corpusSources.length) {
      html += `<section class="xref-overview reveal" id="xrefOverview">${synthLoadingHTML(corpusSources.length)}</section>`;
    }

    if (direct.length) {
      html += `<section class="xref-direct reveal"><div class="related-head"><h3>Entries named for it</h3><span class="xref-mini">${direct.length}</span></div><div class="xref-chips">` +
        direct.slice(0, 24).map((d) => `<a class="xref-chip" href="#/item/${encodeURIComponent(d.slug)}">${coverMini(d.e)}<span class="xref-chip-t">${esc(d.e.title)}</span><span class="xref-chip-k">${kindLabel[d.e.kind] || d.e.kind}</span></a>`).join("") +
        `</div></section>`;
    }

    if (sources.length) {
      html += `<section class="xref-body"><details class="xref-raw"${corpusSources.length ? "" : " open"}><summary><span class="xref-raw-h">Every mention, in context</span><span class="xref-mini">${totalMentions} in ${srcTotal}</span></summary>`;
      html += sources.map((s) => {
        const more = s.count - s.snips.length;
        return `<article class="xref-source reveal">
          <a class="xref-src-head" href="#/item/${encodeURIComponent(s.slug)}">
            ${coverMini(s.e)}
            <span class="xref-src-meta"><span class="xref-src-t">${esc(s.e.title)}</span><span class="xref-src-s">${esc(s.e.sub || kindLabel[s.e.kind] || "")}</span></span>
            <span class="xref-count">${s.count}×</span>
          </a>
          <div class="xref-snips">${s.snips.map((sn) => `<a class="xref-snip" href="#/item/${encodeURIComponent(s.slug)}"><span class="xref-q">${sn}</span></a>`).join("")}
          ${more > 0 ? `<a class="xref-more" href="#/item/${encodeURIComponent(s.slug)}">+${more} more mention${more === 1 ? "" : "s"} on this page →</a>` : ""}</div>
        </article>`;
      }).join("");
      html += `</details></section>`;
    }

    root.innerHTML = html;
    view.append(root);
    wireXrefForm(root);
    if (corpusSources.length) { const mount = $("#xrefOverview", root); if (mount) synthesize(term, corpusSources, mount, false); }
  }
  function wireXrefForm(root) {
    const f = $("#xrefForm", root); if (!f) return;
    f.addEventListener("submit", (e) => { e.preventDefault(); const v = $("#xrefInput", root).value.trim(); if (v) location.hash = "#/xref/" + encodeURIComponent(v); });
  }
  function plainContext(slug, idx, term) {
    const raw = PLAINRAW[slug] || "", n = term.length;
    let start = Math.max(0, idx - 90), end = Math.min(raw.length, idx + n + 130);
    let frag = raw.slice(start, end);
    if (start > 0) frag = frag.replace(/^\S*\s+/, "");
    if (end < raw.length) frag = frag.replace(/\s+\S*$/, "");
    return (start > 0 ? "…" : "") + frag + (end < raw.length ? "…" : "");
  }
  function synthLoadingHTML(n) {
    return `<div class="synth-loading"><div class="synth-spin"></div><div class="synth-load-txt"><strong>Synthesizing a narrative…</strong><span>reading ${n} source${n === 1 ? "" : "s"} and composing one cited overview — about 10 seconds</span></div>
      <div class="synth-skel"><span></span><span></span><span></span><span></span><span></span></div></div>`;
  }
  // ---- AI synthesis: gather passages → /api/overview → narrative w/ hover footnotes ----
  async function synthesize(term, corpusSources, mount, fresh) {
    const payload = { term, fresh: !!fresh, sources: corpusSources.map((s) => ({ n: s.n, title: s.title, kind: s.kind, author: s.author, passages: s.passages })) };
    try {
      const r = await fetch("/api/overview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(35000) });
      const data = await r.json();
      if (!data || !data.ok || !data.narrative) throw new Error((data && data.error) || "no narrative");
      renderSynth(mount, data, corpusSources, term);
    } catch (e) {
      renderFallback(mount, corpusSources, term);
    }
  }
  function refList(list) {
    return `<div class="xref-refs"><div class="related-head"><h3>Sources</h3><span class="xref-mini">${list.length} cited</span></div><ol class="xref-ref-list">` +
      list.map((s) => `<li class="xref-ref"><a href="#/item/${encodeURIComponent(s.slug)}"><span class="xref-ref-n">${s.n}</span><span class="xref-ref-t">${esc(s.title)}</span><span class="xref-ref-k">${kindLabel[s.kind] || s.kind}${s.count ? ` · ${s.count}×` : ""}</span></a></li>`).join("") +
      `</ol></div>`;
  }
  function narrativeHTML(text) {
    return esc(text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) =>
      `<p class="synth-p">${p.replace(/\n+/g, " ").replace(/\[\[(\d+)\]\]/g, (m, n) => `<sup class="fn-cite" data-n="${n}" tabindex="0" role="button" aria-label="Source ${n}">${n}</sup>`)}</p>`
    ).join("");
  }
  function renderSynth(mount, data, corpusSources, term) {
    const used = corpusSources.filter((s) => data.narrative.includes(`[[${s.n}]]`));
    const list = used.length ? used : corpusSources;
    mount.innerHTML = `<article class="synth-body">${narrativeHTML(data.narrative)}</article>
      <div class="synth-meta"><span>${data.cached ? "Recalled from cache" : "Synthesized from the library"} · ${list.length} source${list.length === 1 ? "" : "s"} · hover a number to see where it came from</span><button class="synth-regen" type="button">↻ Regenerate</button></div>
      ${refList(list)}`;
    wireFootnotes(mount, new Map(corpusSources.map((s) => [String(s.n), s])), term);
    const rb = $(".synth-regen", mount); if (rb) rb.addEventListener("click", () => { mount.innerHTML = synthLoadingHTML(corpusSources.length); synthesize(term, corpusSources, mount, true); });
  }
  function renderFallback(mount, corpusSources, term) {
    const paras = corpusSources.map((s) => `<p class="xref-ov-p">${s.passages.map((p) => markTerm(p, term)).join(" ")} <a class="xref-cite" href="#/item/${encodeURIComponent(s.slug)}" title="${esc(s.title)}">[${s.n}]</a></p>`).join("");
    mount.innerHTML = `<div class="synth-note">Live synthesis isn't available right now. Here's a compiled overview drawn straight from the sources.</div>
      <article class="xref-ov-body">${paras}</article>${refList(corpusSources)}`;
  }
  function fnCard(s, term) {
    return `<div class="fn-card-head"><span class="fn-card-n">${s.n}</span>${coverMini(s.e)}<span class="fn-card-meta"><span class="fn-card-t">${esc(s.title)}</span><span class="fn-card-k">${kindLabel[s.kind] || s.kind}${s.author ? ` · ${esc(s.author)}` : ""}${s.count ? ` · ${s.count} mention${s.count === 1 ? "" : "s"}` : ""}</span></span></div>
      <div class="fn-card-pass">${s.passages.slice(0, 2).map((p) => `<p>"${markTerm(p, term)}"</p>`).join("")}</div>
      <a class="fn-card-link" href="#/item/${encodeURIComponent(s.slug)}">Open this source →</a>`;
  }
  function wireFootnotes(scope, srcByN, term) {
    const oldPop = document.getElementById("fnPop");
    if (oldPop) { const fresh = oldPop.cloneNode(false); oldPop.replaceWith(fresh); }
    let pop = $("#fnPop"); if (!pop) { pop = el("div", "fn-pop"); pop.id = "fnPop"; pop.hidden = true; document.body.append(pop); }
    let hideT = null;
    const show = (sup) => {
      const s = srcByN.get(sup.dataset.n); if (!s) return;
      if (hideT) { clearTimeout(hideT); hideT = null; }
      pop.innerHTML = fnCard(s, term); pop.hidden = false; pop.classList.add("show");
      const r = sup.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
      let left = Math.max(12, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - 12));
      let top = r.bottom + 9; if (top + ph > window.innerHeight - 12) top = r.top - ph - 9;
      pop.style.left = left + "px"; pop.style.top = Math.max(12, top) + "px";
    };
    const hide = () => { hideT = setTimeout(() => { pop.classList.remove("show"); pop.hidden = true; }, 200); };
    $$(".fn-cite", scope).forEach((sup) => {
      sup.addEventListener("mouseenter", () => show(sup));
      sup.addEventListener("mouseleave", hide);
      sup.addEventListener("focus", () => show(sup));
      sup.addEventListener("blur", hide);
      sup.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(sup); }
      });
    });
    pop.addEventListener("mouseenter", () => { if (hideT) { clearTimeout(hideT); hideT = null; } });
    pop.addEventListener("mouseleave", hide);
  }

  /* --- SECTION INDEX PAGES --- */
  function viewTimelines() {
    const root = el("div", "wrap page");
    root.innerHTML = `${crumb([["#/", "Home"], [null, "Timelines"]])}
      <div class="section-head"><p class="eyebrow">A sense of when</p><h2>Four windows onto everything that ever happened.</h2></div>
      <div class="timeline" id="timeline"></div>`;
    view.append(root);
    const tl = $("#timeline", root);
    TIMELINES.forEach((t) => {
      const a = el("a", "tl-row"); a.href = "#/item/" + encodeURIComponent(t.slug || "");
      a.innerHTML = `<div class="tl-span">${esc(t.span)}</div><div><h4 class="tl-era">${esc(t.era)}</h4><p class="tl-note">${esc(t.note)}</p><span class="tl-more">${(t.events || []).length} key events <span class="arr">→</span></span></div>`;
      tl.append(a);
    });
  }
  function viewLanguages() {
    const root = el("div", "wrap page");
    root.innerHTML = `${crumb([["#/", "Home"], [null, "Languages"]])}
      <div class="section-head"><p class="eyebrow">The language atlas</p><h2>Two dozen ways to say hello.</h2><p>Pocket guides for the curious traveler. Open one for the full phrase list.</p></div>
      <div class="atlas" id="atlas"></div>`;
    view.append(root);
    const atlas = $("#atlas", root);
    LANGUAGES.forEach((l) => {
      const has = content(l.slug);
      const n = has ? el("a", "lang clickable") : el("span", "lang");
      if (has) n.href = "#/item/" + encodeURIComponent(l.slug);
      const speakBtn = `<button class="lang-listen" aria-label="Listen to ${esc(l.name)}" onclick="event.preventDefault();event.stopPropagation();const u=new SpeechSynthesisUtterance('${esc(l.hello).replace(/'/g,"\\'")}');speechSynthesis.speak(u);" title="Hear pronunciation">🔊</button>`;
      n.innerHTML = `<span class="glyph">${esc(l.hello)}</span><span class="lname">${esc(l.name)}</span>${speakBtn}`;
      atlas.append(n);
    });
  }
  function viewDocuments() {
    const root = el("div", "wrap page");
    root.innerHTML = `${crumb([["#/", "Home"], [null, "Documents"]])}
      <div class="section-head"><p class="eyebrow">The rules of life</p><h2>The documents that drew the lines.</h2></div>
      <div class="docs" id="docs"></div>`;
    view.append(root);
    const docs = $("#docs", root);
    DOCUMENTS.forEach((d) => {
      const a = d.slug ? el("a", "doc") : el("div", "doc");
      if (d.slug) a.href = "#/item/" + encodeURIComponent(d.slug);
      a.innerHTML = `<div class="y">${esc(d.y)}</div><h4>${esc(d.t)}</h4><div class="p">${esc(d.p)}</div>`;
      docs.append(a);
    });
  }
  function viewStudy() {
    const root = el("div", "wrap page");
    root.innerHTML = `${crumb([["#/", "Home"], [null, "Study"]])}
      <div class="section-head"><p class="eyebrow">Go deeper</p><h2>Study programs.</h2></div><div id="programs"></div>`;
    view.append(root);
    // Try to find catalog items matching a course/book name (case-insensitive prefix/substring)
    function matchCatalogItem(name) {
      const n = name.toLowerCase();
      return ALL.find((x) => x.t.toLowerCase() === n) || ALL.find((x) => x.t.toLowerCase().includes(n) || n.includes(x.t.toLowerCase()));
    }
    // Estimate reading time: use real reading time if item has content, otherwise assume ~8 hours per course
    const HRS_PER_COURSE = 8;
    function courseTimeLabel(name) {
      const match = matchCatalogItem(name);
      if (match && match.slug) {
        const fc = content(match.slug);
        if (fc) { const words = plainFromHTML(fc).split(" ").filter(Boolean).length; const mins = Math.max(1, Math.round(words / 200)); return mins < 60 ? `${mins} min` : `~${Math.round(mins / 60)} hr`; }
      }
      return `~${HRS_PER_COURSE} hr`;
    }
    const prog = $("#programs", root);
    PROGRAMS.forEach((p) => {
      const c = el("div", "prog");
      const useOrder = p.courses.length >= 3;
      let coursesHTML;
      if (useOrder) {
        const totalHrs = p.courses.length * HRS_PER_COURSE;
        const itemsHTML = p.courses.map((name, i) => {
          const match = matchCatalogItem(name);
          const href = match && match.slug ? `#/item/${encodeURIComponent(match.slug)}` : null;
          const timeLabel = courseTimeLabel(name);
          const inner = `<span class="ro-num">${i + 1}</span><span class="ro-title">${esc(name)}</span><span class="ro-time">${esc(timeLabel)}</span>`;
          return href ? `<a class="ro-item" href="${href}">${inner}</a>` : `<div class="ro-item">${inner}</div>`;
        }).join("");
        coursesHTML = `<ol class="reading-order">${itemsHTML}</ol><div class="ro-total">Total estimated time: <strong>~${totalHrs} hours</strong></div>`;
      } else {
        coursesHTML = `<div class="course-list">${p.courses.map((name) => `<span class="course">${esc(name)}</span>`).join("")}</div>`;
      }
      c.innerHTML = `<div class="prog-head"><h3>${esc(p.org)}</h3><span class="tag">${esc(p.tag)}</span></div>${coursesHTML}`;
      prog.append(c);
    });
  }
  function viewResearch() {
    const root = el("div", "wrap page");
    root.innerHTML = `${crumb([["#/", "Home"], [null, "Research"]])}
      <div class="section-head"><p class="eyebrow">Scholarship</p><h2>Research &amp; Writing.</h2><p>Original scholarly articles and literature reviews by Eric Bond — covering climate adaptation, water resources, marine biology, and earth science.</p></div>
      <div class="grid" id="researchGrid"></div>`;
    view.append(root);
    const grid = $("#researchGrid", root);
    if (typeof RESEARCH !== "undefined") RESEARCH.forEach((r) => {
      const card = el("a", "card reveal"); card.href = "#/item/" + encodeURIComponent(r.slug);
      card.innerHTML = `<div class="card-body"><p class="eyebrow">${esc(r.topic)} · ${esc(r.year)}</p><h3>${esc(r.title)}</h3><p class="card-blurb">${esc(r.blurb)}</p></div>`;
      grid.append(card);
    });
  }

  function viewVoices() {
    const root = el("div", "wrap page");
    root.innerHTML = `${crumb([["#/", "Home"], [null, "Voices"]])}
      <div class="section-head"><p class="eyebrow">Voices</p><h2>The people behind the pages.</h2><p>${esc(INTERVIEWS.blurb)}</p></div>
      <div class="iv" id="interviews"></div>
      <div class="section-head" style="margin-top:4rem"><p class="eyebrow">Worth keeping</p><h2>Quotes.</h2></div>
      <div class="quote-wrap" id="quotes"></div>`;
    view.append(root);
    const iv = $("#interviews", root);
    INTERVIEWS.rounds.forEach((r) => {
      const c = el("div", "iv-round"); c.innerHTML = `<div class="year">${r.year}</div>`;
      const wrap = el("div", "iv-people");
      r.people.forEach((p) => {
        const slug = [`${p.toLowerCase()}-interview-${r.year}`, `${p.toLowerCase()}-${r.year}-interview`].find((s) => content(s));
        const pill = slug ? el("a", "iv-person clickable") : el("span", "iv-person");
        if (slug) pill.href = "#/item/" + encodeURIComponent(slug);
        pill.textContent = p; wrap.append(pill);
      });
      c.append(wrap); iv.append(c);
    });
    const q = $("#quotes", root);
    QUOTES.forEach((qt) => q.append(el("div", "quote", `<q>${esc(qt.q)}</q><div class="a">${esc(qt.a)}</div>`)));
  }

  /* --- SAVED --- */
  function viewSaved() {
    const items = ALL.filter((x) => x.slug && saved.has(x.slug));
    const root = el("div", "wrap page");
    root.innerHTML = `${crumb([["#/", "Home"], [null, "Saved"]])}
      <div class="section-head"><p class="eyebrow">Your shelf</p><h2>Saved.</h2><p>${items.length ? "Items you've starred — kept here for you, in this browser." : "You haven't starred anything yet."}</p></div>
      <div class="grid" id="savedGrid"></div>`;
    view.append(root);
    if (items.length) {
      const exp = el("button", "btn btn-ghost", "⤓ Export reading list");
      exp.style.marginBottom = "1.5rem";
      exp.addEventListener("click", () => {
        const md = `# My stekel reading list\n\n${items.map((x) => `- **${x.t}**${x.a ? ` — ${x.a}` : ""}  _(${x.code} · ${x.section})_`).join("\n")}\n`;
        const a = el("a"); a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" })); a.download = "stekel-reading-list.md"; a.click(); URL.revokeObjectURL(a.href);
      });
      $(".section-head", root).after(exp);
    }
    const grid = $("#savedGrid", root);
    if (!items.length) {
      grid.append(el("div", "empty", "Tap the ★ on any book or page to save it here."));
      const cta = el("a", "btn btn-primary", "Browse the catalog →"); cta.href = "#/catalog"; cta.style.marginTop = "1rem";
      root.append(cta);
    } else { items.sort((a, b) => a.t.localeCompare(b.t)); items.forEach((x) => grid.append(card(x))); revealIn(grid); }
  }

  /* --- SHELF (virtual bookcase) --- */
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function spine(it, classIdx) {
    const a = el("a", "spine");
    a.href = "#/item/" + encodeURIComponent(it.slug);
    const h = hashStr(it.t);
    const w = 30 + (h % 16);               // 30–45px wide
    const ht = 158 + (h % 54);             // 158–212px tall
    const mix = 60 + (h % 30);             // accent richness
    a.style.width = w + "px";
    a.style.height = ht + "px";
    a.style.background = `color-mix(in srgb, ${accents[classIdx % accents.length]} ${mix}%, #1b1813)`;
    a.title = it.t + (it.a ? " — " + it.a : "");
    a.innerHTML = `<span class="spine-title">${esc(it.t)}</span>`;
    return a;
  }
  function viewShelf() {
    const root = el("div", "wrap page");
    const totalItems = ALL.filter((x) => x.slug).length;
    root.innerHTML = `${crumb([["#/", "Home"], [null, "The shelves"]])}
      <div class="section-head"><p class="eyebrow">Browse like a bookcase</p><h2>The shelves. <span style="font-family:var(--mono);font-size:.6em;font-weight:400;color:var(--muted);letter-spacing:.03em">${totalItems}</span></h2>
      <p>The whole collection as it might sit on a wall — one shelf per Dewey class. Pull any spine to read it.</p></div>
      <div id="shelfRecent"></div>
      <div id="shelves"></div>`;
    view.append(root);

    // Recently viewed section with clear-history control
    const recItems = recent.map((s) => ALL.find((x) => x.slug === s)).filter(Boolean).slice(0, 8);
    const recentSec = $("#shelfRecent", root);
    if (recItems.length) {
      const rHead = el("div", "related-head");
      rHead.style.marginBottom = "1rem";
      const rTitle = el("h3");
      rTitle.style.cssText = "font-family:var(--serif);font-weight:600;font-size:1.2rem;margin:0";
      rTitle.innerHTML = `Recently viewed <span style="font-family:var(--mono);font-size:.72rem;font-weight:400;color:var(--muted);margin-left:.3rem">${recItems.length}</span>`;
      const clearBtn = el("button", "btn btn-ghost", "Clear history");
      clearBtn.style.cssText = "font-size:.8rem;padding:.35rem .75rem";
      clearBtn.addEventListener("click", () => {
        recent = [];
        try { localStorage.setItem(RECENT_KEY, "[]"); } catch (e) {}
        recentSec.innerHTML = "";
      });
      rHead.append(rTitle, clearBtn);
      recentSec.append(rHead);
      const rGrid = el("div", "grid");
      rGrid.style.marginBottom = "2.5rem";
      recItems.forEach((x) => rGrid.append(card(x)));
      recentSec.append(rGrid);
    }

    const wrap = $("#shelves", root);
    DEWEY.forEach((d, i) => {
      const items = d.items.filter((it) => it.slug);
      if (!items.length) return;
      const sec = el("section", "shelf-sec reveal");
      sec.dataset.d = String((i % 4) + 1);
      sec.innerHTML = `<div class="shelf-label"><span class="shelf-code">${d.code}</span><span>${esc(d.name)}</span><span style="font-family:var(--mono);font-size:.72rem;color:var(--muted);margin-left:.3rem">${items.length}</span><a href="#/class/${d.code}" class="shelf-all">${d.items.length} →</a></div><div class="shelf"><div class="shelf-row"></div></div>`;
      const row = $(".shelf-row", sec);
      items.forEach((it) => row.append(spine(it, i)));
      wrap.append(sec);
    });
  }

  /* ---- breadcrumb ---- */
  function crumb(parts) {
    return `<nav class="crumb">` + parts.map((p, i) => {
      const last = i === parts.length - 1;
      const sep = i ? `<span class="crumb-sep">/</span>` : "";
      return sep + (p[0] && !last ? `<a href="${p[0]}">${esc(p[1])}</a>` : `<span${last ? ' aria-current="page"' : ""}>${esc(p[1])}</span>`);
    }).join("") + `</nav>`;
  }

  /* ===================== REGISTRY (for routing + palette) ===================== */
  const REGISTRY = new Map();
  function reg(slug, e) { if (slug && !REGISTRY.has(slug)) REGISTRY.set(slug, e); }
  ALL.forEach((x) => reg(x.slug, { title: x.t, sub: x.a || x.section, kind: x.k, cover: (x.k === "book" && typeof COVERS !== "undefined" && COVERS[x.t]) || null, render: () => viewItem(x) }));
  LANGUAGES.forEach((l) => content(l.slug) && reg(l.slug, { title: l.name, sub: "Language guide", kind: "language", render: () => viewContentPage({ label: "Language", kind: "guide", title: l.name, sub: `"${esc(l.hello)}" — hello`, slug: l.slug, backHref: "#/languages", backLabel: "Languages" }) }));
  DOCUMENTS.forEach((d) => d.slug && reg(d.slug, { title: d.t, sub: `Document · ${d.y}`, kind: "document", render: () => viewContentPage({ label: "Document", kind: "document", title: d.t, sub: `${esc(d.p)} · ${d.y}`, slug: d.slug, backHref: "#/documents", backLabel: "Documents", fallback: d.d }) }));
  TIMELINES.forEach((t) => t.slug && reg(t.slug, {
    title: t.era, sub: `Timeline · ${t.span}`, kind: "timeline", render: () => viewContentPage({
      label: "Timeline", kind: "guide", title: t.era, sub: t.span, slug: t.slug, backHref: "#/timelines", backLabel: "Timelines", fallback: t.note,
      extra: `<p class="detail-by" style="margin-top:-.6rem">${esc(t.note)}</p><div class="m-events">${(t.events || []).map((e) => `<div class="m-event"><span class="m-event-y">${esc(e[0])}</span><span class="m-event-t">${esc(e[1])}</span></div>`).join("")}</div>`,
    })
  }));
  INTERVIEWS.rounds.forEach((r) => r.people.forEach((p) => {
    const s = [`${p.toLowerCase()}-interview-${r.year}`, `${p.toLowerCase()}-${r.year}-interview`].find((x) => content(x));
    if (s) reg(s, { title: p, sub: `Interview · ${r.year}`, kind: "interview", render: () => viewContentPage({ label: `Interview · ${r.year}`, kind: "guide", title: p, sub: `Interview, ${r.year}`, slug: s, backHref: "#/voices", backLabel: "Voices" }) });
  }));
  if (typeof RESEARCH !== "undefined") RESEARCH.forEach((r) => reg(r.slug, { title: r.title, sub: `Research · ${r.year}`, kind: "research", render: () => viewContentPage({ label: "Research", kind: "guide", title: r.title, sub: `${esc(r.topic)} · ${r.year}`, slug: r.slug, backHref: "#/research", backLabel: "Research", fallback: r.blurb }) }));

  /* ===================== ROUTER ===================== */
  const navOf = { catalog: "catalog", class: "catalog", shelf: "shelf", timelines: "timelines", languages: "languages", documents: "documents", study: "study", voices: "voices", research: "research", saved: "saved" };
  function setActiveNav(seg) {
    $$("#navLinks a").forEach((a) => a.classList.toggle("active", a.dataset.nav === navOf[seg]));
  }
  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const parts = h.split("/").filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch(e) { return s; } });
    if (activeRafId) { cancelAnimationFrame(activeRafId); activeRafId = null; }
    view.innerHTML = "";
    closePalette();
    hideProgress();
    const fp = document.getElementById("fnPop"); if (fp) { fp.hidden = true; fp.classList.remove("show"); }
    links.classList.remove("open"); document.body.classList.remove("nav-open");
    kbdPrev = kbdNext = null;
    const seg = parts[0] || "home";
    if (seg === "random") { goRandom(); return; }
    if (seg === "xref") { viewXref(parts.slice(1).join("/")); setActiveNav(seg); revealIn(view); requestAnimationFrame(() => window.scrollTo(0, 0)); onScroll(); return; }
    if (!parts.length) viewHome();
    else if (seg === "catalog") viewCatalog(null);
    else if (seg === "class") viewCatalog(parts[1]);
    else if (seg === "item") { const e = REGISTRY.get(parts[1]); if (e) e.render(); else notFound(parts[1]); }
    else if (seg === "saved") viewSaved();
    else if (seg === "shelf") viewShelf();
    else if (seg === "timelines") viewTimelines();
    else if (seg === "languages") viewLanguages();
    else if (seg === "documents") viewDocuments();
    else if (seg === "study") viewStudy();
    else if (seg === "voices") viewVoices();
    else if (seg === "research") viewResearch();
    else viewHome();
    setActiveNav(seg);
    revealIn(view);
    requestAnimationFrame(() => window.scrollTo(0, 0));
    onScroll();
    const wsHome = $("#homeSearch"); if (wsHome) wsHome.addEventListener("click", openPalette);
    const rndHome = $("#homeRandom"); if (rndHome) rndHome.addEventListener("click", goRandom);
  }
  function notFound(slug) {
    const safeslug = esc(slug || "unknown");
    const root = el("div", "wrap page");
    root.innerHTML = `
      ${crumb([["#/", "Home"], [null, "Page not found"]])}
      <div class="section-head" style="padding-top:4rem">
        <p class="eyebrow">404 · Not found</p>
        <h2>That page isn't here.</h2>
        <p>No entry found for <code style="font-family:var(--mono);background:var(--paper);padding:.1em .4em;border-radius:5px">${safeslug}</code>. It may have been moved or the link is incorrect.</p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.5rem">
        <a class="btn btn-primary" href="#/">Go home →</a>
        <a class="btn btn-ghost" href="#/catalog">Browse the catalog</a>
      </div>
      <div style="margin-top:3rem;max-width:480px">
        <p style="font-size:.9rem;color:var(--muted);margin-bottom:.75rem">Or search for something:</p>
        <form id="nf404Form" style="display:flex;gap:.5rem">
          <label class="search" style="flex:1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input id="nf404Input" type="search" placeholder="Search the collection…" autocomplete="off" />
          </label>
          <button type="submit" class="btn btn-primary" style="padding:.6rem 1rem">Go</button>
        </form>
      </div>`;
    view.append(root);
    const f = $("#nf404Form", root);
    if (f) f.addEventListener("submit", (e) => { e.preventDefault(); const v = $("#nf404Input", root).value.trim(); if (v) { location.hash = "#/catalog"; } });
    const inp = $("#nf404Input", root);
    if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const v = inp.value.trim(); if (v) { closePalette(); location.hash = "#/catalog"; setTimeout(() => openPalette(), 120); } } });
  }
  function navigateTo(slug) { if (slug && REGISTRY.has(slug)) location.hash = "#/item/" + encodeURIComponent(slug); }
  window.addEventListener("hashchange", route);

  /* ===================== REVEAL ===================== */
  let io;
  function revealIn(scope) {
    if (!io) io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.1, rootMargin: "0px 0px -6% 0px" });
    $$(".reveal:not(.in)", scope).forEach((n) => io.observe(n));
  }

  /* ===================== NAV / PROGRESS / THEME ===================== */
  const nav = $("#nav"), toTop = $("#toTop"), progress = $("#progress");
  let onReadingPage = false;
  function onScroll() {
    const y = window.scrollY;
    nav.classList.toggle("scrolled", y > 12);
    toTop.classList.toggle("show", y > 600);
    if (onReadingPage) {
      const hgt = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (hgt > 0 ? (y / hgt) * 100 : 0) + "%";
    }
  }
  function showProgress() { onReadingPage = true; progress.classList.add("visible"); progress.style.width = "0"; }
  function hideProgress() { onReadingPage = false; progress.classList.remove("visible"); progress.style.width = "0"; }
  window.addEventListener("scroll", onScroll, { passive: true });
  toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  const toggle = $("#navToggle"), links = $("#navLinks");
  toggle.setAttribute("aria-expanded", "false");
  // dynamic "Saved" nav link
  const savedLink = el("a", "nav-saved"); savedLink.href = "#/saved"; savedLink.dataset.nav = "saved";
  links.append(savedLink);
  function updateSavedNav() {
    savedLink.innerHTML = `★ Saved${saved.size ? ` <span class="nav-count">${saved.size}</span>` : ""}`;
    savedLink.classList.toggle("has", saved.size > 0);
    $$(".hub-card[href='#/saved'] p").forEach((p) => { p.textContent = saved.size ? `${saved.size} item${saved.size === 1 ? "" : "s"} you've starred.` : "Star items to build your own shelf."; });
  }
  updateSavedNav();
  toggle.addEventListener("click", (e) => { e.stopPropagation(); links.classList.toggle("open"); document.body.classList.toggle("nav-open"); toggle.setAttribute("aria-expanded", links.classList.contains("open")); });
  $$("#navLinks a", links).forEach((a) => a.addEventListener("click", () => { links.classList.remove("open"); document.body.classList.remove("nav-open"); }));
  document.addEventListener("click", (e) => {
    if (!links.classList.contains("open")) return;
    if (!links.contains(e.target) && !toggle.contains(e.target)) {
      links.classList.remove("open"); document.body.classList.remove("nav-open");
    }
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (!palette.hidden) return;
    if (e.key === "ArrowLeft" && kbdPrev) { e.preventDefault(); location.hash = "#/item/" + encodeURIComponent(kbdPrev); }
    else if (e.key === "ArrowRight" && kbdNext) { e.preventDefault(); location.hash = "#/item/" + encodeURIComponent(kbdNext); }
    else if (e.key === "r" && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); goRandom(); }
  });

  const themeBtn = $("#themeBtn"), THEMES = ["system", "light", "dark"];
  const SUN = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>`;
  const MOON = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
  const AUTO = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>`;
  function applyTheme(t) { if (t === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t); themeBtn.innerHTML = t === "light" ? SUN : t === "dark" ? MOON : AUTO; themeBtn.title = "Theme: " + t; }
  let theme; try { theme = localStorage.getItem("stekel-theme") || "system"; } catch(e) { theme = "system"; }
  applyTheme(theme);
  themeBtn.addEventListener("click", () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; try { localStorage.setItem("stekel-theme", theme); } catch(e) {} applyTheme(theme); });

  /* ===================== COMMAND PALETTE ===================== */
  const palette = $("#palette"), pInput = $("#paletteInput"), pResults = $("#paletteResults"), pHint = $("#paletteHint");
  let PLAIN = null, PLAINRAW = null, pItems = [], pSel = 0, pLastFocus = null;
  let plainBuilding = false;
  function buildPlain(onProgress) {
    if (PLAIN || plainBuilding || typeof CONTENT === "undefined") return;
    plainBuilding = true; PLAIN = {}; PLAINRAW = {};
    const slugs = Object.keys(CONTENT);
    let i = 0;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 0));
    function chunk(deadline) {
      const budget = deadline && deadline.timeRemaining ? () => deadline.timeRemaining() > 1 : (() => i % 24 !== 0);
      while (i < slugs.length && (budget() || i === 0)) {
        const s = slugs[i++]; const raw = plainFromHTML(CONTENT[s]); PLAINRAW[s] = raw; PLAIN[s] = raw.toLowerCase();
      }
      if (i < slugs.length) idle(chunk);
      else { plainBuilding = false; if (onProgress) onProgress(); }
    }
    idle(chunk);
  }
  function openPalette() {
    pLastFocus = document.activeElement;
    palette.hidden = false; document.body.style.overflow = "hidden";
    requestAnimationFrame(() => palette.classList.add("show"));
    pInput.value = ""; runSearch(""); pInput.focus();
    // build the full-text index in the background (chunked, non-blocking); re-run search when ready
    buildPlain(() => { if (!palette.hidden && pInput.value.trim().length >= 3) runSearch(pInput.value); });
  }
  function closePalette() { if (palette.hidden) return; palette.classList.remove("show"); document.body.style.overflow = ""; setTimeout(() => { palette.hidden = true; }, 220); if (pLastFocus) pLastFocus.focus(); }
  function coverMini(e) { return e.cover ? `<span class="p-cover"><img loading="lazy" src="${coverSrc(e.cover, "S")}" alt="" onerror="this.style.display='none'"></span>` : `<span class="p-cover">${ICON[e.kind === "museum" ? "museum" : e.kind === "book" ? "book" : "guide"] || ICON.book}</span>`; }
  function runSearch(q) {
    const term = q.trim().toLowerCase(), entries = [...REGISTRY.entries()];
    let meta = [];
    if (!term) { meta = entries.slice(0, 8).map(([slug, e]) => ({ slug, e })); pHint.textContent = REGISTRY.size + " entries · " + (typeof CONTENT !== "undefined" ? Object.keys(CONTENT).length : 0) + " pages"; }
    else {
      const scored = [];
      for (const [slug, e] of entries) { const t = e.title.toLowerCase(), s = (e.sub || "").toLowerCase(); let sc = -1; if (t === term) sc = 0; else if (t.startsWith(term)) sc = 1; else if (t.includes(term)) sc = 2; else if (s.includes(term)) sc = 4; if (sc >= 0) scored.push({ slug, e, sc }); }
      scored.sort((a, b) => a.sc - b.sc || a.e.title.localeCompare(b.e.title));
      meta = scored.slice(0, 8);
    }
    let text = [];
    if (term && term.length >= 3 && PLAIN) {
      const inMeta = new Set(meta.map((m) => m.slug));
      for (const slug in PLAIN) {
        if (inMeta.has(slug) || !REGISTRY.has(slug)) continue;
        const idx = PLAIN[slug].indexOf(term);
        if (idx >= 0) { const start = Math.max(0, idx - 45), raw = PLAIN[slug].slice(start, idx + term.length + 55); const snip = (start > 0 ? "…" : "") + esc(raw).replace(new RegExp("(" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "i"), "<mark>$1</mark>") + "…"; text.push({ slug, e: REGISTRY.get(slug), snip }); if (text.length >= 8) break; }
      }
    }
    const xref = term.length >= 2 ? [{ type: "xref", term }] : [];
    pItems = [...xref, ...meta.map((m) => ({ ...m, type: "meta" })), ...text.map((m) => ({ ...m, type: "text" }))];
    pSel = 0; renderResults(meta, text, term);
  }
  function xrefRow(term) {
    return `<div class="p-result p-xref" data-i="0"><span class="p-cover p-xref-ico">⌖</span><div class="p-main"><div class="p-title">Cross-reference "${esc(term)}" across the whole library</div><div class="p-sub">Gather every mention into one dossier page</div></div><span class="p-kind">↵</span></div>`;
  }
  function renderResults(meta, text, term) {
    let html = "";
    const hasX = term.length >= 2;
    const off = hasX ? 1 : 0;
    if (hasX) html += xrefRow(term);
    if (!meta.length && !text.length && !hasX) html = `<div class="palette-empty">No matches for "${esc(term)}".</div>`;
    if (meta.length) { html += `<div class="palette-group-label">${term ? "Best matches" : "Jump to"}</div>` + meta.map((m, i) => resultRow(m, off + i)).join(""); }
    if (text.length) { html += `<div class="palette-group-label">In the text</div>` + text.map((m, i) => resultRow(m, off + meta.length + i, m.snip)).join(""); }
    pResults.innerHTML = html;
    $$(".p-result", pResults).forEach((n, i) => { n.addEventListener("click", () => { pSel = i; openSelected(); }); n.addEventListener("mousemove", () => { pSel = i; highlight(); }); });
    highlight();
  }
  function resultRow(m, i, snip) {
    return `<div class="p-result" data-i="${i}">${coverMini(m.e)}<div class="p-main"><div class="p-title">${esc(m.e.title)}</div><div class="p-sub">${esc(m.e.sub || "")}</div>${snip ? `<div class="p-snip">${snip}</div>` : ""}</div><span class="p-kind">${kindLabel[m.e.kind] || m.e.kind}</span></div>`;
  }
  function highlight() { $$(".p-result", pResults).forEach((n, i) => { n.setAttribute("aria-selected", i === pSel ? "true" : "false"); if (i === pSel) n.scrollIntoView({ block: "nearest" }); }); }
  function openSelected() { const it = pItems[pSel]; if (!it) return; closePalette(); if (it.type === "xref") location.hash = "#/xref/" + encodeURIComponent(it.term); else navigateTo(it.slug); }
  let paletteSearchT;
  pInput.addEventListener("input", (e) => { clearTimeout(paletteSearchT); paletteSearchT = setTimeout(() => runSearch(e.target.value), 120); });
  pInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); pSel = Math.max(0, Math.min(Math.max(0, pItems.length - 1), pSel + 1)); highlight(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); pSel = Math.max(0, pSel - 1); highlight(); }
    else if (e.key === "Enter") { e.preventDefault(); openSelected(); }
    else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
  });
  palette.addEventListener("click", (e) => { if (e.target.hasAttribute("data-pclose")) closePalette(); });
  $("#paletteBtn").addEventListener("click", openPalette);
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palette.hidden ? openPalette() : closePalette(); }
    else if (e.key === "/" && palette.hidden && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); openPalette(); }
  });

  /* ===================== INIT ===================== */
  $("#year").textContent = new Date().getFullYear();
  route();

  /* ---- PWA: install as an app, work offline (served over http only) ---- */
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
})();
