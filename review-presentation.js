'use strict';
// Display-only grouping. Never write these derived values back to the NPF scores.
const ReviewPresentation=(()=>{
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const stages={nose:'향',palate:'맛',finish:'여운'};
 const fruit=['과일','건과일','시트러스'],sweet=['단맛','바닐라·크림','바닐라','캔디·인공향'],grain=['곡물·몰트','곡물','견과·고소'],roast=['초콜릿·커피','로스팅'],wood=['오크·나무','오크'],flower=['꽃·허브','꽃','허브'],peat=['스모크·피트','피트'];
 const groups={
  american:{name:'버번·라이·밀버번',axes:[['단맛·바닐라',sweet],['과일',fruit],['곡물·견과',grain],['오크',wood],['스파이스',['스파이스']],['로스팅',roast]]},
  whisky:{name:'스카치·아이리시 등',axes:[['과일',fruit],['단맛·바닐라',sweet],['꽃·허브',flower],['곡물·로스팅',[...grain,...roast]],['오크',wood],['스모크·피트',peat]]},
  other:{name:'기타 주류',axes:[['과일',fruit],['꽃·허브',flower],['단맛',sweet],['곡물·견과',grain],['산미',['산미']],['쓴맛·스파이스',['쓴맛','스파이스']]]},
  drink:{name:'카페인·소다',axes:[['과일',fruit],['단맛·바닐라',sweet],['꽃·허브',flower],['로스팅·쓴맛',[...roast,'쓴맛']],['산미',['산미']],['탄산',['탄산']]]},
  common:{name:'서로 다른 종류 · 공통 축',axes:[['과일·꽃',[...fruit,...flower]],['단맛·바닐라',sweet],['곡물·로스팅',[...grain,...roast]],['오크·스파이스',[...wood,'스파이스']],['스모크·쓴맛',[...peat,'쓴맛']],['산미·청량',['산미','탄산','짠맛·미네랄']]]}
 };
 function group(record){
  const c=record.catalog||{},type=c.primary_type||'',origin=c.origin||'';
  // A bourbon cask is not bourbon whisky. Use product classification only.
  if(/버번|라이|테네시|bourbon|\brye\b|tennessee/i.test(type))return 'american';
  if(record.category==='위스키'||/위스키|whisk|스카치|아이리시|싱글몰트|블렌디드/i.test(type+' '+origin))return 'whisky';
  if(record.category==='카페인'||/에너지|소다|음료|커피|차$/.test(type))return 'drink';
  return 'other';
 }
 function comparisonGroup(records){const keys=new Set(records.map(group));return keys.size===1?[...keys][0]:'common';}
 function wheel(record,stage='all',forcedGroup){
  const key=groups[forcedGroup]?forcedGroup:group(record),definition=groups[key];
  const parts=stage==='all'?Object.keys(stages):[stage];
  const valid=f=>Number.isFinite(f.value)&&f.value>=0&&f.value<=(record.profile_scale?.max||4.5);
  const axes=definition.axes.map(([label,families])=>{
   const values=parts.map(s=>(record.features||[]).filter(f=>f.stage===s&&families.includes(f.family)&&valid(f)).map(f=>f.value)).filter(v=>v.length).map(v=>Math.max(...v));
   return {label,families,value:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
  });
  return {key,name:definition.name,axes};
 }
 function excerpts(text){
  const blocks=[];let current=null;
  for(const raw of String(text||'').split(/\r?\n/)){
   const line=raw.trim();if(!line)continue;
   const numbered=line.match(/^\d+[.)]\s*(.+)/),bullet=line.match(/^[-•]\s*(.+)/);
   if(numbered||bullet){current={numbered:!!numbered,text:(numbered||bullet)[1]};blocks.push(current);}
   else if(current)current.text+=' '+line;
   else{current={numbered:false,text:line};blocks.push(current);}
  }
  const ranked=blocks.filter(b=>b.numbered);
  return (ranked.length?ranked:blocks).slice(0,3).map(b=>b.text);
 }
 function bar(label,value,kind='',maximum=5){
  const known=Number.isFinite(value)&&value>=0&&value<=maximum;
  return `<div class="review-score ${kind}"><span>${escape(label)}</span><div class="review-track" role="img" aria-label="${escape(label)} ${known?value.toFixed(1)+' / '+maximum:'미기록'}"><i style="width:${known?value/maximum*100:0}%"></i></div><b>${known?value.toFixed(1):'—'}</b></div>`;
 }
 function npf(record){
  const notes=record.tasting_notes||record.notes||{},max=record.profile_scale?.max||4.5;
  return `<section class="review-panel compact-npf"><div class="review-section-title"><h3>NPF</h3><span>향미 ${record.profile_scale?.min??.5}–${max} · 강도 0–5</span></div><div class="review-npf-grid">${Object.entries(stages).map(([stage,label])=>{
   const words=excerpts(notes[stage]),fs=(record.features||[]).filter(f=>f.stage===stage&&Number.isFinite(f.value)&&f.value>=0&&f.value<=max).sort((a,b)=>b.value-a.value);
   return `<section class="review-stage"><h4><span>${stage==='nose'?'N':stage==='palate'?'P':'F'}</span> ${label}</h4>${words.length?`<ol class="review-excerpts">${words.map(w=>`<li>${escape(w)}</li>`).join('')}</ol>`:'<p class="review-muted">원문 노트 미확인</p>'}<div class="review-sensation">${bar('강도',record.intensities?.[stage]?.value,'sensation')}${stage==='palate'&&record.mouthfeel_body?.value!=null?bar('바디',record.mouthfeel_body.value,'sensation'):''}${stage==='finish'&&record.finish_duration?.score!=null?bar('여운 길이',record.finish_duration.score,'sensation'):''}${stage==='finish'&&record.finish_duration?.score==null&&record.finish_duration?.value?`<p class="review-muted">여운 길이 · ${escape(record.finish_duration.value)}</p>`:''}</div>${fs.length?fs.map(f=>bar(f.family,f.value,'',max)).join(''):'<p class="review-muted">향미 점수 미기록</p>'}${notes[stage]?`<details class="review-original"><summary>원문 보기</summary><p>${escape(notes[stage])}</p></details>`:''}</section>`;
  }).join('')}</div></section>`;
 }
 function hex(record,stage='all',forcedGroup,color='#2d5143'){
  const model=wheel(record,stage,forcedGroup),cx=200,cy=154,radius=102;
  const point=(i,value=5,extra=0)=>{const angle=i*Math.PI/3-Math.PI/2,r=radius*value/5+extra;return [cx+Math.cos(angle)*r,cy+Math.sin(angle)*r];};
  const coordinates=model.axes.map((a,i)=>a.value==null?null:point(i,a.value));
  const all=coordinates.every(Boolean),segments=coordinates.map((p,i)=>p&&coordinates[(i+1)%6]?`<line x1="${p[0]}" y1="${p[1]}" x2="${coordinates[(i+1)%6][0]}" y2="${coordinates[(i+1)%6][1]}" stroke="${color}" stroke-width="2"/>`:'').join('');
  return `<div class="review-wheel"><p class="review-muted">${escape(model.name)} · ${stages[stage]||'전체'} · 0–5</p><div class="review-wheel-canvas"><svg viewBox="0 0 400 310" role="img" aria-label="${escape(record.name)} ${stages[stage]||'전체'} 육각형 향미 지도. ${model.axes.map(a=>escape(a.label)+' '+(a.value==null?'미기록':a.value.toFixed(1))).join(', ')}">${[1,2,3,4,5].map(v=>`<polygon points="${model.axes.map((_,i)=>point(i,v).join(',')).join(' ')}" fill="none" stroke="#dce3d5"/>`).join('')}${model.axes.map((_,i)=>`<line x1="${cx}" y1="${cy}" x2="${point(i)[0]}" y2="${point(i)[1]}" stroke="#e5e9df"/>`).join('')}${all?`<polygon class="review-wheel-fill" points="${coordinates.map(p=>p.join(',')).join(' ')}" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-width="2"/>`:segments}${coordinates.map((p,i)=>p?`<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${color}"><title>${escape(model.axes[i].label)} ${model.axes[i].value.toFixed(1)}</title></circle>`:'').join('')}</svg>${model.axes.map((a,i)=>{const p=point(i,5,22);return `<span class="review-wheel-label" aria-hidden="true" style="left:${p[0]/4}%;top:${p[1]/3.1}%">${escape(a.label)}${a.value==null?' · —':''}</span>`;}).join('')}</div><dl class="review-wheel-values">${model.axes.map(a=>`<div><dt>${escape(a.label)}</dt><dd>${a.value==null?'—':a.value.toFixed(1)}</dd></div>`).join('')}</dl><details class="review-method"><summary>축 구성과 계산 기준</summary><p>각 축은 해당 단계에서 기록한 세부 항목의 최댓값입니다. 전체는 기록된 단계별 축 점수의 평균입니다. 미기록은 0점으로 채우지 않으며 선을 연결하지 않습니다. 만족도·전체 강도와는 별도입니다.</p><ul>${model.axes.map(a=>`<li>${escape(a.label)}: ${escape(a.families.join(', '))}</li>`).join('')}</ul><p>육각형에 포함되지 않은 항목도 NPF 막대와 원래 점수에 유지됩니다. 원래 0.5–4.5 척도는 확대 환산하지 않습니다.</p></details></div>`;
 }
 function facts(record){
  const c=record.catalog||{},meta=record.meta||{},n=(v,unit)=>v==null?'':Number(v).toLocaleString('ko-KR')+unit;
  const rows=[['국가',c.country],['지역',c.region],['증류소',c.distillery],['종류',meta.종류||c.primary_type],['숙성',c.age],['도수',n(record.abv,'%')],['용량',n(record.volume,'mL')],['구매가',n(record.price,'원')],['카페인',n(record.caffeine,'mg')],['열량',n(record.calories,'kcal')]];
  return `<section class="review-panel review-facts"><h3>제품 정보</h3><dl>${rows.filter(([,v])=>v!==''&&v!=null).map(([k,v])=>`<div><dt>${k}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl><details><summary>추가 정보</summary><dl>${[['소유주',c.owner],['시음 형태',c.sample_type],['잔당가격',n(c.serving_price,'원')],['잔 용량',n(c.serving_ml,'mL')],['색',c.color],['에어링',n(c.airing_remaining,'%')],['세부 분류',(c.subtypes||[]).join(' · ')]].filter(([,v])=>v!==''&&v!=null).map(([k,v])=>`<div><dt>${k}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl></details></section>`;
 }
 function production(record){
  const mash=record.meta?.매시빌||record.mashbill||'',c=record.catalog||{},cask=record.meta?.캐스크||c.cask_raw||(c.casks||[]).join(' · ');
  if(!mash&&!cask)return '';
  const parts=[...mash.matchAll(/([^/%]+?)\s*(\d+(?:\.\d+)?)\s*%/g)].map(m=>({label:m[1].trim(),value:Number(m[2])})),total=parts.reduce((s,p)=>s+p.value,0);
  const strip=parts.length&&Math.abs(total-100)<.1?`<div class="review-mash" role="img" aria-label="${escape(mash)}">${parts.map((p,i)=>`<i style="width:${p.value}%;background:${['#dfb145','#72905c','#9e6b43','#ac916d'][i%4]}"></i>`).join('')}</div>`:'';
  return `<div class="review-production">${mash?`<section class="review-panel"><h3>매시빌</h3>${strip}<p>${escape(mash)}</p></section>`:''}${cask?`<section class="review-panel"><h3>캐스크</h3><p>${escape(cask)}</p></section>`:''}</div>`;
 }
 function tags(record,stage='all'){return Object.entries(Discovery.profile(record,stage)).filter(([,v])=>Number.isFinite(v)&&v>0).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([label])=>`<span>${escape(label)}</span>`).join('');}
 return {group,comparisonGroup,wheel,excerpts,npf,hex,facts,production,tags};
})();
