/* Market mood: plain numbers only, each with its source and whether it is delayed or end-of-day. No composite score. */
export function mood({breadth,vix,scanSource,asOf,afterClose}){const basis=afterClose?"end-of-day":"delayed";
  const scan=scanSource+" daily closes of the scanned Nifty 500 stocks";
  return{asOf,basis,items:[
    {id:"advances",label:"Advances",value:breadth.adv,of:breadth.n,source:scan,basis},
    {id:"declines",label:"Declines",value:breadth.dec,of:breadth.n,source:scan,basis},
    {id:"above200",label:"% of stocks above their 200-day average",value:breadth.above200,unit:"%",source:scan,basis},
    vix&&!vix.error?{id:"indiaVix",label:"India VIX",value:vix.price,change:vix.d1,source:vix.src==="upstox"?"Upstox (NSE index quote)":"Yahoo Finance ^INDIAVIX (unofficial)",basis:afterClose?"end-of-day":"delayed",at:vix.tradeAt}
      :{id:"indiaVix",label:"India VIX",value:null,source:"unavailable this run",basis:null,error:vix?vix.error:"not fetched"}]}}
