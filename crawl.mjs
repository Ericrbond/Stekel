import fs from "fs";
import { JSDOM } from "jsdom";
const slugs = fs.readFileSync("slugs.txt","utf8").split("\n").map(s=>s.trim()).filter(Boolean)
  .filter(s=>!/^(test|new-page|unk|stekel$)/.test(s) && s!=="test/2025/7/22/test");

const KEEP = new Set(["H1","H2","H3","H4","H5","H6","P","UL","OL","LI","STRONG","B","EM","I","U","BR","A","BLOCKQUOTE","HR","TABLE","THEAD","TBODY","TR","TD","TH"]);
function sanitize(node, doc){
  [...node.querySelectorAll("script,style,noscript")].forEach(n=>n.remove());
  const walk=(el)=>{
    [...el.children].forEach(c=>{
      walk(c);
      if(!KEEP.has(c.tagName)){
        // unwrap: replace element with its children
        const parent=c.parentNode;
        while(c.firstChild) parent.insertBefore(c.firstChild,c);
        parent.removeChild(c);
      } else {
        // strip attributes except href on A
        [...c.attributes].forEach(a=>{ if(!(c.tagName==="A"&&a.name==="href")) c.removeAttribute(a.name); });
        if(c.tagName==="A"){ c.setAttribute("target","_blank"); c.setAttribute("rel","noopener"); }
      }
    });
  };
  walk(node);
  return node.innerHTML.replace(/\s+/g," ").replace(/(&nbsp;)+/g," ").replace(/>\s+</g,"><").trim();
}

async function one(slug){
  try{
    const r=await fetch("https://stekel.org/"+slug,{headers:{"User-Agent":"Mozilla/5.0 stekel-mirror"}});
    if(!r.ok) return null;
    const h=await r.text();
    const doc=new JSDOM(h).window.document;
    const blocks=[...doc.querySelectorAll(".sqs-block-html .sqs-block-content")];
    if(!blocks.length) return null;
    const wrap=doc.createElement("div");
    blocks.forEach(b=>{ const d=doc.createElement("div"); d.innerHTML=b.innerHTML; while(d.firstChild) wrap.appendChild(d.firstChild); });
    let html=sanitize(wrap,doc);
    if(html.length>80000) html=html.slice(0,80000);
    return html.length>20?html:null;
  }catch(e){ return null; }
}

const out={}; let done=0, ok=0;
const QUEUE=[...slugs]; const CONC=5;
async function worker(){
  while(QUEUE.length){
    const s=QUEUE.shift();
    const c=await one(s); done++;
    if(c){ out[s]=c; ok++; }
    if(done%40===0) console.log(done+"/"+slugs.length+"  ok="+ok);
  }
}
await Promise.all(Array.from({length:CONC},worker));
fs.writeFileSync("content.js","/* Full page content mirrored from stekel.org — rich text per slug. */\nconst CONTENT = "+JSON.stringify(out)+";\n");
const bytes=fs.statSync("content.js").size;
console.log("CRAWL DONE pages="+ok+"/"+slugs.length+" size="+(bytes/1024|0)+"KB");
