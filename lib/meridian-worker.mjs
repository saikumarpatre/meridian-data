/* Meridian live-data link for Cloudflare Workers (free plan). Paste this whole file into a new Worker.
   Two separate engines, so one failing never stops the other:
   - PRICES: Upstox Market Quote + Historical Candle APIs (official NSE/BSE data) when the Worker has an UPSTOX_TOKEN secret;
     otherwise Yahoo Finance's public chart data (unofficial, may be delayed).
   - FUNDAMENTALS: Upstox Fundamentals APIs (income statement, balance sheet, cash flow, key ratios, shareholding) with UPSTOX_TOKEN;
     otherwise Screener.in company pages, unless the Worker has SCREENER=off.
   UPSTOX_TOKEN is an Upstox "Analytics Token": free, read-only, valid one year, cannot place orders. It stays inside this Worker.
   Paths: /api/health, /api/market/chart, /api/market/search, /api/market/fund, /api/market/screen */
/* Screener.in company page parser, shared by the Meridian server (Node) and the browser fallback.
   Pure string parsing: no DOM. Returns only what it can read; anything missing stays null so callers can keep their snapshot. */
function mpText(h){return String(h||"").replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/&#8377;|₹/g,"").replace(/\s+/g," ").trim()}
function mpNum(s){if(s==null)return null;var t=String(s).replace(/,/g,"").replace(/[^\d.\-]/g," ").trim().split(/\s+/)[0];if(t===""||t==="-"||isNaN(+t))return null;return +t}
function mpSection(html,id){var i=html.search(new RegExp('<section[^>]*id=["\']'+id+'["\']',"i"));if(i<0)return null;var j=html.indexOf("</section>",i);return html.slice(i,j<0?undefined:j)}
function mpTable(sec){if(!sec)return null;var i=sec.search(/<table[^>]*class=["'][^"']*data-table/i);if(i<0)return null;var j=sec.indexOf("</table>",i);var t=sec.slice(i,j);
  var head=[];var th=t.match(/<thead[\s\S]*?<\/thead>/i);(th?th[0]:"").replace(/<th[^>]*>([\s\S]*?)<\/th>/gi,function(_,x){head.push(mpText(x))});
  var rows={};var body=t.match(/<tbody[\s\S]*?<\/tbody>/i);(body?body[0]:t).replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi,function(_,r){var cells=[];r.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi,function(__,c){cells.push(mpText(c))});if(!cells.length)return;var name=cells[0].replace(/\s*[+\-]\s*$/,"").trim();if(name&&!rows[name])rows[name]=cells.slice(1)});
  return{head:head.slice(1),rows:rows}}
function mpRow(T,names){if(!T)return null;for(var i=0;i<names.length;i++){var k=Object.keys(T.rows).filter(function(x){return x.toLowerCase()===names[i].toLowerCase()})[0];if(k)return T.rows[k].map(mpNum)}return null}
function parseScreener(html){var out={name:null,ratios:{},pl:null,q:null,promoter:null,warnings:[]};html=String(html||"");
  var h1=html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);out.name=h1?mpText(h1[1]):null;
  var i=html.search(/id=["']top-ratios["']/i);if(i<0)out.warnings.push("top ratios not found");else{var j=html.indexOf("</ul>",i);var ul=html.slice(i,j);
    ul.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi,function(_,li){var nm=li.match(/class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);if(!nm)return;var key=mpText(nm[1]);var nums=[];li.replace(/class=["'][^"']*\bnumber\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,function(__,n){var v=mpNum(mpText(n));if(v!=null)nums.push(v)});out.ratios[key]=nums})}
  var r=out.ratios,g=function(k,ix){var a=r[k];return a&&a.length>(ix||0)?a[ix||0]:null};
  out.price=g("Current Price");out.mcap=g("Market Cap");out.pe=g("Stock P/E");out.bv=g("Book Value");out.dy=g("Dividend Yield");out.roce=g("ROCE");out.roe=g("ROE");out.hi=g("High / Low",0);out.lo=g("High / Low",1);
  var PL=mpTable(mpSection(html,"profit-loss"));if(!PL)out.warnings.push("profit and loss table not found");else out.pl={head:PL.head,sales:mpRow(PL,["Sales","Revenue"]),op:mpRow(PL,["Operating Profit","Financing Profit"]),opm:mpRow(PL,["OPM %","Financing Margin %"]),int:mpRow(PL,["Interest"]),dep:mpRow(PL,["Depreciation"]),np:mpRow(PL,["Net Profit"]),eps:mpRow(PL,["EPS in Rs"])};
  var Q=mpTable(mpSection(html,"quarters"));if(Q)out.q={head:Q.head,sales:mpRow(Q,["Sales","Revenue"]),op:mpRow(Q,["Operating Profit","Financing Profit"]),np:mpRow(Q,["Net Profit"])};
  var shSec=mpSection(html,"shareholding"),qd=shSec?shSec.search(/id=["']quarterly-shp["']/i):-1,SH=mpTable(qd>=0?shSec.slice(qd):shSec);
  if(SH){var pr=mpRow(SH,["Promoters"]);if(pr&&pr.length)out.promoter={head:SH.head,vals:pr};out.sh={head:SH.head,pro:pr,fii:mpRow(SH,["FIIs"]),dii:mpRow(SH,["DIIs"]),gov:mpRow(SH,["Government"]),pub:mpRow(SH,["Public"]),n:mpRow(SH,["No. of Shareholders"])}}else out.warnings.push("shareholding not found");
  var BS=mpTable(mpSection(html,"balance-sheet"));if(BS)out.bs={head:BS.head,eq:mpRow(BS,["Equity Capital"]),res:mpRow(BS,["Reserves"]),bor:mpRow(BS,["Borrowings"]),tot:mpRow(BS,["Total Liabilities","Total Assets"]),nb:mpRow(BS,["Fixed Assets","Net Block"]),cwip:mpRow(BS,["CWIP"]),inv:mpRow(BS,["Investments"])};
  var CF=mpTable(mpSection(html,"cash-flow"));if(CF)out.cf={head:CF.head,cfo:mpRow(CF,["Cash from Operating Activity"]),cfi:mpRow(CF,["Cash from Investing Activity"])};
  var RA=mpTable(mpSection(html,"ratios"));if(RA)out.ra={head:RA.head,dd:mpRow(RA,["Debtor Days"]),id:mpRow(RA,["Inventory Days"]),ccc:mpRow(RA,["Cash Conversion Cycle"]),wcd:mpRow(RA,["Working Capital Days"]),roce:mpRow(RA,["ROCE %"])};
  out.about=mpAbout(html);out.ranges=mpRanges(html);out.pros=mpList(html,"pros");out.cons=mpList(html,"cons");out.sector=mpSectors(html);
  return out}
function mpAbout(html){var i=String(html).search(/class=["'][^"']*\babout\b[^"']*["']/i);if(i<0)return null;var seg=html.slice(i,i+3000),p=seg.match(/<p[^>]*>([\s\S]*?)<\/p>/i);var t=p?mpText(p[1]):null;return t?t.slice(0,400):null}
/* the four small growth tables beside the P&L: {"Compounded Sales Growth":{"10 Years":14,...},...} */
function mpRanges(html){var o={};String(html).replace(/<table[^>]*class=["'][^"']*ranges-table[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi,function(_,t){var th=t.match(/<th[^>]*>([\s\S]*?)<\/th>/i);if(!th)return;var name=mpText(th[1]),rows={};
    t.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi,function(__,r){var c=[];r.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi,function(___,x){c.push(mpText(x))});if(c.length>=2)rows[c[0].replace(/:\s*$/,"")]=mpNum(c[1])});o[name]=rows});return o}
function mpList(html,cls){var i=String(html).search(new RegExp('<div[^>]*class=["\'][^"\']*\\b'+cls+'\\b',"i"));if(i<0)return[];var j=html.indexOf("</ul>",i);var seg=html.slice(i,j<0?i+4000:j),out=[];seg.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi,function(_,x){var t=mpText(x);if(t)out.push(t)});return out.slice(0,8)}
function mpSectors(html){var out=[];String(html).replace(/<a[^>]*href=["'](?:https:\/\/www\.screener\.in)?\/market\/(IN[0-9A-Z\/]+)["'][^>]*>([\s\S]*?)<\/a>/gi,function(_,code,t){var depth=code.replace(/\/$/,"").split("/").length,txt=mpText(t);if(txt&&!out.some(function(x){return x.code===code}))out.push({code:code,depth:depth,name:txt})});
  out.sort(function(a,b){return a.depth-b.depth});return out.slice(0,4)}
/* a public screen's results page: header names and one object per company row */
function parseScreen(html){html=String(html||"");var out={title:null,head:[],rows:[],total:null,pages:null,warnings:[]};
  var h1=html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);out.title=h1?mpText(h1[1]):null;
  var tm=mpText(html).match(/([\d,]+) results found(?:: Showing page \d+ of (\d+))?/i);if(tm){out.total=mpNum(tm[1]);out.pages=tm[2]?+tm[2]:1}
  var tables=html.match(/<table[\s\S]*?<\/table>/gi)||[],t=tables.filter(function(x){return /href=["'](?:https:\/\/www\.screener\.in)?\/company\//i.test(x)})[0];
  if(!t){out.warnings.push("results table not found");return out}
  var hr=t.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);if(hr)hr[1].replace(/<th[^>]*>([\s\S]*?)<\/th>/gi,function(_,x){out.head.push(mpText(x))});
  t.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi,function(_,r){var a=r.match(/href=["'](?:https:\/\/www\.screener\.in)?\/company\/([^\/"']+)\/(consolidated\/)?["'][^>]*>([\s\S]*?)<\/a>/i);if(!a)return;var cells=[];r.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi,function(__,c){cells.push(mpText(c))});
    var o={code:decodeURIComponent(a[1]).toUpperCase(),cons:!!a[2],name:mpText(a[3]),cells:{}};out.head.forEach(function(h,i){if(i<cells.length&&!/^s\.?\s*no/i.test(h)&&!/^(name|company)$/i.test(h))o.cells[h]=mpNum(cells[i])});out.rows.push(o)});
  if(!out.rows.length)out.warnings.push("no company rows found");return out}

const UA="Mozilla/5.0 (compatible; MeridianLearning/1.0; educational, low-volume)";
const SYM=/^[A-Z0-9^&.=\-]{1,24}$/,CODE=/^([A-Z0-9&\-]{1,20}|\d{6})$/,RANGES=["5d","1mo","3mo","6mo","1y","2y"],INTERVALS=["1d","1wk"];
function nseOpen(){const t=new Date(Date.now()+330*6e4),d=t.getUTCDay(),m=t.getUTCHours()*60+t.getUTCMinutes();return d>=1&&d<=5&&m>=555&&m<=930}
const CORS={"access-control-allow-origin":"*","access-control-allow-methods":"GET, OPTIONS","access-control-allow-headers":"content-type","cache-control":"no-store"};
function json(o,status){return new Response(JSON.stringify(o),{status:status||200,headers:Object.assign({"content-type":"application/json; charset=utf-8"},CORS)})}
async function cached(key,ttl,make){const c=typeof caches!=="undefined"?caches.default:null,req=new Request("https://meridian-cache.invalid/"+encodeURIComponent(key));
  if(c){const hit=await c.match(req);if(hit){const o=await hit.json();if(Date.now()-o.__at<ttl*1000)return Object.assign(o,{__cached:true})}}
  const o=await make();o.__at=Date.now();if(c)await c.put(req,new Response(JSON.stringify(o),{headers:{"content-type":"application/json","cache-control":"max-age="+Math.max(ttl,3600*12)}}));return o}
async function get(url,type){const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),12000);let r;const host=new URL(url).hostname.replace(/^www\./,"");
  try{r=await fetch(url,{headers:{"user-agent":UA,accept:type==="json"?"application/json":"text/html"},signal:ctl.signal})}catch(e){throw Object.assign(new Error(e.name==="AbortError"?host+" did not answer within 12 s":host+" could not be reached"),{code:504,kind:"timeout"})}finally{clearTimeout(t)}
  if(!r.ok)throw Object.assign(new Error(host+" answered "+r.status+(r.status===403?" (access refused)":r.status===429?" (rate limited)":"")),{code:502,kind:"source"});return type==="json"?r.json():r.text()}
/* ---------- Upstox ---------- */
const UPX="https://api.upstox.com";
const UIDX={"^NSEI":["NSE","Nifty 50"],"^CRSLDX":["NSE","Nifty 500"],"^NSEBANK":["NSE","Nifty Bank"],"^BSESN":["BSE","SENSEX"]};
function upErr(status,body){const m=body&&body.errors&&body.errors[0]&&(body.errors[0].message||body.errors[0].errorCode);
  if(status===401)return Object.assign(new Error("Upstox rejected the token (expired, revoked or mistyped). Generate a new Analytics Token in Upstox Developer Apps and update UPSTOX_TOKEN."),{code:502,kind:"auth"});
  if(status===429)return Object.assign(new Error("Upstox rate limit reached; try again in a minute."),{code:503,kind:"rate"});
  return Object.assign(new Error("Upstox answered "+status+(m?": "+m:"")),{code:502,kind:"source"})}
async function up(env,path){const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),12000);let r;
  try{r=await fetch(UPX+path,{headers:{accept:"application/json",authorization:"Bearer "+env.UPSTOX_TOKEN},signal:ctl.signal})}catch(e){throw Object.assign(new Error(e.name==="AbortError"?"Upstox did not answer within 12 s":"Upstox could not be reached"),{code:504,kind:"timeout"})}finally{clearTimeout(t)}
  let b=null;try{b=await r.json()}catch(e){}if(!r.ok||!b||b.status==="error")throw upErr(r.status||502,b);return b}
/* NSE symbol / BSE code / index -> Upstox instrument (key, ISIN, name), checked and cached for 30 days */
async function upFind(env,sym){return cached("um|"+sym,30*86400,async()=>{let ex="NSE",seg="EQ",qy=sym,want=null;
    if(UIDX[sym]){ex=UIDX[sym][0];seg="INDEX";qy=UIDX[sym][1];want=qy.toLowerCase()}else{const m=/^(.+)\.(NS|BO)$/.exec(sym);if(!m)throw Object.assign(new Error("Not an NSE/BSE symbol"),{code:400,kind:"symbol"});qy=m[1];ex=m[2]==="NS"?"NSE":"BSE";want=qy.toLowerCase()}
    const b=await up(env,"/v2/instruments/search?query="+encodeURIComponent(qy)+"&exchanges="+ex+"&segments="+seg+"&records=30");
    const L=(b.data||[]).filter(x=>x&&x.instrument_key),hit=L.find(x=>String(x.trading_symbol||"").toLowerCase()===want)||L.find(x=>String(x.name||"").toLowerCase()===want)||(seg==="EQ"&&/^\d{6}$/.test(qy)?L.find(x=>String(x.exchange_token||"")===qy):null);
    if(!hit)throw Object.assign(new Error("Upstox has no "+ex+" "+(seg==="INDEX"?"index":"listing")+" with the symbol "+qy),{code:404,kind:"symbol"});
    return{key:hit.instrument_key,isin:hit.isin||null,name:hit.name||qy,sym:hit.trading_symbol||qy,ex:ex}})}
function dIST(ms){return new Date(ms+330*6e4).toISOString().slice(0,10)}
const RDAYS={"5d":7,"1mo":31,"3mo":93,"6mo":186,"1y":366,"2y":731};
/* one chart in Yahoo's shape so every existing screen keeps working; __src says where it really came from */
async function upChart(env,sym,range){const I=await upFind(env,sym),k=encodeURIComponent(I.key),now=Date.now();
  const [c,qt]=await Promise.all([cached("uc|"+I.key+"|"+range,nseOpen()?3600:6*3600,()=>up(env,"/v3/historical-candle/"+k+"/days/1/"+dIST(now)+"/"+dIST(now-RDAYS[range]*864e5))),
    cached("uq|"+I.key,nseOpen()?60:1800,()=>up(env,"/v2/market-quote/quotes?instrument_key="+k))]);
  const C=((c.data&&c.data.candles)||[]).slice().sort((a,b)=>Date.parse(a[0])-Date.parse(b[0]));
  const QV=Object.values(qt.data||{}),Q=QV.find(v=>v&&v.instrument_token===I.key)||QV[0]||null;
  if(!C.length&&!(Q&&Q.last_price>0))throw Object.assign(new Error("Upstox returned no price data for "+sym),{code:404,kind:"empty"});
  const ltt=Q&&Q.last_trade_time?Number(Q.last_trade_time):null,price=Q&&Q.last_price>0?Q.last_price:C[C.length-1][4];
  const meta={regularMarketPrice:price,regularMarketTime:Math.round((ltt||Date.parse(C[C.length-1][0]))/1000),currency:"INR",exchangeName:I.ex,fullExchangeName:I.ex,longName:I.name,
    previousClose:Q&&Q.net_change!=null&&Q.last_price>0?Math.round((Q.last_price-Q.net_change)*100)/100:null};
  return{chart:{result:[{meta:meta,timestamp:C.map(x=>Math.round(Date.parse(x[0])/1000)),indicators:{quote:[{open:C.map(x=>x[1]),high:C.map(x=>x[2]),low:C.map(x=>x[3]),close:C.map(x=>x[4]),volume:C.map(x=>x[5])}]}}],error:null},
    __src:"upstox",__key:I.key,__name:I.name,__tradeAt:ltt,__quoteAt:qt.__at||now,__cached:!!(c.__cached&&qt.__cached)}}
async function yahooChart(sym,range,interval){return cached("c|"+sym+"|"+range+"|"+interval,nseOpen()?300:3600,async()=>{const j=await get("https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(sym)+"?range="+range+"&interval="+interval,"json");if(!j||!j.chart||!j.chart.result)throw Object.assign(new Error("No price data for "+sym),{code:404,kind:"empty"});j.__src="yahoo";return j})}
/* fundamentals from Upstox, returned in the same shape as the Screener parser; every field says where it came from, missing ones are listed */
const MON={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function pKey(p){const m=/(\w{3})\w*\s+(\d{4})/.exec(String(p||""));return m&&MON[m[1]]!=null?+m[2]*12+MON[m[1]]:null}
function asc(h){return(h||[]).filter(x=>x&&pKey(x.period)!=null&&x.value!=null&&isFinite(+x.value)).sort((a,b)=>pKey(a.period)-pKey(b.period))}
function cat(arr,name){const x=(arr||[]).find(y=>y&&y.category===name);return x?asc(x.history):[]}
function part(fs,re){const x=(fs||[]).find(y=>y&&re.test(String(y.particular||"")));return x?asc(x.history):[]}
function series(head,h){const m={};h.forEach(x=>{m[x.period]=+x.value});return head.map(p=>m[p]!=null?m[p]:null)}
function pct(v){if(v==null)return null;const n=parseFloat(String(v).replace(/[%,]/g,""));return isFinite(n)?n:null}
function r2(x){return x==null||!isFinite(x)?null:Math.round(x*100)/100}
async function upFund(env,code,basis){const I=await upFind(env,/^\d{6}$/.test(code)?code+".BO":code+".NS");if(!I.isin)throw Object.assign(new Error("Upstox listing has no ISIN for "+code),{code:404,kind:"symbol"});
  const F="/v2/fundamentals/"+I.isin,t="type="+basis,k=encodeURIComponent(I.key);
  const job=(p)=>up(env,p).then(b=>({ok:true,b:b}),e=>({ok:false,e:e}));
  const [qt,kr,isy,isq,bs,cf,sh]=await Promise.all([job("/v2/market-quote/quotes?instrument_key="+k),job(F+"/key-ratios"),job(F+"/income-statement?"+t+"&time_period=yearly&fs=true"),job(F+"/income-statement?"+t+"&time_period=quarterly"),job(F+"/balance-sheet?"+t+"&fs=true"),job(F+"/cash-flow?"+t+"&fs=true"),job(F+"/share-holdings")]);
  const auth=[qt,kr,isy,isq,bs,cf,sh].find(x=>!x.ok&&x.e.kind==="auth");if(auth)throw auth.e;
  if([kr,isy,bs,cf,sh].every(x=>!x.ok))throw Object.assign(new Error("Upstox returned no fundamentals for "+code+" ("+kr.e.message+")"),{code:502,kind:"empty"});
  const src={},miss=[],errs=[],d={name:I.name,ratios:{},warnings:[]},S=(f,s)=>{src[f]=s};
  [["quote",qt],["key ratios",kr],["yearly results",isy],["quarterly results",isq],["balance sheet",bs],["cash flow",cf],["shareholding",sh]].forEach(([n,x])=>{if(!x.ok)errs.push(n+": "+x.e.message)});
  const Q=qt.ok?Object.values(qt.b.data||{})[0]:null;d.price=Q&&Q.last_price>0?Q.last_price:null;if(d.price!=null)S("price","Upstox quote");
  const R={};if(kr.ok)(kr.b.data||[]).forEach(x=>{R[String(x.name||"").toUpperCase()]=pct(x.company_value)});
  d.pe=R["P/E"]!=null?R["P/E"]:null;d.roe=R.ROE!=null?R.ROE:null;d.roce=R.ROCE!=null?R.ROCE:null;["pe","roe","roce"].forEach(f=>{if(d[f]!=null)S(f,"Upstox key ratios")});
  d.bv=R["P/B"]>0&&d.price?r2(d.price/R["P/B"]):null;if(d.bv!=null)S("bv","derived: price ÷ P/B (Upstox)");
  const Y=isy.ok?isy.b.data:null,QQ=isq.ok?isq.b.data:null;
  if(Y){const rev=cat(Y.income_statement,"revenue"),op=cat(Y.income_statement,"operating_profit"),np=cat(Y.income_statement,"net_profit"),fs=Y.full_statement||[];
    const head=rev.map(x=>x.period);if(head.length){const qs=QQ?cat(QQ.income_statement,"revenue"):[],qo=QQ?cat(QQ.income_statement,"operating_profit"):[],qn=QQ?cat(QQ.income_statement,"net_profit"):[];
      const ttm=a=>a.length>=4?a.slice(-4).reduce((s,x)=>s+(+x.value),0):null,sales=series(head,rev),ops=series(head,op),nps=series(head,np),eps=series(head,part(fs,/^EPS\s*-\s*Basic/i)),int=series(head,part(fs,/interest|finance cost/i)),dep=series(head,part(fs,/depreciation/i));
      const T=[ttm(qs),ttm(qo),ttm(qn)];d.pl={head:head.concat("TTM"),sales:sales.concat(T[0]),op:ops.concat(T[1]),np:nps.concat(T[2]),opm:sales.map((s,i)=>s&&ops[i]!=null?r2(ops[i]/s*100):null).concat(T[0]&&T[1]!=null?r2(T[1]/T[0]*100):null),eps:eps.concat(null),int:int.concat(null),dep:dep.concat(null)};
      S("sales","Upstox income statement ("+basis+", ₹ crore)");S("np","Upstox income statement");if(T[0]!=null)S("ttm","sum of the last 4 quarters (Upstox)");else miss.push("TTM (fewer than 4 quarters returned)");
      if(eps.every(x=>x==null))miss.push("EPS");if(int.every(x=>x==null))miss.push("interest");if(dep.every(x=>x==null))miss.push("depreciation");
      if(head.length>=4&&sales[0]>0&&sales[3]>0){d.ranges={"Compounded Sales Growth":{"3 Years":r2((Math.pow(sales[sales.length-1]/sales[sales.length-4],1/3)-1)*100)}};S("growth","derived: 3-year CAGR from Upstox yearly revenue")}
      if(head.length>=4&&nps[nps.length-4]>0&&nps[nps.length-1]>0){d.ranges=d.ranges||{};d.ranges["Compounded Profit Growth"]={"3 Years":r2((Math.pow(nps[nps.length-1]/nps[nps.length-4],1/3)-1)*100)}}
      const lastEps=eps.filter(x=>x>0).pop(),lastNp=nps[eps.lastIndexOf(lastEps)];if(d.price&&lastEps>0&&lastNp>0){d.mcap=Math.round(d.price*lastNp/lastEps);S("mcap","derived: price × shares (latest FY profit ÷ EPS)")}}
    if(QQ){const qh=cat(QQ.income_statement,"revenue").map(x=>x.period);if(qh.length)d.q={head:qh,sales:series(qh,cat(QQ.income_statement,"revenue")),op:series(qh,cat(QQ.income_statement,"operating_profit")),np:series(qh,cat(QQ.income_statement,"net_profit"))}}}
  if(sh.ok){const D=sh.b.data||[],pro=cat(D,"promoters"),head=pro.map(x=>x.period);if(head.length){const fii=series(head,cat(D,"fii")),od=series(head,cat(D,"other_dii")),mf=series(head,cat(D,"mutual_funds"));
      d.promoter={head:head,vals:series(head,pro)};d.sh={head:head,pro:series(head,pro),fii:fii,dii:head.map((_,i)=>od[i]!=null&&mf[i]!=null?r2(od[i]+mf[i]):null),pub:series(head,cat(D,"retail_and_other")),n:head.map(()=>null)};S("promoter","Upstox shareholding");miss.push("number of shareholders","pledged shares")}}
  if(bs.ok){const B=bs.b.data||{},h=asc((B.history||[]).map(x=>({period:x.period,value:x.total_asset}))),head=h.map(x=>x.period),fs=B.full_statement||[];
    if(head.length){const bor=part(fs,/borrowing|total debt/i);d.bs={head:head,tot:series(head,h),eq:series(head,part(fs,/^Equity Capital/i)),res:series(head,part(fs,/reserves/i)),bor:bor.length?series(head,bor):null,nb:null,cwip:null,inv:null};S("bs","Upstox balance sheet");if(!bor.length)miss.push("debt / borrowings")}}
  if(cf.ok){const C=cf.b.data||{},o=cat(C.cash_flow,"operating"),head=o.map(x=>x.period);if(head.length){d.cf={head:head,cfo:series(head,o),cfi:series(head,cat(C.cash_flow,"investing"))};S("cf","Upstox cash flow")}}
  ["dividend yield","52-week high/low"].forEach(x=>miss.push(x));if(d.mcap==null)miss.push("market cap");if(d.pe==null)miss.push("P/E");if(d.roce==null)miss.push("ROCE");if(d.roe==null)miss.push("ROE");
  return{ok:true,code:code,basis:basis,src:"https://upstox.com/developer/api-documentation/get-key-ratios",source:"Upstox Fundamentals API",isin:I.isin,at:Date.now(),data:d,fields:src,missing:miss,partial:errs}}
export default{async fetch(request,env){env=env||{};const url=new URL(request.url),p=url.pathname,q=url.searchParams,tok=!!(env.UPSTOX_TOKEN&&String(env.UPSTOX_TOKEN).length>20),scr=String(env.SCREENER||"").toLowerCase()!=="off";
  if(request.method==="OPTIONS")return new Response(null,{headers:CORS});if(request.method!=="GET")return json({error:"Method not allowed"},405);
  try{
    if(p==="/api/health"){const o={ok:true,market:true,kind:"cloudflare-worker",nseOpen:nseOpen(),engines:{prices:tok?"upstox":"yahoo",fundamentals:tok?"upstox":(scr?"screener":"none"),screens:scr?"screener":"none"},upstox:{configured:tok}};
      if(q.get("check")==="1"){o.checks={};if(tok){try{const I=await upFind(env,"^NSEI");const b=await up(env,"/v2/market-quote/quotes?instrument_key="+encodeURIComponent(I.key));const v=Object.values(b.data||{})[0];o.checks.upstox={ok:!!(v&&v.last_price>0),detail:v?"Nifty 50 "+v.last_price:"no quote"}}catch(e){o.checks.upstox={ok:false,kind:e.kind||"error",detail:e.message}}}
        try{const j=await get("https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=1d&interval=1d","json");o.checks.yahoo={ok:!!(j&&j.chart&&j.chart.result)}}catch(e){o.checks.yahoo={ok:false,detail:e.message}}
        if(scr&&!tok){try{const h=await get("https://www.screener.in/company/MPSLTD/","html");o.checks.screener={ok:/profit-loss/.test(h),detail:/profit-loss/.test(h)?"page read":"page layout not recognised (possibly a bot check)"}}catch(e){o.checks.screener={ok:false,detail:e.message}}}}
      return json(o)}
    if(p==="/api/market/chart"){const sym=String(q.get("sym")||""),range=String(q.get("range")||"1mo"),interval=String(q.get("interval")||"1d");
      if(!SYM.test(sym)||!RANGES.includes(range)||!INTERVALS.includes(interval))return json({error:"Bad symbol or range",kind:"symbol"},400);
      let o=null,why=null;const upable=tok&&interval==="1d"&&(UIDX[sym]||/\.(NS|BO)$/.test(sym));
      if(upable){try{o=await upChart(env,sym,range)}catch(e){if(e.kind==="symbol"||e.kind==="auth")return json({error:e.message,kind:e.kind,src:"upstox"},e.code||502);why=e.message}}
      if(!o){o=await yahooChart(sym,range,interval);if(why)o.__fallback="Upstox failed ("+why+"); this is Yahoo Finance data"}
      o.__via="meridian-worker";return json(o)}
    if(p==="/api/market/search"){const qs=String(q.get("q")||"").replace(/[^A-Za-z0-9&.\- ]/g," ").trim().slice(0,50);if(qs.length<2)return json({error:"Search text too short",kind:"symbol"},400);
      if(tok){const b=await cached("us|"+qs.toLowerCase(),7*86400,()=>up(env,"/v2/instruments/search?query="+encodeURIComponent(qs)+"&exchanges=NSE,BSE&segments=EQ&records=10"));
        return json({quotes:(b.data||[]).filter(x=>x&&x.trading_symbol).map(x=>({symbol:x.trading_symbol+(x.exchange==="BSE"?".BO":".NS"),shortname:x.name,longname:x.name,quoteType:"EQUITY",exchange:x.exchange,isin:x.isin||null})),__src:"upstox"})}
      const j=await cached("ys|"+qs.toLowerCase(),7*86400,async()=>{const r=await get("https://query2.finance.yahoo.com/v1/finance/search?q="+encodeURIComponent(qs)+"&quotesCount=6&newsCount=0","json");return{quotes:(r&&r.quotes)||[]}});j.__src="yahoo";return json(j)}
    if(p==="/api/market/fund"){const code=String(q.get("code")||"").toUpperCase(),basis=String(q.get("basis")||"standalone");
      if(!CODE.test(code)||(basis!=="standalone"&&basis!=="consolidated"))return json({error:"Bad company code",kind:"symbol"},400);
      if(tok){const o=await cached("uf|"+code+"|"+basis,12*3600,()=>upFund(env,code,basis));return json(o)}
      if(!scr)return json({error:"No fundamentals source: add UPSTOX_TOKEN to this Worker",kind:"setup"},503);
      const src="https://www.screener.in/company/"+encodeURIComponent(code)+"/"+(basis==="consolidated"?"consolidated/":"");
      const o=await cached("f|"+code+"|"+basis,12*3600,async()=>{const d=parseScreener(await get(src,"html"));if(d.price==null&&!d.pl)throw Object.assign(new Error("Page layout not recognised ("+d.warnings.join("; ")+")"),{code:502,kind:"parse"});return{ok:true,code:code,basis:basis,src:src,source:"Screener.in",at:Date.now(),data:d}});
      return json(o)}
    if(p==="/api/market/screen"){if(!scr)return json({error:"Screener.in pages are switched off on this link (SCREENER=off)",kind:"setup"},503);const id=String(q.get("id")||""),slug=String(q.get("slug")||""),page=Number(q.get("page")||1);
      if(!/^\d{1,9}$/.test(id)||!/^[a-z0-9-]{1,90}$/.test(slug)||!(page>=1&&page<=5))return json({error:"Bad screen"},400);
      const src="https://www.screener.in/screens/"+id+"/"+slug+"/"+(page>1?"?page="+page:"");
      const o=await cached("s|"+id+"|"+page,12*3600,async()=>{const d=parseScreen(await get(src,"html"));if(!d.rows.length)throw Object.assign(new Error("Screen page not recognised ("+d.warnings.join("; ")+")"),{code:502,kind:"parse"});return{ok:true,id:id,page:page,src:src,at:Date.now(),data:d}});
      return json(o)}
    return json({error:"Not found"},404)
  }catch(e){return json({error:e.message||"Source error",kind:e.kind||"source"},e.code||502)}}};
