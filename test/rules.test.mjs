/* Unit tests for the Drop A rule modules. Run: node --test test/ */
import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import path from "node:path";
import {dayInfo,candleComplete,istDate} from "../lib/calendar.mjs";
import {atr,trueRange} from "../lib/rules/indicators.mjs";import {evaluate} from "../lib/rules/filters.mjs";
import {plan,positionPct} from "../lib/rules/tradeplan.mjs";import {create,step,advance} from "../lib/rules/lifecycle.mjs";
import {parseFeed,phrases,match} from "../lib/news.mjs";import {verification,missed,humanCommit} from "../lib/health.mjs";import {tokenExpiry} from "../lib/source.mjs";
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const H={status:"NEEDS VERIFICATION",years:[2026],dates:[{date:"2026-11-24",name:"Gurpurb",verified:false},{date:"2026-12-25",name:"Christmas",verified:true}]};

test("1 calendar: unverified holiday runs and is flagged; verified holiday is skipped; weekend skipped",()=>{
  const a=dayInfo("2026-11-24",H);assert.equal(a.tradingDay,true);assert.equal(a.possibleHoliday,true);
  const b=dayInfo("2026-12-25",H);assert.equal(b.tradingDay,false);assert.equal(b.possibleHoliday,false);
  assert.equal(dayInfo("2026-11-14",H).tradingDay,false);assert.equal(dayInfo("2026-11-16",H).tradingDay,true);
  assert.equal(dayInfo("2027-01-04",H).listCoversYear,false)});
test("1b calendar: shipped holidays.json is entirely NEEDS VERIFICATION",()=>{const J=JSON.parse(fs.readFileSync(path.join(ROOT,"holidays.json"),"utf8"));
  assert.equal(J.status,"NEEDS VERIFICATION");assert.ok(J.dates.length>=15);assert.ok(J.dates.every(d=>d.verified===false))});
test("1c calendar: a candle dated today is complete only after 16:00 IST",()=>{
  assert.equal(candleComplete("2026-11-16",Date.parse("2026-11-16T15:59:00+05:30")),false);assert.equal(candleComplete("2026-11-16",Date.parse("2026-11-16T16:00:00+05:30")),true);
  assert.equal(candleComplete("2026-11-13",Date.parse("2026-11-16T10:00:00+05:30")),true)});
test("4 indicators: ATR14 matches a hand-worked Wilder example",()=>{
  /* constant range: every TR = 2 -> ATR = 2 */
  const n=30,C=Array.from({length:n},(_,i)=>100+i*0.5),H2=C.map(c=>c+1),L2=C.map(c=>c-1);assert.equal(atr(H2,L2,C,14),2);
  /* worked by hand, n=3: TR = [4,2,6,2]; first ATR=(4+2+6)/3=4; then (4*2+2)/3 = 3.3333 */
  const h=[10,12,12,15,14],l=[9,8,10,9,12],c=[10,11,11,14,13];assert.deepEqual(trueRange(h,l,c),[4,2,6,2]);
  assert.ok(Math.abs(atr(h,l,c,3)-10/3)<1e-9)});
test("7 filters: each failed rule is named with its reason",()=>{const r={days:300,sma200:100,price:95,sma50:105,dd:-40,vol:30,rsi:60,traded:5};
  const e=evaluate(r);assert.equal(e.pass,false);assert.deepEqual(e.failed.map(f=>f.id),["above200","drawdown"]);assert.match(e.failed[0].detail,/₹95/)});
const base={price:100,atr14:2,swingLow20:97,hi52:100.5};
test("5 tradeplan: stop = lower of swing low and 2xATR; target = 2R; zone = close to 1xATR below",()=>{const p=plan(base);
  assert.equal(p.ok,true);assert.equal(p.stop,96);assert.equal(p.stopBasis,"2×ATR below the close");assert.equal(p.target,108);assert.equal(p.rr,2);assert.equal(p.entryLow,98);assert.equal(p.entryHigh,100);
  const q=plan(Object.assign({},base,{swingLow20:90}));assert.equal(q.stop,90);assert.equal(q.stopBasis,"20-day swing low")});
test("5b tradeplan: position over 25% of capital is rejected",()=>{const p=plan({price:100,atr14:0.5,swingLow20:99.5,hi52:100});
  assert.equal(p.ok,false);assert.equal(p.rule,"cap");assert.ok(positionPct(100,99)>0.25)});
test("5c tradeplan: a 52-week high between price and target rejects the idea",()=>{const p=plan(Object.assign({},base,{hi52:104}));assert.equal(p.ok,false);assert.equal(p.rule,"resistance")});

/* lifecycle helpers */
const idea={sym:"SYNT1",name:"Synthetic",entryLow:98,entryHigh:100,stop:96,target:108,rr:2,stopBasis:"x"};
const K=(date,o,h,l,c,sma200=90)=>({date,o,h,l,c,sma200});
const states=ev=>ev.map(e=>e.to);
test("6a lifecycle: NEW -> WATCHING -> ENTRY TRIGGERED -> ACTIVE -> TARGET HIT",()=>{const o=create(idea,"2026-11-16");
  const ev=advance(o,[K("2026-11-17",101,103,100.5,102),K("2026-11-18",101,101.5,99,99.5),K("2026-11-19",99.8,101,99,100.5),K("2026-11-20",101,108.5,100,108)]);
  assert.deepEqual(states(ev),["WATCHING","ENTRY TRIGGERED","ACTIVE","TARGET HIT"]);assert.equal(o.fill,99.8);assert.equal(o.exit,108);assert.equal(o.resultR,2.16)});
test("6b lifecycle: one candle touching both stop and target counts as STOPPED OUT",()=>{const o=create(idea,"2026-11-16");
  const ev=advance(o,[K("2026-11-17",101,101,99,99.5),K("2026-11-18",99.5,109,95,100)]);assert.deepEqual(states(ev),["ENTRY TRIGGERED","ACTIVE","STOPPED OUT"]);assert.equal(o.exit,96);assert.equal(o.resultR,-1)});
test("6c lifecycle: a gap below the stop fills at the open and loses more than 1R",()=>{const o=create(idea,"2026-11-16");
  const ev=advance(o,[K("2026-11-17",101,101,99,99.5),K("2026-11-18",99.5,100,98.5,99),K("2026-11-19",93,94,92,93.5)]);
  assert.deepEqual(states(ev),["ENTRY TRIGGERED","ACTIVE","STOPPED OUT"]);assert.equal(o.exit,93);assert.ok(o.resultR<-1);assert.match(ev[2].reason,/gap/)});
test("6d lifecycle: fill-day open outside the entry zone -> WITHDRAWN, not filled",()=>{const o=create(idea,"2026-11-16");
  const ev=advance(o,[K("2026-11-17",101,101,99,99.5),K("2026-11-18",101.2,102,100,101)]);assert.deepEqual(states(ev),["ENTRY TRIGGERED","WITHDRAWN"]);assert.equal(o.fill,null)});
test("6e lifecycle: fill-day reward/risk under 2:1 -> WITHDRAWN",()=>{const o=create(Object.assign({},idea,{target:103}),"2026-11-16");
  const ev=advance(o,[K("2026-11-17",101,101,99,99.5),K("2026-11-18",99.9,100,99,99.5)]);assert.deepEqual(states(ev),["ENTRY TRIGGERED","WITHDRAWN"]);assert.match(ev[1].reason,/reward\/risk/)});
test("6f lifecycle: fill-day position over 25% of capital -> WITHDRAWN",()=>{const o=create(Object.assign({},idea,{stop:99.2,entryLow:99.5,target:110}),"2026-11-16");
  const ev=advance(o,[K("2026-11-17",101,101,99.6,99.8),K("2026-11-18",99.9,100,99.6,99.8)]);assert.deepEqual(states(ev),["ENTRY TRIGGERED","WITHDRAWN"]);assert.match(ev[1].reason,/25% cap/)});
test("6g lifecycle: not triggered in 10 trading days -> EXPIRED",()=>{const o=create(idea,"2026-11-02");const days=[];for(let i=0;i<12;i++)days.push(K("2026-11-"+String(3+i).padStart(2,"0"),102,103,101,102));
  const ev=advance(o,days);assert.deepEqual(states(ev),["WATCHING","EXPIRED"]);assert.equal(o.waitDays,10)});
test("6h lifecycle: close below the 200-day average before entry -> WITHDRAWN",()=>{const o=create(idea,"2026-11-16");
  const ev=advance(o,[K("2026-11-17",101,101,99,99.5,99.8)]);assert.deepEqual(states(ev),["WITHDRAWN"])});
test("6i lifecycle: ACTIVE for 60 trading days -> EXPIRED at the close",()=>{const o=create(idea,"2026-01-01");const d0=Date.parse("2026-01-02");const days=[K("2026-01-02",101,101,99,99.5),K("2026-01-03",99.5,100,98.5,99)];
  for(let i=2;i<70;i++)days.push(K(new Date(d0+i*864e5).toISOString().slice(0,10),100,101,99,100));const ev=advance(o,days);assert.equal(states(ev).pop(),"EXPIRED");assert.equal(o.activeDays,60);assert.equal(o.exit,100)});
test("6j lifecycle: re-processing the same day adds no events (idempotent); stops never move",()=>{const o=create(idea,"2026-11-16");advance(o,[K("2026-11-17",101,103,100.5,102)]);
  assert.equal(advance(o,[K("2026-11-17",101,103,100.5,102)]).length,0);assert.equal(o.stop,96)});
test("7 news: RSS + Atom parsed to headline/link/time only; descriptions dropped",()=>{
  const r=parseFeed(`<rss><item><title><![CDATA[A &amp; B]]></title><link>https://x.invalid/1</link><description>BODY</description><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate></item></rss>`);
  assert.deepEqual(Object.keys(r[0]).sort(),["link","t","title"]);assert.equal(r[0].title,"A & B");assert.ok(!JSON.stringify(r).includes("BODY"));
  const a=parseFeed(`<feed><entry><title>T</title><link href="https://x.invalid/2"/><updated>2026-11-16T10:00:00Z</updated><summary>S</summary></entry></feed>`);assert.equal(a[0].link,"https://x.invalid/2");
  const P=phrases({TITAN:"Titan Company Ltd.",BSE:"BSE Ltd.",IOB:"Indian Overseas Bank"});assert.deepEqual(P.map(x=>x.sym),["TITAN","IOB"]);
  assert.deepEqual(match("Titan shares jump",P),["TITAN"]);assert.deepEqual(match("Titanic film",P),[])});
test("8 health: 3 scheduled successful runs on trading days needed; manual, weekend and possible-holiday runs don't count",()=>{
  const at=s=>Date.parse(s+"+05:30");const R=[{at:at("2026-11-14T18:50:00"),event:"schedule",ok:true,job:["research"]},{at:at("2026-11-16T18:50:00"),event:"workflow_dispatch",ok:true,job:["research"]},
    {at:at("2026-11-16T19:00:00"),event:"schedule",ok:true,job:["research"]},{at:at("2026-11-17T19:00:00"),event:"schedule",ok:false,job:["research"]},{at:at("2026-11-24T19:00:00"),event:"schedule",ok:true,job:["research"]}];
  let v=verification(R,H);assert.equal(v.label,"Scheduled runs: unverified (1/3)");
  R.push({at:at("2026-11-18T19:00:00"),event:"schedule",ok:true,job:["research"]},{at:at("2026-11-19T10:00:00"),event:"schedule",ok:true,job:["prices"]});v=verification(R,H);assert.equal(v.verified,true);assert.deepEqual(v.days,["2026-11-16","2026-11-18","2026-11-19"])});
test("8b health: a missed scheduled research run is reported",()=>{const S=JSON.parse(fs.readFileSync(path.join(ROOT,"schedule.json"),"utf8")),at=s=>Date.parse(s+"+05:30");
  const R=[{at:at("2026-11-16T18:55:00"),event:"schedule",ok:true,job:["research","prices"]},{at:at("2026-11-16T10:00:00"),event:"schedule",ok:true,job:["prices"]},{at:at("2026-11-17T10:00:00"),event:"schedule",ok:true,job:["prices"]},{at:at("2026-11-17T22:00:00"),event:"schedule",ok:true,job:["news"]}];
  const m=missed(R,H,S,at("2026-11-17T22:30:00"));assert.deepEqual(m,[{job:"research",date:"2026-11-17",expected:"18:47 IST"}])});
test("8c health: last-human-commit warns at 50 days",()=>{assert.equal(humanCommit(Date.now()-49*864e5,Date.now()).warn,false);assert.equal(humanCommit(Date.now()-50*864e5,Date.now()).warn,true)});
test("2 token: expiry read from the JWT claim only; non-JWT gives null",()=>{const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
  assert.equal(tokenExpiry(b({alg:"x"})+"."+b({exp:1800000000})+".sig"),1800000000000);assert.equal(tokenExpiry("not-a-jwt"),null)});
test("9 workflow cron lines match schedule.json",()=>{const S=JSON.parse(fs.readFileSync(path.join(ROOT,"schedule.json"),"utf8")),Y=fs.readFileSync(path.join(ROOT,".github/workflows/update.yml"),"utf8");
  const crons=[...Y.matchAll(/cron:\s*"([^"]+)"/g)].map(m=>m[1]).sort();assert.deepEqual(crons,Object.values(S.jobs).map(j=>j.cron).sort());
  for(const j of Object.values(S.jobs))assert.ok(Y.split(j.cron).length>=3,"cron "+j.cron+" is also used in a step condition")});
