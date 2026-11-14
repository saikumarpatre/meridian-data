/* Module 10: lifecycle. Reads open ideas + complete daily candles; writes state changes as append-only events.
   States: NEW, WATCHING, ENTRY TRIGGERED, ACTIVE, TARGET HIT, STOPPED OUT, EXPIRED, WITHDRAWN.
   Fixed rules (Phase 3): stops never move; fills happen at the next day's OPEN;
   at the fill, an open outside the entry zone, reward/risk under 2:1, or a position over 25% of capital -> WITHDRAWN instead of filling;
   a candle that touches both stop and target counts as STOPPED OUT; an open beyond the stop fills at the open (gap risk). */
import {r2} from "./indicators.mjs";
import {DEFAULTS,positionPct} from "./tradeplan.mjs";
export const OPEN=["NEW","WATCHING","ENTRY TRIGGERED","ACTIVE"],CLOSED=["TARGET HIT","STOPPED OUT","EXPIRED","WITHDRAWN"];
export const LIMITS={waitDays:10,activeDays:60};
export function create(idea,date){return{id:idea.sym+"-"+date.replace(/-/g,""),sym:idea.sym,name:idea.name||idea.sym,created:date,state:"NEW",
  entryLow:idea.entryLow,entryHigh:idea.entryHigh,stop:idea.stop,target:idea.target,rrPlanned:idea.rr,stopBasis:idea.stopBasis,
  lastDate:date,waitDays:0,activeDays:0,fill:null,fillDate:null,exit:null,exitDate:null,resultR:null}}
/* one complete daily candle {date,o,h,l,c,sma200}; returns the events it caused (0, 1 or 2) and mutates opp */
export function step(opp,k,P=DEFAULTS){const ev=[],go=(to,reason,price)=>{ev.push({id:opp.id,sym:opp.sym,date:k.date,from:opp.state,to,reason,price:price==null?null:r2(price)});opp.state=to};
  const close=(to,price,reason)=>{opp.exit=r2(price);opp.exitDate=k.date;opp.resultR=opp.fill!=null&&opp.fill>opp.stop?r2((price-opp.fill)/(opp.fill-opp.stop)):null;go(to,reason,price)};
  const exits=(first)=>{ /* order matters: gap at the open first (not on the fill day, the fill already used the open), then the both-touched rule */
    if(!first&&k.o<=opp.stop)return close("STOPPED OUT",k.o,"Opened at ₹"+r2(k.o)+", at or below the stop ₹"+opp.stop+" (gap): filled at the open, so the loss is larger than planned");
    if(!first&&k.o>=opp.target)return close("TARGET HIT",k.o,"Opened at ₹"+r2(k.o)+", above the target: filled at the open");
    if(k.l<=opp.stop&&k.h>=opp.target)return close("STOPPED OUT",opp.stop,"The day touched both the stop and the target; counted as stopped out");
    if(k.l<=opp.stop)return close("STOPPED OUT",opp.stop,"Low ₹"+r2(k.l)+" reached the stop");
    if(k.h>=opp.target)return close("TARGET HIT",opp.target,"High ₹"+r2(k.h)+" reached the target");
    if(opp.activeDays>=LIMITS.activeDays)return close("EXPIRED",k.c,"Still open after "+LIMITS.activeDays+" trading days; closed at the day's close")};
  if(k.date<=opp.lastDate||CLOSED.includes(opp.state))return ev;
  opp.lastDate=k.date;
  if(opp.state==="NEW"||opp.state==="WATCHING"){opp.waitDays++;
    if(k.sma200!=null&&k.c<k.sma200)go("WITHDRAWN","Closed at ₹"+r2(k.c)+", below the 200-day average (₹"+r2(k.sma200)+"), before entry",k.c);
    else if(k.c<=opp.stop)go("WITHDRAWN","Closed at or below the stop before entry",k.c);
    else if(k.c>=opp.entryLow&&k.c<=opp.entryHigh)go("ENTRY TRIGGERED","Closed at ₹"+r2(k.c)+", inside the entry zone; fill at the next open",k.c);
    else if(opp.waitDays>=LIMITS.waitDays)go("EXPIRED","Entry zone not reached within "+LIMITS.waitDays+" trading days",k.c);
    else if(opp.state==="NEW")go("WATCHING","Entry zone ₹"+opp.entryLow+"–"+opp.entryHigh+" not reached yet",k.c);
    return ev}
  if(opp.state==="ENTRY TRIGGERED"){const o=k.o;
    if(o<opp.entryLow||o>opp.entryHigh){go("WITHDRAWN","Opened at ₹"+r2(o)+", outside the entry zone ₹"+opp.entryLow+"–"+opp.entryHigh+"; not filled",o);return ev}
    const rr=(opp.target-o)/(o-opp.stop),pp=positionPct(o,opp.stop,P.riskPct);
    if(!(rr>=P.minRR)){go("WITHDRAWN","At the open ₹"+r2(o)+" reward/risk would be "+r2(rr)+", below "+P.minRR+":1; not filled",o);return ev}
    if(pp>P.capPct){go("WITHDRAWN","At the open ₹"+r2(o)+" the position would be "+r2(100*pp)+"% of capital, above the "+(100*P.capPct)+"% cap; not filled",o);return ev}
    opp.fill=r2(o);opp.fillDate=k.date;opp.activeDays=1;go("ACTIVE","Filled at the open ₹"+r2(o)+" (reward/risk "+r2(rr)+")",o);exits(true);return ev}
  if(opp.state==="ACTIVE"){opp.activeDays++;exits(false);return ev}
  return ev}
export function advance(opp,K,P){const ev=[];for(const k of K)ev.push(...step(opp,k,P));return ev}
