/* Runs last in every workflow run, even after a failure. Writes data/health.json and appends one line to data/health/runs.jsonl.
   Records: what triggered the run, each step's outcome, Upstox status and token expiry (never the token), calendar,
   verified scheduled trading days, missed runs, and the last commit made by a person. */
import fs from "node:fs";import path from "node:path";
import {makeSource,tokenExpiry} from "../lib/source.mjs";import {istDate,loadHolidays,dayInfo} from "../lib/calendar.mjs";import {verification,missed,humanCommit} from "../lib/health.mjs";
const ROOT=process.env.MER_ROOT||path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");const D=path.join(ROOT,"data"),HD=path.join(D,"health");fs.mkdirSync(HD,{recursive:true});
const NOW=+(process.env.MER_NOW||Date.now()),H=loadHolidays(ROOT),SCHED=JSON.parse(fs.readFileSync(path.join(ROOT,"schedule.json"),"utf8"));
const E=process.env,event=E.GITHUB_EVENT_NAME||"manual",schedule=E.MER_SCHEDULE||null;
const job=schedule?Object.entries(SCHED.jobs).filter(([k,v])=>v.cron===schedule).map(([k])=>k):["prices","research","news"];
if(schedule===SCHED.jobs.research.cron)job.push("prices");
const read=f=>{try{return JSON.parse(fs.readFileSync(path.join(HD,f),"utf8"))}catch(e){return null}};
const steps={};for(const [k,env] of [["prices","OUT_PRICES"],["research","OUT_RESEARCH"],["news","OUT_NEWS"]]){const o=E[env]||"";if(!o||o==="skipped")continue;const d=read("step-"+k+".json");
  steps[k]={outcome:o,detail:d&&d.at>=NOW-3*36e5?d:null}}
const ok=Object.keys(steps).length>0&&Object.values(steps).every(s=>s.outcome==="success");
/* Upstox: live check (one quote) + expiry from the token's own claim */
const SRC=makeSource(E.UPSTOX_TOKEN);let up={configured:SRC.status.configured,state:"missing",detail:"No UPSTOX_TOKEN repository secret"};
if(SRC.status.configured){const st=await SRC.check();const exp=tokenExpiry(E.UPSTOX_TOKEN);
  up={configured:true,state:st.state,detail:st.detail,checkedAt:st.checkedAt,expires:exp,daysToExpiry:exp?Math.floor((exp-NOW)/864e5):null,
    expiryNote:exp?null:"Expiry could not be read from the token; set a reminder for one year after you generated it."};
  if(up.daysToExpiry!=null&&up.daysToExpiry<=30)up.warn="The Upstox token expires in "+up.daysToExpiry+" days. Generate a new Analytics Token and update the UPSTOX_TOKEN secret."}
/* run log (append-only) */
const RP=path.join(HD,"runs.jsonl");const run={at:NOW,id:E.GITHUB_RUN_ID||null,attempt:E.GITHUB_RUN_ATTEMPT||null,event,schedule,job,ok,steps:Object.fromEntries(Object.entries(steps).map(([k,v])=>[k,v.outcome])),upstox:up.state};
fs.appendFileSync(RP,JSON.stringify(run)+"\n");
const runs=fs.readFileSync(RP,"utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean);
const last=k=>{const r=runs.filter(x=>x.event==="schedule"&&x.job.includes(k));return r.length?r[r.length-1].at:null};
const lastOk=k=>{const r=runs.filter(x=>x.job.includes(k)&&x.steps&&x.steps[k]==="success");return r.length?r[r.length-1].at:null};
const day=dayInfo(istDate(NOW),H),hc=humanCommit(E.LAST_HUMAN_COMMIT?(+E.LAST_HUMAN_COMMIT)*1000:null,NOW);
const health={v:1,at:NOW,run,steps,upstox:up,calendar:Object.assign(day,{holidayList:H.status||"NEEDS VERIFICATION",holidaySources:H.sources||[]}),
  schedule:SCHED,lastScheduled:{prices:last("prices"),research:last("research"),news:last("news")},lastSuccess:{prices:lastOk("prices"),research:lastOk("research"),news:lastOk("news")},
  verification:verification(runs,H),missed:missed(runs,H,SCHED,NOW),lastHumanCommit:hc,recentRuns:runs.slice(-60)};
fs.writeFileSync(path.join(D,"health.json"),JSON.stringify(health));
console.log("health:",ok?"ok":"problem",JSON.stringify(run.steps),"| upstox:",up.state+(up.daysToExpiry!=null?" (expires in "+up.daysToExpiry+" days)":""),"|",health.verification.label,"| missed:",health.missed.length);
