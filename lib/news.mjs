/* Module 12 helpers: RSS/Atom -> {title, link, t}. Keeps headline and link only; descriptions and article text are dropped. */
const ent=s=>String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]+>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/\s+/g," ").trim();
const tag=(x,n)=>{const m=new RegExp("<"+n+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+n+">","i").exec(x);return m?m[1]:null};
export function parseFeed(xml){const out=[],blocks=String(xml||"").match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi)||[];
  for(const b of blocks){const title=ent(tag(b,"title"));let link=ent(tag(b,"link"));if(!link){const m=/<link[^>]*href=["']([^"']+)["']/i.exec(b);link=m?m[1]:""}
    const d=tag(b,"pubDate")||tag(b,"published")||tag(b,"updated")||tag(b,"dc:date"),t=d?Date.parse(ent(d)):NaN;
    if(title&&/^https?:\/\//i.test(link))out.push({title:title.slice(0,240),link:link.trim(),t:isFinite(t)?t:null})}return out}
/* company names -> safe match phrases: drop legal suffixes; skip phrases that are too short or too common to be meaningful */
const STOP=/\b(limited|ltd\.?|the|company|co\.?|corporation|corp\.?|india|\(india\)|industries|inds?\.?|enterprises?|plc)\b/gi;
export function phrases(names){const out=[];for(const [sym,name] of Object.entries(names||{})){const p=String(name).replace(STOP," ").replace(/[^A-Za-z0-9&\- ]/g," ").replace(/\s+/g," ").trim();
  if(p.length>=5||p.split(" ").length>=2)out.push({sym,p,re:new RegExp("(^|[^A-Za-z0-9])"+p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/ /g,"\\s+")+"([^A-Za-z0-9]|$)","i")})}return out}
export const match=(title,P)=>P.filter(x=>x.re.test(title)).map(x=>x.sym);
