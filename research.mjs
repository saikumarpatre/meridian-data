/* Meridian daily research — runs on GitHub Actions once each evening (IST) and on demand.
   Writes data/research/latest.json, data/research/track.json and ONE immutable file per day: data/research/YYYY-MM-DD.json
   (never rewritten, so past research can't be edited to look right later).
   Sources: scan prices from Yahoo Finance via the Meridian worker code (unofficial; keeps Upstox usage low);
   universe = Nifty 500 constituent list published by NSE Indices (fetched each run; falls back to Meridian's own symbols);
   fundamentals = Upstox Fundamentals API for the top candidates only, and only with UPSTOX_TOKEN.
   Everything is computed from those numbers. Nothing is estimated or invented; missing data is listed as missing.
   Research candidates are not recommendations, and no return is promised. */
import fs from "node:fs";import path from "node:path";
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const W=(await import("../lib/meridian-worker.mjs")).default;
const S=JSON.parse(fs.readFileSync(path.join(ROOT,"symbols.json"),"utf8"));
const TOKEN=process.env.UPSTOX_TOKEN||"",envF=TOKEN?{UPSTOX_TOKEN:TOKEN,SCREENER:"off"}:{SCREENER:"off"},envP={SCREENER:"off"};  /* scan prices: Yahoo (keeps Upstox calls low); fundamentals: Upstox */
const RD=path.join(ROOT,"data","research");fs.mkdirSync(RD,{recursive:true});
const call=async(p,e)=>{const r=await W.fetch(new Request("https://feed.local"+p),e||envP);const j=await r.json().catch(()=>({error:"bad JSON"}));if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const PACE=+(process.env.MER_PACE||350);
const istDate=ms=>new Date(ms+330*6e4).toISOString().slice(0,10);
const r2=x=>x==null||!isFinite(x)?null:Math.round(x*100)/100;
const log=[];const note=m=>{log.push(m);console.log(m)};

/* ---------- 1. universe ---------- */
async function getUniverse(){const urls=["https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv","https://archives.nseindia.com/content/indices/ind_nifty500list.csv"];
  for(const u of urls){try{const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),15000);const r=await fetch(u,{headers:{"user-agent":"Mozilla/5.0 (meridian-data research job)",accept:"text/csv,*/*"},signal:ctl.signal});clearTimeout(t);
      if(!r.ok)throw new Error("HTTP "+r.status);const txt=await r.text(),lines=txt.trim().split(/\r?\n/),hd=lines[0].split(",").map(h=>h.trim().toLowerCase());
      const ci=n=>hd.findIndex(h=>h.indexOf(n)===0),iN=ci("company"),iI=ci("industry"),iS=ci("symbol"),iSe=ci("series");if(iS<0)throw new Error("no Symbol column");
      const L=lines.slice(1).map(l=>l.split(",")).filter(c=>c[iS]&&(iSe<0||/EQ/.test(c[iSe]||"EQ"))).map(c=>({sym:c[iS].trim(),name:(c[iN]||c[iS]).trim(),industry:(c[iI]||"Unclassified").trim()}));
      if(L.length<100)throw new Error("only "+L.length+" rows");return{src:u,list:L}}catch(e){note("universe source failed: "+u+" ("+e.message+")")}}
  const own=[...new Set(S.hg.concat(S.markets.map(m=>m.nse).filter(Boolean)))].map(s=>({sym:s,name:s,industry:"Unclassified"}));
  return{src:"Meridian's own symbol list (Nifty 500 list unavailable today)",list:own}}

/* ---------- 2. indicators ---------- */
const sma=(a,n)=>a.length<n?null:a.slice(-n).reduce((s,x)=>s+x,0)/n;
function rsi(c,n=14){if(c.length<n+1)return null;let g=0,l=0;for(let i=1;i<=n;i++){const d=c[i]-c[i-1];d>0?g+=d:l-=d}g/=n;l/=n;for(let i=n+1;i<c.length;i++){const d=c[i]-c[i-1];g=(g*(n-1)+(d>0?d:0))/n;l=(l*(n-1)+(d<0?-d:0))/n}return l===0?100:100-100/(1+g/l)}
function ema(a,n){const k=2/(n+1);let e=a[0];const out=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);out.push(e)}return out}
function macd(c){if(c.length<35)return null;const e12=ema(c,12),e26=ema(c,26),m=e12.map((x,i)=>x-e26[i]),s=ema(m,9),i=m.length-1;return{macd:m[i],signal:s[i],hist:m[i]-s[i]}}
function adx(h,l,c,n=14){if(c.length<2*n+1)return null;let tr=[],pd=[],md=[];for(let i=1;i<c.length;i++){const up=h[i]-h[i-1],dn=l[i-1]-l[i];pd.push(up>dn&&up>0?up:0);md.push(dn>up&&dn>0?dn:0);tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])))}
  const wild=a=>{let s=a.slice(0,n).reduce((x,y)=>x+y,0);const out=[s];for(let i=n;i<a.length;i++){s=s-s/n+a[i];out.push(s)}return out};const T=wild(tr),P=wild(pd),M=wild(md),dx=T.map((t,i)=>{const p=100*P[i]/t,m=100*M[i]/t;return p+m===0?0:100*Math.abs(p-m)/(p+m)});
  let a=dx.slice(0,n).reduce((x,y)=>x+y,0)/n;for(let i=n;i<dx.length;i++)a=(a*(n-1)+dx[i])/n;const i=T.length-1;return{adx:a,pdi:100*P[i]/T[i],mdi:100*M[i]/T[i]}}
const ret=(c,n)=>c.length>n&&c[c.length-1-n]>0?(c[c.length-1]/c[c.length-1-n]-1)*100:null;
function vol(c,n=126){const a=c.slice(-n-1);if(a.length<30)return null;const r=[];for(let i=1;i<a.length;i++)if(a[i-1]>0&&a[i]>0)r.push(Math.log(a[i]/a[i-1]));const m=r.reduce((s,x)=>s+x,0)/r.length;return Math.sqrt(r.reduce((s,x)=>s+(x-m)*(x-m),0)/(r.length-1))*Math.sqrt(252)*100}
function maxDD(c){let pk=-Infinity,dd=0;for(const x of c){pk=Math.max(pk,x);dd=Math.min(dd,x/pk-1)}return dd*100}
function metrics(R){const q=R.indicators.quote[0],t=R.timestamp||[],ix=[];for(let i=0;i<t.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)ix.push(i);
  const C=ix.map(i=>q.close[i]),H=ix.map(i=>q.high[i]),L=ix.map(i=>q.low[i]),V=ix.map(i=>q.volume?q.volume[i]||0:0),T=ix.map(i=>t[i]);if(C.length<60)return null;
  const yr=C.slice(-252),last=C[C.length-1],m=macd(C),a=adx(H,L,C),v20=sma(V,20),v50=sma(V,50);
  let upV=0,dnV=0;for(let i=Math.max(1,C.length-50);i<C.length;i++){if(C[i]>C[i-1])upV+=V[i];else if(C[i]<C[i-1])dnV+=V[i]}
  const o={price:last,tradeAt:(R.meta.regularMarketTime||T[T.length-1])*1000,days:C.length,prevClose:C.length>1?C[C.length-2]:null,
    d1:C.length>1?(last/C[C.length-2]-1)*100:null,r1m:ret(C,21),r3m:ret(C,63),r6m:ret(C,126),r12m:ret(C,Math.min(252,C.length-1)),
    sma20:sma(C,20),sma50:sma(C,50),sma100:sma(C,100),sma200:sma(C,200),rsi:rsi(C),macd:m?m.hist:null,adx:a?a.adx:null,pdi:a?a.pdi:null,mdi:a?a.mdi:null,
    vol:vol(C),dd:maxDD(yr),hi52:Math.max(...yr),lo52:Math.min(...yr),volRatio:v50?v20/v50:null,upDown:dnV?upV/dnV:null,traded:v20!=null?v20*last/1e7:null};
  o.offHigh=(last/o.hi52-1)*100;
  o.trend=o.sma200==null?"Not enough history":last>o.sma50&&o.sma50>o.sma200&&(o.adx||0)>=25?"Strong uptrend":last>o.sma50&&o.sma50>o.sma200?"Uptrend":last<o.sma50&&last>o.sma200?"Weakening":last<o.sma200&&o.sma50<o.sma200?"Downtrend":"Sideways";
  o.flags=[];if(o.rsi>70)o.flags.push("Overbought (RSI "+Math.round(o.rsi)+")");if(o.rsi<30)o.flags.push("Oversold (RSI "+Math.round(o.rsi)+")");
  if(o.offHigh>-2&&o.volRatio>1.3)o.flags.push("At a 52-week high on rising volume");if(last<=o.lo52*1.02)o.flags.push("Near its 52-week low");
  if(o.upDown>1.5&&o.volRatio>1.1)o.flags.push("Accumulation: up-day volume "+o.upDown.toFixed(1)+"× down-day volume (50 days)");if(o.upDown!=null&&o.upDown<0.67)o.flags.push("Distribution: down-day volume outweighs up-day volume");
  for(const k of Object.keys(o))if(typeof o[k]==="number"&&k!=="tradeAt")o[k]=r2(o[k]);return{o,C,T}}
const pctRank=(arr,v)=>{const a=arr.filter(x=>x!=null);if(!a.length||v==null)return 0;return a.filter(x=>x<=v).length/a.length};
const median=a=>{const b=a.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y);if(!b.length)return null;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2};

/* ---------- 3. run ---------- */
const t0=Date.now(),U=await getUniverse();note("universe: "+U.list.length+" from "+U.src);
const IDX=[["^NSEI","Nifty 50"],["^BSESN","Sensex"],["^NSEBANK","Bank Nifty"],["^CRSLDX","Nifty 500"],["^INDIAVIX","India VIX"],["INR=X","USD/INR"],["CL=F","Crude oil (WTI)"],["GC=F","Gold"],["^GSPC","S&P 500"]];
const indices=[];const charts={};
for(const [s,n] of IDX){try{const j=await call("/api/market/chart?sym="+encodeURIComponent(s)+"&range=2y&interval=1d"),R=j.chart.result[0],M=metrics(R);if(M){charts[s]=M;indices.push({sym:s,name:n,src:j.__src,price:M.o.price,tradeAt:M.o.tradeAt,d1:M.o.d1,r1m:M.o.r1m,r3m:M.o.r3m,r12m:M.o.r12m,trend:M.o.trend})}}catch(e){indices.push({sym:s,name:n,error:e.message})}await sleep(PACE)}
const N=charts["^NSEI"];const rows=[];let fails=0;
for(const u of U.list){try{const j=await call("/api/market/chart?sym="+encodeURIComponent(u.sym+".NS")+"&range=2y&interval=1d"),M=metrics(j.chart.result[0]);if(M){charts[u.sym]=M;rows.push(Object.assign({sym:u.sym,name:u.name,industry:u.industry,src:j.__src},M.o))}}catch(e){fails++}await sleep(PACE)}
note("prices: "+rows.length+" of "+U.list.length+" ("+fails+" failed)");
for(const r of rows)r.rs6m=N&&r.r6m!=null&&N.o.r6m!=null?r2(r.r6m-N.o.r6m):null;
/* breadth and sectors */
const val=rows.filter(r=>r.sma200!=null);
const breadth={n:rows.length,above200:val.length?r2(100*val.filter(r=>r.price>r.sma200).length/val.length):null,above50:rows.length?r2(100*rows.filter(r=>r.sma50&&r.price>r.sma50).length/rows.length):null,
  adv:rows.filter(r=>r.d1>0).length,dec:rows.filter(r=>r.d1<0).length,highs:rows.filter(r=>r.offHigh!=null&&r.offHigh>-0.5).length,lows:rows.filter(r=>r.lo52&&r.price<=r.lo52*1.005).length};
const bySec={};rows.forEach(r=>{(bySec[r.industry]=bySec[r.industry]||[]).push(r)});
const sectors=Object.entries(bySec).filter(([k,a])=>a.length>=3&&k!=="Unclassified").map(([k,a])=>({name:k,n:a.length,r1m:r2(median(a.map(x=>x.r1m))),r3m:r2(median(a.map(x=>x.r3m))),above200:r2(100*a.filter(x=>x.sma200&&x.price>x.sma200).length/a.length)})).sort((x,y)=>(y.r3m||-999)-(x.r3m||-999));
/* risk filters + technical score */
const elig=rows.filter(r=>r.days>=200&&r.sma200&&r.price>r.sma200&&r.sma50>r.sma200&&r.dd>-35&&r.vol!=null&&r.vol<45&&r.rsi>=45&&r.rsi<=72&&(r.traded==null||r.traded>=2));
const A={rs:elig.map(r=>r.rs6m),vol:elig.map(r=>-r.vol),dd:elig.map(r=>r.dd),adx:elig.map(r=>r.adx)};
elig.forEach(r=>{r.tech=r2(20*pctRank(A.rs,r.rs6m)+10*pctRank(A.adx,r.adx)+10*pctRank(A.vol,-r.vol)+10*pctRank(A.dd,r.dd))});
elig.sort((a,b)=>b.tech-a.tech);
/* fundamentals for the best 30 (Upstox only) */
let fundNote=TOKEN?null:"Fundamentals not checked: add the UPSTOX_TOKEN secret to the repository to include ROCE, ROE, growth and valuation.";
const top=elig.slice(0,30);
if(TOKEN)for(const r of top){try{const f=await call("/api/market/fund?code="+encodeURIComponent(r.sym)+"&basis=consolidated",envF);r.f={roce:f.data.roce,roe:f.data.roe,pe:f.data.pe,mcap:f.data.mcap,salesCagr3:f.data.ranges&&f.data.ranges["Compounded Sales Growth"]?f.data.ranges["Compounded Sales Growth"]["3 Years"]:null,profitCagr3:f.data.ranges&&f.data.ranges["Compounded Profit Growth"]?f.data.ranges["Compounded Profit Growth"]["3 Years"]:null,promoter:f.data.promoter?f.data.promoter.vals.slice(-1)[0]:null,promoterChg:f.data.promoter&&f.data.promoter.vals.length>1?r2(f.data.promoter.vals.slice(-1)[0]-f.data.promoter.vals[0]):null,missing:f.missing||[],source:f.source,at:f.at}}catch(e){r.f={error:e.message}}await sleep(PACE)}
if(TOKEN){const peMed={};top.filter(r=>r.f&&r.f.pe>0).forEach(r=>{(peMed[r.industry]=peMed[r.industry]||[]).push(r.f.pe)});
  top.forEach(r=>{const f=r.f;if(!f||f.error){r.fund=null;return}const pm=median(peMed[r.industry]||[]),q=x=>x==null?0:x;let s=0;
    s+=Math.min(15,Math.max(0,(q(f.roce)-8)))*1;s+=Math.min(10,Math.max(0,(q(f.roe)-8)*0.8));s+=Math.min(10,Math.max(0,q(f.salesCagr3)*0.5));s+=Math.min(10,Math.max(0,q(f.profitCagr3)*0.4));
    if(f.pe>0&&pm){r.peVsSector=r2(f.pe/pm);s+=f.pe<=pm?5:f.pe<=pm*1.3?2:0}r.fund=r2(Math.min(50,s))})}
/* classification, reasons, risks, invalidation */
const ind=r=>r.industry,secRank={};sectors.forEach((s,i)=>secRank[s.name]=i);
function explain(r){const why=[],str=[],risk=[],inv=[],f=r.f&&!r.f.error?r.f:null;
  why.push("6-month return "+r.r6m+"% vs Nifty 50 "+(N?N.o.r6m:"–")+"% (relative strength "+(r.rs6m>0?"+":"")+r.rs6m+" pts)");
  why.push(r.trend+": price above its 50-day ("+r.sma50+") and 200-day ("+r.sma200+") averages"+(r.adx?"; ADX "+r.adx:""));
  if(r.flags.length)why.push(r.flags.join("; "));
  str.push("Lower risk than most peers in the scan: volatility "+r.vol+"% a year, worst fall in 12 months "+r.dd+"%");
  if(f){if(f.roce!=null)str.push("ROCE "+f.roce+"%, ROE "+(f.roe==null?"n/a":f.roe+"%"));if(f.salesCagr3!=null)str.push("3-year sales growth "+f.salesCagr3+"% a year"+(f.profitCagr3!=null?", profit "+f.profitCagr3+"% a year":""));if(f.promoter!=null)str.push("Promoter holding "+f.promoter+"%"+(f.promoterChg?" ("+(f.promoterChg>0?"+":"")+f.promoterChg+" pts over the period shown)":""))}
  if(r.rsi>65)risk.push("Momentum is stretched (RSI "+r.rsi+"); pullbacks are common from here");
  if(r.offHigh>-3)risk.push("Trading near its 52-week high ("+r.hi52+"), which can act as resistance");
  if(secRank[ind(r)]!=null&&secRank[ind(r)]>sectors.length*0.66)risk.push("Its sector ("+ind(r)+") is among the weaker ones over 3 months");
  if(r.vol>35)risk.push("Above-average price swings (volatility "+r.vol+"%)");
  if(f&&f.pe&&r.peVsSector>1.3)risk.push("Valuation rich: P/E "+f.pe+" is "+r.peVsSector+"× the median of scanned peers in its industry");
  if(!f)risk.push("Fundamentals not checked in this run (ROCE, debt, earnings quality unknown)");
  if(f&&f.missing&&f.missing.length)risk.push("Not available from the data source: "+f.missing.slice(0,4).join(", "));
  risk.push("Governance, pledging, auditor and announcement checks are not automated: read the latest filings before relying on this");
  inv.push("A close below the 200-day average (about ₹"+Math.round(r.sma200)+") would break the trend thesis");
  if(f&&f.roce!=null)inv.push("ROCE falling below 12% or two quarters of falling profit would weaken the quality case");
  const conf=f&&r.fund>=30&&r.tech>=35?"Medium":f?"Medium-low":"Low";
  const cls=f?(r.fund>=30&&r.tech>=35&&!(r.peVsSector>1.5)?"Strong research candidate":"Watchlist"):"Watchlist (technical only)";
  return{why,strengths:str,risks:risk,invalidate:inv,confidence:conf,classification:cls}}
const ranked=top.map(r=>Object.assign(r,{score:r2((r.tech||0)+(r.fund!=null?r.fund:0))})).sort((a,b)=>b.score-a.score);
const picks=ranked.filter(r=>TOKEN?(r.fund!=null&&r.fund>=20):true).slice(0,10).map(r=>Object.assign({sym:r.sym,name:r.name,industry:r.industry,src:r.src,price:r.price,tradeAt:r.tradeAt,d1:r.d1,r1m:r.r1m,r3m:r.r3m,r6m:r.r6m,rs6m:r.rs6m,
  sma20:r.sma20,sma50:r.sma50,sma100:r.sma100,sma200:r.sma200,rsi:r.rsi,macd:r.macd,adx:r.adx,vol:r.vol,dd:r.dd,hi52:r.hi52,lo52:r.lo52,offHigh:r.offHigh,traded:r.traded,trend:r.trend,flags:r.flags,tech:r.tech,fund:r.fund==null?null:r.fund,score:r.score,f:r.f||null,peVsSector:r.peVsSector||null},explain(r)));
/* weakening: Meridian's researched companies + big names breaking down */
const watch=new Set(S.hg);const weak=rows.filter(r=>(watch.has(r.sym)||r.traded>50)&&r.sma200&&r.price<r.sma200&&r.sma50<r.sma200&&r.rs6m!=null&&r.rs6m<-10).sort((a,b)=>a.rs6m-b.rs6m).slice(0,8)
  .map(r=>({sym:r.sym,name:r.name,industry:r.industry,price:r.price,r6m:r.r6m,rs6m:r.rs6m,trend:r.trend,why:"Below its 50-day and 200-day averages; "+r.rs6m+" pts behind the Nifty 50 over 6 months"+(watch.has(r.sym)?" (on Meridian's researched shortlist)":"")}));
const researched=S.hg.map(s=>{const r=rows.find(x=>x.sym===s);return r?{sym:s,price:r.price,trend:r.trend,rsi:r.rsi,r6m:r.r6m,rs6m:r.rs6m,vol:r.vol,dd:r.dd,sma200:r.sma200,flags:r.flags}:{sym:s,missing:true}});
/* brief: plain sentences from the numbers */
const nf=indices.find(i=>i.sym==="^NSEI"),vx=indices.find(i=>i.sym==="^INDIAVIX");
const brief=[];if(nf&&!nf.error)brief.push("Nifty 50 "+(nf.d1>=0?"rose ":"fell ")+Math.abs(nf.d1)+"% on the last session; "+nf.r1m+"% over a month and "+nf.r12m+"% over a year ("+nf.trend.toLowerCase()+").");
if(breadth.above200!=null)brief.push("Breadth: "+breadth.above200+"% of "+breadth.n+" scanned stocks are above their 200-day average; "+breadth.adv+" rose and "+breadth.dec+" fell; "+breadth.highs+" at 52-week highs, "+breadth.lows+" at lows.");
if(sectors.length>=6)brief.push("Strongest over 3 months: "+sectors.slice(0,3).map(s=>s.name+" ("+s.r3m+"%)").join(", ")+". Weakest: "+sectors.slice(-3).reverse().map(s=>s.name+" ("+s.r3m+"%)").join(", ")+".");
if(vx&&!vx.error)brief.push("India VIX "+vx.price+(vx.d1!=null?" ("+(vx.d1>=0?"+":"")+vx.d1+"%)":"")+(vx.price>20?": volatility is elevated, so position risk matters more.":": volatility is moderate."));
brief.push(picks.length?picks.length+" companies passed every risk filter and ranked highest today"+(TOKEN?" on trend and fundamentals.":" on trend and risk (fundamentals not checked).")+(elig.length<picks.length*2?" Few stocks qualified, which itself says the market is selective.":""):"No company passed all risk filters today, so no candidates are shown.");
if(weak.length)brief.push(weak.length+" notable names are in downtrends and trailing the market (see Weakening).");
/* ---------- 4. history (immutable) and track record ---------- */
const today=istDate(Date.now()),hp=path.join(RD,today+".json");
if(!fs.existsSync(hp)&&picks.length)fs.writeFileSync(hp,JSON.stringify({date:today,at:Date.now(),nifty:N?N.o.price:null,fundamentals:!!TOKEN,picks:picks.map(p=>({sym:p.sym,name:p.name,price:p.price,classification:p.classification,score:p.score,why:p.why[0]}))}));
const days=fs.readdirSync(RD).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const H=[7,30,90,180,365],agg=H.map(h=>({h,n:0,hits:0,ex:[],ret:[],dd:[]}));const recent=[];
const closeAt=(sym,ms)=>{const M=charts[sym];if(!M)return null;let v=null;for(let i=0;i<M.T.length;i++){if(M.T[i]*1000<=ms)v=M.C[i];else break}return v};
for(const f of days){const d=JSON.parse(fs.readFileSync(path.join(RD,f),"utf8")),start=Date.parse(d.date+"T15:30:00+05:30");
  for(const p of d.picks){const M=charts[p.sym];const cur=M?M.o.price:null,nCur=N?N.o.price:null;
    const row={date:d.date,sym:p.sym,name:p.name,priceThen:p.price,priceNow:cur,ret:cur?r2((cur/p.price-1)*100):null,nifty:d.nifty&&nCur?r2((nCur/d.nifty-1)*100):null};
    if(M){let mn=Infinity;for(let i=0;i<M.T.length;i++)if(M.T[i]*1000>start)mn=Math.min(mn,M.C[i]);row.maxDD=isFinite(mn)?r2(Math.min(0,(mn/p.price-1)*100)):null}
    H.forEach((h,k)=>{const end=start+h*864e5;if(end>Date.now())return;const a=closeAt(p.sym,end),b=d.nifty?closeAt("^NSEI",end):null;if(a==null)return;const R=(a/p.price-1)*100,B=b!=null?(b/d.nifty-1)*100:null;
      const g=agg[k];g.n++;g.ret.push(R);if(B!=null){g.ex.push(R-B);if(R>B)g.hits++}if(row.maxDD!=null)g.dd.push(row.maxDD)});
    recent.push(row)}}
const track={at:Date.now(),since:days[0]||null,daysRecorded:days.length,horizons:agg.map(g=>({days:g.h,matured:g.n,hitRatio:g.n?r2(100*g.hits/g.n):null,avgReturn:g.ret.length?r2(g.ret.reduce((s,x)=>s+x,0)/g.ret.length):null,avgExcess:g.ex.length?r2(g.ex.reduce((s,x)=>s+x,0)/g.ex.length):null,worstDD:g.dd.length?r2(Math.min(...g.dd)):null})),recent:recent.slice(-40).reverse()};
fs.writeFileSync(path.join(RD,"track.json"),JSON.stringify(track));
const latest={v:1,at:Date.now(),date:today,tookSec:Math.round((Date.now()-t0)/1000),universe:{src:U.src,n:U.list.length,priced:rows.length},prices:"yahoo",fundamentals:TOKEN?"upstox":"none",fundNote,
  indices,breadth,sectors,brief,picks,eligible:elig.length,weak,researched,notConnected:["NSE/BSE corporate announcements","FII/DII flows","Promoter pledging, insider trades, auditor changes"],log,
  method:"Universe: Nifty 500. Risk filters: price above the 200-day average with the 50-day above the 200-day; worst 12-month fall smaller than 35%; volatility under 45% a year; RSI 45–72; average daily traded value at least ₹2 crore. Technical score (0–50): 6-month strength vs Nifty 20, trend strength (ADX) 10, low volatility 10, small drawdown 10. Fundamental score (0–50, Upstox only): ROCE, ROE, 3-year sales and profit growth, P/E vs scanned industry peers."};
fs.writeFileSync(path.join(RD,"latest.json"),JSON.stringify(latest));
note("research done: "+picks.length+" candidates, "+elig.length+" eligible, "+weak.length+" weakening, "+days.length+" days recorded");
