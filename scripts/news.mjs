/* Module 12: news. Fetches the RSS feeds listed in news-feeds.json into data/news.json. Replaces the rss2json relay.
   Stores headline, link, source and time only (never article text); keeps 7 days, newest first, at most 250 items.
   Company tags come from simple name matching against public company names and are labelled "matched by name – may be wrong". */
import fs from "node:fs";import path from "node:path";import {parseFeed,phrases,match} from "../lib/news.mjs";
const ROOT=process.env.MER_ROOT||path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");const D=path.join(ROOT,"data");fs.mkdirSync(path.join(D,"health"),{recursive:true});
const NOW=+(process.env.MER_NOW||Date.now()),F=JSON.parse(fs.readFileSync(path.join(ROOT,"news-feeds.json"),"utf8"));
let names={};try{names=JSON.parse(fs.readFileSync(path.join(D,"names.json"),"utf8")).names||{}}catch(e){}const P=phrases(names);
let prev={items:[]};try{prev=JSON.parse(fs.readFileSync(path.join(D,"news.json"),"utf8"))}catch(e){}
const feeds=[],items=new Map((prev.items||[]).map(x=>[x.link,x]));
for(const f of F.feeds){const r0=Date.now();try{const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),12000);
    const r=await fetch(f.url,{headers:{"user-agent":"Mozilla/5.0 (meridian-data news job; headlines and links only)",accept:"application/rss+xml, application/xml, text/xml, */*"},signal:ctl.signal});clearTimeout(t);
    if(!r.ok)throw new Error("HTTP "+r.status);const L=parseFeed(await r.text());if(!L.length)throw new Error("no items recognised");
    for(const x of L){const old=items.get(x.link);items.set(x.link,{title:x.title,link:x.link,t:x.t||(old&&old.t)||NOW,src:f.name,cat:f.cat})}feeds.push({name:f.name,ok:true,count:L.length,ms:Date.now()-r0})}
  catch(e){feeds.push({name:f.name,ok:false,error:e.name==="AbortError"?"no answer within 12 s":e.message})}}
const keep=[...items.values()].filter(x=>x.t>=NOW-7*864e5&&x.t<=NOW+36e5).sort((a,b)=>b.t-a.t).slice(0,250).map(x=>{const m=match(x.title,P);return m.length?Object.assign({},x,{match:m}):(({match,...y})=>y)(x)});
const out={v:1,at:NOW,note:"Headlines and links only; open the link to read the article on the publisher's site. Company tags are matched by name and may be wrong.",feeds,items:keep};
fs.writeFileSync(path.join(D,"news.json"),JSON.stringify(out));
const ok=feeds.filter(f=>f.ok).length;fs.writeFileSync(path.join(D,"health","step-news.json"),JSON.stringify({at:Date.now(),ok:ok>0,feedsOk:ok,feeds:feeds.length,items:keep.length,matched:keep.filter(x=>x.match).length}));
console.log("news: feeds ok",ok+"/"+feeds.length,"items",keep.length);feeds.filter(f=>!f.ok).forEach(f=>console.log("  "+f.name+": "+f.error));
if(!ok)process.exit(1);
