/* Module 11 (part): lifecycle outcome stats. The 7/30/90/180/365-day comparison vs Nifty stays in research.mjs. */
import {r2} from "./indicators.mjs";import {OPEN} from "./lifecycle.mjs";
export function oppStats(opps){const L=Object.values(opps),by=s=>L.filter(o=>o.state===s).length,closedR=L.filter(o=>o.resultR!=null&&(o.state==="TARGET HIT"||o.state==="STOPPED OUT"||(o.state==="EXPIRED"&&o.fill!=null)));
  return{total:L.length,open:L.filter(o=>OPEN.includes(o.state)).length,byState:Object.fromEntries(["NEW","WATCHING","ENTRY TRIGGERED","ACTIVE","TARGET HIT","STOPPED OUT","EXPIRED","WITHDRAWN"].map(s=>[s,by(s)])),
    filledAndClosed:closedR.length,avgR:closedR.length?r2(closedR.reduce((s,o)=>s+o.resultR,0)/closedR.length):null,
    note:closedR.length<20?"Fewer than 20 closed ideas: too few to judge the method.":null}}
