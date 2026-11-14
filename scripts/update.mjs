/* Meridian data feed: runs on GitHub Actions, writes public JSON that Meridian.html reads directly.
   It reuses the Meridian live-data worker code in-process, so the source rules are identical:
   - Prices: Upstox (official) when the repository secret UPSTOX_TOKEN exists; otherwise Yahoo Finance (unofficial).
   - Fundamentals: Upstox Fundamentals API only (needs UPSTOX_TOKEN). Screener.in is never read here.
   Nothing is invented: a symbol that fails keeps its previous file and the error is listed in feed.json. */
import fs from "node:fs";import path from "node:path";
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const W=(await import("../lib/meridian-worker.mjs")).default;
const S=JSON.parse(fs.readFileSync(path.join(ROOT,"symbols.json"),"utf8"));
const TOKEN=process.env.UPSTOX_TOKEN||"",env=TOKEN?{UPSTOX_TOKEN:TOKEN,SCREENER:"off"}:{SCREENER:"off"};
const file=s=>s.replace(/[^A-Za-z0-9.-]/g,"_")+".json";
const call=async(p)=>{const r=await W.fetch(new Request("https://feed.local"+p),env);const j=await r.json().catch(()=>({error:"bad JSON"}));if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const prevPath=path.join(ROOT,"data","feed.json");let prev={};try{prev=JSON.parse(fs.readFileSync(prevPath,"utf8"))}catch(e){}
const out={v:1,at:Date.now(),prices:TOKEN?"upstox":"yahoo",fundamentals:TOKEN?"upstox":"none",names:Object.assign({},prev.names||{}),last:{},fund:Object.assign({},prev.fund||{}),errors:[]};
/* 1. resolve Markets company names that have no known NSE symbol */
for(const m of S.markets){if(m.nse){out.names[m.name]=m.nse+".NS";continue}if(out.names[m.name])continue;
  try{const j=await call("/api/market/search?q="+encodeURIComponent(m.name.replace(/\(.*?\)/g,"").trim()));const q=(j.quotes||[]).find(x=>/\.(NS|BO)$/.test(x.symbol||"")&&(x.quoteType==="EQUITY"||!x.quoteType));if(q)out.names[m.name]=q.symbol;else out.errors.push(m.name+": no NSE/BSE listing found")}catch(e){out.errors.push(m.name+": "+e.message)}await sleep(300)}
/* 2. prices: two years of daily candles per symbol, one file each */
const syms=[...new Set([].concat(S.indices,S.hg.map(s=>s+".NS"),Object.values(out.names)))];
for(const s of syms){try{const j=await call("/api/market/chart?sym="+encodeURIComponent(s)+"&range=2y&interval=1d");const R=j.chart.result[0],q=R.indicators.quote[0],r2=a=>(a||[]).map(x=>x==null?null:Math.round(x*100)/100);
    const o={sym:s,src:j.__src||out.prices,fallback:j.__fallback||null,at:Date.now(),meta:R.meta,timestamp:R.timestamp||[],close:r2(q.close),high:r2(q.high),low:r2(q.low),open:r2(q.open),volume:q.volume||[]};
    fs.writeFileSync(path.join(ROOT,"data","charts",file(s)),JSON.stringify(o));out.last[s]={p:R.meta.regularMarketPrice,t:(R.meta.regularMarketTime||0)*1000,src:o.src}}
  catch(e){out.errors.push(s+": "+e.message);if(prev.last&&prev.last[s])out.last[s]=Object.assign({},prev.last[s],{stale:true})}await sleep(TOKEN?150:600)}
/* 3. fundamentals for the researched companies (Upstox only, at most twice a day) */
if(TOKEN){const due=!prev.fundAt||Date.now()-prev.fundAt>11*36e5;out.fundAt=due?Date.now():prev.fundAt;
  if(due)for(const c of S.hg){const basis=S.consolidated.includes(c)?"consolidated":"standalone";try{out.fund[c+"|"+basis]=await call("/api/market/fund?code="+c+"&basis="+basis)}catch(e){out.errors.push(c+" fundamentals: "+e.message)}await sleep(300)}}
fs.writeFileSync(prevPath,JSON.stringify(out));
console.log("prices:",out.prices,"symbols ok:",Object.keys(out.last).filter(k=>!out.last[k].stale).length+"/"+syms.length,"errors:",out.errors.length);out.errors.slice(0,20).forEach(e=>console.log("  "+e));
