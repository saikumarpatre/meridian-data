/* Module 3/4 plumbing: one place that decides Upstox vs Yahoo, labels every fallback, and records the token status.
   The token is only ever passed to the worker code; it is never logged or written to any file. */
const W=(await import("./meridian-worker.mjs")).default;
export function makeSource(token){const T=token&&String(token).length>20?String(token):"",st={configured:!!T,state:T?"untested":"missing",detail:T?null:"No UPSTOX_TOKEN repository secret",counts:{upstox:0,yahoo:0,fallback:0}};
  const envU={UPSTOX_TOKEN:T,SCREENER:"off"},envY={SCREENER:"off"};
  const raw=async(p,env)=>{const r=await W.fetch(new Request("https://feed.local"+p),env);const j=await r.json().catch(()=>({error:"bad JSON"}));if(!r.ok)throw Object.assign(new Error(j.error||("HTTP "+r.status)),{kind:j.kind||"source"});return j};
  const useUp=()=>st.configured&&st.state!=="rejected";
  async function chart(sym,range="2y",opt={}){const p="/api/market/chart?sym="+encodeURIComponent(sym)+"&range="+range+"&interval=1d";
    if(useUp()&&!opt.yahooOnly){try{const j=await raw(p,envU);if(j.__src==="upstox"){st.counts.upstox++;if(st.state==="untested")st.state="ok"}else{st.counts.yahoo++;st.counts.fallback++;j.__fallback=j.__fallback||"Upstox does not cover this instrument";j.__label="Yahoo Finance (fallback: "+j.__fallback+")"}return j}
      catch(e){if(e.kind==="auth"){st.state="rejected";st.detail=e.message}else if(e.kind!=="symbol"&&st.state==="untested"){st.state="error";st.detail=e.message}
        const j=await raw(p,envY);st.counts.yahoo++;st.counts.fallback++;j.__fallback=e.kind==="symbol"?"Upstox has no listing for "+sym:"Upstox failed: "+e.message;j.__label="Yahoo Finance (fallback: "+j.__fallback+")";return j}}
    const j=await raw(p,envY);st.counts.yahoo++;if(st.state==="rejected"){st.counts.fallback++;j.__fallback="Upstox rejected the token";j.__label="Yahoo Finance (fallback: Upstox rejected the token)"}else j.__label=st.configured?"Yahoo Finance":"Yahoo Finance (unofficial; no Upstox token)";return j}
  async function fund(code,basis){if(!useUp())throw new Error(st.state==="rejected"?"Upstox token rejected":"No Upstox token");
    try{const j=await raw("/api/market/fund?code="+encodeURIComponent(code)+"&basis="+basis,envU);if(st.state==="untested")st.state="ok";return j}
    catch(e){if(e.kind==="auth"){st.state="rejected";st.detail=e.message}throw e}}
  async function search(q){return raw("/api/market/search?q="+encodeURIComponent(q),useUp()?envU:envY)}
  async function check(){if(!st.configured)return st;try{const j=await raw("/api/health?check=1",envU),c=j.checks&&j.checks.upstox;
      if(c&&c.ok){st.state="ok";st.detail=c.detail}else{st.state=c&&c.kind==="auth"?"rejected":"error";st.detail=c?c.detail:"no answer"}}catch(e){st.state="error";st.detail=e.message}st.checkedAt=Date.now();return st}
  return{chart,fund,search,check,status:st}}
/* Analytics tokens are JWTs: read only the expiry claim. Never returns or logs the token. */
export function tokenExpiry(token){try{const p=String(token||"").split(".");if(p.length!==3)return null;const j=JSON.parse(Buffer.from(p[1].replace(/-/g,"+").replace(/_/g,"/"),"base64").toString("utf8"));return j&&j.exp?j.exp*1000:null}catch(e){return null}}
