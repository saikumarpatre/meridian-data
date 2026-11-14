/* Module 3 (prices) + 4 (candles) for the 30-minute feed. Writes data/feed.json and data/charts/<symbol>.json, and appends
   one line per symbol per day to data/history/prices/YYYY-MM.jsonl (append-only; a day already recorded is never rewritten).
   Prices: Upstox (official) with the UPSTOX_TOKEN secret; every Yahoo row says why it is Yahoo. Fundamentals: Upstox only.
   Nothing is invented: a symbol that fails keeps its previous value, marked stale, and the error is listed. */
import fs from "node:fs";import path from "node:path";
import {makeSource} from "../lib/source.mjs";import {istDate,loadHolidays,dayInfo,candleComplete} from "../lib/calendar.mjs";
const ROOT=process.env.MER_ROOT||path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const S=JSON.parse(fs.readFileSync(path.join(ROOT,"symbols.json"),"utf8"));
const NOW=+(process.env.MER_NOW||Date.now()),EVENT=process.env.GITHUB_EVENT_NAME||"manual";
const day=dayInfo(istDate(NOW),loadHolidays(ROOT)),D=path.join(ROOT,"data");fs.mkdirSync(path.join(D,"charts"),{recursive:true});fs.mkdirSync(path.join(D,"health"),{recursive:true});
const stepOut=o=>fs.writeFileSync(path.join(D,"health","step-prices.json"),JSON.stringify(Object.assign({at:Date.now()},o)));
if(!day.tradingDay&&EVENT==="schedule"){console.log("Not a trading day ("+day.date+(day.holiday?", "+day.holiday.name:", weekend")+"): prices skipped");stepOut({skipped:"not a trading day",day});process.exit(0)}
const SRC=makeSource(process.env.UPSTOX_TOKEN),file=s=>s.replace(/[^A-Za-z0-9.-]/g,"_")+".json",sleep=ms=>new Promise(r=>setTimeout(r,ms)),PACE=+(process.env.MER_PACE||(SRC.status.configured?150:600));
const prevPath=path.join(D,"feed.json");let prev={};try{prev=JSON.parse(fs.readFileSync(prevPath,"utf8"))}catch(e){}
const out={v:1,schema:2,at:Date.now(),day,names:Object.assign({},prev.names||{}),last:{},fund:Object.assign({},prev.fund||{}),fundAt:prev.fundAt||null,errors:[]};
/* 1. resolve Markets names that have no known NSE symbol */
for(const m of S.markets){if(m.nse){out.names[m.name]=m.nse+".NS";continue}if(out.names[m.name])continue;
  try{const j=await SRC.search(m.name.replace(/\(.*?\)/g,"").trim());const q=(j.quotes||[]).find(x=>/\.(NS|BO)$/.test(x.symbol||"")&&(x.quoteType==="EQUITY"||!x.quoteType));if(q)out.names[m.name]=q.symbol;else out.errors.push(m.name+": no NSE/BSE listing found")}catch(e){out.errors.push(m.name+": "+e.message)}await sleep(PACE)}
/* 2. prices + candles */
const HP=path.join(D,"history","prices");fs.mkdirSync(HP,{recursive:true});const hist=[];
const syms=[...new Set([].concat(S.indices,S.hg.map(s=>s+".NS"),Object.values(out.names)))];
for(const s of syms){try{const j=await SRC.chart(s,"2y");const R=j.chart.result[0],q=R.indicators.quote[0],r2=a=>(a||[]).map(x=>x==null?null:Math.round(x*100)/100);
    const o={sym:s,src:j.__src||"yahoo",label:j.__label||null,fallback:j.__fallback||null,at:Date.now(),meta:R.meta,timestamp:R.timestamp||[],close:r2(q.close),high:r2(q.high),low:r2(q.low),open:r2(q.open),volume:q.volume||[]};
    fs.writeFileSync(path.join(D,"charts",file(s)),JSON.stringify(o));out.last[s]={p:R.meta.regularMarketPrice,t:(R.meta.regularMarketTime||0)*1000,src:o.src,fallback:o.fallback};
    const t=o.timestamp,i=t.length-1;if(i>=0&&o.close[i]!=null){const d=istDate(t[i]*1000);if(candleComplete(d,NOW))hist.push({d,s,o:o.open[i],h:o.high[i],l:o.low[i],c:o.close[i],v:o.volume[i]||0,src:o.src})}}
  catch(e){out.errors.push(s+": "+e.message);if(prev.last&&prev.last[s])out.last[s]=Object.assign({},prev.last[s],{stale:true})}await sleep(PACE)}
/* append-only daily history: add a (day,symbol) line only if it is not there yet */
const byMonth={};hist.forEach(h=>(byMonth[h.d.slice(0,7)]=byMonth[h.d.slice(0,7)]||[]).push(h));let added=0;
for(const [m,rows] of Object.entries(byMonth)){const f=path.join(HP,m+".jsonl"),seen=new Set();if(fs.existsSync(f))fs.readFileSync(f,"utf8").split("\n").filter(Boolean).forEach(l=>{try{const x=JSON.parse(l);seen.add(x.d+"|"+x.s)}catch(e){}});
  const add=rows.filter(r=>!seen.has(r.d+"|"+r.s));if(add.length){fs.appendFileSync(f,add.map(r=>JSON.stringify(r)).join("\n")+"\n");added+=add.length}}
/* 3. fundamentals for the researched companies (Upstox only, at most twice a day) */
if(SRC.status.configured&&SRC.status.state!=="rejected"){const due=!prev.fundAt||Date.now()-prev.fundAt>11*36e5;
  if(due){out.fundAt=Date.now();for(const c of S.hg){const basis=S.consolidated.includes(c)?"consolidated":"standalone";try{out.fund[c+"|"+basis]=await SRC.fund(c,basis)}catch(e){out.errors.push(c+" fundamentals: "+e.message)}await sleep(PACE)}}}
const C=SRC.status.counts;out.bySource=C;out.prices=C.upstox>=C.yahoo&&C.upstox>0?"upstox":"yahoo";out.fundamentals=SRC.status.configured&&SRC.status.state!=="rejected"?"upstox":"none";
out.upstox={configured:SRC.status.configured,state:SRC.status.state,detail:SRC.status.detail};
fs.writeFileSync(prevPath,JSON.stringify(out));
stepOut({ok:true,symbols:syms.length,okCount:Object.keys(out.last).filter(k=>!out.last[k].stale).length,bySource:C,historyLinesAdded:added,errors:out.errors.length,upstox:out.upstox,day});
console.log("prices: upstox",C.upstox,"yahoo",C.yahoo,"(fallbacks",C.fallback+")","ok",Object.keys(out.last).filter(k=>!out.last[k].stale).length+"/"+syms.length,"errors",out.errors.length,"history +"+added,"upstox:",SRC.status.state);out.errors.slice(0,20).forEach(e=>console.log("  "+e));
