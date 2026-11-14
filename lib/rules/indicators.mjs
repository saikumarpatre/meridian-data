/* Module 5: indicators. Reads daily candles; writes per-stock metrics. Pure functions, no network. */
export const r2=x=>x==null||!isFinite(x)?null:Math.round(x*100)/100;
export const sma=(a,n)=>a.length<n?null:a.slice(-n).reduce((s,x)=>s+x,0)/n;
export function rsi(c,n=14){if(c.length<n+1)return null;let g=0,l=0;for(let i=1;i<=n;i++){const d=c[i]-c[i-1];d>0?g+=d:l-=d}g/=n;l/=n;for(let i=n+1;i<c.length;i++){const d=c[i]-c[i-1];g=(g*(n-1)+(d>0?d:0))/n;l=(l*(n-1)+(d<0?-d:0))/n}return l===0?100:100-100/(1+g/l)}
export function ema(a,n){const k=2/(n+1);let e=a[0];const out=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);out.push(e)}return out}
export function macd(c){if(c.length<35)return null;const e12=ema(c,12),e26=ema(c,26),m=e12.map((x,i)=>x-e26[i]),s=ema(m,9),i=m.length-1;return{macd:m[i],signal:s[i],hist:m[i]-s[i]}}
export const trueRange=(h,l,c)=>{const tr=[];for(let i=1;i<c.length;i++)tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));return tr};
/* Wilder ATR: first value = mean of the first n true ranges, then (prev*(n-1)+TR)/n */
export function atr(h,l,c,n=14){const tr=trueRange(h,l,c);if(tr.length<n)return null;let a=tr.slice(0,n).reduce((s,x)=>s+x,0)/n;for(let i=n;i<tr.length;i++)a=(a*(n-1)+tr[i])/n;return a}
export function adx(h,l,c,n=14){if(c.length<2*n+1)return null;let tr=[],pd=[],md=[];for(let i=1;i<c.length;i++){const up=h[i]-h[i-1],dn=l[i-1]-l[i];pd.push(up>dn&&up>0?up:0);md.push(dn>up&&dn>0?dn:0);tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])))}
  const wild=a=>{let s=a.slice(0,n).reduce((x,y)=>x+y,0);const out=[s];for(let i=n;i<a.length;i++){s=s-s/n+a[i];out.push(s)}return out};const T=wild(tr),P=wild(pd),M=wild(md),dx=T.map((t,i)=>{const p=100*P[i]/t,m=100*M[i]/t;return p+m===0?0:100*Math.abs(p-m)/(p+m)});
  let a=dx.slice(0,n).reduce((x,y)=>x+y,0)/n;for(let i=n;i<dx.length;i++)a=(a*(n-1)+dx[i])/n;const i=T.length-1;return{adx:a,pdi:100*P[i]/T[i],mdi:100*M[i]/T[i]}}
export const ret=(c,n)=>c.length>n&&c[c.length-1-n]>0?(c[c.length-1]/c[c.length-1-n]-1)*100:null;
export function vol(c,n=126){const a=c.slice(-n-1);if(a.length<30)return null;const r=[];for(let i=1;i<a.length;i++)if(a[i-1]>0&&a[i]>0)r.push(Math.log(a[i]/a[i-1]));const m=r.reduce((s,x)=>s+x,0)/r.length;return Math.sqrt(r.reduce((s,x)=>s+(x-m)*(x-m),0)/(r.length-1))*Math.sqrt(252)*100}
export function maxDD(c){let pk=-Infinity,dd=0;for(const x of c){pk=Math.max(pk,x);dd=Math.min(dd,x/pk-1)}return dd*100}
/* candles in Yahoo's chart shape -> clean arrays; drops incomplete rows; optional cut keeps only rows the caller accepts (e.g. complete days) */
export function candles(R,keep){const q=R.indicators.quote[0],t=R.timestamp||[],ix=[];for(let i=0;i<t.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null&&(!keep||keep(t[i])))ix.push(i);
  return{T:ix.map(i=>t[i]),O:ix.map(i=>q.open&&q.open[i]!=null?q.open[i]:q.close[i]),H:ix.map(i=>q.high[i]),L:ix.map(i=>q.low[i]),C:ix.map(i=>q.close[i]),V:ix.map(i=>q.volume?q.volume[i]||0:0)}}
export function metrics(R,keep){const K=candles(R,keep),{T,O,H,L,C,V}=K;if(C.length<60)return null;
  const yr=C.slice(-252),last=C[C.length-1],m=macd(C),a=adx(H,L,C),v20=sma(V,20),v50=sma(V,50);
  let upV=0,dnV=0;for(let i=Math.max(1,C.length-50);i<C.length;i++){if(C[i]>C[i-1])upV+=V[i];else if(C[i]<C[i-1])dnV+=V[i]}
  const o={price:last,tradeAt:T[T.length-1]*1000,days:C.length,prevClose:C.length>1?C[C.length-2]:null,
    d1:C.length>1?(last/C[C.length-2]-1)*100:null,r1m:ret(C,21),r3m:ret(C,63),r6m:ret(C,126),r12m:ret(C,Math.min(252,C.length-1)),
    sma20:sma(C,20),sma50:sma(C,50),sma100:sma(C,100),sma200:sma(C,200),rsi:rsi(C),macd:m?m.hist:null,adx:a?a.adx:null,pdi:a?a.pdi:null,mdi:a?a.mdi:null,
    atr14:atr(H,L,C,14),swingLow20:Math.min(...L.slice(-20)),
    vol:vol(C),dd:maxDD(yr),hi52:Math.max(...H.slice(-252)),lo52:Math.min(...L.slice(-252)),volRatio:v50?v20/v50:null,upDown:dnV?upV/dnV:null,traded:v20!=null?v20*last/1e7:null};
  o.offHigh=(last/o.hi52-1)*100;
  o.trend=o.sma200==null?"Not enough history":last>o.sma50&&o.sma50>o.sma200&&(o.adx||0)>=25?"Strong uptrend":last>o.sma50&&o.sma50>o.sma200?"Uptrend":last<o.sma50&&last>o.sma200?"Weakening":last<o.sma200&&o.sma50<o.sma200?"Downtrend":"Sideways";
  o.flags=[];if(o.rsi>70)o.flags.push("Overbought (RSI "+Math.round(o.rsi)+")");if(o.rsi<30)o.flags.push("Oversold (RSI "+Math.round(o.rsi)+")");
  if(o.offHigh>-2&&o.volRatio>1.3)o.flags.push("At a 52-week high on rising volume");if(last<=o.lo52*1.02)o.flags.push("Near its 52-week low");
  if(o.upDown>1.5&&o.volRatio>1.1)o.flags.push("Accumulation: up-day volume "+o.upDown.toFixed(1)+"× down-day volume (50 days)");if(o.upDown!=null&&o.upDown<0.67)o.flags.push("Distribution: down-day volume outweighs up-day volume");
  for(const k of Object.keys(o))if(typeof o[k]==="number"&&k!=="tradeAt")o[k]=r2(o[k]);return{o,...K}}
/* 200-day average as of index i (for lifecycle checks on past days) */
export const sma200At=(C,i)=>i+1<200?null:C.slice(i-199,i+1).reduce((s,x)=>s+x,0)/200;
