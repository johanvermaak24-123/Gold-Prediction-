(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GoldOracleEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function finite(v,fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
  function round2(v){ return Math.round(v*100)/100; }
  function wait(decision,note,extra={}){ return {decision,note,...extra}; }
  function validPrice(v){ const n=Number(v); return Number.isFinite(n)&&n>0&&n<1e9; }

  function buildPlan(input={}){
    const data=input.data||{};
    const price=Number(input.price);
    const spreadRaw=Number(input.spread);
    const hRaw=Number(input.horizon);
    const horizon=[1,3,6].includes(hRaw)?hRaw:3;

    if(!validPrice(price)) return wait('ENTER PRICE','Enter a valid current XAUUSD price first.');
    if(!Number.isFinite(spreadRaw)||spreadRaw<0) return wait('CHECK SPREAD','Broker spread must be a valid non-negative number.');
    if(spreadRaw>price*0.02) return wait('CHECK SPREAD','Spread is unusually large versus price. Check it before using the order map.');

    const spread=spreadRaw;
    const directionalScore=clamp(finite(data.stabilizedDirectionalScore ?? data.directionalScore,0),-100,100);
    const dir=directionalScore/100;
    const conf=clamp(finite(data.calibratedConfidence ?? data.confidence,0),0,100);
    const conflict=clamp(finite(data.conflict,100),0,100);
    const scoredCount=Math.max(0,Math.floor(finite(data.scoredCount,0)));
    const feedSuccessCount=Math.max(0,Math.floor(finite(data.feedSuccessCount,0)));
    const flipBlocked=Boolean(data.flipBlocked);
    const marketVolPct=clamp(finite(data.marketVolPct,0.004),0.0005,0.03);

    if(feedSuccessCount===0) return wait('WAIT','No news feeds returned successfully. No order should be created from this scan.');
    if(flipBlocked) return wait('WAIT','Opposite news bias appeared, but the anti-flip confirmation gate has not confirmed the reversal yet.',{flipBlocked:true});
    if(conf<48||Math.abs(dir)<0.18||conflict>72||scoredCount<4) return wait('WAIT','Evidence is not clean enough for a pending order yet.');

    const horizonScale=horizon===1?0.66:horizon===6?1.48:1.0;
    const evidenceMovePct=(0.0018+0.0044*(conf/100))*horizonScale;
    const volMovePct=marketVolPct*Math.sqrt(horizon*12)*0.34;
    const movePct=clamp(Math.max(evidenceMovePct,volMovePct),0.0016,horizon===6?0.018:0.012);
    const move=price*movePct;
    const pullback=move*clamp(0.31-conf/520,0.10,0.23)+spread*1.2;
    const invalid=move*0.58+spread*2.1;

    let plan;
    if(dir>0){
      const entry=price-pullback, stop=entry-invalid;
      const tp1=entry+move*0.44, tp2=entry+move*0.80, tp3=entry+move*1.17;
      plan={decision:'BUY LIMIT',direction:'BUY',entry,stop,tp1,tp2,tp3,low:price-move*0.58,high:price+move*1.16,
        note:'Bullish news bias. The pending limit sits below current price to reduce chasing after a headline spike.'};
    }else{
      const entry=price+pullback, stop=entry+invalid;
      const tp1=entry-move*0.44, tp2=entry-move*0.80, tp3=entry-move*1.17;
      plan={decision:'SELL LIMIT',direction:'SELL',entry,stop,tp1,tp2,tp3,low:price-move*1.16,high:price+move*0.58,
        note:'Bearish news bias. The pending limit sits above current price to reduce chasing after a headline drop.'};
    }

    const nums=['entry','stop','tp1','tp2','tp3','low','high'].map(k=>plan[k]);
    if(nums.some(v=>!Number.isFinite(v)||v<=0)) return wait('WAIT','Calculation safety check failed. Verify price and spread.');
    const buyOK=plan.decision!=='BUY LIMIT'||(plan.entry<price&&plan.stop<plan.entry&&plan.tp1>plan.entry&&plan.tp2>plan.tp1&&plan.tp3>plan.tp2);
    const sellOK=plan.decision!=='SELL LIMIT'||(plan.entry>price&&plan.stop>plan.entry&&plan.tp1<plan.entry&&plan.tp2<plan.tp1&&plan.tp3<plan.tp2);
    if(!buyOK||!sellOK||!(plan.low<plan.high)) return wait('WAIT','Order-map invariant check failed. No order should be placed from this scan.');

    for(const k of ['entry','stop','tp1','tp2','tp3','low','high']) plan[k]=round2(plan[k]);
    plan.horizon=horizon; plan.confidence=round2(conf); plan.directionalScore=round2(directionalScore);
    plan.riskDistance=round2(Math.abs(plan.entry-plan.stop));
    plan.rewardToTP1=round2(Math.abs(plan.tp1-plan.entry));
    plan.rewardToTP3=round2(Math.abs(plan.tp3-plan.entry));
    return plan;
  }

  function planInvariant(plan,price){
    if(!plan||!['BUY LIMIT','SELL LIMIT','WAIT','ENTER PRICE','CHECK SPREAD'].includes(plan.decision)) return false;
    if(plan.decision==='BUY LIMIT') return plan.entry<price&&plan.stop<plan.entry&&plan.tp1>plan.entry&&plan.tp2>plan.tp1&&plan.tp3>plan.tp2;
    if(plan.decision==='SELL LIMIT') return plan.entry>price&&plan.stop>plan.entry&&plan.tp1<plan.entry&&plan.tp2<plan.tp1&&plan.tp3<plan.tp2;
    return true;
  }
  return {buildPlan,planInvariant,clamp,finite,round2};
});
