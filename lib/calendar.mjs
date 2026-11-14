/* Trading calendar (IST). Unverified holidays never stop a job: they are reported as "possible holiday". */
import fs from "node:fs";import path from "node:path";
const IST=330*6e4;
export const istDate=ms=>new Date(ms+IST).toISOString().slice(0,10);
export const istMinutes=ms=>{const d=new Date(ms+IST);return d.getUTCHours()*60+d.getUTCMinutes()};
export const weekday=date=>{const d=new Date(date+"T00:00:00Z").getUTCDay();return d>=1&&d<=5};
export function loadHolidays(root){try{return JSON.parse(fs.readFileSync(path.join(root,"holidays.json"),"utf8"))}catch(e){return{years:[],dates:[]}}}
export function dayInfo(date,H){const h=(H.dates||[]).find(x=>x.date===date)||null,wd=weekday(date),yr=+date.slice(0,4);
  return{date,weekday:wd,holiday:h?{name:h.name,verified:!!h.verified}:null,
    tradingDay:wd&&!(h&&h.verified),possibleHoliday:!!(wd&&h&&!h.verified),
    listCoversYear:(H.years||[]).includes(yr),listStatus:H.status||"NEEDS VERIFICATION"}}
/* a daily candle dated today is complete only after 16:00 IST (close 15:30 plus data delay) */
export const candleComplete=(candleDate,now)=>candleDate<istDate(now)||(candleDate===istDate(now)&&istMinutes(now)>=960);
export function addDays(date,n){return new Date(Date.parse(date+"T00:00:00Z")+n*864e5).toISOString().slice(0,10)}
