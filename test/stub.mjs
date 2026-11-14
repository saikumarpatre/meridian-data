/* Offline stand-in for every outside service the jobs call. Every company name, price and headline here is SYNTHETIC.
   Controls: STUB_401=1 (Upstox rejects the token), STUB_NOUP=SYM (Upstox has no listing for SYM), STUB_RSS_FAIL=1. Time comes from MER_NOW. */
const N=150,IND=["Capital Goods","Chemicals","Information Technology","Healthcare","Automobile and Auto Components","Fast Moving Consumer Goods","Financial Services","Metals & Mining"];
export const syms=Array.from({length:N},(_,i)=>"SYNT"+String(i).padStart(3,"0"));
function rng(seed){let s=seed>>>0||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return((s>>>0)%1e6)/1e6}}
const hash=s=>[...s].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7);
const START=Date.parse("2024-06-03T03:45:00Z"),DAY=864e5;
/* date-anchored: the same date always gets the same candle, so a later "now" only appends days */
export function series(sym,now){const r=rng(hash(sym)),drift=(r()-0.35)*0.003,sig=0.008+r()*0.025,out=[];let p=100+r()*900;
  for(let t=START;t<=now;t+=DAY){const d=new Date(t);if(d.getUTCDay()===0||d.getUTCDay()===6){r();r();r();continue}const o=p;p*=Math.exp(drift+sig*(r()-0.5)*2);const h=Math.max(o,p)*(1+r()*0.01),l=Math.min(o,p)*(1-r()*0.01);
    if(t+12*36e5<=now||t<=now)out.push([Math.floor(t/1000),o,h,l,p,Math.round(2e5+r()*2e6)]);else r()}return out}
const J=(o,s)=>new Response(JSON.stringify(o),{status:s||200,headers:{"content-type":"application/json"}});
export const calls={},seenAuth=[];
const nowMs=()=>+(process.env.MER_NOW||Date.now());
const rss=(src)=>`<?xml version="1.0"?><rss><channel><title>${src}</title>
<item><title><![CDATA[Synthetic Co 3 wins a large order]]></title><link>https://example.invalid/${src}/a1</link><description>LONG ARTICLE TEXT THAT MUST NOT BE STORED</description><pubDate>${new Date(nowMs()-36e5).toUTCString()}</pubDate></item>
<item><title>Markets end flat &amp; steady</title><link>https://example.invalid/${src}/a2</link><description>MORE TEXT</description><pubDate>${new Date(nowMs()-72e5).toUTCString()}</pubDate></item>
<item><title>Old story</title><link>https://example.invalid/${src}/old</link><pubDate>${new Date(nowMs()-9*864e5).toUTCString()}</pubDate></item>
</channel></rss>`;
const atom=`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom headline about Synthetic Co 7</title><link href="https://example.invalid/atom/1"/><updated>${new Date(nowMs()-18e5).toISOString()}</updated><summary>SECRET SUMMARY</summary></entry></feed>`;
globalThis.fetch=async(u,o)=>{u=String(u);const host=new URL(u).hostname,now=nowMs();calls[host]=(calls[host]||0)+1;
  if(o&&o.headers&&o.headers.authorization)seenAuth.push(o.headers.authorization);
  if(host.includes("niftyindices"))return new Response("Company Name,Industry,Symbol,Series,ISIN Code\n"+syms.map((s,i)=>"Synthetic Co "+i+" Ltd,"+IND[i%IND.length]+","+s+",EQ,INE0SYN"+String(i).padStart(5,"0")).join("\n"));
  if(host.includes("nseindia"))return new Response("blocked",{status:403});
  if(host.includes("yahoo")){if(/\/search/.test(u))return J({quotes:[]});const m=/chart\/([^?]+)/.exec(u);const sym=decodeURIComponent(m[1]).replace(/\.NS$/,"");if(sym==="SYNT149")return new Response("",{status:404});const S=series(sym,now),t=S.map(x=>x[0]);
    return J({chart:{result:[{meta:{regularMarketPrice:S[S.length-1][4],regularMarketTime:t[t.length-1]+21000,currency:"INR"},timestamp:t,indicators:{quote:[{open:S.map(x=>x[1]),high:S.map(x=>x[2]),low:S.map(x=>x[3]),close:S.map(x=>x[4]),volume:S.map(x=>x[5])}]}}],error:null}})}
  if(host==="api.upstox.com"){if(process.env.STUB_401)return J({status:"error",errors:[{errorCode:"UDAPI100050",message:"Invalid token used to access API"}]},401);
    const U=new URL(u),q=U.searchParams;
    if(U.pathname==="/v2/instruments/search"){const s=q.get("query");const idx={"Nifty 50":1,"Nifty 500":1,"Nifty Bank":1,"SENSEX":1,"India VIX":1}[s];
      if(idx)return J({status:"success",data:[{name:s,instrument_key:(s==="SENSEX"?"BSE_INDEX|":"NSE_INDEX|")+s,trading_symbol:s.toUpperCase().replace(/ /g,""),segment:"X"}]});
      if(process.env.STUB_NOUP===s)return J({status:"success",data:[]});
      return J({status:"success",data:[{name:s+" LTD",instrument_key:"NSE_EQ|INE0SYN"+s,isin:"INE0SYN"+s,trading_symbol:s,segment:"NSE_EQ"}]})}
    const key=decodeURIComponent((U.pathname.split("/")[3]||"")),symOf=k=>{const x=k.split("|")[1];return x.startsWith("INE0SYN")?x.slice(7):({"Nifty 50":"^NSEI","Nifty 500":"^CRSLDX","Nifty Bank":"^NSEBANK","SENSEX":"^BSESN","India VIX":"^INDIAVIX"})[x]||x};
    if(U.pathname.startsWith("/v3/historical-candle/")){const S=series(symOf(key),now);return J({status:"success",data:{candles:S.slice().reverse().map(x=>[new Date(x[0]*1000+(5.5*36e5-3.75*36e5)).toISOString().replace(/T.*/,"T00:00:00+05:30"),x[1],x[2],x[3],x[4],x[5],0])}})}
    if(U.pathname==="/v2/market-quote/quotes"){const k=q.get("instrument_key"),S=series(symOf(k),now),l=S[S.length-1];return J({status:"success",data:{[k.replace("|",":")]:{instrument_token:k,last_price:l[4],net_change:l[4]-S[S.length-2][4],last_trade_time:String(l[0]*1000+21000000)}}})}
    const f=/^\/v2\/fundamentals\/([A-Z0-9]+)\/([a-z-]+)$/.exec(U.pathname);if(f){const s=f[1].replace(/^INE0SYN/,""),r=rng(hash(s)+9),hist=(v,l)=>v.map((x,i)=>({period:l[i],value:x}));
      if(f[2]==="key-ratios")return J({status:"success",data:[{name:"P/E",company_value:String(Math.round(10+r()*60))},{name:"ROE",company_value:Math.round(5+r()*30)+"%"},{name:"ROCE",company_value:Math.round(6+r()*35)+"%"},{name:"P/B",company_value:"3"}]});
      if(f[2]==="income-statement"){const g=1+r()*0.3,Y=["Mar 2026","Mar 2025","Mar 2024","Mar 2023"],b=100+r()*900;return J({status:"success",data:{income_statement:[{category:"revenue",history:hist([b*g**3,b*g**2,b*g,b],Y)},{category:"operating_profit",history:hist([b*g**3*.2,b*g**2*.2,b*g*.2,b*.2],Y)},{category:"net_profit",history:hist([b*g**3*.12,b*g**2*.11,b*g*.1,b*.09],Y)}],full_statement:[{particular:"EPS - Basic",history:hist([12,10,9,8],Y)}]}})}
      if(f[2]==="share-holdings")return J({status:"success",data:[{category:"promoters",history:hist([55,54],["Sep 2026","Sep 2025"])}]});
      return J({status:"error",errors:[{message:"not in stub"}]},500)}
    return J({status:"error",errors:[{message:"unknown"}]},404)}
  if(/economictimes|business-standard|livemint|moneycontrol|cnbc|bloomberg|rbi\.org|sebi\.gov/.test(host)){if(process.env.STUB_RSS_FAIL)return new Response("down",{status:503});if(host.includes("sebi"))return new Response(atom);if(host.includes("cnbc"))return new Response("not xml",{status:200});return new Response(rss(host))}
  return new Response("",{status:404})};
