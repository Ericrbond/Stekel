import fs from "fs";
const buckets = JSON.parse(fs.readFileSync("buckets.json","utf8"));
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

const OVERRIDES = {
  "7-1/2-lessons":"Seven and a Half Lessons About the Brain",
  "geb":"Gödel Escher Bach","spqr":"SPQR Mary Beard","les-mis":"Les Misérables",
  "six-easy-pieces":"Six Easy Pieces Feynman","surely-youre-joking-mr-feynman":"Surely You're Joking Mr Feynman",
  "the-curve-of-binding-energy":"The Curve of Binding Energy McPhee","curve-of-binding-energy":"The Curve of Binding Energy McPhee",
  "geb":"Godel Escher Bach Hofstadter","joy-of-x":"The Joy of x Strogatz",
  "alls-quiet-on-the-western-front":"All Quiet on the Western Front",
  "21-lessons-for-the-21-century":"21 Lessons for the 21st Century",
};
function deslug(s){
  if(OVERRIDES[s]) return OVERRIDES[s];
  let t=s.replace(/-by-[a-z]+$/,"").replace(/-/g," ");
  return t.replace(/\b\w/g,c=>c.toUpperCase()).replace(/\bOf\b/g,"of").replace(/\bThe\b/g,(m,i)=>i===0?"The":"the").replace(/\bAnd\b/g,"and").replace(/\bA\b/g,(m,i)=>i===0?"A":"a");
}
function classFromDdc(ddc){
  if(!ddc||!ddc.length) return null;
  for(const d of ddc){ const m=String(d).match(/(\d)/); if(m) return (m[1]+"00"); }
  return null;
}
async function res(title){
  const q=new URLSearchParams({q:title,limit:"1",fields:"title,author_name,cover_i,ddc,key,first_publish_year"});
  try{
    const r=await fetch("https://openlibrary.org/search.json?"+q,{headers:{"User-Agent":"stekel/1.0"}});
    if(!r.ok) return null; const j=await r.json(); const d=j.docs&&j.docs[0]; if(!d) return null;
    return { a:(d.author_name&&d.author_name[0])||"", cover:d.cover_i||null, code:classFromDdc(d.ddc), key:d.key||null, oltitle:d.title||"" };
  }catch(e){return null;}
}
const out=[];
let i=0;
for(const s of buckets.book){
  const t=deslug(s); const r=await res(t); i++;
  out.push({ slug:s, t, ...(r||{a:"",cover:null,code:null,key:null}) });
  if(i%20===0) console.log(i+"/"+buckets.book.length);
  await sleep(150);
}
fs.writeFileSync("catalog-raw.json",JSON.stringify(out,null,2));
const withCover=out.filter(x=>x.cover).length, withClass=out.filter(x=>x.code).length;
console.log("books",out.length,"| covers",withCover,"| ddc-class",withClass);
