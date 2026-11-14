/* Module 9: tradeplan. Reads metrics (last close, ATR14, 20-day swing low, 52-week high); writes entry zone, stop, target, reward/risk.
   Position size as a share of capital = riskPct x entry / (entry - stop), so the 25% cap needs no capital figure (none is stored in this public repo).
   Stops never move (no trailing stops in Phase 3). */
import {r2} from "./indicators.mjs";
export const DEFAULTS={riskPct:0.005,capPct:0.25,minRR:2,atrStop:2,zoneAtr:1,resistanceGap:0.01};
export const positionPct=(entry,stop,riskPct=DEFAULTS.riskPct)=>entry>stop?riskPct*entry/(entry-stop):Infinity;
export function plan(r,o={}){const P=Object.assign({},DEFAULTS,o),C=r.price,A=r.atr14;
  if(!(C>0)||!(A>0)||r.swingLow20==null)return{ok:false,rule:"plan-data",reason:"Not enough data for a stop (ATR or swing low missing)"};
  const atrStop=C-P.atrStop*A,stop=r2(Math.min(r.swingLow20,atrStop)),stopBasis=r.swingLow20<=atrStop?"20-day swing low":P.atrStop+"×ATR below the close";
  if(!(stop>0)||stop>=C)return{ok:false,rule:"plan-data",reason:"Stop could not be placed below the price"};
  const risk=C-stop,target=r2(C+P.minRR*risk),entryHigh=r2(C),entryLow=r2(Math.max(C-P.zoneAtr*A,stop+0.5*risk)),rr=r2((target-C)/risk),pp=positionPct(C,stop,P.riskPct);
  const out={entryLow,entryHigh,stop,stopBasis,target,rr,riskPerShare:r2(risk),riskPctOfPrice:r2(100*risk/C),positionPctAtFullRisk:r2(100*pp)};
  if(rr<P.minRR)return Object.assign(out,{ok:false,rule:"rr",reason:"Reward/risk "+rr+" is below "+P.minRR+":1"});
  if(pp>P.capPct)return Object.assign(out,{ok:false,rule:"cap",reason:"Stop is so close (risk "+out.riskPctOfPrice+"% of price) that a "+(P.riskPct*100)+"% risk position would be "+out.positionPctAtFullRisk+"% of capital, above the "+(P.capPct*100)+"% cap"});
  if(r.hi52>C*(1+P.resistanceGap)&&r.hi52<target)return Object.assign(out,{ok:false,rule:"resistance",reason:"52-week high ₹"+r.hi52+" sits below the 2R target ₹"+target});
  return Object.assign(out,{ok:true})}
