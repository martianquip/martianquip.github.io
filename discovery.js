'use strict';
// Review-note overlap, not a probability of enjoyment. Missing notes are not measured zeros.
const Discovery = (()=>{
  const stages=['nose','palate','finish'];
  const valid=f=>f&&typeof f.family==='string'&&f.family.length>0&&Number.isFinite(f.value)&&f.value>=0&&f.value<=4.5;
  function profile(record,stage='all'){
    // Starter references record presence only; they have no authored stage notes.
    if(record.starter===true)return stage==='all'?Object.fromEntries(Object.entries(record.reference_profile||{}).filter(([family,value])=>family.trim()&&value===1)):{};
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
  const identity=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
  function productKey(record){return identity(record.name||record.english)||String(record.id);}
  function journeyClass(record){
    if(record.category!=='위스키'||record.is_collection)return null;
    const catalog=record.catalog||{};
    if(catalog.primary_type==='버번')return 'bourbon';
    // Verified exact editions override inferred peat tags; other editions keep their tags.
    const name=identity(String(record.name??'').trim()?record.name:record.english);
    const unpeated=['클라이넬리쉬14년','clynelish14y','글렌드로낙18년','glendronach18y','글렌드로낙21년','glendronach21y'].includes(name);
    if(unpeated)return 'scotch';
    const tagged=(catalog.subtypes||[]).some(value=>/피티드|peated/i.test(value)&&!/언피티드|언피트|비피트|논피트|unpeated/i.test(value));
    const named=['옥토모어153','octomore153','킬호만사닉','kilchomansanaig'].includes(name);
    if(tagged||named)return 'peat';
    return ['스카치위스키','스카치'].includes(catalog.origin)?'scotch':null;
  }
  function bottlePrice(record){
    const {price,volume}=record;
    const miniature=/미니어[처쳐]|미니\s*보틀|세트|miniature|\bmini\b|\bset\b/i.test([record.name,record.english].join(' '));
    return Number.isFinite(price)&&price>0&&Number.isFinite(volume)&&volume>=200&&record.catalog?.sample_type==='보틀'&&!miniature?price:null;
  }
  function journey(records,{selections=[],bottleBudget=null,routeBudget=null}={}){
    const branches=[{id:'bourbon',label:'버번',node:null},{id:'scotch',label:'스카치',node:null},{id:'peat',label:'피트 위스키',node:null}];
    const empty=(reason,anchorMode=null)=>({branches,reason,anchorMode});
    if(!Array.isArray(records)||!Array.isArray(selections))return empty('경험한 위스키를 다시 선택해 주세요.');
    if(selections.length>12)return empty('경험한 위스키는 최대 12개까지 선택해 주세요.');
    if([bottleBudget,routeBudget].some(value=>value!==null&&(!Number.isFinite(value)||value<0)))return empty('예산은 0 이상의 숫자로 입력해 주세요.');
    const byId=new Map(records.map(record=>[String(record.id),record]));
    const selected=new Map();
    for(const selection of selections){
      const record=byId.get(String(selection?.id));
      if(record&&record.category==='위스키'&&!record.is_collection&&['liked','neutral','disliked'].includes(selection.preference))selected.set(productKey(record),{record,preference:selection.preference});
    }
    const choices=[...selected.values()],liked=choices.filter(choice=>choice.preference==='liked');
    const neutral=choices.filter(choice=>choice.preference==='neutral');
    const anchorMode=liked.length?'liked':neutral.length?'experience':null;
    if(!anchorMode)return empty(choices.length?'아쉬웠던 제품만으로 좋아하는 방향을 정하지 않습니다. 좋았거나 경험 기준으로 삼을 위스키를 하나 선택해 주세요.':'이전에 마신 위스키를 하나 이상 선택해 주세요.');
    const profiles=new Map(records.map(record=>[record,profile(record)]));
    const positive=record=>Object.values(profiles.get(record)).some(value=>value>0);
    const anchors=(liked.length?liked:neutral).map(choice=>choice.record).filter(positive);
    if(!anchors.length)return empty('선택한 기준 제품에 비교할 향미 근거가 부족합니다. 다른 제품을 추가해 주세요.',anchorMode);
    const negatives=choices.filter(choice=>choice.preference==='disliked').map(choice=>choice.record).filter(positive);
    const used=new Set(selected.keys());
    const pool=records.filter(record=>!record.starter&&journeyClass(record)&&positive(record));
    const capped=bottleBudget!==null||routeBudget!==null;
    function next(branch,step,parent,mode){
      const ranked=[];
      for(const record of pool){
        const key=productKey(record);
        if(used.has(key)||journeyClass(record)!==branch)continue;
        const price=bottlePrice(record),cost={knownTotal:(parent?.cost.knownTotal||0)+(price??0),unknownCount:(parent?.cost.unknownCount||0)+(price===null?1:0)};
        if((capped&&price===null)||(bottleBudget!==null&&price>bottleBudget)||(routeBudget!==null&&cost.knownTotal>routeBudget))continue;
        const vector=profiles.get(record),matches=anchors.map(anchor=>similarity(profiles.get(anchor),vector));
        const original=matches.reduce((sum,match)=>sum+(match?.score||0),0)/anchors.length;
        const previous=parent?similarity(profiles.get(parent.record),vector):null;
        if(parent?!previous:!matches.some(Boolean))continue;
        const base=parent ? .65*previous.score+.35*original : original;
        const penalty=negatives.length?Math.max(...negatives.map(negative=>similarity(profiles.get(negative),vector)?.score||0))*.3:0;
        const score=Math.round(Math.max(0,Math.min(100,(mode==='explore'?100-Math.abs(base-65)*1.5:base)-penalty)));
        const shared=previous?previous.shared:[...new Set(matches.filter(Boolean).sort((a,b)=>b.score-a.score).flatMap(match=>match.shared))].slice(0,4);
        ranked.push({record,step,score,shared,mode,children:[],cost,reason:(parent?'직전 제품과 처음 선택한 기준의 향미를 함께 비교했습니다. ':anchorMode==='liked'?'좋았던 제품의 향미에서 출발합니다. ':'경험한 향미에서 출발하며 좋아했다는 뜻은 아닙니다. ')+(penalty?'아쉬웠던 제품과 닮은 정도만큼 우선순위를 낮췄습니다. ':'')+'다음 단계는 앞 제품을 경험한 뒤 이 방향을 계속 탐색한다는 가정의 제안입니다.'});
      }
      ranked.sort((a,b)=>b.score-a.score||(String(a.record.id)<String(b.record.id)?-1:String(a.record.id)>String(b.record.id)?1:0));
      const node=ranked[0]||null;
      if(node)used.add(productKey(node.record));
      return node;
    }
    // ponytail: greedy breadth-first choices keep this small; optimize whole routes only if needed.
    let level=[];
    for(const branch of branches){branch.node=next(branch.id,1,null,'similar');if(branch.node)level.push({branch:branch.id,node:branch.node});}
    for(let step=2;step<=3;step++){
      const following=[];
      for(const {branch,node} of level){
        for(const mode of ['similar','explore']){
          const child=next(branch,step,node,mode);
          if(child){node.children.push(child);following.push({branch,node:child});}
        }
        if(node.children.length<2)node.reason+=' '+(capped?'설정한 예산과 남은 향미 근거를 만족하는 다음 선택지가 부족해 가능한 경로만 표시합니다.':'중복을 제외한 다음 제품의 향미 근거가 부족해 가능한 경로만 표시합니다.');
      }
      level=following;
    }
    const any=branches.some(branch=>branch.node);
    const reason=any?'각 갈림길에서 하나씩 고르는 3단계 경로입니다. 다음 단계는 실제 경험 후 달라질 수 있으며, 지수는 만족 확률이 아닙니다. 가격은 리뷰 당시 기록으로 현재 판매가가 아닙니다. 확인된 보틀 가격만 합산하고 미확인은 별도로 셉니다.':capped?'선택한 경험·예산 조건에 맞고 보틀 가격이 확인되는 다음 제품을 찾지 못했습니다. 예산을 조정하거나 제한을 해제해 주세요.':'선택한 경험과 향미가 겹치는 다음 제품을 찾지 못했습니다. 다른 기준 제품을 추가해 주세요.';
    return {branches,reason,anchorMode};
  }
  return {profile,axes,recommend,similarity,journeyClass,bottlePrice,productKey,journey};
})();