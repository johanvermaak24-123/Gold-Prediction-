'use strict';
// One-time recent-history calibration. It builds predictions using only news that was available
// before each historical checkpoint, then resolves those predictions on later XAU/USD bars.
const fs=require('fs'); const path=require('path'); const C=require('./core');
const ROOT=path.resolve(__dirname,'..'), DATA=path.join(ROOT,'data');
const CONFIG=JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));
const key=process.env.TWELVE_DATA_API_KEY||''; const days=Math.max(0,Math.min(7,Number(process.env.BOOTSTRAP_DAYS||0)||0));
if(!days){console.log('Bootstrap skipped: BOOTSTRAP_DAYS=0');process.exit(0);} if(!key){console.error('Bootstrap requires TWELVE_DATA_API_KEY');process.exit(2);}
function readJson(f,x){try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return x;}} function writeJson(f,o){fs.writeFileSync(f,JSON.stringify(o,null,2));}
function utc14(ms){const d=new Date(ms);return d.toISOString().replace(/[-:T]/g,'').slice(0,14);} function isoNoZ(ms){return new Date(ms).toISOString().replace('T',' ').replace('Z','');}
async function fetchJson(url,ms=15000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{headers:{'user-agent':'GoldOracleHistorical/2.0','accept':'application/json'},signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(t);}}
async function marketBars(startMs,endMs){const p=new URLSearchParams({symbol:CONFIG.marketSymbol||'XAU/USD',interval:'5min',start_date:isoNoZ(startMs),end_date:isoNoZ(endMs),outputsize:'5000',timezone:'UTC',apikey:key});const j=await fetchJson(`https://api.twelvedata.com/time_series?${p}`,20000);if(j.status==='error'||!Array.isArray(j.values))throw new Error(j.message||'No historical values');return j.values.map(v=>({time:new Date(String(v.datetime).replace(' ','T')+'Z').getTime(),open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close)})).filter(b=>[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);}
const HIST_QUERY='(gold OR XAUUSD OR bullion OR dollar OR DXY OR "Federal Reserve" OR FOMC OR CPI OR inflation OR PCE OR payrolls OR NFP OR unemployment OR "Treasury yields" OR war OR ceasefire OR sanctions OR geopolitical OR "gold ETF" OR "central bank")';
async function historicalNews(checkMs){const start=checkMs-24*3600000;const p=new URLSearchParams({query:HIST_QUERY,mode:'ArtList',maxrecords:'75',format:'json',sort:'HybridRel',startdatetime:utc14(start),enddatetime:utc14(checkMs)});const j=await fetchJson(`https://api.gdeltproject.org/api/v2/doc/doc?${p}`,15000);const a=Array.isArray(j?.articles)?j.articles:[];return a.map(x=>({title:String(x.title||''),url:String(x.url||''),domain:String(x.domain||''),seendate:/^\d{14}$/.test(String(x.seendate||''))?new Date(`${String(x.seendate).slice(0,4)}-${String(x.seendate).slice(4,6)}-${String(x.seendate).slice(6,8)}T${String(x.seendate).slice(8,10)}:${String(x.seendate).slice(10,12)}:${String(x.seendate).slice(12,14)}Z`).toISOString():new Date(checkMs).toISOString(),queryId:'historical-archive',queryWeight:1,official:false,deepRead:false}));}
function nearestAtOrBefore(bars,ms){let out=null;for(const b of bars){if(b.time<=ms)out=b;else break;}return out;}
(async()=>{
  const end=Date.now()-8*3600000; // leave room for the longest 6H horizon plus data delay
  const start=end-days*86400000-24*3600000; const bars=await marketBars(start,end+8*3600000); if(bars.length<100)throw new Error('Not enough historical market bars.');
  const statePath=path.join(DATA,'state.json');const state=readJson(statePath,{version:2,learning:C.initLearning(),history:[],stability:{'1':{},'3':{},'6':{}}});if(!state.learning)state.learning=C.initLearning();if(!Array.isArray(state.history))state.history=[];
  const neutral=C.initLearning(); const stab={'1':{},'3':{},'6':{}}; const generated=[];
  // 6-hour checkpoints keep API load reasonable and reduce heavily overlapping samples.
  for(let check=end-days*86400000;check<=end;check+=6*3600000){
    const spot=nearestAtOrBefore(bars,check); if(!spot)continue; let news=[];try{news=await historicalNews(check);}catch(e){console.warn('Historical news skipped',new Date(check).toISOString(),e.message);continue;}if(news.length<4)continue;
    const prior=bars.filter(b=>b.time<=check).slice(-180); const stats=C.marketStats(prior);
    for(const h of [1,3,6]){
      const keyId=`${new Date(check).toISOString()}-${h}`; if(state.history.some(f=>f.bootstrapKey===keyId))continue;
      const ev=C.aggregateEvidence(news,neutral,h,{feedSuccessCount:1,feedTotal:1},check);ev.calibratedConfidence=ev.confidence;ev.marketVolPct=stats.volPct;
      const st=C.stabilizeBias(stab[String(h)]||{},ev);stab[String(h)]=st;Object.assign(ev,st);
      const plan=C.Engine.buildPlan({price:spot.close,spread:CONFIG.assumedSpread,horizon:h,data:ev});if(!['BUY LIMIT','SELL LIMIT'].includes(plan.decision))continue;
      let f=C.createForecast({horizon:h,nowMs:check,price:spot.close,spread:CONFIG.assumedSpread,evidence:ev,stability:st,plan,market:stats,articles:ev.topArticles});f.bootstrap=true;f.bootstrapKey=keyId;f.bootstrapMode='GDELT archived headlines + historical XAU/USD 5m bars';
      f=C.resolveForecast(f,bars,check+h*3600000+60000); if(f.resolved)generated.push(f);
    }
    await new Promise(r=>setTimeout(r,350));
  }
  // Add historical proof, then learn from it. Predictions themselves were produced with neutral weights.
  state.history.push(...generated);state.history=state.history.slice(-800);for(let i=0;i<state.history.length;i++){const r=C.learnFromForecast(state.learning,state.history[i]);state.learning=r.learning;state.history[i]=r.forecast;}
  state.bootstrap={days,completedAt:new Date().toISOString(),added:generated.length,method:'No-lookahead: each checkpoint queried only news ending at that checkpoint; weights were neutral during prediction generation.'};writeJson(statePath,state);
  console.log(`Bootstrap complete: ${generated.length} resolved forecasts added across ${days} day(s).`);
})().catch(e=>{console.error(e);process.exit(1);});
