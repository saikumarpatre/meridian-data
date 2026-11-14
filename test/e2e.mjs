/* End-to-end run of every Drop A job against the synthetic stub (no network). Prints evidence; exits 1 on any failed check.
   Run: node test/e2e.mjs */
import fs from "node:fs";import path from "node:path";import os from "node:os";import {execFileSync} from "node:child_process";
const REPO=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const T=fs.mkdtempSync(path.join(os.tmpdir(),"mer-e2e-"));for(const f of ["symbols.json","holidays.json","schedule.json","news-feeds.json"])fs.copyFileSync(path.join(REPO,f),path.join(T,f));
const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url"),FAKE=b({alg:"none"})+"."+b({sub:"synthetic",exp:Math.floor(Date.parse("2027-11-10T00:00:00Z")/1000)})+".SYNTHETICSIGNATURE0123456789";
let fails=0;const ok=(c,m)=>{console.log((c?"  PASS ":"  FAIL ")+m);if(!c)fails++};
const run=(script,now,env={})=>{try{return execFileSync(process.execPath,["--import",path.join(REPO,"test/stub.mjs"),path.join(REPO,"scripts",script)],{env:Object.assign({},process.env,{MER_ROOT:T,MER_PACE:"0",MER_NOW:String(Date.parse(now)),UPSTOX_TOKEN:""},env),encoding:"utf8",stdio:["ignore","pipe","pipe"]})}catch(e){return "EXIT "+e.status+"\n"+(e.stdout||"")+(e.stderr||"")}};
const J=f=>JSON.parse(fs.readFileSync(path.join(T,"data",f),"utf8"));
const health=(now,ev,outs,env={})=>run("health.mjs",now,Object.assign({GITHUB_EVENT_NAME:ev,MER_SCHEDULE:ev==="schedule"?(outs.research?"17 13 * * *":outs.news&&!outs.prices?"5 */2 * * *":"*/30 3-10 * * 1-5"):"",OUT_PRICES:outs.prices||"",OUT_RESEARCH:outs.research||"",OUT_NEWS:outs.news||"",LAST_HUMAN_COMMIT:String(Math.floor(Date.parse("2026-11-14T23:00:00+05:30")/1000))},env));

console.log("\nA. Monday 16 Nov 18:50 IST, manual run, NO token");
let o=run("update.mjs","2026-11-16T18:50:00+05:30");console.log("   "+o.trim().split("\n")[0]);
let F=J("feed.json");ok(F.v===1&&F.schema===2,"feed.json keeps v:1 so the current app still reads it");ok(F.bySource.upstox===0&&F.bySource.yahoo>0&&F.upstox.state==="missing","prices from Yahoo, Upstox state 'missing'");
o=run("research.mjs","2026-11-16T18:50:00+05:30");console.log("   "+o.trim().split("\n").pop());
let L=J("research/latest.json");ok(L.dataDate==="2026-11-16","uses the complete 16 Nov candle");
ok(L.picks.every(p=>p.rr>=2&&p.plan.positionPctAtFullRisk<=25&&p.stop<p.entryLow&&p.entryHigh<=p.price+1e-9&&p.target>p.price),"every idea: R:R ≥ 2, position ≤ 25%, stop below the zone ("+L.picks.length+" ideas)");
ok(L.picks.every(p=>p.risks[0].includes("does not remove it")),"every idea carries the gap-risk sentence");
ok(L.nearMisses.every(n=>n.notQualified&&n.failed&&n.failed.detail),"near misses are marked not qualified with the failing rule ("+L.nearMisses.length+")");
ok(L.mood.items.every(i=>i.source&&("basis" in i)),"each mood number names its source and basis: "+L.mood.items.map(i=>i.label+"="+i.value+" ["+i.basis+"]").join(", "));
const day1=fs.readFileSync(path.join(T,"data/research/2026-11-16.json"),"utf8");ok(day1.length>10,"immutable day file written for 2026-11-16");
let E=fs.readFileSync(path.join(T,"data/opps/events.jsonl"),"utf8");ok(E.split("\n").filter(Boolean).every(l=>JSON.parse(l).to==="NEW")&&E.length>0,"opportunities created as NEW: "+E.split("\n").filter(Boolean).length);
o=run("news.mjs","2026-11-16T18:50:00+05:30");console.log("   "+o.trim().split("\n")[0]);
let NW=J("news.json");ok(NW.items.length>0&&NW.items.every(i=>Object.keys(i).every(k=>["title","link","t","src","cat","match"].includes(k))),"news items hold headline/link/time/source only");
ok(!JSON.stringify(NW).includes("ARTICLE TEXT")&&!JSON.stringify(NW).includes("SECRET SUMMARY"),"article text and summaries are not stored");ok(!NW.items.some(i=>i.link.endsWith("/old")),"items older than 7 days dropped");
ok(NW.feeds.some(f=>!f.ok),"a broken feed is reported, not hidden ("+NW.feeds.filter(f=>!f.ok).map(f=>f.name+": "+f.error).join("; ")+")");
o=health("2026-11-16T18:52:00+05:30","workflow_dispatch",{prices:"success",research:"success",news:"success"});console.log("   "+o.trim());
let HJ=J("health.json");ok(HJ.upstox.state==="missing"&&HJ.verification.label==="Scheduled runs: unverified (0/3)","health: Upstox missing; "+HJ.verification.label);
ok(!HJ.missed.length,"install day is not reported as a missed run");ok(HJ.lastHumanCommit.daysAgo===1&&HJ.lastHumanCommit.warn===false,"last human commit recorded as a timestamp only (no name or email)");

console.log("\nB. Tuesday 17 Nov 18:50 IST, scheduled run, VALID token (synthetic JWT)");
o=run("update.mjs","2026-11-17T18:50:00+05:30",{UPSTOX_TOKEN:FAKE,GITHUB_EVENT_NAME:"schedule"});console.log("   "+o.trim().split("\n")[0]);F=J("feed.json");
ok(F.bySource.upstox>0&&F.upstox.state==="ok","prices from Upstox ("+F.bySource.upstox+"), Yahoo only where Upstox has no listing ("+F.bySource.yahoo+", each labelled)");
ok(Object.values(F.last).filter(x=>x.src==="yahoo").every(x=>x.fallback),"every Yahoo row in an Upstox run says why");
o=run("research.mjs","2026-11-17T18:50:00+05:30",{UPSTOX_TOKEN:FAKE,GITHUB_EVENT_NAME:"schedule"});console.log("   "+o.trim().split("\n").pop());L=J("research/latest.json");
ok(L.fundamentals==="upstox"&&L.picks.every(p=>p.fund>=20),"fundamentals from Upstox; every idea has fundamental score ≥ 20");
ok(fs.readFileSync(path.join(T,"data/research/2026-11-16.json"),"utf8")===day1,"16 Nov day file unchanged (immutable)");
const E2=fs.readFileSync(path.join(T,"data/opps/events.jsonl"),"utf8");ok(E2.startsWith(E)&&E2.length>E.length,"events.jsonl only grew (append-only)");
const tos=E2.split("\n").filter(Boolean).map(l=>JSON.parse(l).to);ok(tos.some(t=>t!=="NEW"),"lifecycle moved ideas on: "+[...new Set(tos)].map(t=>t+"×"+tos.filter(x=>x===t).length).join(", "));
o=health("2026-11-17T18:55:00+05:30","schedule",{prices:"success",research:"success"},{UPSTOX_TOKEN:FAKE});console.log("   "+o.trim());HJ=J("health.json");
ok(HJ.upstox.state==="ok"&&HJ.upstox.daysToExpiry>300,"health: Upstox ok, token expires in "+HJ.upstox.daysToExpiry+" days (read from the token's claim)");

console.log("\nC. Wednesday 18 Nov 18:50 IST, token REJECTED (401)");
o=run("update.mjs","2026-11-18T18:50:00+05:30",{UPSTOX_TOKEN:FAKE,STUB_401:"1",GITHUB_EVENT_NAME:"schedule"});console.log("   "+o.trim().split("\n")[0]);F=J("feed.json");
ok(F.upstox.state==="rejected"&&F.bySource.upstox===0&&Object.values(F.last).every(x=>x.src==="yahoo"&&(x.stale||x.fallback)),"rejected token: every price falls back to Yahoo and is labelled");
o=health("2026-11-18T18:55:00+05:30","schedule",{prices:"success",research:"success"},{UPSTOX_TOKEN:FAKE,STUB_401:"1"});console.log("   "+o.trim());HJ=J("health.json");ok(HJ.upstox.state==="rejected","health: Upstox 'rejected' ("+HJ.upstox.detail+")");

console.log("\nD. Saturday 21 Nov, scheduled evening run");
o=run("research.mjs","2026-11-21T18:50:00+05:30",{GITHUB_EVENT_NAME:"schedule"});ok(/research skipped/.test(o),"research skipped on a weekend: "+o.trim());
o=run("update.mjs","2026-11-21T18:50:00+05:30",{GITHUB_EVENT_NAME:"schedule"});ok(/prices skipped/.test(o),"prices skipped on a weekend");

console.log("\nE. Thursday 19 Nov 11:00 IST, manual run during market hours");
o=run("research.mjs","2026-11-19T11:00:00+05:30");L=J("research/latest.json");ok(L.dataDate==="2026-11-18","uses the 18 Nov close, not the half-finished 19 Nov candle");

console.log("\nF. Tuesday 24 Nov (unverified holiday), scheduled run");
o=run("update.mjs","2026-11-24T10:00:00+05:30",{GITHUB_EVENT_NAME:"schedule"});F=J("feed.json");ok(F.day.possibleHoliday===true&&!/skipped/.test(o),"runs anyway and flags 'possible holiday' ("+F.day.holiday.name+")");

console.log("\nG. Verification needs 3 scheduled trading days");
health("2026-11-19T18:55:00+05:30","schedule",{prices:"success",research:"success"});HJ=J("health.json");console.log("   "+HJ.verification.label+" "+JSON.stringify(HJ.verification.days));
ok(HJ.verification.verified===true&&HJ.verification.days.join()==="2026-11-17,2026-11-18,2026-11-19","scheduled runs that fired and finished on 17, 18, 19 Nov count (a rejected token is reported separately, not as a missed run); the manual 16 Nov run does not count");
health("2026-11-20T18:55:00+05:30","schedule",{prices:"success",research:"failure"});health("2026-11-23T18:55:00+05:30","schedule",{prices:"success",research:"success"});HJ=J("health.json");
ok(HJ.verification.label.startsWith("Scheduled runs: verified")||HJ.verification.count===3,"after successful scheduled runs on 3 trading days: "+HJ.verification.label+" "+JSON.stringify(HJ.verification.days));
ok(HJ.recentRuns.some(r=>r.ok===false),"a failed step marks the run as a problem in the log");

console.log("\nH. Missed scheduled run is reported");
health("2026-11-25T22:30:00+05:30","workflow_dispatch",{news:"success"});HJ=J("health.json");ok(HJ.missed.some(m=>m.job==="research"&&m.date==="2026-11-25"),"missing 25 Nov 18:47 research run reported: "+JSON.stringify(HJ.missed.filter(m=>m.date>="2026-11-24")));

console.log("\nI. All news feeds down");
o=run("news.mjs","2026-11-25T22:00:00+05:30",{STUB_RSS_FAIL:"1"});ok(/^EXIT 1/.test(o),"news job exits with failure so the run is marked as a problem");
ok(J("news.json").feeds.every(f=>!f.ok),"news.json records each failed feed");

console.log("\nJ. Privacy and secrets");
const all=[];const walk=d=>{for(const f of fs.readdirSync(d)){const p=path.join(d,f);fs.statSync(p).isDirectory()?walk(p):all.push(p)}};walk(path.join(T,"data"));
const leak=all.filter(p=>{const s=fs.readFileSync(p,"utf8");return s.includes("SYNTHETICSIGNATURE")||s.includes(FAKE.slice(0,40))});ok(!leak.length,"the token appears in none of "+all.length+" data files");
const pii=all.filter(p=>/[\w.+-]+@[\w-]+\.[a-z]{2,}|"(paperTrades|journal|watchlist|settings|capital)"\s*:/i.test(fs.readFileSync(p,"utf8")));ok(!pii.length,"no e-mail addresses and no capital, watchlist, journal or paper-trade fields in the repo files"+(pii.length?": "+pii.join(","):""));
console.log("\n"+(fails?fails+" CHECK(S) FAILED":"ALL CHECKS PASSED")+"  (temp dir "+T+")");process.exit(fails?1:0);
