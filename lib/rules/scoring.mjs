/* Module 8: scoring. Reads metrics (+ Upstox fundamentals when present); writes tech (0-50), fund (0-50), confidence. */
import {r2} from "./indicators.mjs";
export const pctRank=(arr,v)=>{const a=arr.filter(x=>x!=null);if(!a.length||v==null)return 0;return a.filter(x=>x<=v).length/a.length};
export const median=a=>{const b=a.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y);if(!b.length)return null;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2};
export function techScores(rows){const A={rs:rows.map(r=>r.rs6m),vol:rows.map(r=>-r.vol),dd:rows.map(r=>r.dd),adx:rows.map(r=>r.adx)};
  rows.forEach(r=>{r.tech=r2(20*pctRank(A.rs,r.rs6m)+10*pctRank(A.adx,r.adx)+10*pctRank(A.vol,-r.vol)+10*pctRank(A.dd,r.dd))});return rows}
export function fundScores(rows){const peMed={};rows.filter(r=>r.f&&!r.f.error&&r.f.pe>0).forEach(r=>{(peMed[r.industry]=peMed[r.industry]||[]).push(r.f.pe)});
  rows.forEach(r=>{const f=r.f;if(!f||f.error){r.fund=null;return}const pm=median(peMed[r.industry]||[]),q=x=>x==null?0:x;let s=0;
    s+=Math.min(15,Math.max(0,(q(f.roce)-8)));s+=Math.min(10,Math.max(0,(q(f.roe)-8)*0.8));s+=Math.min(10,Math.max(0,q(f.salesCagr3)*0.5));s+=Math.min(10,Math.max(0,q(f.profitCagr3)*0.4));
    if(f.pe>0&&pm){r.peVsSector=r2(f.pe/pm);s+=f.pe<=pm?5:f.pe<=pm*1.3?2:0}r.fund=r2(Math.min(50,s))});return rows}
export function classify(r){const f=r.f&&!r.f.error?r.f:null;
  return{confidence:f&&r.fund>=30&&r.tech>=35?"Medium":f?"Medium-low":"Low",
    classification:f?(r.fund>=30&&r.tech>=35&&!(r.peVsSector>1.5)?"Strong research candidate":"Watchlist"):"Watchlist (technical only)"}}
