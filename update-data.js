'use strict';
const fs=require('fs'); const path=require('path');
const C=require('./core');
const ROOT=path.resolve(__dirname,'..'); const DATA=path.join(ROOT,'data');
const CONFIG=JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));
const nowMs=Date.now();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function readJson(file,fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;} }
function writeJson(file,obj){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(obj,null,2)); }
function domainOf(url=''){ try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';} }
function decodeXml(v=''){ return String(v??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function tag(block,name){ const n=String(name).replace(/[^a-zA-Z0-9:_-]/g,''); const m=String(block).match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`,'i')); return m?decodeXml(m[1]):''; }
function normalizeTime(v){ if(/^\d{14}$/.test(String(v||''))){const s=String(v);return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}Z`;} const d=new Date(v);return Number.isNaN(d.getTime())?new Date(nowMs).toISOString():d.toISOString(); }
async function fetchText(url,ms=9000,headers={}){ const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),ms);try{const r=await fetch(url,{headers:{'user-agent':'GoldOracleGitHub/2.0','accept':'text/html,application/xml,application/json;q=0.9,*/*;q=0.5',...headers},signal:ctrl.signal});if(!r.ok)throw new Error(`${r.status} ${url}`);return await r.text();}finally{clearTimeout(t);} }
async function fetchJson(url,ms=9000){ const txt=await fetchText(url,ms,{'accept':'application/json'}); return JSON.parse(txt); }

const QUERIES=[
  {id:'gold',q:'(gold OR XAUUSD OR bullion)',weight:1.25},{id:'usd',q:'(dollar OR DXY OR "US dollar")',weight:1.15},
  {id:'fed',q:'("Federal Reserve" OR FOMC OR Powell OR "interest rates")',weight:1.30},
  {id:'macro',q:'(CPI OR inflation OR PCE OR payrolls OR NFP OR unemployment OR "Treasury yields")',weight:1.20},
  {id:'risk',q:'(war OR ceasefire OR sanctions OR missile OR attack OR conflict OR geopolitical)',weight:1.05},
  {id:'flows',q:'("central bank" gold OR "gold reserves" OR "gold ETF" OR bullion demand)',weight:1.10}
];
const OFFICIAL=[
  {id:'fed-policy',url:'https://www.federalreserve.gov/feeds/press_monetary.xml',domain:'federalreserve.gov',weight:1.65},
  {id:'fed-all',url:'https://www.federalreserve.gov/feeds/press_all.xml',domain:'federalreserve.gov',weight:1.45},
  {id:'bls-cpi',url:'https://www.bls.gov/feed/cpi.rss',domain:'bls.gov',weight:1.65},
  {id:'bls-jobs',url:'https://www.bls.gov/feed/empsit.rss',domain:'bls.gov',weight:1.65}
];
async function fetchGdelt(q){ const p=new URLSearchParams({query:q.q,mode:'ArtList',maxrecords:'75',format:'json',sort:'HybridRel',timespan:'24h'}); const j=await fetchJson(`https://api.gdeltproject.org/api/v2/doc/doc?${p}`,10000); return (Array.isArray(j?.articles)?j.articles:[]).map(a=>({title:String(a.title||''),url:String(a.url||''),domain:String(a.domain||domainOf(a.url)),seendate:normalizeTime(a.seendate),queryId:q.id,queryWeight:q.weight,official:false,description:''})); }
async function fetchOfficial(f){ const xml=await fetchText(f.url,9000); const items=xml.match(/<item\b[\s\S]*?<\/item>/gi)||[]; return items.slice(0,35).map(b=>({title:tag(b,'title'),url:tag(b,'link'),domain:f.domain,seendate:normalizeTime(tag(b,'pubDate')||tag(b,'dc:date')),queryId:f.id,queryWeight:f.weight,official:true,description:tag(b,'description')})).filter(a=>a.title); }
function stripHtml(html=''){ return String(html).replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<noscript\b[\s\S]*?<\/noscript>/gi,' ').replace(/<svg\b[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim(); }
async function deepRead(a){ if(!/^https?:/i.test(a.url))return a; try{ const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),7000); const r=await fetch(a.url,{headers:{'user-agent':'Mozilla/5.0 GoldOracleResearch/2.0','accept':'text/html,*/*'},signal:ctrl.signal,redirect:'follow'}); clearTimeout(t); const type=r.headers.get('content-type')||''; if(!r.ok||!type.includes('text/html'))return a; const len=Number(r.headers.get('content-length')||0); if(len>1500000)return a; const html=(await r.text()).slice(0,1500000); const text=stripHtml(html); if(text.length<400)return a; return {...a,bodyText:text.slice(0,12000),deepRead:true}; }catch{return a;} }
async function fetchNews(){
  const tasks=[...QUERIES.map(q=>({id:q.id,p:fetchGdelt(q)})),...OFFICIAL.map(f=>({id:f.id,p:fetchOfficial(f)}))]; const settled=await Promise.allSettled(tasks.map(x=>x.p)); const all=[];const errors=[];let ok=0;
  settled.forEach((r,i)=>{if(r.status==='fulfilled'){ok++;all.push(...r.value);}else errors.push(`${tasks[i].id}: ${r.reason?.message||'failed'}`);});
  const seen=new Map(); for(const a of all){const k=C.normalizeTitle(a.title).slice(0,190)||a.url;if(!k)continue;const old=seen.get(k);if(!old||a.official&&!old.official)seen.set(k,a);} let unique=[...seen.values()];
  unique.sort((a,b)=>new Date(b.seendate)-new Date(a.seendate));
  const deepCandidates=unique.filter(a=>!a.official&&/(gold|dollar|fed|yield|inflation|cpi|payroll|war|sanction|rate)/i.test(a.title)).slice(0,CONFIG.deepReadArticles||12);
  const deep=await Promise.all(deepCandidates.map(deepRead)); const deepMap=new Map(deep.map(a=>[a.url,a])); unique=unique.map(a=>deepMap.get(a.url)||a);
  return {articles:unique.slice(0,260),feedSuccessCount:ok,feedTotal:tasks.length,errors};
}
async function fetchMarket(){
  const key=process.env.TWELVE_DATA_API_KEY||''; if(!key)return {available:false,provider:'Twelve Data',reason:'TWELVE_DATA_API_KEY GitHub secret is not configured.',bars:[]};
  const p=new URLSearchParams({symbol:CONFIG.marketSymbol||'XAU/USD',interval:'5min',outputsize:String(CONFIG.marketBars||1500),timezone:'UTC',apikey:key});
  try{const j=await fetchJson(`https://api.twelvedata.com/time_series?${p}`,12000);if(j.status==='error'||!Array.isArray(j.values))throw new Error(j.message||'No values');const bars=j.values.map(v=>({time:new Date(String(v.datetime).replace(' ','T')+'Z').getTime(),open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close)})).filter(b=>[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);if(!bars.length)throw new Error('No valid bars');return {available:true,provider:'Twelve Data',symbol:CONFIG.marketSymbol||'XAU/USD',bars,price:bars.at(-1).close,updatedAt:new Date(bars.at(-1).time).toISOString()};}catch(e){return {available:false,provider:'Twelve Data',reason:e.message,bars:[]};}
}
function stateInit(){return {version:2,createdAt:new Date(nowMs).toISOString(),learning:C.initLearning(),history:[],stability:{'1':{},'3':{},'6':{}},lastRun:null};}
function publicLearning(L){
  const featureRows=Object.entries(L.features||{}).map(([name,s])=>({name,...s})).sort((a,b)=>b.samples-a.samples).slice(0,30);
  const sourceRows=Object.entries(L.sources||{}).map(([name,s])=>({name,...s})).sort((a,b)=>b.samples-a.samples).slice(0,20);
  return {totalLearned:L.totalLearned||0,lastUpdated:L.lastUpdated,features:featureRows,sources:sourceRows,horizons:L.horizons||{}};
}
(async()=>{
  let state=readJson(path.join(DATA,'state.json'),stateInit()); if(!state.learning)state.learning=C.initLearning(); if(!Array.isArray(state.history))state.history=[];
  const [news,market]=await Promise.all([fetchNews(),fetchMarket()]);
  // Resolve older forecasts using the newest real XAU/USD bars.
  if(market.available){
    state.history=state.history.map(f=>C.resolveForecast(f,market.bars,nowMs));
    state.history=state.history.map(f=>{const r=C.learnFromForecast(state.learning,f);state.learning=r.learning;return r.forecast;});
  }
  const stats=C.marketStats(market.bars); const horizons={};
  for(const h of [1,3,6]){
    const ev=C.aggregateEvidence(news.articles,state.learning,h,news,nowMs); ev.calibratedConfidence=C.calibrateConfidence(ev.confidence,state.learning,h); ev.marketVolPct=stats.volPct;
    const stab=C.stabilizeBias(state.stability[String(h)]||{},ev); state.stability[String(h)]=stab;
    Object.assign(ev,stab);
    const price=market.available?market.price:null; const plan=C.Engine.buildPlan({price,spread:CONFIG.assumedSpread,horizon:h,data:ev});
    horizons[String(h)]={evidence:ev,stability:stab,plan};
    const active=state.history.some(f=>!f.resolved&&f.horizon===h);
    if(market.available&&!active&&['BUY LIMIT','SELL LIMIT'].includes(plan.decision)){
      state.history.push(C.createForecast({horizon:h,nowMs,price,spread:CONFIG.assumedSpread,evidence:ev,stability:stab,plan,market:stats,articles:ev.topArticles}));
    }
  }
  state.history=state.history.slice(-800); state.lastRun=new Date(nowMs).toISOString();
  const proof=C.proofSummary(state.history);
  const snapshot={
    version:'2.0.0',generatedAt:new Date(nowMs).toISOString(),githubOnly:true,
    market:{available:market.available,provider:market.provider,symbol:market.symbol||CONFIG.marketSymbol,price:market.price||null,updatedAt:market.updatedAt||null,reason:market.reason||null,stats,bars:market.bars.slice(-180)},
    news:{feedSuccessCount:news.feedSuccessCount,feedTotal:news.feedTotal,errors:news.errors,articleCount:news.articles.length,deepReadCount:news.articles.filter(a=>a.deepRead).length,
      articles:horizons['3'].evidence.topArticles.slice(0,45).map(a=>({title:a.title,url:a.url,domain:a.domain,seendate:a.seendate,queryId:a.queryId,official:!!a.official,deepRead:!!a.deepRead,weightedScore:a.weightedScore,features:a.features||[]}))},
    horizons,proof,learning:publicLearning(state.learning),recentOutcomes:state.history.filter(f=>f.resolved).slice(-30).reverse(),activeForecasts:state.history.filter(f=>!f.resolved).slice(-10)
  };
  writeJson(path.join(DATA,'state.json'),state); writeJson(path.join(DATA,'snapshot.json'),snapshot);
  console.log(`GOLD ORACLE update ${snapshot.generatedAt}: news ${news.feedSuccessCount}/${news.feedTotal}, market=${market.available?'LIVE':'MANUAL'}, resolved=${proof.resolved}, learned=${snapshot.learning.totalLearned}`);
})().catch(e=>{console.error(e);process.exit(1);});
