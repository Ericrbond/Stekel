import { chromium } from "playwright";
import path from "path"; import { fileURLToPath } from "url";
const d = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errs=[]; p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await p.goto("file://"+path.join(d,"index.html"),{waitUntil:"networkidle"});

const total = await p.$$eval("#catalogGrid .card", c=>c.length);
// click Science tile (500)
await p.click('.tile[data-code="500"]');
await p.waitForTimeout(500);
const filtered = await p.$$eval("#catalogGrid .card", c=>c.length);
const pill = await p.$("#catalogMeta .filter-pill");
const pillText = pill ? await pill.innerText() : "(none)";
// clear via pill
if (pill) await pill.click();
await p.waitForTimeout(200);
const afterClear = await p.$$eval("#catalogGrid .card", c=>c.length);
// search
await p.fill("#searchInput","orwell");
await p.waitForTimeout(200);
const searchN = await p.$$eval("#catalogGrid .card", c=>c.length);
const searchTitles = await p.$$eval("#catalogGrid .card h4", n=>n.map(x=>x.textContent));
// filter chip museums
await p.fill("#searchInput","");
await p.click('.chip[data-kind="museum"]');
await p.waitForTimeout(200);
const museums = await p.$$eval("#catalogGrid .card", c=>c.length);

console.log(JSON.stringify({total,filtered,pillText,afterClear,searchN,searchTitles,museums,errors:errs},null,2));
await b.close();
