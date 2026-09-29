'use strict';
// Review-note overlap, not a probability of enjoyment. Missing notes are not measured zeros.
const Discovery = (()=>{
  const stages=['nose','palate','finish'];
  const valid=f=>f&&typeof f.family==='string'&&f.family.length>0&&Number.isFinite(f.value)&&f.value>=0&&f.value<=4.5;
  function profile(record,stage='all'){
    const selected=stage==='all'?stages:stages.includes(stage)?[stage]:[];
    const values=new Map();
    for(const part of selected){
      const fruits=(record.fruit_features||[]).filter(f=>f.stage===part&&valid(f));
      const core=(record.features||[]).filter(f=>f.stage===part&&valid(f)&&(!fruits.length||!['과일','시트러스'].includes(f.family)));
      const known=new Map([...core,...fruits].map(f=>[f.family,f.value]));
      for(const [family,value] of known){if(!values.has(family))values.set(family,[]);values.get(family).push(value);}
    }
    return Object.fromEntries([...values].map(([family,values])=>[family,values.reduce((a,b)=>a+b,0)/values.length]));
  }
  function axes(records,category,stage='all'){
    return [...new Set(records.filter(r=>!r.is_collection&&r.category===category).flatMap(r=>Object.keys(profile(r,stage))))].sort((a,b)=>a.localeCompare(b,'ko'));
  }
  function similarity(a,b){
    const left=Object.entries(a).filter(([,v])=>v>0),right=Object.entries(b).filter(([,v])=>v>0);
    const common=left.map(([key])=>key).filter(key=>Object.hasOwn(b,key)&&b[key]>0);
    if(!common.length)return null;
    const union=new Set([...left,...right].map(([key])=>key));
    const norm=Math.sqrt(left.reduce((sum,[,v])=>sum+v*v,0)*right.reduce((sum,[,v])=>sum+v*v,0));
    const cosine=common.reduce((sum,key)=>sum+a[key]*b[key],0)/norm;
    return {score:100*(.7*cosine+.3*common.length/union.size),shared:common.sort((x,y)=>a[y]*b[y]-a[x]*b[x]||x.localeCompare(y,'ko')).slice(0,4)};
  }
  function recommend(records,{category,seed,mode='similar',stage='all',weights={}}={}){
    const empty=reason=>({items:[],reason});
    if(!['similar','explore','custom'].includes(mode)||!['all',...stages].includes(stage))return empty('추천 방식과 단계를 다시 선택해 주세요.');
    const pool=records.filter(r=>!r.is_collection&&r.category===category);
    let anchor;
    if(mode==='custom'){
      const available=new Set(axes(pool,category,stage));
      anchor=Object.fromEntries(Object.entries(weights||{}).filter(([key,value])=>available.has(key)&&Number.isFinite(value)&&value>0&&value<=4.5));
      if(!Object.keys(anchor).length)return empty('원하는 향미를 하나 이상 0.5~4.5로 선택해 주세요.');
    }else{
      const record=pool.find(r=>r.id===seed);
      if(!record)return empty('이 분류의 기준 제품을 선택해 주세요.');
      anchor=profile(record,stage);
      if(!Object.values(anchor).some(value=>value>0))return empty('기준 제품의 선택한 단계에 향미 근거가 부족합니다. 다른 단계나 제품을 골라 주세요.');
    }
    const items=[];
    for(const record of pool){
      if(mode!=='custom'&&record.id===seed)continue;
      const match=similarity(anchor,profile(record,stage));
      if(!match)continue;
      const score=Math.round(Math.max(0,Math.min(100,mode==='explore'?100-Math.abs(match.score-65)*1.5:match.score)));
      items.push({record,score,shared:match.shared});
    }
    items.sort((a,b)=>b.score-a.score||(String(a.record.id)<String(b.record.id)?-1:String(a.record.id)>String(b.record.id)?1:0));
    if(!items.length)return empty('선택한 단계에서 공통 향미가 확인되는 다른 제품이 없습니다. 단계나 기준을 바꿔 보세요.');
    return {items:items.slice(0,12),reason:mode==='explore'?'향미가 일부 겹치면서 조금 다른 제품을 먼저 보여주는 탐색 지수입니다. 만족 확률이나 품질 점수가 아닙니다.':'기록된 향미의 수치와 공통 표현을 비교한 유사도입니다. 만족 확률이나 품질 점수가 아닙니다.'};
  }
  return {profile,axes,recommend};
})();