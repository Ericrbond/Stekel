#!/usr/bin/env python3
"""
add_book.py — Interactively add a new book or museum to the Stekel catalogue.

Run:
    python3 /Users/eric/Desktop/Stekel/add_book.py
"""

import zipfile, re, json, shutil, os, subprocess, sys
from lxml import etree

# ─── Fixed paths (never change) ───────────────────────────────
STEKEL_DIR    = "/Users/eric/Desktop/Stekel"
CONTENT_JS    = f"{STEKEL_DIR}/content.js"
DATA_JS       = f"{STEKEL_DIR}/data.js"
SW_JS         = f"{STEKEL_DIR}/sw.js"
COVERS_DIR    = f"{STEKEL_DIR}/assets/covers"
STEKEL_ASSETS = f"{STEKEL_DIR}/assets/stekel"
def _load_secrets():
    """Read CF credentials from ~/.stekel_secrets (key=value lines)."""
    path = os.path.expanduser("~/.stekel_secrets")
    secrets = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                secrets[k.strip()] = v.strip()
    return secrets

_secrets      = _load_secrets()
CF_TOKEN      = _secrets.get("CF_TOKEN", "")
CF_ACCOUNT_ID = _secrets.get("CF_ACCOUNT_ID", "")
CF_BUCKET     = _secrets.get("CF_BUCKET", "stekel-assets")
IMAGE_EXTS    = {'.jpeg', '.jpg', '.png', '.webp'}

# ─── Helpers ──────────────────────────────────────────────────

def ask(prompt, default=None):
    """Prompt for input. Press Enter to accept the default."""
    if default:
        val = input(f"  {prompt} [{default}]: ").strip()
        return val if val else default
    else:
        val = ""
        while not val:
            val = input(f"  {prompt}: ").strip()
        return val

def ask_yn(prompt, default=True):
    hint = "Y/n" if default else "y/N"
    val = input(f"  {prompt} [{hint}]: ").strip().lower()
    if not val:
        return default
    return val.startswith('y')

def title_to_slug(title):
    """'A City on Mars' → 'a-city-on-mars'"""
    slug = title.lower()
    slug = re.sub(r"[''']", "", slug)
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug.strip())
    slug = re.sub(r"-+", "-", slug)
    return slug

def strip_folder_prefix(name):
    """'(2023) A City on Mars by Weinersmith' → 'A City on Mars by Weinersmith'"""
    return re.sub(r"^\(\d{4}\)\s*", "", name).strip()

def strip_author(name):
    """'A City on Mars by Weinersmith' → 'A City on Mars'"""
    return re.sub(r"\s+by\s+\S.*$", "", name, flags=re.IGNORECASE).strip()

def rename_for_web(filename):
    stem, ext = os.path.splitext(filename)
    stem = stem.replace("'", "").replace(".", "")
    stem = stem.replace(" ", "_")
    return stem + ext

# ─── Docx parser ──────────────────────────────────────────────

W   = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
SEP = '<p><strong>___________________________________________________________________________</strong></p>'

def get_style(p):
    ps = p.find(f'{W}pPr/{W}pStyle')
    return ps.get(f'{W}val', '') if ps is not None else ''

def get_ilvl(p):
    il = p.find(f'.//{W}ilvl')
    return int(il.get(f'{W}val', 0)) if il is not None else 0

def plain(p):
    return ''.join((n.text or '') for n in p.findall(f'.//{W}t'))

def runs_html(p):
    """Convert paragraph runs to HTML preserving exact bold/italic/underline/sup/sub from the docx."""
    out = ''
    for r in p.findall(f'.//{W}r'):
        rpr    = r.find(f'{W}rPr')
        bold   = rpr is not None and rpr.find(f'{W}b')  is not None
        ital   = rpr is not None and rpr.find(f'{W}i')  is not None
        under  = rpr is not None and rpr.find(f'{W}u')  is not None
        vAlign = rpr.find(f'{W}vertAlign') if rpr is not None else None
        is_sup = vAlign is not None and vAlign.get(f'{W}val') == 'superscript'
        is_sub = vAlign is not None and vAlign.get(f'{W}val') == 'subscript'
        parts  = []
        for node in r:
            tag = node.tag.replace(W, '')
            if tag == 't':
                parts.append((node.text or '').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;'))
            elif tag == 'br':
                parts.append('<br>')
        text = ''.join(parts)
        if not text:
            continue
        if is_sup:   text = f'<sup>{text}</sup>'
        elif is_sub: text = f'<sub>{text}</sub>'
        if bold:  text = f'<strong>{text}</strong>'
        if ital:  text = f'<em>{text}</em>'
        if under: text = f'<u>{text}</u>'
        out += text
    return out

def build_ul(items, pos, min_ilvl):
    """Build nested <ul> — sub-lists go INSIDE the parent <li>, not after it."""
    out = '<ul>'
    while pos < len(items):
        typ, ilvl, content = items[pos]
        if typ != 'list' or ilvl < min_ilvl:
            break
        if ilvl == min_ilvl:
            out += f'<li><p>{content}</p>'
            pos += 1
            if pos < len(items) and items[pos][0] == 'list' and items[pos][1] > min_ilvl:
                sub, pos = build_ul(items, pos, items[pos][1])
                out += sub
            out += '</li>'
        else:
            out += f'<li><p>{content}</p></li>'
            pos += 1
    return out + '</ul>', pos

def parse_docx(docx_path, title_display, ref_html):
    with zipfile.ZipFile(docx_path) as z:
        xml = z.read('word/document.xml')
    root  = etree.fromstring(xml)
    body  = root.find(f'{W}body')
    paras = body.findall(f'.//{W}p')

    items = []
    for i, p in enumerate(paras):
        style = get_style(p)
        ilvl  = get_ilvl(p)
        tx    = plain(p).strip()
        if i == 0:
            items.append(('title', 0, tx))
        elif i == 1:
            items.append(('ref', 0, tx))
        elif re.match(r'^_+$', tx):
            items.append(('sep', 0, SEP))
        elif style == 'Heading1':
            inner = runs_html(p)
            inner = re.sub(r'^---(.+?)---\s*$', lambda m: m.group(1).strip(), inner)
            items.append(('heading', 0, f'<h1><u><strong>{inner}</strong></u></h1>'))
        elif style == 'ListParagraph':
            items.append(('list', ilvl, runs_html(p)))
        elif tx:
            items.append(('para', 0, f'<p>{runs_html(p)}</p>'))

    html_parts = []
    i = 0
    while i < len(items):
        typ, ilvl, content = items[i]
        if typ == 'title':
            html_parts.append(f'<h1><u><strong>{title_display}</strong></u></h1>')
            i += 1
        elif typ == 'ref':
            html_parts.append(ref_html)
            i += 1
        elif typ in ('sep', 'heading', 'para'):
            html_parts.append(content)
            i += 1
        elif typ == 'list':
            ul, i = build_ul(items, i, ilvl)
            html_parts.append(ul)
        else:
            i += 1
    return ''.join(html_parts)

# ─── R2 upload ────────────────────────────────────────────────

def upload_to_r2(web_names):
    print(f"\n  Uploading {len(web_names)} images to R2...")
    failed = []
    for name in web_names:
        local = os.path.join(STEKEL_ASSETS, name)
        url   = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/r2/buckets/{CF_BUCKET}/objects/{name}"
        res   = subprocess.run([
            "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
            "-X", "PUT", url,
            "-H", f"Authorization: Bearer {CF_TOKEN}",
            "-H", "Content-Type: image/jpeg",
            "--data-binary", f"@{local}"
        ], capture_output=True, text=True)
        code = res.stdout.strip()
        status = "✓" if code == "200" else f"✗ (HTTP {code})"
        print(f"    {status}  {name}")
        if code != "200":
            failed.append(name)
    if failed:
        print(f"\n  WARNING: {len(failed)} upload(s) failed — rerun or upload manually.")
    return failed

# ─── SW version bump ──────────────────────────────────────────

def bump_sw():
    with open(SW_JS) as f:
        sw = f.read()
    m = re.search(r'"stekel-v(\d+)"', sw)
    if not m:
        print("  WARNING: could not parse SW version")
        return
    old, new = int(m.group(1)), int(m.group(1)) + 1
    with open(SW_JS, 'w') as f:
        f.write(sw.replace(f'"stekel-v{old}"', f'"stekel-v{new}"', 1))
    print(f"  sw.js: stekel-v{old} → stekel-v{new}")

# ─── Main ─────────────────────────────────────────────────────

def main():
    print("\n" + "═"*60)
    print("  STEKEL — Add New Book / Museum")
    print("═"*60 + "\n")

    # ── Step 1: Book folder ───────────────────────────────────
    print("STEP 1: Book folder")
    print("  Drag the book folder into this window (or type the path):")
    raw_dir = input("  Folder: ").strip().strip("'\"")
    book_dir = raw_dir.rstrip("/")
    if not os.path.isdir(book_dir):
        print(f"  ERROR: folder not found: {book_dir}")
        sys.exit(1)
    folder_name = os.path.basename(book_dir)
    clean_name  = strip_author(strip_folder_prefix(folder_name))
    print(f"  Found: {folder_name}\n")

    # ── Step 2: Detect .docx ─────────────────────────────────
    print("STEP 2: Word document")
    docx_files = [f for f in os.listdir(book_dir) if f.lower().endswith('.docx')]
    if len(docx_files) == 1:
        docx_file = docx_files[0]
        print(f"  Auto-detected: {docx_file}")
    elif len(docx_files) == 0:
        print("  ERROR: no .docx file found in that folder.")
        sys.exit(1)
    else:
        print("  Multiple .docx files found:")
        for i, f in enumerate(docx_files):
            print(f"    {i+1}. {f}")
        choice = int(ask("Which one? (enter number)")) - 1
        docx_file = docx_files[choice]
    docx_path = os.path.join(book_dir, docx_file)
    print()

    # ── Step 3: Detect cover image ───────────────────────────
    print("STEP 3: Cover image")
    img_files = [f for f in os.listdir(book_dir) if os.path.splitext(f)[1].lower() in IMAGE_EXTS]
    # Prefer file whose stem matches the docx name
    docx_stem   = os.path.splitext(docx_file)[0]
    cover_match = [f for f in img_files if os.path.splitext(f)[0] == docx_stem]
    if cover_match:
        cover_file = cover_match[0]
        print(f"  Auto-detected: {cover_file}")
    elif img_files:
        print("  Image files found:")
        print("    0. No cover")
        for i, f in enumerate(img_files):
            print(f"    {i+1}. {f}")
        choice = int(ask("Which is the cover? (0 for none)"))
        cover_file = img_files[choice-1] if choice > 0 else ""
    else:
        cover_file = ""
        print("  No images found — skipping cover.")
    print()

    # ── Step 4: Slug ─────────────────────────────────────────
    print("STEP 4: URL slug")
    suggested_slug = title_to_slug(clean_name)
    slug = ask("Slug (title words only, hyphens, no author)", suggested_slug)
    print()

    # ── Step 5: Display title ─────────────────────────────────
    print("STEP 5: Display title (appears as the page heading)")
    title_display = ask("Title", clean_name)
    print()

    # ── Step 6: Ref line ──────────────────────────────────────
    print("STEP 6: Reference line")
    print("  This goes at the top of the page under the title.")
    print("  For a book:   Author (Year). <em>Title</em>. Publisher.")
    print("  For a museum: Museum Name (year). Location.")
    print()
    kind = ask("Kind", "book")
    if kind.lower() == "book":
        authors   = ask("Author(s) — e.g. 'Kelly & Zach Weinersmith'")
        year      = ask("Year — e.g. '2023'")
        em_title  = ask("Book title (italicised)")
        publisher = ask("Publisher")
        authors_esc  = authors.replace('&', '&amp;')
        em_title_esc = em_title.replace('&', '&amp;')
        publisher_esc = publisher.replace('&', '&amp;')
        ref_html = (
            f'<p><u><strong>Ref</strong></u><strong>: {authors_esc} ({year}). '
            f'<em>{em_title_esc}</em>. {publisher_esc}.</strong></p>'
        )
    else:
        museum_name = ask("Museum name")
        year        = ask("Year")
        location    = ask("Location")
        museum_esc  = museum_name.replace('&', '&amp;')
        location_esc = location.replace('&', '&amp;')
        ref_html = f'<p>Ref: <em>{museum_esc}</em> ({year}). {location_esc}.</p>'
    print(f"\n  Ref HTML: {ref_html}\n")

    # ── Step 7: Page images ───────────────────────────────────
    print("STEP 7: Page images")
    page_imgs = [
        f for f in os.listdir(book_dir)
        if os.path.splitext(f)[1].lower() in IMAGE_EXTS and f != cover_file
    ]
    page_imgs.sort()
    if page_imgs:
        print(f"  Found {len(page_imgs)} page image(s) in the folder.")
        has_images = ask_yn("Add them as a captioned gallery at the bottom?", True)
    else:
        has_images = False
        print("  No page images found — skipping gallery.\n")

    if has_images:
        image_pairs = [(f, rename_for_web(f)) for f in page_imgs]
        print(f"\n  Images to upload ({len(image_pairs)}):")
        for orig, web in image_pairs:
            changed = " (renamed)" if orig != web else ""
            print(f"    {orig}{changed}")
        print()

    # ── Confirm ───────────────────────────────────────────────
    print("─"*60)
    print("  Ready to proceed:")
    print(f"    Slug:   {slug}")
    print(f"    Title:  {title_display}")
    print(f"    Ref:    {ref_html[:80]}{'...' if len(ref_html)>80 else ''}")
    print(f"    Cover:  {cover_file or '(none)'}")
    print(f"    Images: {len(page_imgs) if has_images else 0}")
    print("─"*60)
    if not ask_yn("\n  Proceed?", True):
        print("  Aborted.")
        sys.exit(0)
    print()

    # ── Execute ───────────────────────────────────────────────
    files_to_commit = ["content.js", "data.js", "sw.js"]

    # Parse docx → HTML → content.js
    print("Parsing docx...")
    html = parse_docx(docx_path, title_display, ref_html)
    print(f"  {len(html):,} chars generated")
    with open(CONTENT_JS) as f:
        raw = f.read()
    json_str = raw[raw.index('{'):raw.rindex('}')+1]
    data = json.loads(json_str)
    action = "Replacing" if slug in data else "Adding"
    data[slug] = html
    new_json = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    with open(CONTENT_JS, 'w') as f:
        f.write('var CONTENT=' + new_json + ';')
    print(f"  {action} '{slug}' in content.js ✓")

    # Cover image
    if cover_file:
        ext  = os.path.splitext(cover_file)[1].lower()
        dest = os.path.join(COVERS_DIR, slug + ext)
        shutil.copy2(os.path.join(book_dir, cover_file), dest)
        cover_rel = f"assets/covers/{slug}{ext}"
        files_to_commit.append(cover_rel)
        print(f"  Cover copied to {cover_rel} ✓")

    # Page images: copy + data.js update + R2 upload
    if has_images:
        web_names = []
        for orig, web in image_pairs:
            shutil.copy2(os.path.join(book_dir, orig), os.path.join(STEKEL_ASSETS, web))
            web_names.append(web)
        print(f"  {len(web_names)} images copied to assets/stekel/ ✓")

        with open(DATA_JS) as f:
            djs = f.read()

        # Add galleryEnd: true
        slug_line = f'"slug": "{slug}",'
        if f'"slug": "{slug}",\n        "galleryEnd": true' not in djs:
            if slug_line in djs:
                djs = djs.replace(slug_line,
                    f'"slug": "{slug}",\n        "galleryEnd": true,', 1)
                print(f"  galleryEnd: true added to data.js ✓")
            else:
                print(f"  WARNING: slug '{slug}' not found in data.js — add the item entry manually.")
        else:
            print(f"  galleryEnd already set ✓")

        # Add PAGE_IMAGES entry
        pi_start = djs.find('var PAGE_IMAGES')
        if pi_start != -1 and f'"{slug}":' not in djs[pi_start:]:
            brace = djs.index('{', pi_start)
            entry = json.dumps(web_names, ensure_ascii=False)
            djs = djs[:brace+1] + f'\n  "{slug}": {entry},' + djs[brace+1:]
            print(f"  PAGE_IMAGES entry added ({len(web_names)} images) ✓")

        with open(DATA_JS, 'w') as f:
            f.write(djs)

        upload_to_r2(web_names)

    # Bump SW cache
    bump_sw()

    # Git instructions
    print("\n" + "═"*60)
    print("  All done! Run these commands to deploy:")
    print("═"*60)
    print(f"  cd {STEKEL_DIR}")
    print(f"  git add {' '.join(files_to_commit)}")
    print(f'  git commit -m "Add {title_display}"')
    print( "  git push origin main")
    print(f"\n  Live in ~30s at:")
    print(f"  https://stekel-gamma.vercel.app/#/item/{slug}\n")


if __name__ == "__main__":
    main()
