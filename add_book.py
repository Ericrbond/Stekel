#!/usr/bin/env python3
"""
add_book.py — Interactively add a new book or museum to the Stekel catalogue.

Run:
    python3 /Users/eric/Desktop/Stekel/add_book.py
"""

import zipfile, re, json, shutil, os, subprocess, sys
from lxml import etree

# ─── Fixed paths ──────────────────────────────────────────────
STEKEL_DIR    = "/Users/eric/Desktop/Stekel"
CONTENT_JS    = f"{STEKEL_DIR}/content.js"
DATA_JS       = f"{STEKEL_DIR}/data.js"
SW_JS         = f"{STEKEL_DIR}/sw.js"
COVERS_DIR    = f"{STEKEL_DIR}/assets/covers"
STEKEL_ASSETS = f"{STEKEL_DIR}/assets/stekel"
IMAGE_EXTS    = {'.jpeg', '.jpg', '.png', '.webp'}

def _load_secrets():
    path = os.path.expanduser("~/.stekel_secrets")
    secrets = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                secrets[k.strip()] = v.strip()
    return secrets

_sec          = _load_secrets()
CF_TOKEN      = _sec.get("CF_TOKEN", "")
CF_ACCOUNT_ID = _sec.get("CF_ACCOUNT_ID", "")
CF_BUCKET     = _sec.get("CF_BUCKET", "stekel-assets")

# ─── Prompts ──────────────────────────────────────────────────

def ask(prompt, default=None):
    if default:
        val = input(f"  {prompt} [{default}]: ").strip()
        return val if val else default
    val = ""
    while not val:
        val = input(f"  {prompt}: ").strip()
    return val

def ask_yn(prompt, default=True):
    hint = "Y/n" if default else "y/N"
    val = input(f"  {prompt} [{hint}]: ").strip().lower()
    return val.startswith('y') if val else default

# ─── Name helpers ─────────────────────────────────────────────

def title_to_slug(title):
    s = title.lower()
    s = re.sub(r"[''']", "", s)
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s.strip())
    return re.sub(r"-+", "-", s)

def strip_folder_prefix(name):
    return re.sub(r"^\(\d{4}\)\s*", "", name).strip()

def strip_author(name):
    return re.sub(r"\s+by\s+\S.*$", "", name, flags=re.IGNORECASE).strip()

def rename_for_web(filename):
    stem, ext = os.path.splitext(filename)
    stem = re.sub(r"['.,()\[\]]", "", stem)
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

# ─── data.js helpers (JSON-safe) ──────────────────────────────

def load_dewey():
    """Parse data.js and return (prefix, dewey_list, suffix)."""
    with open(DATA_JS) as f:
        raw = f.read()
    m = re.search(r'(const DEWEY\s*=\s*)(\[)', raw)
    if not m:
        raise ValueError("Cannot find 'const DEWEY = [' in data.js")
    pre_end = m.start(2)
    # Find the matching closing ]
    depth, pos = 0, pre_end
    while pos < len(raw):
        if raw[pos] == '[': depth += 1
        elif raw[pos] == ']':
            depth -= 1
            if depth == 0:
                arr_end = pos + 1
                break
        pos += 1
    prefix  = raw[:pre_end]
    suffix  = raw[arr_end:]
    dewey   = json.loads(raw[pre_end:arr_end])
    return prefix, dewey, suffix

def save_dewey(prefix, dewey, suffix):
    """Write data.js back with pretty-printed DEWEY array."""
    # Use 2-space indent to match original style
    arr_str = json.dumps(dewey, ensure_ascii=False, indent=2)
    with open(DATA_JS, 'w') as f:
        f.write(prefix + arr_str + suffix)

def slug_in_dewey(dewey, slug):
    for section in dewey:
        for item in section.get('items', []):
            if item.get('slug') == slug:
                return True
    return False

def insert_item_in_dewey(dewey, new_item, dewey_code):
    """
    Insert new_item into the correct section and position based on dewey_code.
    Items within a section are sorted numerically by dewey sub-code.
    """
    code_prefix = dewey_code.split('.')[0]  # e.g. "891" → "800" section
    # Find the section whose code range covers this dewey number
    target_section = None
    for section in dewey:
        sec_code = section.get('code', '')
        try:
            if int(sec_code) <= int(code_prefix) < int(sec_code) + 100:
                target_section = section
                break
        except ValueError:
            continue

    if target_section is None:
        print(f"  WARNING: no section found for dewey {dewey_code} — appending to last section.")
        target_section = dewey[-1]

    items = target_section.setdefault('items', [])

    # Insert in sorted dewey order
    def sort_key(item):
        try:
            return float(item.get('dewey', '0'))
        except ValueError:
            return 0.0

    try:
        new_key = float(dewey_code)
    except ValueError:
        new_key = 0.0

    insert_at = len(items)
    for i, item in enumerate(items):
        try:
            if float(item.get('dewey', '0')) > new_key:
                insert_at = i
                break
        except ValueError:
            pass

    items.insert(insert_at, new_item)
    print(f"  Inserted at position {insert_at} in section {target_section['code']} ✓")
    return dewey

def add_gallery_end(dewey, slug):
    for section in dewey:
        for item in section.get('items', []):
            if item.get('slug') == slug:
                if not item.get('galleryEnd'):
                    item['galleryEnd'] = True
                    print(f"  galleryEnd: true set ✓")
                return dewey
    print(f"  WARNING: slug '{slug}' not found in DEWEY for galleryEnd")
    return dewey

def register_cover(title, local_filename):
    """Add entry to COVERS keyed by book title."""
    with open(DATA_JS) as f:
        d = f.read()
    covers_start = d.find('const COVERS')
    covers_brace = d.index('{', covers_start)
    depth, pos = 0, covers_brace
    while pos < len(d):
        if d[pos] == '{': depth += 1
        elif d[pos] == '}':
            depth -= 1
            if depth == 0:
                covers_end = pos + 1
                break
        pos += 1
    covers = json.loads(d[covers_brace:covers_end])
    if title in covers:
        print(f"  COVERS entry already exists for '{title}' ✓")
        return
    covers[title] = {"local": local_filename}
    new_d = d[:covers_brace] + json.dumps(covers, ensure_ascii=False, indent=2) + d[covers_end:]
    with open(DATA_JS, 'w') as f:
        f.write(new_d)
    print(f"  COVERS['{title}'] = {local_filename!r} ✓")

def add_page_images_entry(slug, web_names):
    """Insert PAGE_IMAGES entry using simple string insert at top of the object."""
    with open(DATA_JS) as f:
        djs = f.read()
    pi_start = djs.find('var PAGE_IMAGES')
    if pi_start == -1:
        pi_start = djs.find('const PAGE_IMAGES')
    if pi_start == -1:
        print("  WARNING: PAGE_IMAGES not found in data.js")
        return
    marker = f'"{slug}":'
    if marker in djs[pi_start:]:
        print(f"  PAGE_IMAGES entry already exists ✓")
        return
    brace = djs.index('{', pi_start)
    entry = json.dumps(web_names, ensure_ascii=False)
    djs = djs[:brace+1] + f'\n  "{slug}": {entry},' + djs[brace+1:]
    with open(DATA_JS, 'w') as f:
        f.write(djs)
    print(f"  PAGE_IMAGES: {len(web_names)} images added ✓")

# ─── R2 upload ────────────────────────────────────────────────

def upload_to_r2(web_names):
    print(f"\n  Uploading {len(web_names)} image(s) to R2...")
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
        print(f"    {'✓' if code=='200' else '✗ HTTP '+code}  {name}")
        if code != "200":
            failed.append(name)
    if failed:
        print(f"\n  WARNING: {len(failed)} upload(s) failed.")
    return failed

# ─── SW bump ──────────────────────────────────────────────────

def bump_sw():
    with open(SW_JS) as f:
        sw = f.read()
    m = re.search(r'"stekel-v(\d+)"', sw)
    if not m:
        return
    old, new = int(m.group(1)), int(m.group(1)) + 1
    with open(SW_JS, 'w') as f:
        f.write(sw.replace(f'"stekel-v{old}"', f'"stekel-v{new}"', 1))
    print(f"  sw.js: stekel-v{old} → stekel-v{new} ✓")

# ─── Main ─────────────────────────────────────────────────────

def main():
    print("\n" + "═"*60)
    print("  STEKEL — Add New Book / Museum")
    print("═"*60 + "\n")

    # Step 1: folder
    print("STEP 1: Book folder")
    print("  Drag the folder into this window (or type the path):")
    raw_dir  = input("  Folder: ").strip().strip("'\"")
    book_dir = raw_dir.rstrip("/")
    if not os.path.isdir(book_dir):
        print(f"  ERROR: folder not found: {book_dir}"); sys.exit(1)
    folder_name = os.path.basename(book_dir)
    clean_name  = strip_author(strip_folder_prefix(folder_name))
    print(f"  Found: {folder_name}\n")

    # Step 2: .docx
    print("STEP 2: Word document")
    docx_files = [f for f in os.listdir(book_dir) if f.lower().endswith('.docx')]
    if len(docx_files) == 1:
        docx_file = docx_files[0]
        print(f"  Auto-detected: {docx_file}")
    elif not docx_files:
        print("  ERROR: no .docx file found."); sys.exit(1)
    else:
        for i, f in enumerate(docx_files): print(f"    {i+1}. {f}")
        docx_file = docx_files[int(ask("Which one?")) - 1]
    docx_path = os.path.join(book_dir, docx_file)
    print()

    # Step 3: cover image
    print("STEP 3: Cover image")
    img_files   = [f for f in os.listdir(book_dir) if os.path.splitext(f)[1].lower() in IMAGE_EXTS]
    docx_stem   = os.path.splitext(docx_file)[0]
    cover_match = [f for f in img_files if os.path.splitext(f)[0] == docx_stem]
    if cover_match:
        cover_file = cover_match[0]
        print(f"  Auto-detected: {cover_file}")
    elif img_files:
        print("    0. No cover")
        for i, f in enumerate(img_files): print(f"    {i+1}. {f}")
        choice = int(ask("Which is the cover? (0 for none)"))
        cover_file = img_files[choice-1] if choice > 0 else ""
    else:
        cover_file = ""
        print("  No images found.")
    print()

    # Step 4: slug
    print("STEP 4: URL slug  (title words only, hyphens, no author)")
    slug = ask("Slug", title_to_slug(clean_name))
    print()

    # Step 5: display title
    print("STEP 5: Display title")
    title_display = ask("Title", clean_name)
    print()

    # Step 6: Dewey code
    print("STEP 6: Dewey decimal code")
    print("  Check data.js for the right section. Examples: 823.914, 891.73, 613.2")
    dewey_code = ask("Dewey code")
    print()

    # Step 7: Ref line
    print("STEP 7: Reference line")
    kind = ask("Kind (book / museum)", "book")
    if kind.lower() == "book":
        authors      = ask("Author(s)")
        year         = ask("Year")
        em_title     = ask("Book title (will be italicised)", title_display)
        publisher    = ask("Publisher")
        ref_html = (
            f'<p><u><strong>Ref</strong></u><strong>: '
            f'{authors.replace("&","&amp;")} ({year}). '
            f'<em>{em_title.replace("&","&amp;")}</em>. '
            f'{publisher.replace("&","&amp;")}.</strong></p>'
        )
    else:
        museum_name = ask("Museum name")
        year        = ask("Year")
        location    = ask("Location")
        ref_html = (
            f'<p>Ref: <em>{museum_name.replace("&","&amp;")}</em> '
            f'({year}). {location.replace("&","&amp;")}.</p>'
        )
    print(f"\n  → {ref_html}\n")

    # Step 8: page images
    print("STEP 8: Page images")
    page_imgs = sorted([
        f for f in os.listdir(book_dir)
        if os.path.splitext(f)[1].lower() in IMAGE_EXTS and f != cover_file
    ])
    if page_imgs:
        print(f"  Found {len(page_imgs)} page image(s).")
        has_images = ask_yn("Add as a captioned gallery at the bottom?", True)
    else:
        has_images = False
        print("  No page images found.\n")

    if has_images:
        image_pairs = [(f, rename_for_web(f)) for f in page_imgs]
        print(f"\n  Will upload:")
        for orig, web in image_pairs:
            tag = f"  → {web}" if orig != web else ""
            print(f"    {orig}{tag}")
        print()

    # Confirm
    print("─"*60)
    print(f"  Slug:   {slug}")
    print(f"  Title:  {title_display}")
    print(f"  Dewey:  {dewey_code}")
    print(f"  Cover:  {cover_file or '(none)'}")
    print(f"  Images: {len(page_imgs) if has_images else 0}")
    print("─"*60)
    if not ask_yn("\n  Proceed?", True):
        print("  Aborted."); sys.exit(0)
    print()

    # ── Execute ───────────────────────────────────────────────
    files_to_commit = ["content.js", "data.js", "sw.js"]

    # content.js
    print("Parsing docx → content.js...")
    html = parse_docx(docx_path, title_display, ref_html)
    print(f"  {len(html):,} chars generated")
    with open(CONTENT_JS) as f:
        raw = f.read()
    data = json.loads(raw[len('var CONTENT='):-1])
    action = "Replacing" if slug in data else "Adding"
    data[slug] = html
    with open(CONTENT_JS, 'w') as f:
        f.write('var CONTENT=' + json.dumps(data, ensure_ascii=False, separators=(',',':')) + ';')
    print(f"  {action} '{slug}' ✓")

    # data.js — DEWEY item + optional galleryEnd
    print("\nUpdating data.js (DEWEY)...")
    prefix, dewey, suffix = load_dewey()
    if slug_in_dewey(dewey, slug):
        print(f"  Item already exists in DEWEY")
        if has_images:
            dewey = add_gallery_end(dewey, slug)
    else:
        new_item = {
            "t": title_display,
            "a": authors if kind.lower() == "book" else museum_name,
            "k": kind.lower(),
            "slug": slug,
            "dewey": dewey_code,
        }
        if has_images:
            new_item["galleryEnd"] = True
        dewey = insert_item_in_dewey(dewey, new_item, dewey_code)
    save_dewey(prefix, dewey, suffix)
    print(f"  data.js saved ✓")

    # cover
    if cover_file:
        ext       = os.path.splitext(cover_file)[1].lower()
        cover_web = slug + ext
        dest      = os.path.join(COVERS_DIR, cover_web)
        shutil.copy2(os.path.join(book_dir, cover_file), dest)
        rel = f"assets/covers/{cover_web}"
        files_to_commit.append(rel)
        print(f"\nCover → {rel} ✓")
        register_cover(title_display, cover_web)

    # images
    if has_images:
        web_names = []
        for orig, web in image_pairs:
            shutil.copy2(os.path.join(book_dir, orig), os.path.join(STEKEL_ASSETS, web))
            web_names.append(web)
        print(f"\n{len(web_names)} images copied to assets/stekel/ ✓")
        add_page_images_entry(slug, web_names)
        upload_to_r2(web_names)

    # SW bump
    print()
    bump_sw()

    # git
    print("\n" + "═"*60)
    print("  Done! Run these commands to deploy:")
    print("═"*60)
    print(f"  cd {STEKEL_DIR}")
    print(f"  git add {' '.join(files_to_commit)}")
    print(f'  git commit -m "Add {title_display}"')
    print( "  git push origin main")
    print(f"\n  https://stekel-gamma.vercel.app/#/item/{slug}\n")


if __name__ == "__main__":
    main()
