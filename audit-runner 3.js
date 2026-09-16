'use strict';
const E=require('../assets/engine.js'); const C=require('./core.js');
let seed=0x9e3779b9; function rnd(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
let invalid=0,crashes=0,buy=0,sell=0,wait=0;
const N=10_000_000;
for(let i=0;i<N;i++){
  try{
    const price=500+rnd()*9500,spread=rnd()*Math.min(8,price*.0015),h=[1,3,6][i%3];
    const data={directionalScore:-100+rnd()*200,stabilizedDirectionalScore:-100+rnd()*200,confidence:rnd()*100,calibratedConfidence:rnd()*100,conflict:rnd()*100,scoredCount:Math.floor(rnd()*40),feedSuccessCount:Math.floor(rnd()*11),marketVolPct:.0005+rnd()*.02,flipBlocked:rnd()<.05};
    const p=E.buildPlan({price,spread,horizon:h,data}); if(!E.planInvariant(p,price))invalid++; if(p.decision==='BUY LIMIT')buy++;else if(p.decision==='SELL LIMIT')sell++;else wait++;
  }catch{crashes++;}
}
let featureFail=0; const words=['dollar falls','higher yields','rate cut','hawkish','jobs beat','ceasefire','war','gold rises','etf outflow','cpi cools','random words'];
for(let i=0;i<250000;i++){try{const f=C.detectFeatures(words[Math.floor(rnd()*words.length)]+' '+Math.random().toString(36));if(!Array.isArray(f))featureFail++;}catch{featureFail++;}}
let resolverFail=0;
for(let i=0;i<100000;i++){try{const dir=rnd()<.5?'BUY':'SELL',price=4000+rnd()*1000;const data={directionalScore:dir==='BUY'?70:-70,stabilizedDirectionalScore:dir==='BUY'?70:-70,confidence:75,calibratedConfidence:75,conflict:10,scoredCount:12,feedSuccessCount:8,marketVolPct:.003};const plan=E.buildPlan({price,spread:.4,horizon:3,data});const f={id:String(i),createdAt:new Date(Date.now()-4*3600000).toISOString(),horizon:3,price,direction:dir,decision:plan.decision,plan,evidence:{features:['weakerUSD'],sources:['reuters.com']},resolved:false};const bars=[];for(let j=0;j<37;j++){const c=price+(rnd()-.5)*25;bars.push({time:new Date(f.createdAt).getTime()+j*300000,open:c,high:c+rnd()*8,low:c-rnd()*8,close:c+(rnd()-.5)*4});}const r=C.resolveForecast(f,bars,Date.now());if(!r||typeof r!=='object')resolverFail++;}catch{resolverFail++;}}
console.log(JSON.stringify({iterations:N,buy,sell,wait,invalid,crashes,featureFuzz:250000,featureFail,resolverFuzz:100000,resolverFail},null,2));
if(invalid||crashes||featureFail||resolverFail)process.exit(1);
