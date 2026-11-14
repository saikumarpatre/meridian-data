/* Meridian daily research: runs each evening (IST) on trading days and on manual runs. Orchestrates the rule modules:
   calendar -> universe -> candles/indicators -> filters -> scoring -> fundamentals -> tradeplan -> lifecycle -> tracker -> mood.
   Uses COMPLETE daily candles only, so a manual run during market hours works on yesterday's close, never on a half-day.
   Writes: data/research/latest.json, data/research/track.json, data/research/YYYY-MM-DD.json (once, never rewritten),
           data/opps/events.jsonl (append-only), data/opps/current.json, data/names.json, data/health/step-research.json.
   Research ideas are not recommendations; no return is promised; stops limit loss but do not remove it (gaps). */
import fs from "node:fs";import path from "node:path";
import {makeSource} from "../lib/source.mjs";import {istDate,loadHolidays,dayInfo,candleComplete} from "../lib/calendar.mjs";
import {metrics,r2,sma200At} from "../lib/rules/indicators.mjs";import {RULES,evaluate} from "../lib/rules/filters.mjs";
import {techScores,fundScores,classify,median} from "../lib/rules/scoring.mjs";import {plan,DEFAULTS} from "../lib/rules/tradeplan.mjs";
import {create,advance,OPEN,LIMITS} from "../lib/rules/lifecycle.mjs";import {oppStats} from "../lib/rules/tracker.mjs";import {mood} from "../lib/rules/mood.mjs";
const ROOT=process.env.MER_ROOT||path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const S=JSON.parse(fs.readFileSync(path.join(ROOT,"symbols.json"),"utf8"));
const NOW=+(process.env.MER_NOW||Date.now()),EVENT=process.env.GITHUB_EVENT_NAME||"manual",D=path.join(ROOT,"data");
const RD=path.join(D,"research"),OD=path.join(D,"opps"),HD=path.join(D,"health");[RD,OD,HD].forEach(d=>fs.mkdirSync(d,{recursive:true}));
const stepOut=o=>fs.writeFileSync(path.join(HD,"step-research.json"),JSON.stringify(Object.assign({at:Date.now()},o)));
const day=dayInfo(istDate(NOW),loadHolidays(ROOT));
if(!day.tradingDay&&EVENT==="schedule"){console.log("Not a trading day ("+day.date+"): research skipped");stepOut({skipped:"not a trading day",day});process.exit(0)}
const SRC=makeSource(process.env.UPSTOX_TOKEN),TOKEN=SRC.status.configured;
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),PACE=+(process.env.MER_PACE||350);
const log=[];const note=m=>{log.push(m);console.log(m)};const keep=t=>candleComplete(istDate(t*1000),NOW);

/* ---------- module 2: universe ---------- */
async function getUniverse(){const urls=["https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv","https://archives.nseindia.com/content/indices/ind_nifty500list.csv"];
  for(const u of urls){try{const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),15000);const r=await fetch(u,{headers:{"user-agent":"Mozilla/5.0 (meridian-data research job)",accept:"text/csv,*/*"},signal:ctl.signal});clearTimeout(t);
      if(!r.ok)throw new Error("HTTP "+r.status);const txt=await r.text(),lines=txt.trim().split(/\r?\n/),hd=lines[0].split(",").map(h=>h.trim().toLowerCase());
      const ci=n=>hd.findIndex(h=>h.indexOf(n)===0),iN=ci("company"),iI=ci("industry"),iS=ci("symbol"),iSe=ci("series");if(iS<0)throw new Error("no Symbol column");
      const L=lines.slice(1).map(l=>l.split(",")).filter(c=>c[iS]&&(iSe<0||/EQ/.test(c[iSe]||"EQ"))).map(c=>({sym:c[iS].trim(),name:(c[iN]||c[iS]).trim(),industry:(c[iI]||"Unclassified").trim()}));
      if(L.length<100)throw new Error("only "+L.length+" rows");return{src:u,list:L}}catch(e){note("universe source failed: "+u+" ("+e.message+")")}}
  const own=[...new Set(S.hg.concat(S.markets.map(m=>m.nse).filter(Boolean)))].map(s=>({sym:s,name:s,industry:"Unclassified"}));
  return{src:"Meridian's own symbol list (Nifty 500 list unavailable today)",list:own}}

/* ---------- modules 3-5: candles + indicators ---------- */
const t0=Date.now(),U=await getUniverse();note("universe: "+U.list.length+" from "+U.src);
const IDX=[["^NSEI","Nifty 50"],["^BSESN","Sensex"],["^NSEBANK","Bank Nifty"],["^CRSLDX","Nifty 500"],["^INDIAVIX","India VIX"],["INR=X","USD/INR"],["CL=F","Crude oil (WTI)"],["GC=F","Gold"],["^GSPC","S&P 500"]];
const indices=[],charts={};
for(const [s,n] of IDX){try{const j=await SRC.chart(s,"2y"),M=metrics(j.chart.result[0],keep);if(M){charts[s]=M;indices.push({sym:s,name:n,src:j.__src,label:j.__label||null,price:M.o.price,tradeAt:M.o.tradeAt,d1:M.o.d1,r1m:M.o.r1m,r3m:M.o.r3m,r12m:M.o.r12m,trend:M.o.trend})}}catch(e){indices.push({sym:s,name:n,error:e.message})}await sleep(PACE)}
const N=charts["^NSEI"];const rows=[];let fails=0;
for(const u of U.list){try{const j=await SRC.chart(u.sym+".NS","2y",{yahooOnly:true}),M=metrics(j.chart.result[0],keep);if(M){charts[u.sym]=M;rows.push(Object.assign({sym:u.sym,name:u.name,industry:u.industry,src:j.__src},M.o))}}catch(e){fails++}await sleep(PACE)}
note("scan prices (Yahoo, unofficial): "+rows.length+" of "+U.list.length+" ("+fails+" failed)");
const rsOf=r=>N&&r.r6m!=null&&N.o.r6m!=null?r2(r.r6m-N.o.r6m):null;rows.forEach(r=>r.rs6m=rsOf(r));
const dataDate=N?istDate(N.T[N.T.length-1]*1000):null,afterClose=candleComplete(istDate(NOW),NOW);

/* breadth and sectors */
const val=rows.filter(r=>r.sma200!=null);
const breadth={n:rows.length,above200:val.length?r2(100*val.filter(r=>r.price>r.sma200).length/val.length):null,above50:rows.length?r2(100*rows.filter(r=>r.sma50&&r.price>r.sma50).length/rows.length):null,
  adv:rows.filter(r=>r.d1>0).length,dec:rows.filter(r=>r.d1<0).length,highs:rows.filter(r=>r.offHigh!=null&&r.offHigh>-0.5).length,lows:rows.filter(r=>r.lo52&&r.price<=r.lo52*1.005).length};
const bySec={};rows.forEach(r=>{(bySec[r.industry]=bySec[r.industry]||[]).push(r)});
const sectors=Object.entries(bySec).filter(([k,a])=>a.length>=3&&k!=="Unclassified").map(([k,a])=>({name:k,n:a.length,r1m:r2(median(a.map(x=>x.r1m))),r3m:r2(median(a.map(x=>x.r3m))),above200:r2(100*a.filter(x=>x.sma200&&x.price>x.sma200).length/a.length)})).sort((x,y)=>(y.r3m||-999)-(x.r3m||-999));

/* ---------- module 7: filters ---------- */
rows.forEach(r=>{r.eval=evaluate(r)});const elig=rows.filter(r=>r.eval.pass);
/* ---------- module 8: scoring ---------- */
techScores(elig);elig.sort((a,b)=>b.tech-a.tech);
const top=elig.slice(0,30);
/* official prices for the shortlist: re-read the top 30 from Upstox when the token works, then recompute */
if(TOKEN)for(const r of top){try{const j=await SRC.chart(r.sym+".NS","2y");if(j.__src==="upstox"){const M=metrics(j.chart.result[0],keep);if(M){charts[r.sym]=M;Object.assign(r,M.o,{src:"upstox"});r.rs6m=rsOf(r);r.eval=evaluate(r)}}else r.srcNote=j.__label}catch(e){r.srcNote="Upstox re-read failed: "+e.message}await sleep(PACE)}
/* ---------- module 6: fundamentals (Upstox only) ---------- */
let fundNote=TOKEN?null:"Fundamentals not checked: add the UPSTOX_TOKEN secret to the repository to include ROCE, ROE, growth and valuation.";
if(TOKEN)for(const r of top){if(SRC.status.state==="rejected")break;try{const f=await SRC.fund(r.sym,"consolidated");r.f={roce:f.data.roce,roe:f.data.roe,pe:f.data.pe,mcap:f.data.mcap,salesCagr3:f.data.ranges&&f.data.ranges["Compounded Sales Growth"]?f.data.ranges["Compounded Sales Growth"]["3 Years"]:null,profitCagr3:f.data.ranges&&f.data.ranges["Compounded Profit Growth"]?f.data.ranges["Compounded Profit Growth"]["3 Years"]:null,promoter:f.data.promoter?f.data.promoter.vals.slice(-1)[0]:null,promoterChg:f.data.promoter&&f.data.promoter.vals.length>1?r2(f.data.promoter.vals.slice(-1)[0]-f.data.promoter.vals[0]):null,missing:f.missing||[],source:f.source,at:f.at}}catch(e){r.f={error:e.message}}await sleep(PACE)}
if(TOKEN&&SRC.status.state==="rejected")fundNote="Fundamentals not checked: Upstox rejected the token ("+(SRC.status.detail||"")+")";
const fundOn=TOKEN&&SRC.status.state!=="rejected";
fundScores(top);top.forEach(r=>r.score=r2((r.tech||0)+(r.fund!=null?r.fund:0)));

/* ---------- module 9: tradeplan + the full rule list for an idea ---------- */
const MAXIDEAS=10;
const IDEA_RULES=RULES.map(x=>x.label).concat([fundOn?"Fundamental score at least 20 of 50 (Upstox)":"Fundamentals: not checked (no working Upstox token)","Stop at the lower of the 20-day swing low and 2×ATR below the close","Target at least 2× the risk (reward/risk ≥ 2:1)","At "+(DEFAULTS.riskPct*100)+"% risk, the position stays at or under "+(DEFAULTS.capPct*100)+"% of capital","No 52-week high between the price and the target","Among the "+MAXIDEAS+" highest scores of the day"]);
const cand=top.filter(r=>r.eval.pass).sort((a,b)=>b.score-a.score);const qualified=[],miss=[];
for(const r of cand){r.plan=plan(r);const fundOk=!fundOn||(r.fund!=null&&r.fund>=20);
  if(!fundOk)miss.push({r,failed:{id:"fund",label:"Fundamental score at least 20 of 50",detail:r.fund==null?"fundamentals unavailable"+(r.f&&r.f.error?" ("+r.f.error+")":""):"score "+r.fund}});
  else if(!r.plan.ok)miss.push({r,failed:{id:r.plan.rule,label:"Trade plan",detail:r.plan.reason}});else qualified.push(r)}
const ideasR=qualified.slice(0,MAXIDEAS);qualified.slice(MAXIDEAS).forEach(r=>miss.push({r,failed:{id:"rank",label:"Among the "+MAXIDEAS+" highest scores",detail:"ranked below the top "+MAXIDEAS}}));
/* near misses: failed exactly one risk filter (not the history rule), or passed the filters but failed fundamentals / plan / rank */
rows.filter(r=>!r.eval.pass&&r.eval.failed.length===1&&r.eval.failed[0].id!=="history").forEach(r=>miss.push({r,failed:r.eval.failed[0]}));
const nearMisses=miss.sort((a,b)=>(b.r.score||b.r.tech||0)-(a.r.score||a.r.tech||0)||(b.r.rs6m||-999)-(a.r.rs6m||-999)).slice(0,5)
  .map(({r,failed})=>({sym:r.sym,name:r.name,industry:r.industry,price:r.price,trend:r.trend,rs6m:r.rs6m,notQualified:true,failed}));

const secRank={};sectors.forEach((s,i)=>secRank[s.name]=i);
function explain(r){const why=[],str=[],risk=[],inv=[],f=r.f&&!r.f.error?r.f:null,p=r.plan;
  why.push("6-month return "+r.r6m+"% vs Nifty 50 "+(N?N.o.r6m:"–")+"% (relative strength "+(r.rs6m>0?"+":"")+r.rs6m+" pts)");
  why.push(r.trend+": price above its 50-day (₹"+r.sma50+") and 200-day (₹"+r.sma200+") averages"+(r.adx?"; ADX "+r.adx:""));
  if(r.flags.length)why.push(r.flags.join("; "));
  str.push("Volatility "+r.vol+"% a year; worst fall in 12 months "+r.dd+"%");
  if(f){if(f.roce!=null)str.push("ROCE "+f.roce+"%, ROE "+(f.roe==null?"n/a":f.roe+"%"));if(f.salesCagr3!=null)str.push("3-year sales growth "+f.salesCagr3+"% a year"+(f.profitCagr3!=null?", profit "+f.profitCagr3+"% a year":""));if(f.promoter!=null)str.push("Promoter holding "+f.promoter+"%"+(f.promoterChg?" ("+(f.promoterChg>0?"+":"")+f.promoterChg+" pts over the period shown)":""))}
  risk.push("A stop limits loss; it does not remove it. If the stock opens below ₹"+p.stop+" (a gap), the loss is larger than planned.");
  if(r.rsi>65)risk.push("Momentum is stretched (RSI "+r.rsi+"); pullbacks are common from here");
  if(secRank[r.industry]!=null&&secRank[r.industry]>sectors.length*0.66)risk.push("Its sector ("+r.industry+") is among the weaker ones over 3 months");
  if(r.vol>35)risk.push("Above-average price swings (volatility "+r.vol+"%)");
  if(f&&f.pe&&r.peVsSector>1.3)risk.push("Valuation rich: P/E "+f.pe+" is "+r.peVsSector+"× the median of scanned peers in its industry");
  if(!f)risk.push("Fundamentals not checked in this run (ROCE, debt, earnings quality unknown)");
  if(f&&f.missing&&f.missing.length)risk.push("Not available from the data source: "+f.missing.slice(0,4).join(", "));
  risk.push("Governance, pledging, auditor and announcement checks are not automated: read the latest filings before relying on this");
  inv.push("The stop at ₹"+p.stop+" ("+p.stopBasis+"); the stop never moves");
  inv.push("Before entry: a close below the 200-day average (about ₹"+Math.round(r.sma200)+") withdraws the idea");
  inv.push("Not entered within "+LIMITS.waitDays+" trading days: the idea expires");
  return Object.assign({why,strengths:str,risks:risk,invalidate:inv},classify(r))}
const picks=ideasR.map(r=>Object.assign({sym:r.sym,name:r.name,industry:r.industry,src:r.src,srcNote:r.srcNote||null,price:r.price,tradeAt:r.tradeAt,d1:r.d1,r1m:r.r1m,r3m:r.r3m,r6m:r.r6m,rs6m:r.rs6m,
  sma20:r.sma20,sma50:r.sma50,sma100:r.sma100,sma200:r.sma200,rsi:r.rsi,macd:r.macd,adx:r.adx,atr14:r.atr14,vol:r.vol,dd:r.dd,hi52:r.hi52,lo52:r.lo52,offHigh:r.offHigh,traded:r.traded,trend:r.trend,flags:r.flags,
  tech:r.tech,fund:r.fund==null?null:r.fund,score:r.score,f:r.f||null,peVsSector:r.peVsSector||null,plan:r.plan,
  entryLow:r.plan.entryLow,entryHigh:r.plan.entryHigh,stop:r.plan.stop,target:r.plan.target,rr:r.plan.rr,stopBasis:r.plan.stopBasis},explain(r)));
/* weakening: Meridian's researched companies + big names breaking down */
const watch=new Set(S.hg);const weak=rows.filter(r=>(watch.has(r.sym)||r.traded>50)&&r.sma200&&r.price<r.sma200&&r.sma50<r.sma200&&r.rs6m!=null&&r.rs6m<-10).sort((a,b)=>a.rs6m-b.rs6m).slice(0,8)
  .map(r=>({sym:r.sym,name:r.name,industry:r.industry,price:r.price,r6m:r.r6m,rs6m:r.rs6m,trend:r.trend,why:"Below its 50-day and 200-day averages; "+r.rs6m+" pts behind the Nifty 50 over 6 months"+(watch.has(r.sym)?" (on Meridian's researched shortlist)":"")}));
const researched=S.hg.map(s=>{const r=rows.find(x=>x.sym===s);return r?{sym:s,name:r.name,price:r.price,trend:r.trend,rsi:r.rsi,r6m:r.r6m,rs6m:r.rs6m,vol:r.vol,dd:r.dd,sma200:r.sma200,flags:r.flags}:{sym:s,missing:true}});

/* ---------- module 10: lifecycle (append-only events) ---------- */
const curP=path.join(OD,"current.json"),evP=path.join(OD,"events.jsonl");let cur={opps:{}};try{cur=JSON.parse(fs.readFileSync(curP,"utf8"))}catch(e){}
const opps=cur.opps||{},events=[],toK=M=>M.T.map((t,i)=>({date:istDate(t*1000),o:M.O[i],h:M.H[i],l:M.L[i],c:M.C[i],sma200:sma200At(M.C,i)}));
for(const o of Object.values(opps)){if(!OPEN.includes(o.state))continue;let M=charts[o.sym];
  if(!M){try{const j=await SRC.chart(o.sym+".NS","2y");M=metrics(j.chart.result[0],keep);if(M)charts[o.sym]=M}catch(e){note("lifecycle: no candles for "+o.sym+" ("+e.message+")")}}
  if(M)events.push(...advance(o,toK(M).filter(k=>k.date>o.lastDate)))}
let created=0;if(dataDate)for(const p of picks){const id=p.sym+"-"+dataDate.replace(/-/g,"");if(opps[id]||Object.values(opps).some(o=>o.sym===p.sym&&OPEN.includes(o.state)))continue;
  const o=create(p,dataDate);opps[id]=o;created++;events.push({id,sym:p.sym,date:dataDate,from:null,to:"NEW",reason:"Passed every rule on "+dataDate+": entry ₹"+o.entryLow+"–"+o.entryHigh+", stop ₹"+o.stop+", target ₹"+o.target,price:p.price})}
if(events.length)fs.appendFileSync(evP,events.map(e=>JSON.stringify(Object.assign({at:NOW},e))).join("\n")+"\n");
fs.writeFileSync(curP,JSON.stringify({at:NOW,dataDate,limits:LIMITS,rules:DEFAULTS,opps}));

/* brief: plain sentences from the numbers */
const nf=indices.find(i=>i.sym==="^NSEI"),vx=indices.find(i=>i.sym==="^INDIAVIX");
const brief=[];if(nf&&!nf.error)brief.push("Nifty 50 "+(nf.d1>=0?"rose ":"fell ")+Math.abs(nf.d1)+"% on the last session; "+nf.r1m+"% over a month and "+nf.r12m+"% over a year ("+nf.trend.toLowerCase()+").");
if(breadth.above200!=null)brief.push("Breadth: "+breadth.above200+"% of "+breadth.n+" scanned stocks are above their 200-day average; "+breadth.adv+" rose and "+breadth.dec+" fell; "+breadth.highs+" at 52-week highs, "+breadth.lows+" at lows.");
if(sectors.length>=6)brief.push("Strongest over 3 months: "+sectors.slice(0,3).map(s=>s.name+" ("+s.r3m+"%)").join(", ")+". Weakest: "+sectors.slice(-3).reverse().map(s=>s.name+" ("+s.r3m+"%)").join(", ")+".");
if(vx&&!vx.error)brief.push("India VIX "+vx.price+(vx.d1!=null?" ("+(vx.d1>=0?"+":"")+vx.d1+"%)":"")+".");
brief.push(picks.length?picks.length+" idea"+(picks.length>1?"s":"")+" passed every rule today, including a stop, a target at least 2× the risk and the 25% position cap.":"No idea passes today. The nearest misses are listed as not qualified.");
if(weak.length)brief.push(weak.length+" notable names are in downtrends and trailing the market (see Weakening).");

/* ---------- module 11: tracker ---------- */
if(dataDate){const hp=path.join(RD,dataDate+".json");
  if(!fs.existsSync(hp))fs.writeFileSync(hp,JSON.stringify({date:dataDate,at:NOW,nifty:N?N.o.price:null,fundamentals:fundOn,picks:picks.map(p=>({sym:p.sym,name:p.name,price:p.price,classification:p.classification,score:p.score,why:p.why[0],entryLow:p.entryLow,entryHigh:p.entryHigh,stop:p.stop,target:p.target,rr:p.rr})),nearMisses}))}
const days=fs.readdirSync(RD).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const H=[7,30,90,180,365],agg=H.map(h=>({h,n:0,hits:0,ex:[],ret:[],dd:[]}));const recent=[];
const closeAt=(sym,ms)=>{const M=charts[sym];if(!M)return null;let v=null;for(let i=0;i<M.T.length;i++){if(M.T[i]*1000<=ms)v=M.C[i];else break}return v};
for(const f of days){const d=JSON.parse(fs.readFileSync(path.join(RD,f),"utf8")),start=Date.parse(d.date+"T15:30:00+05:30");
  for(const p of d.picks){const M=charts[p.sym];const cur=M?M.o.price:null,nCur=N?N.o.price:null;
    const row={date:d.date,sym:p.sym,name:p.name,priceThen:p.price,priceNow:cur,ret:cur?r2((cur/p.price-1)*100):null,nifty:d.nifty&&nCur?r2((nCur/d.nifty-1)*100):null};
    if(M){let mn=Infinity;for(let i=0;i<M.T.length;i++)if(M.T[i]*1000>start)mn=Math.min(mn,M.C[i]);row.maxDD=isFinite(mn)?r2(Math.min(0,(mn/p.price-1)*100)):null}
    H.forEach((h,k)=>{const end=start+h*864e5;if(end>NOW)return;const a=closeAt(p.sym,end),b=d.nifty?closeAt("^NSEI",end):null;if(a==null)return;const R=(a/p.price-1)*100,B=b!=null?(b/d.nifty-1)*100:null;
      const g=agg[k];g.n++;g.ret.push(R);if(B!=null){g.ex.push(R-B);if(R>B)g.hits++}if(row.maxDD!=null)g.dd.push(row.maxDD)});
    recent.push(row)}}
const ostats=oppStats(opps);
const track={at:NOW,since:days[0]||null,daysRecorded:days.length,horizons:agg.map(g=>({days:g.h,matured:g.n,hitRatio:g.n?r2(100*g.hits/g.n):null,avgReturn:g.ret.length?r2(g.ret.reduce((s,x)=>s+x,0)/g.ret.length):null,avgExcess:g.ex.length?r2(g.ex.reduce((s,x)=>s+x,0)/g.ex.length):null,worstDD:g.dd.length?r2(Math.min(...g.dd)):null})),recent:recent.slice(-40).reverse(),opps:ostats};
fs.writeFileSync(path.join(RD,"track.json"),JSON.stringify(track));

/* names for the news job (public company names only) */
const nameOf={};U.list.forEach(u=>nameOf[u.sym]=u.name);const nm={};S.hg.concat(picks.map(p=>p.sym),Object.values(opps).filter(o=>OPEN.includes(o.state)).map(o=>o.sym)).forEach(s=>{if(nameOf[s]&&nameOf[s]!==s)nm[s]=nameOf[s]});
fs.writeFileSync(path.join(D,"names.json"),JSON.stringify({at:NOW,names:nm}));

const md=mood({breadth,vix:vx,scanSource:"Yahoo Finance (unofficial)",asOf:dataDate,afterClose});
const latest={v:1,schema:2,at:NOW,date:istDate(NOW),dataDate,day,tookSec:Math.round((Date.now()-t0)/1000),universe:{src:U.src,n:U.list.length,priced:rows.length},
  prices:"scan: Yahoo Finance (unofficial); shortlist: "+(fundOn?"Upstox (official) where available":"Yahoo Finance"),fundamentals:fundOn?"upstox":"none",fundNote,upstox:{configured:TOKEN,state:SRC.status.state,detail:SRC.status.detail},
  indices,breadth,mood:md,sectors,brief,picks,ideasCount:picks.length,qualifiedCount:qualified.length,nearMisses,eligible:elig.length,weak,researched,
  ideaRules:IDEA_RULES,limits:LIMITS,planRules:DEFAULTS,opps:{stats:ostats,open:Object.values(opps).filter(o=>OPEN.includes(o.state)),eventsToday:events},
  notConnected:["NSE/BSE corporate announcements","FII/DII flows","Promoter pledging, insider trades, bulk/block deals","Options open interest and put/call ratio"],log,
  method:"Universe: Nifty 500, complete daily candles only. Risk filters: "+RULES.map(x=>x.label.toLowerCase()).join("; ")+". Technical score (0–50): 6-month strength vs Nifty 20, trend strength (ADX) 10, low volatility 10, small drawdown 10. Fundamental score (0–50, Upstox only): ROCE, ROE, 3-year sales and profit growth, P/E vs scanned industry peers. Trade plan: entry zone from the close down to 1×ATR below it; stop at the lower of the 20-day swing low and 2×ATR below the close; target 2× the risk; ideas whose plan breaks a rule are not shown. Stops never move."};
fs.writeFileSync(path.join(RD,"latest.json"),JSON.stringify(latest));
stepOut({ok:true,dataDate,universe:U.list.length,priced:rows.length,eligible:elig.length,ideas:picks.length,nearMisses:nearMisses.length,oppsCreated:created,events:events.length,upstox:latest.upstox,day,tookSec:latest.tookSec});
note("research done: data "+dataDate+", "+picks.length+" ideas, "+elig.length+" passed filters, "+nearMisses.length+" near misses, "+created+" new opps, "+events.length+" events, upstox "+SRC.status.state);
