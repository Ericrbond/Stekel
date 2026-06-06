import fs from "fs";
const raw = JSON.parse(fs.readFileSync("catalog-raw.json","utf8"));
const buckets = JSON.parse(fs.readFileSync("buckets.json","utf8"));

// load existing static sections + class metadata + curated descriptions
const oldSrc = fs.readFileSync("data.js","utf8");
const G = new Function(oldSrc + "; return {DEWEY,TIMELINES,LANGUAGES,DOCUMENTS,PROGRAMS,INTERVIEWS,QUOTES,BIOS,DESCRIPTIONS:(typeof DESCRIPTIONS!=='undefined'?DESCRIPTIONS:{})};")();

const STOP=new Set(["the","a","an","of","and","to","in","is","for","on","by","how","are","were","not"]);
const norm=(s)=>s.toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const sig=(s)=>norm(s).split(" ").filter(w=>w&&!STOP.has(w));
function matches(deslug,oltitle){
  if(!oltitle) return false;
  const o=norm(oltitle), s=sig(deslug);
  if(!s.length) return true;
  if(o.includes(norm(deslug))) return true;
  const hit=s.filter(w=>o.includes(w)).length;
  return hit/s.length>=0.6;
}

// class heuristic for missing ddc
function heur(t){
  const s=norm(t);
  const has=(...ws)=>ws.some(w=>s.includes(w));
  if(has("money","invest","wealth","econom","market","stock","estate","rich","millionaire","startup","budget","financ")) return "300";
  if(has("war","milit","strateg","navy","fleet","seapower","battle","army","marine","revolution","empire","khan","troy","rome","frigate","crossing","centurion","globalism","defeat","campaign")) return "900";
  if(has("histor","africa","china","america","constitution","leopold","truths","samburu","independence")) return "900";
  if(has("physic","quantum","climate","ecolog","geolog","disease","virus","brain","biolog","univers","planet","earth","weather","nature","animal","dinosaur","mammal","telomere","biochem","statistic","immune","extinction","carbon","banana","water","hydrolog","sustainab","capital")) return "500";
  if(has("engineer","lockpick","valve","battery","future of the","superintellig","comput","robot")) return "600";
  if(has("medit","stoic","nietzsche","pleasure","empathy","mind","think","focus","peak","flow","habit","obstacle","superman","narwhal","melancholy")) return "100";
  return "800";
}

// title display fixups
const FIX={"7-1/2-lessons":"Seven and a Half Lessons","spqr":"SPQR","geb":"Gödel, Escher, Bach","les-mis":"Les Misérables",
  "alls-quiet-on-the-western-front":"All Quiet on the Western Front","21-lessons-for-the-21-century":"21 Lessons for the 21st Century",
  "ghengis-khan":"Genghis Khan","whose-afraid-of-carl":"Who's Afraid of Carl"};
function disp(slug,t){ if(FIX[slug])return FIX[slug]; return t; }

const CLASS_OVERRIDE = {
  "100 Years of Sea Power":"900","A Promised Land":"900","Back To Work":"900","My Life":"900",
  "Decision Points":"900","Bullets Not Ballots":"900","Drone Theory":"900","Documents That Changed the World":"900",
  "There Goes Robert E Lee":"900","The Boundless Sea":"900","Turn Right At Machu Picchu":"900","Yemen":"900",
  "Best Things First":"300","Superforecasting":"300","Man V Markets":"300","The Money Book":"300",
  "The 2023 Global Risks Report":"300","Ghettoside":"300","Missoula":"300","Poor Economics":"300",
  "The Anxious Generation":"300","Transforming Leadership":"300","Five Stars":"600","Tools of Titans":"600",
  "Moonwalking With Einstein":"100","Stealing Fire":"100","Mistakes Were Made":"100","Debating To Win Arguments":"100",
  "The God Equation":"500","The Future of Humanity":"500","Restoring Paradise":"500","Collapse":"300",
  "Aesir With Carlin":"200","Mythos":"200","SPQR":"900","Deep Time":"800","Oceans":"500","Heroes":"200",
  "An Incomplete Education":"000","Engineering In Plain Sight":"600","Factfulness":"000","Documents That Changed the World":"000",
};
const BAD_MATCH = new Set(["Columbus","Earth","The Body","Immune","The Gamble","Countdown","Bewac","Contact Bedford","Wash Your Hands"]);

// BUILD BOOKS
let books = raw.map(x=>{
  const t = disp(x.slug, x.t);
  let ok = matches(x.t, x.oltitle);
  if (BAD_MATCH.has(t)) ok = false;
  return {
    t,
    a: ok ? (x.a||"") : "",
    k: "book",
    code: CLASS_OVERRIDE[t] || x.code || heur(x.t),
    cover: ok ? (x.cover||null) : null,
    key: ok ? (x.key||null) : null,
    slug: x.slug,
  };
});
// dedupe by title (keep the one with a cover if any)
const seen = new Map();
for (const b of books) { const k=b.t.toLowerCase(); if(!seen.has(k)||(!seen.get(k).cover&&b.cover)) seen.set(k,b); }
books = [...seen.values()];

// BUILD MUSEUMS
const MUSEUM_FIX={"usmc-museum":"National Museum of the Marine Corps","mcaad-museum":"Milken Center for the American Dream",
 "epa-museum":"EPA Museum","nyc-public-library-rare-books-museum":"NYPL Rare Books Division","mcclung-museum":"McClung Museum",
 "mount-st-helens-national-volcanic-monument":"Mount St. Helens Nat'l Volcanic Monument","us-national-gallery-of-art":"National Gallery of Art",
 "us-national-portrait-gallery":"National Portrait Gallery","african-american-museum":"National African American Museum",
 "american-indian-museum":"National Museum of the American Indian","the-george-washington-masonic-national-memorial":"George Washington Masonic Memorial",
 "the-henry-ford-museum":"The Henry Ford Museum","museo-larco":"Museo Larco","museo-amazonico":"Museo Amazónico","museo-arqueologia-lima":"Museo de Arqueología, Lima",
 "landesmuseum-wurttemberg":"Landesmuseum Württemberg","robben-island-museum":"Robben Island Museum","rijksmuseum":"Rijksmuseum",
 "royal-museum-of-fine-arts-of-belgium":"Royal Museum of Fine Arts, Belgium","table-mountain-national-park":"Table Mountain National Park",
 "balls-bluff-battlefield-park":"Ball's Bluff Battlefield","wright-brothers":"Wright Brothers National Memorial","fort-raleigh":"Fort Raleigh Historic Site",
 "namibia-independence-museum":"Namibia Independence Museum","museum-of-indigenous-amazonian-cultures":"Museum of Indigenous Amazonian Cultures",
 "new-mexico-museum-of-natural-history":"New Mexico Museum of Natural History","seattle-art-museum":"Seattle Art Museum","mcaad-museum":"Milken Center for the American Dream"};
function museumName(slug){ if(MUSEUM_FIX[slug])return MUSEUM_FIX[slug]; return slug.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase()); }
function museumClass(s){
  if(/art|gallery|portrait|fine-arts|rijksmuseum|larco|landesmuseum|faberge/.test(s)) return "700";
  if(/natural-history|fossil|field-museum|geology|gray-fossil/.test(s)) return "500";
  if(/bible/.test(s)) return "200";
  if(/air-and-space|wright|henry-ford/.test(s)) return "600";
  return "900";
}
const museums = buckets.museum.map(s=>({ t:museumName(s), a:"", k:"museum", code:museumClass(s), cover:null, key:null, slug:s }));

// GUIDES (basics-*)
const guides=[
  {t:"Real Estate — The Basics",a:"Study guide",k:"guide",code:"300",cover:null,key:null,slug:"basics-real-estate"},
  {t:"Stock Market Investing — The Basics",a:"Study guide",k:"guide",code:"300",cover:null,key:null,slug:"basics-stock-market-investing"},
  {t:"Language Guides",a:"22 languages — see the atlas",k:"guide",code:"400",cover:null,key:null,slug:"languages-home"},
];

const all=[...books,...museums,...guides];

// group into DEWEY (preserve class metadata)
const meta = G.DEWEY.map(d=>({code:d.code,range:d.range,name:d.name,blurb:d.blurb}));
const byCode={}; meta.forEach(m=>byCode[m.code]=[]);
all.forEach(it=>{ const c=byCode[it.code]?it.code:"000"; byCode[c].push({t:it.t,a:it.a,k:it.k,slug:it.slug||null}); });
// sort each class: books by title
Object.values(byCode).forEach(arr=>arr.sort((a,b)=>a.t.localeCompare(b.t)));

const DEWEY = meta.map(m=>({...m, items:byCode[m.code]}));

// attach slugs to other sections so they open their mirrored content
const LANGUAGES = G.LANGUAGES.map(l=>({...l, slug:l.name.toLowerCase()}));
const DOC_SLUG = {
  "The Magna Carta":"the-magna-carta-england-1215",
  "Declaration of Independence":"declaration-of-independence-usa-1776",
  "Declaration of the Rights of Man":"france-rights-of-man",
  "The Bill of Rights":"us-constitution",
  "Universal Declaration of Human Rights":"universal-declaration-of-human-rights-1948",
  "The Ten Commandments":"the-10-commandments",
  "The Rules of Nature":"rules-of-nature",
};
const DOCUMENTS = G.DOCUMENTS.map(d=>({...d, slug:DOC_SLUG[d.t]||null}));
const TL_SLUG = {"Deep Past":"history-pre-0","Antiquity & After":"history-01000","The Middle Millennium":"history-10001500","The Modern Age":"history-1500present"};
const TIMELINES = G.TIMELINES.map(t=>({...t, slug:TL_SLUG[t.era]||null}));

// COVERS + KEYS maps (by title)
const COVERS={}, KEYS={};
all.forEach(it=>{ if(it.cover) COVERS[it.t]={c:it.cover}; if(it.key) KEYS[it.t]=it.key; });
// keep curated descriptions
const DESCRIPTIONS=G.DESCRIPTIONS||{};

// serialize
const J=(o)=>JSON.stringify(o,null,2);
const file=`/* stekel.org — content model (auto-built from the live sitemap, ${all.length} items). */

const DEWEY = ${J(DEWEY)};

const TIMELINES = ${J(TIMELINES)};

const LANGUAGES = ${J(LANGUAGES)};

const DOCUMENTS = ${J(DOCUMENTS)};

const PROGRAMS = ${J(G.PROGRAMS)};

const INTERVIEWS = ${J(G.INTERVIEWS)};

const QUOTES = ${J(G.QUOTES)};

const BIOS = ${J(G.BIOS)};

/* Real cover art — Open Library cover IDs. */
const COVERS = ${J(COVERS)};

/* Open Library work keys — used to fetch descriptions on demand. */
const KEYS = ${J(KEYS)};

/* Curated / cached descriptions (override runtime fetch). */
const DESCRIPTIONS = ${J(DESCRIPTIONS)};
`;
fs.writeFileSync("data.js",file);
console.log("books",books.length,"museums",museums.length,"covers",Object.keys(COVERS).length,"keys",Object.keys(KEYS).length);
console.log("per class:", DEWEY.map(d=>d.code+":"+d.items.length).join("  "));
