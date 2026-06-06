import fs from "fs";
const src = fs.readFileSync("data.js","utf8");
const DEWEY = new Function(src + "; return DEWEY;")();

const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const books = [];
DEWEY.forEach(d=>d.items.forEach(it=>{ if(it.k==="book") books.push(it); }));

async function resolve(title, author){
  const q = new URLSearchParams({ title, author: author||"", limit:"1", fields:"cover_i,first_publish_year" });
  try {
    const r = await fetch("https://openlibrary.org/search.json?"+q.toString(),{headers:{"User-Agent":"stekel-site/1.0 (build)"}});
    if(!r.ok) return null;
    const j = await r.json();
    const doc = j.docs && j.docs[0];
    if(doc && doc.cover_i) return { cover: doc.cover_i, year: doc.first_publish_year||null };
  } catch(e){}
  return null;
}

const out = {};
for(const b of books){
  let res = await resolve(b.t, b.a);
  if(!res){ res = await resolve(b.t, ""); } // retry title-only
  out[b.t] = res;
  console.log((res?"OK":"--"), b.t, res?res.cover:"");
  await sleep(220);
}
fs.writeFileSync("covers.json", JSON.stringify(out,null,2));
console.log("resolved", Object.values(out).filter(Boolean).length, "/", books.length);
