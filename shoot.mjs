import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = "file://" + path.join(__dirname, "index.html");
const tag = process.argv[2] || "v";
const only = process.argv[3]; // optional: single section id

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

await page.goto(url, { waitUntil: "networkidle" });
// kill smooth scroll + force all reveals visible for clean capture
await page.addStyleTag({ content: `*{scroll-behavior:auto !important} .reveal{opacity:1 !important;transform:none !important}` });
await page.waitForTimeout(300);

const sections = only ? [only] : ["home","library","catalog","timelines","languages","documents","study","voices"];
for (const id of sections) {
  const elh = await page.$("#" + id);
  if (!elh) { console.log("missing", id); continue; }
  await elh.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await elh.screenshot({ path: `assets/${tag}-${id}.png` });
}

// hero clean
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
await page.screenshot({ path: `assets/${tag}-top.png` });

// mobile full
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
const mp = await m.newPage();
await mp.goto(url, { waitUntil: "networkidle" });
await mp.addStyleTag({ content: `*{scroll-behavior:auto !important}.reveal{opacity:1 !important;transform:none !important}` });
await mp.waitForTimeout(300);
await mp.screenshot({ path: `assets/${tag}-mobile-hero.png` });
await mp.screenshot({ path: `assets/${tag}-mobile.png`, fullPage: true });

console.log("done", tag, errs.length ? "ERRORS:" + errs.join("|") : "clean");
await browser.close();
