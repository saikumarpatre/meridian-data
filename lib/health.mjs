/* Health and verification logic (pure): run log -> verified scheduled trading days, missed runs, last-human-commit warning. */
import {istDate,istMinutes,dayInfo,addDays} from "./calendar.mjs";
export const NEED=3,WARN_DAYS=50,DISABLE_DAYS=60;
const okRun=r=>r.event==="schedule"&&r.ok;
/* A trading day counts when a scheduled run succeeded on it. Unverified-holiday weekdays are not counted (conservative). */
export function verification(runs,H){const days=[...new Set(runs.filter(okRun).map(r=>istDate(r.at)))].filter(d=>{const i=dayInfo(d,H);return i.tradingDay&&!i.possibleHoliday}).sort();
  const n=days.length;return{needed:NEED,count:Math.min(n,NEED),days:days.slice(0,NEED),verified:n>=NEED,
    label:n>=NEED?"Scheduled runs: verified on "+NEED+" trading days":"Scheduled runs: unverified ("+Math.min(n,NEED)+"/"+NEED+")"}}
/* expected-but-missing scheduled runs since the first logged run, last 14 days */
export function missed(runs,H,sched,now){const out=[];if(!runs.length)return out;const first=istDate(Math.min(...runs.map(r=>r.at))),today=istDate(now);
  const sch=runs.filter(r=>r.event==="schedule"),firstAt=Math.min(...runs.map(r=>r.at));
  for(let d=addDays(today,-14);d<=today;d=addDays(d,1)){if(d<first)continue;const i=dayInfo(d,H);if(!i.tradingDay)continue;
    /* research: 18:47 IST + grace */
    const rs=Date.parse(d+"T18:47:00+05:30"),due=rs+(sched.jobs.research.graceMin||90)*6e4;
    if(rs>=firstAt&&now>due&&!sch.some(r=>r.job.includes("research")&&istDate(r.at)===d))out.push({job:"research",date:d,expected:"18:47 IST"});
    /* prices: at least one scheduled run between 08:30 and 16:00 + grace */
    const ps=Date.parse(d+"T08:30:00+05:30"),pdue=Date.parse(d+"T16:00:00+05:30")+(sched.jobs.prices.graceMin||90)*6e4;
    if(ps>=firstAt&&now>pdue&&!sch.some(r=>r.job.includes("prices")&&istDate(r.at)===d&&istMinutes(r.at)>=8*60&&istMinutes(r.at)<=18*60))out.push({job:"prices",date:d,expected:"08:30–16:00 IST"})}
  const lastNews=Math.max(0,...sch.filter(r=>r.job.includes("news")).map(r=>r.at));
  if(now-Math.max(lastNews,firstAt)>(sched.jobs.news.graceMin||240)*6e4)out.push({job:"news",date:today,expected:"every 2 hours",lastAt:lastNews||null});
  return out}
export function humanCommit(ts,now){if(!ts)return{at:null,note:"Could not read the commit history"};const days=Math.floor((now-ts)/864e5);
  return{at:ts,daysAgo:days,warnAt:WARN_DAYS,disableAt:DISABLE_DAYS,warn:days>=WARN_DAYS,
    note:"GitHub disables scheduled workflows in a public repository after 60 days without repository activity. GitHub does not define whether the data bot's own commits count, so Meridian assumes they do not."+(days>=WARN_DAYS?" Make any small commit, or re-enable the workflow in the Actions tab.":"")}}
