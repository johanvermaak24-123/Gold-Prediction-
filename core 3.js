'use strict';
const crypto=require('crypto');
const Engine=require('../assets/engine.js');
const {clamp,finite}=Engine;

const SOURCE_WEIGHTS={
  'federalreserve.gov':1.55,'bls.gov':1.55,'bea.gov':1.50,'treasury.gov':1.50,
  'reuters.com':1.35,'bloomberg.com':1.30,'ft.com':1.25,'wsj.com':1.25,
  'cnbc.com':1.15,'marketwatch.com':1.10,'investing.com':1.05
};
const STOPWORDS=new Set('the a an and or for to of in on at by with from as is are was were be been being this that these those after before over under amid into against about says said gold xauusd bullion dollar usd us market markets price prices'.split(' '));
const FEATURE_RULES=[
  ['weakerUSD',+3.2,/(dollar (falls|drops|slides|weakens|retreats)|weaker dollar|dxy (falls|drops|slides|weakens))/i],
  ['strongerUSD',-3.2,/(dollar (rises|gains|jumps|strengthens|surges)|stronger dollar|dxy (rises|gains|jumps|strengthens))/i],
  ['lowerYields',+2.6,/(yields? (fall|falls|drop|drops|decline|declines|ease|eases)|lower yields?)/i],
  ['higherYields',-2.6,/(yields? (rise|rises|jump|jumps|climb|climbs|surge|surges)|higher yields?)/i],
  ['dovish',+2.8,/(rate cut|cuts rates|dovish|easing|policy easing|lower rates?)/i],
  ['hawkish',-2.8,/(rate hike|hikes rates|hawkish|higher for longer|delays? rate cuts?|policy tightening)/i],
  ['softJobs',+2.3,/(weak jobs|jobs miss|payrolls miss|unemployment rises|soft labo(u)?r|labo(u)?r market weak)/i],
  ['strongJobs',-2.3,/(strong jobs|jobs beat|payrolls beat|unemployment falls|labo(u)?r market strong)/i],
  ['goldUp',+1.7,/(gold (rises|jumps|surges|gains|climbs)|bullion (rises|jumps|surges|gains|climbs))/i],
  ['goldDown',-1.7,/(gold (falls|drops|slides|slumps|declines)|bullion (falls|drops|slides|slumps|declines))/i],
  ['geopolitics',+1.4,/(\bwar\b|\battacks?\b|\battacked\b|\bmissiles?\b|\bescalat|geopolitical tension|\bsanctions?\b)/i],
  ['deescalation',-1.1,/(ceasefire|peace deal|de-escalat|truce)/i],
  ['goldFlows',+1.8,/(central bank.{0,50}(buy|purchase|accumulat)|gold reserves.{0,40}(rise|increase)|etf inflow)/i],
  ['goldOutflows',-1.7,/(etf outflow|gold demand.{0,30}(falls|drops)|central bank.{0,50}(sell|sales))/i],
  ['coolInflation',+1.4,/(inflation (cools|eases|slows)|cpi (cools|eases|below)|pce (cools|eases|below))/i],
  ['hotInflation',-1.3,/(inflation (hot|accelerates|rises)|cpi (hot|above|rises)|pce (hot|above|rises))/i]
];

function sourceWeight(domain=''){ domain=String(domain).toLowerCase().replace(/^www\./,''); for(const [d,w] of Object.entries(SOURCE_WEIGHTS)) if(domain===d||domain.endsWith('.'+d)) return w; return 1; }
function parseDate(v){ const d=new Date(v); return Number.isNaN(d.getTime())?null:d; }
function recencyWeight(date,halfLifeHours=4,nowMs=Date.now()){
  const d=parseDate(date); if(!d) return .5; const age=Math.max(0,(nowMs-d.getTime())/3600000); return clamp(Math.pow(.5,age/halfLifeHours),.18,1);
}
function featureMultiplier(feature,learning){ const f=learning?.features?.[feature]; return f&&f.active?clamp(f.multiplier,.65,1.35):1; }
function sourceMultiplier(domain,learning){ const s=learning?.sources?.[domain]; return s&&s.active?clamp(s.multiplier,.80,1.20):1; }
function detectFeatures(text=''){
  const t=String(text||'').slice(0,24000); const out=[]; const hasEase=/(ceasefire|peace deal|de-escalat|truce)/i.test(t);
  for(const [name,base,rx] of FEATURE_RULES){ if(name==='geopolitics'&&hasEase) continue; if(rx.test(t)) out.push({name,base}); }
  return out;
}
function scoreArticle(article,learning,horizon=3,nowMs=Date.now()){
  const text=[article.title,article.description,article.bodyText].filter(Boolean).join(' \n ');
  const features=detectFeatures(text);
  let base=0; for(const f of features) base+=f.base*featureMultiplier(f.name,learning);
  const sw=sourceWeight(article.domain)*sourceMultiplier(article.domain,learning);
  const rw=recencyWeight(article.seendate,horizon===1?2.2:horizon===6?7:4.2,nowMs);
  const qw=clamp(finite(article.queryWeight,1),.5,2);
  const deep=article.deepRead?1.10:1;
  const weighted=base*sw*rw*qw*deep;
  return {...article,features:features.map(f=>f.name),baseScore:base,weightedScore:Number.isFinite(weighted)?weighted:0,sourceWeight:sw,recencyWeight:rw};
}
function normalizeTitle(v=''){ return String(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function eventKey(title=''){
  const words=normalizeTitle(title).split(/\s+/).filter(w=>w.length>2&&!STOPWORDS.has(w));
  return [...new Set(words)].slice(0,7).sort().join('|') || normalizeTitle(title).slice(0,80);
}
function aggregateEvidence(articles,learning,horizon,feedMeta={},nowMs=Date.now()){
  const scored=articles.map(a=>scoreArticle(a,learning,horizon,nowMs));
  const clusters=new Map();
  for(const a of scored){
    const key=eventKey(a.title); const arr=clusters.get(key)||[]; arr.push(a); clusters.set(key,arr);
  }
  const used=[];
  for(const arr of clusters.values()){
    arr.sort((a,b)=>Math.abs(b.weightedScore)-Math.abs(a.weightedScore));
    // One dominant story plus a discounted corroboration. This prevents 20 copies of one event from faking confidence.
    if(arr[0]) used.push({...arr[0],clusterFactor:1});
    if(arr[1]) used.push({...arr[1],weightedScore:arr[1].weightedScore*.28,clusterFactor:.28});
  }
  used.sort((a,b)=>Math.abs(b.weightedScore)-Math.abs(a.weightedScore));
  const directional=used.filter(a=>Math.abs(a.weightedScore)>.08);
  const sum=directional.reduce((s,a)=>s+a.weightedScore,0);
  const magnitude=directional.reduce((s,a)=>s+Math.abs(a.weightedScore),0)||1;
  const ratio=clamp(sum/magnitude,-1,1);
  const bull=directional.filter(a=>a.weightedScore>0).reduce((s,a)=>s+a.weightedScore,0);
  const bear=Math.abs(directional.filter(a=>a.weightedScore<0).reduce((s,a)=>s+a.weightedScore,0));
  const conflict=Math.min(bull,bear)/Math.max(.0001,Math.max(bull,bear));
  const coverage=clamp(directional.length/16,0,1);
  const diversity=clamp(new Set(directional.map(a=>a.domain)).size/7,0,1);
  const deepRatio=directional.length?directional.filter(a=>a.deepRead).length/directional.length:0;
  const feedCoverage=clamp(finite(feedMeta.feedSuccessCount,0)/Math.max(1,finite(feedMeta.feedTotal,1)),0,1);
  const confidence=clamp(Math.abs(ratio)*(0.52+.18*coverage+.12*diversity+.08*deepRatio+.10*feedCoverage)*(1-.46*conflict)*100,0,100);
  const featureSet=[...new Set(directional.flatMap(a=>a.features||[]))];
  const sourceSet=[...new Set(directional.map(a=>a.domain).filter(Boolean))];
  return {
    horizon,directionalScore:Math.round(ratio*100),confidence:Math.round(confidence),conflict:Math.round(conflict*100),
    scoredCount:directional.length,articleCount:scored.length,clusterCount:clusters.size,
    deepReadCount:scored.filter(a=>a.deepRead).length,feedSuccessCount:feedMeta.feedSuccessCount||0,feedTotal:feedMeta.feedTotal||0,
    features:featureSet,sources:sourceSet,
    topArticles:used.slice(0,35)
  };
}
function stabilizeBias(prev={},evidence={}){
  const rawScore=finite(evidence.directionalScore,0), conf=finite(evidence.confidence,0);
  const raw=Math.abs(rawScore)>=18&&conf>=48?(rawScore>0?1:-1):0;
  let accepted=finite(prev.accepted,0), candidate=finite(prev.candidate,0), streak=finite(prev.streak,0), flipBlocked=false;
  if(raw===0){ candidate=0; streak=0; }
  else if(accepted===0){ accepted=raw; candidate=0; streak=0; }
  else if(raw===accepted){ candidate=0; streak=0; }
  else {
    if(candidate===raw) streak++; else {candidate=raw;streak=1;}
    if(streak>=2&&conf>=55){ accepted=raw;candidate=0;streak=0; } else flipBlocked=true;
  }
  const stabilizedDirectionalScore=accepted===0?rawScore:Math.abs(rawScore)*accepted;
  return {accepted,candidate,streak,flipBlocked,rawDirection:raw,stabilizedDirectionalScore:Math.round(stabilizedDirectionalScore),updatedAt:new Date().toISOString()};
}
function marketStats(bars=[]){
  const clean=bars.filter(b=>Number.isFinite(b.close)&&Number.isFinite(b.high)&&Number.isFinite(b.low)).sort((a,b)=>a.time-b.time);
  if(clean.length<4) return {volPct:.004,support:null,resistance:null,return1h:0,return3h:0,return6h:0};
  const last=clean.at(-1).close;
  const returns=[];
  for(let i=1;i<clean.length;i++) returns.push(Math.log(clean[i].close/clean[i-1].close));
  const slice=returns.slice(-72); const mean=slice.reduce((a,b)=>a+b,0)/Math.max(1,slice.length);
  const variance=slice.reduce((s,r)=>s+(r-mean)**2,0)/Math.max(1,slice.length-1);
  const volPct=Math.sqrt(Math.max(0,variance));
  const ret=(n)=>{ const idx=Math.max(0,clean.length-1-n); return (last/clean[idx].close-1)*100; };
  const look=clean.slice(-96); const support=Math.min(...look.map(b=>b.low)); const resistance=Math.max(...look.map(b=>b.high));
  return {volPct:clamp(volPct,.0005,.03),support,resistance,return1h:ret(12),return3h:ret(36),return6h:ret(72)};
}
function hashId(parts){ return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0,18); }
function createForecast({horizon,nowMs,price,spread,evidence,stability,plan,market,articles}){
  const createdAt=new Date(nowMs).toISOString();
  return {
    id:hashId([createdAt,horizon,price,plan.decision,plan.entry||0]),createdAt,horizon,price,spread,
    direction:plan.direction||null,decision:plan.decision,plan,
    evidence:{directionalScore:evidence.directionalScore,stabilizedDirectionalScore:stability.stabilizedDirectionalScore,confidence:evidence.confidence,calibratedConfidence:evidence.calibratedConfidence,conflict:evidence.conflict,features:evidence.features,sources:evidence.sources,scoredCount:evidence.scoredCount},
    market:{support:market.support,resistance:market.resistance,return1h:market.return1h,return3h:market.return3h,return6h:market.return6h,volPct:market.volPct},
    articleRefs:(articles||[]).slice(0,10).map(a=>({title:a.title,domain:a.domain,weightedScore:a.weightedScore,features:a.features})),
    resolved:false,learned:false
  };
}
function touched(bar,price){ return Number.isFinite(price)&&bar.low<=price&&bar.high>=price; }
function resolveForecast(f,bars,nowMs=Date.now()){
  if(!f||f.resolved) return f;
  const start=new Date(f.createdAt).getTime(), end=start+f.horizon*3600000;
  if(nowMs<end) return f;
  const relevant=bars.filter(b=>b.time>=start&&b.time<=end).sort((a,b)=>a.time-b.time);
  if(!relevant.length) return {...f,resolutionPendingData:true};
  const last=relevant.at(-1); const rawDir=f.direction==='BUY'?1:f.direction==='SELL'?-1:0;
  const finalMove=last.close-f.price; const directionCorrect=rawDir!==0?Math.sign(finalMove)===rawDir:false;
  let entryIndex=-1;
  if(rawDir!==0&&Number.isFinite(f.plan?.entry)) entryIndex=relevant.findIndex(b=>touched(b,f.plan.entry));
  let status='NO_ENTRY', ambiguous=false, firstTargetAt=null, stopAt=null, deepestTP=0, mae=0,mfe=0;
  const base=entryIndex>=0?f.plan.entry:f.price;
  const evalBars=entryIndex>=0?relevant.slice(entryIndex):relevant;
  for(let i=0;i<evalBars.length;i++){
    const b=evalBars[i];
    const fav=rawDir===1?b.high-base:base-b.low; const adv=rawDir===1?base-b.low:b.high-base;
    mfe=Math.max(mfe,fav); mae=Math.max(mae,adv);
    if(entryIndex<0) continue;
    const stopHit=touched(b,f.plan.stop);
    const tpHits=[f.plan.tp1,f.plan.tp2,f.plan.tp3].map(p=>touched(b,p));
    if(stopHit&&tpHits.some(Boolean)){ ambiguous=true;status='AMBIGUOUS';break; }
    if(stopHit){ status='STOP'; stopAt=new Date(b.time).toISOString(); break; }
    for(let t=0;t<3;t++) if(tpHits[t]){ deepestTP=Math.max(deepestTP,t+1); if(!firstTargetAt) firstTargetAt=new Date(b.time).toISOString(); }
    if(deepestTP===3){ status='TP3';break; }
  }
  if(entryIndex>=0&&!ambiguous&&status!=='STOP'&&status!=='TP3') status=deepestTP?`TP${deepestTP}`:'OPEN_AT_HORIZON';
  const entryAt=entryIndex>=0?new Date(relevant[entryIndex].time).toISOString():null;
  const reward=status==='TP3'?1:status==='TP2'?.78:status==='TP1'?.5:status==='STOP'?-1:status==='AMBIGUOUS'?0:(directionCorrect?.18:-.18);
  return {...f,resolved:true,resolvedAt:new Date(Math.min(nowMs,end)).toISOString(),resolutionPendingData:false,
    outcome:{status,ambiguous,directionCorrect,finalPrice:last.close,finalMove,finalMovePct:(finalMove/f.price)*100,entryAt,
      timeToEntryMin:entryAt?Math.round((new Date(entryAt).getTime()-start)/60000):null,firstTargetAt,stopAt,deepestTP,mae,mfe,reward}}
}
function initLearning(){ return {features:{},sources:{},horizons:{},totalLearned:0,lastUpdated:null}; }
function updateStat(obj,key,correct,reward,minSamples,lo,hi){
  if(!obj[key]) obj[key]={samples:0,wins:0,losses:0,rewardSum:0,multiplier:1,active:false};
  const s=obj[key]; s.samples++; if(correct)s.wins++;else s.losses++; s.rewardSum+=finite(reward,0);
  const bayes=(s.wins+2)/(s.samples+4); s.multiplier=clamp(.8+(bayes-.5)*.9,lo,hi); s.active=s.samples>=minSamples; s.hitRate=Math.round(bayes*1000)/10;
}
function learnFromForecast(learning,f){
  if(!f?.resolved||f.learned||f.outcome?.ambiguous) return {learning,forecast:f};
  const L=learning||initLearning(); const correct=Boolean(f.outcome?.directionCorrect); const reward=finite(f.outcome?.reward,0);
  for(const x of f.evidence?.features||[]) updateStat(L.features,x,correct,reward,12,.65,1.35);
  for(const d of f.evidence?.sources||[]) updateStat(L.sources,d,correct,reward,20,.80,1.20);
  const hk=String(f.horizon); if(!L.horizons[hk])L.horizons[hk]={samples:0,wins:0,plans:0,tp1plus:0,stops:0};
  const h=L.horizons[hk]; h.samples++; if(correct)h.wins++; if(f.outcome?.entryAt)h.plans++; if((f.outcome?.deepestTP||0)>=1)h.tp1plus++; if(f.outcome?.status==='STOP')h.stops++;
  h.hitRate=Math.round(((h.wins+2)/(h.samples+4))*1000)/10;
  L.totalLearned=(L.totalLearned||0)+1; L.lastUpdated=new Date().toISOString();
  return {learning:L,forecast:{...f,learned:true}};
}
function calibrateConfidence(raw,learning,horizon){
  const h=learning?.horizons?.[String(horizon)]; if(!h||h.samples<12) return Math.round(raw);
  const empirical=((h.wins+2)/(h.samples+4))*100;
  return Math.round(clamp(raw*.65+empirical*.35,0,100));
}
function proofSummary(history=[]){
  const r=history.filter(f=>f.resolved&&!f.outcome?.ambiguous); const entered=r.filter(f=>f.outcome?.entryAt);
  const wins=r.filter(f=>f.outcome?.directionCorrect).length; const tp=r.filter(f=>(f.outcome?.deepestTP||0)>=1).length; const stops=r.filter(f=>f.outcome?.status==='STOP').length;
  const avg=(arr)=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;
  return {resolved:r.length,entered:entered.length,directionHitRate:r.length?Math.round(wins/r.length*1000)/10:null,tp1PlusRate:entered.length?Math.round(tp/entered.length*1000)/10:null,
    stopRate:entered.length?Math.round(stops/entered.length*1000)/10:null,avgMAE:avg(entered.map(f=>finite(f.outcome?.mae,0))),avgMFE:avg(entered.map(f=>finite(f.outcome?.mfe,0)))};
}
module.exports={Engine,SOURCE_WEIGHTS,detectFeatures,scoreArticle,aggregateEvidence,stabilizeBias,marketStats,createForecast,resolveForecast,initLearning,learnFromForecast,calibrateConfidence,proofSummary,normalizeTitle,eventKey,sourceWeight,recencyWeight};
