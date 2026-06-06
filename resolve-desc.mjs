import fs from "fs";
const src = fs.readFileSync("data.js","utf8");
const DEWEY = new Function(src.replace(/const COVERS[\s\S]*$/,"") + "; return DEWEY;")();
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const books=[]; DEWEY.forEach(d=>d.items.forEach(it=>{if(it.k==="book")books.push(it);}));

function clean(txt){
  if(!txt) return null;
  let t = typeof txt==="string"?txt:(txt.value||"");
  t = t.split("\n")[0].split("([")[0].replace(/\[\d+\]/g,"").replace(/\s+/g," ").trim();
  // trim to ~2 sentences / 280 chars
  if(t.length>300){ const cut=t.slice(0,300); const lastDot=cut.lastIndexOf(". "); t=(lastDot>120?cut.slice(0,lastDot+1):cut.trim()+"…"); }
  return t||null;
}
async function workKey(title,author){
  const q=new URLSearchParams({title,author:author||"",limit:"1",fields:"key"});
  try{const r=await fetch("https://openlibrary.org/search.json?"+q,{headers:{"User-Agent":"stekel/1.0"}});const j=await r.json();return j.docs&&j.docs[0]&&j.docs[0].key;}catch(e){return null;}
}
async function desc(key){
  try{const r=await fetch("https://openlibrary.org"+key+".json",{headers:{"User-Agent":"stekel/1.0"}});const j=await r.json();return clean(j.description);}catch(e){return null;}
}
const out={};
for(const b of books){
  const k=await workKey(b.t,b.a); await sleep(180);
  let d=null; if(k) { d=await desc(k); await sleep(180); }
  out[b.t]=d; console.log(d?"OK":"--",b.t.slice(0,32).padEnd(33), d?d.slice(0,50):"");
}
fs.writeFileSync("desc.json",JSON.stringify(out,null,2));
console.log("with desc:",Object.values(out).filter(Boolean).length,"/",books.length);
