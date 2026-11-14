/* Module 7: filters. Reads indicator metrics; writes pass/fail per rule with the reason. */
export const RULES=[
 {id:"history",label:"At least 200 trading days of history",test:r=>r.days>=200&&r.sma200!=null,detail:r=>r.days+" days"},
 {id:"above200",label:"Price above the 200-day average",test:r=>r.price>r.sma200,detail:r=>"₹"+r.price+" vs ₹"+r.sma200},
 {id:"trend",label:"50-day average above the 200-day average",test:r=>r.sma50>r.sma200,detail:r=>"₹"+r.sma50+" vs ₹"+r.sma200},
 {id:"drawdown",label:"Worst fall in 12 months smaller than 35%",test:r=>r.dd>-35,detail:r=>r.dd+"%"},
 {id:"volatility",label:"Volatility under 45% a year",test:r=>r.vol!=null&&r.vol<45,detail:r=>(r.vol==null?"n/a":r.vol+"%")},
 {id:"rsi",label:"RSI between 45 and 72",test:r=>r.rsi>=45&&r.rsi<=72,detail:r=>"RSI "+r.rsi},
 {id:"liquidity",label:"Average daily traded value at least ₹2 crore",test:r=>r.traded==null||r.traded>=2,detail:r=>(r.traded==null?"n/a":"₹"+r.traded+" crore")}
];
export function evaluate(r,rules=RULES){const failed=[];for(const R of rules){let ok=false;try{ok=!!R.test(r)}catch(e){}if(!ok)failed.push({id:R.id,label:R.label,detail:R.detail(r)})}return{pass:!failed.length,failed}}
