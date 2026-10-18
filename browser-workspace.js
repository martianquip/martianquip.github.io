'use strict';
// The published catalog remains immutable. Only visitor edits are stored here.
const BrowserWorkspace=(()=>{
 const copy=x=>structuredClone(x),stages=['nose','palate','finish'];
 let key,storageName,token=null,base=[],saved={version:1,edits:{},boards:{}},queue=Promise.resolve(),writable=false;
 const error=()=>new Error('저장 형식이 올바르지 않습니다.');
 const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
 function clean(value){
  if(!object(value)||value.version!==1||!object(value.edits)||!object(value.boards))throw error();
  const ids=new Set(base.map(r=>r.id)),result={version:1,edits:{},boards:{}};
  for(const [id,patch] of Object.entries(value.edits)){
   if(!ids.has(id)||!object(patch))throw error();
   const out={};
   for(const [field,v] of Object.entries(patch)){
    if(['name','english','category','memo','mashbill'].includes(field)){if(typeof v!=='string'||v.length>10000||field==='name'&&!v.trim())throw error();out[field]=v;}
    else if(['price','volume','abv','caffeine','calories'].includes(field)){if(v!==null&&(!Number.isFinite(v)||v<0||v>1e10||field==='abv'&&v>100))throw error();out[field]=v;}
    else if(field==='catalog'){
     if(!object(v))throw error();out.catalog={};
     for(const [f,x] of Object.entries(v)){
      if(['primary_type','country','origin','region','distillery','owner','age','sample_type','color'].includes(f)){if(typeof x!=='string'||x.length>500)throw error();}
      else if(['casks','subtypes'].includes(f)){if(!Array.isArray(x)||x.length>30||x.some(s=>typeof s!=='string'||s.length>200))throw error();}
      else throw error();out.catalog[f]=x;
     }
    }else if(field==='rating'){
     if(!object(v)||Object.keys(v).some(f=>!['score','nose','palate','finish','value'].includes(f)))throw error();
     out.rating=Object.fromEntries(Object.entries(v).map(([f,x])=>[f,score(x)]));
    }else if(field==='features'||field==='fruit_features'){
     if(!Array.isArray(v)||v.length>300)throw error();const seen=new Set();
     out[field]=v.map(f=>{if(!object(f)||!stages.includes(f.stage)||typeof f.family!=='string'||!f.family||f.family.length>80||seen.has(f.stage+'|'+f.family))throw error();seen.add(f.stage+'|'+f.family);return {stage:f.stage,family:f.family,value:score(f.value),confidence:'manual'};}).filter(f=>f.value!==null);
    }else if(field==='intensities'){
     if(!object(v)||Object.keys(v).some(s=>!stages.includes(s)))throw error();out[field]=Object.fromEntries(Object.entries(v).map(([s,x])=>[s,{value:score(x?.value)}]));
    }else if(field==='mouthfeel_body'){out[field]={value:score(v?.value)};}
    else if(field==='finish_duration'){out[field]={score:score(v?.score)};}
    else throw error();
   }
   const max=sensoryMax(base.find(r=>r.id===id));
   for(const field of ['features','fruit_features'])if(out[field]?.some(f=>f.value>max))throw error();
   result.edits[id]=out;
  }
  for(const [path,item] of Object.entries(value.boards)){
   if(!['/api/whisky-tree','/api/tier-maker'].includes(path)||!Number.isInteger(item?.revision)||item.revision<0)throw error();
   validateBoard(path,item.document,ids);result.boards[path]=copy(item);
  }
  return result;
 }
 function score(v){if(v!==null&&(!Number.isFinite(v)||v<0||v>5||v*2!==Math.round(v*2)))throw error();return v;}
 function validateBoard(path,d,ids){
  const tree=path.endsWith('whisky-tree'),text=(x,n=200)=>typeof x==='string'&&x.length<=n;
  if(!object(d)||d.version!==(tree?3:1)||!object(d.labels)||!Array.isArray(d.recommended)||d.recommended.some(id=>!ids.has(id))||!Array.isArray(d.boards)||!d.boards.length||d.boards.length>20)throw error();
  if(Object.entries(d.labels).some(([id,label])=>!ids.has(id)||!text(label)))throw error();
  const bids=new Set();
  for(const b of d.boards){
   if(!/^[\w-]{1,80}$/.test(b.id)||bids.has(b.id)||!text(b.name)||!b.name.trim())throw error();bids.add(b.id);
   const used=new Set();
   if(tree){
    if(!['all','bourbon','scotch','other'].includes(b.kind)||!Array.isArray(b.columns)||!b.columns.length||b.columns.length>12||b.columns.some(c=>!text(c.id,80)||!text(c.name))||new Set(b.columns.map(c=>c.id)).size!==b.columns.length||!Array.isArray(b.levels)||b.levels.length!==6||b.levels.some(l=>!text(l.name)||!text(l.price))||!Array.isArray(b.nodes)||b.nodes.length>600)throw error();
    const cells=new Set();
    for(const n of b.nodes){const cell=[n.column_id,n.level,n.slot].join('|');if(!ids.has(n.review_id)||used.has(n.review_id)||!b.columns.some(c=>c.id===n.column_id)||!Number.isInteger(n.level)||n.level<0||n.level>=6||!Number.isInteger(n.slot)||n.slot<0||n.slot>=10||cells.has(cell)||n.lineup!==undefined&&!text(n.lineup,50))throw error();used.add(n.review_id);cells.add(cell);}
   }else{
    if(!['all','bourbon','scotch','peat','energy','zero-soda'].includes(b.kind)||!object(b.tiers)||Object.keys(b.tiers).sort().join('')!=='ABCDS')throw error();
    for(const rank of ['S','A','B','C','D']){if(!Array.isArray(b.tiers[rank]))throw error();for(const id of b.tiers[rank]){if(!ids.has(id)||used.has(id))throw error();used.add(id);}}
   }
  }
 }
 async function pack(value){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(storageName)},key,new TextEncoder().encode(JSON.stringify(value))));
  const encode=b=>{let s='';for(const n of b)s+=String.fromCharCode(n);return btoa(s);};
  return JSON.stringify({version:1,scope:storageName,iv:encode(iv),data:encode(bytes)});
 }
 async function unpack(raw){
  const p=JSON.parse(raw);if(p.version!==1||p.scope!==storageName)throw error();
  const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  return clean(JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(p.iv),additionalData:new TextEncoder().encode(storageName)},key,decode(p.data)))));
 }
 async function init(data,cipher,scope){
  base=copy(data.reviews);key=cipher;storageName='taste-atlas-workspace-v1:'+scope;saved={version:1,edits:{},boards:{}};token=null;writable=!!key&&!!navigator.locks;
  if(writable)try{token=localStorage.getItem(storageName);if(token)saved=await unpack(token);}catch{writable=false;toast('브라우저 저장본을 읽지 못했습니다. 기존 저장본을 보호하기 위해 편집을 잠갔습니다.');}
  apply();
  for(const [path,item] of Object.entries(saved.boards))sharedBoards[path]=copy(item);
  document.querySelectorAll('.board-notice').forEach(el=>el.textContent=writable?'이 브라우저에 암호화하여 저장합니다. 새로고침 후에도 유지되며 PC 앱·다른 기기에는 자동 반영되지 않습니다. 데이터 & 백업에서 백업 파일을 보관하세요.':'현재 환경에서는 보드 변경을 영구 저장할 수 없습니다.');
  $('#summary').textContent=`${base.length}개 게시글 · 브라우저 작업 공간`;
  $('#workspace-note').textContent=writable?'이 브라우저에 암호화 저장 · PC 앱 및 다른 기기와 자동 동기화하지 않습니다.':'현재 환경에서는 읽기만 가능합니다. 공유 링크로 최신 브라우저에서 열어 주세요.';
  renderData();
 }
 function apply(){state.reviews=base.map(r=>{const p=saved.edits[r.id];return p?{...copy(r),...copy(p),catalog:{...copy(r.catalog),...copy(p.catalog||{})}}:copy(r);});sharedRecords=null;}
 async function commit(change){
  if(!writable)throw new Error('이 브라우저에서는 저장할 수 없습니다.');
  const work=async()=>navigator.locks.request(storageName,async()=>{
   if(localStorage.getItem(storageName)!==token)throw new Error('다른 탭에서 저장본이 변경되었습니다. 입력 내용을 별도로 보관한 뒤 새로고침하세요.');
   const next=copy(saved);change(next);const checked=clean(next),packed=await pack(checked);
   localStorage.setItem(storageName,packed);token=packed;saved=checked;apply();
  });
  const result=queue.then(work);queue=result.catch(()=>{});return result;
 }
 async function saveBoard(path,item){await commit(next=>{next.boards[path]=copy(item);});}
 function editor(r){
  if(state.mode!=='static')return '';
  const input=(label,name,value,type='text',extra='')=>`<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value??'')}" ${extra}></label>`;
  const n=(label,name,value,max=1e10,step='any')=>input(label,name,value,'number',`min="0" max="${max}" step="${step}"`);
  const families=[...new Set(r.features.map(f=>f.family))],max=sensoryMax(r);
  return `<details class="workspace-editor"><summary>내 기록 · 제품 정보 · 점수 수정</summary><form id="browser-edit" data-id="${esc(r.id)}"><p>이 브라우저에서만 적용되는 내 기록입니다. 빈칸은 미기록, 0은 실제 0점입니다.</p><fieldset ${writable?'':'disabled'}><div class="workspace-fields">${n('내 종합 별점','rating.score',r.rating?.score,5,.5)}${input('제품명','name',r.name,'text','required maxlength="500"')}${input('영문명','english',r.english)}${input('음료 분류','category',r.category)}${input('종류','catalog.primary_type',r.catalog.primary_type)}${input('국가','catalog.country',r.catalog.country)}${input('지역','catalog.region',r.catalog.region)}${input('증류소','catalog.distillery',r.catalog.distillery)}${input('숙성년수','catalog.age',r.catalog.age)}${input('캐스크 (쉼표로 구분)','catalog.casks',(r.catalog.casks||[]).join(', '))}${input('매시빌','mashbill',r.mashbill)}${n('도수 (%)','abv',r.abv,100)}${n('구매가격 (원)','price',r.price)}${n('용량 (ml)','volume',r.volume)}${n('카페인 (mg)','caffeine',r.caffeine)}${n('열량 (kcal)','calories',r.calories)}</div><label>내 메모<textarea name="memo" maxlength="10000" rows="4">${esc(r.memo||'')}</textarea></label><details><summary>향·맛·여운 세부 점수</summary><div class="workspace-fields">${stages.map(s=>n(labels[s]+' 전체 강도','intensities.'+s,r.intensities?.[s]?.value,5,.5)).join('')}${n('맛의 바디','mouthfeel_body',r.mouthfeel_body?.value,5,.5)}${n('여운 길이 점수','finish_duration',r.finish_duration?.score,5,.5)}</div><div class="workspace-score-grid">${stages.map(s=>`<section><h4>${labels[s]}</h4>${families.map(f=>n(f,'features|'+s+'|'+f,r.features.find(x=>x.stage===s&&x.family===f)?.value,max,.5)).join('')}${r.fruit_features.filter(f=>f.stage===s).map(f=>n(f.family,'fruit_features|'+s+'|'+f.family,f.value,max,.5)).join('')}</section>`).join('')}</div></details><button class="action-button primary" type="submit">이 브라우저에 저장</button><button class="quiet-button" type="button" data-revert="${esc(r.id)}">이 제품을 게시본으로 복원</button></fieldset><p class="workspace-message" role="status"></p></form></details>`;
 }
 async function saveForm(form){
  const r=state.reviews.find(r=>r.id===form.dataset.id),patch={},features={features:[],fruit_features:[]};
  for(const el of form.elements){
   if(!el.name)continue;const name=el.name,v=el.type==='number'?(el.value===''?null:Number(el.value)):el.value;
   if(name.includes('|')){const [field,stage,family]=name.split('|');if(v!==null)features[field].push({stage,family,value:v});continue;}
   if(name.startsWith('catalog.')){const f=name.slice(8),value=f==='casks'?v.split(',').map(s=>s.trim()).filter(Boolean):v;if(JSON.stringify(value)!==JSON.stringify(r.catalog[f]??''))(patch.catalog||={})[f]=value;}
   else if(name==='rating.score'){if(v!==(r.rating?.score??null))patch.rating={...r.rating,score:v};}
   else if(name.startsWith('intensities.')){const s=name.split('.')[1];if(v!==(r.intensities?.[s]?.value??null))(patch.intensities||=copy(r.intensities))[s]={value:v};}
   else if(name==='mouthfeel_body'||name==='finish_duration'){const f=name==='mouthfeel_body'?'value':'score';if(v!==(r[name]?.[f]??null))patch[name]={[f]:v};}
   else if(v!==(r[name]??''))patch[name]=v;
  }
  const normalized=a=>JSON.stringify(a.map(({stage,family,value})=>({stage,family,value})).sort((a,b)=>(a.stage+a.family).localeCompare(b.stage+b.family)));
  for(const field of Object.keys(features))if(normalized(features[field])!==normalized(r[field]))patch[field]=features[field];
  await commit(next=>{const old=next.edits[r.id]||{};next.edits[r.id]={...old,...patch,...(patch.catalog?{catalog:{...old.catalog,...patch.catalog}}:{})};});
  await refresh();await openDetail(r.id);$('#browser-edit').closest('details').open=true;$('#browser-edit .workspace-message').textContent='저장했습니다.';
 }
 async function refresh(){
  state.page=1;for(const [sel,values] of [['#type',state.reviews.map(r=>r.catalog.primary_type)],['#cask',state.reviews.flatMap(r=>r.catalog.casks||[])],['#subtype',state.reviews.flatMap(r=>r.catalog.subtypes||[])]]){const previous=$(sel).value;$(sel).length=1;fillOptions(sel,values);$(sel).value=previous;}
  $('#rec-category').innerHTML='';fillOptions('#rec-category',state.reviews.filter(r=>!r.is_collection).map(r=>r.category));refreshRecommendationInputs();
  WhiskyJourney.reset();WhiskyJourney.mount($('#whisky-journey'),state.reviews,id=>openDetail(id),{photo,hydrateImages});await render();renderData();
 }
 function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 function csv(rows){return '\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+@\t\r-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');}
 function renderData(){
  if(!$('#workspace-rows'))return;
  const q=$('#workspace-search').value.toLowerCase(),mode=$('#workspace-kind').value;
  const rows=state.reviews.filter(r=>(mode!=='notes'||r.memo||r.rating?.score!=null)&&(mode!=='collections'||r.is_collection)&&[r.name,r.english,r.memo].join(' ').toLowerCase().includes(q));
  $('#workspace-count').textContent=`${rows.length}개 게시글 · 내 수정 ${Object.keys(saved.edits).length}개`;
  $('#workspace-rows').innerHTML=rows.map(r=>`<tr><td>${esc(r.published)}</td><td><button class="name-button" data-open="${esc(r.id)}">${esc(r.name)}</button></td><td>${esc(r.catalog.primary_type)}</td><td>${number(r.price,'원')}</td><td>${r.rating?.score==null?'—':'★ '+r.rating.score}</td><td class="workspace-memo">${esc(r.memo||'')}</td></tr>`).join('');
 }
 function showMap(){
  // Discovery axes expects a category; collect actual profile axes across all records.
  const all=[...new Set(state.reviews.flatMap(r=>Object.keys(Discovery.profile(r,'all'))))].sort();
  for(const sel of ['#map-x','#map-y'])if(!$(sel).options.length)fillOptions(sel,all);
  if($('#map-x').value===$('#map-y').value&&all.length>1)$('#map-y').selectedIndex=1;
  drawMap();
 }
 function drawMap(){
  const x=$('#map-x').value,y=$('#map-y').value,stage=$('#map-stage').value;
  const points=state.reviews.filter(r=>!r.is_collection).map(r=>({r,p:Discovery.profile(r,stage)})).filter(({p})=>Number.isFinite(p[x])&&Number.isFinite(p[y]));
  $('#map-points').innerHTML=points.map(({r,p})=>`<button type="button" class="map-dot" data-open="${esc(r.id)}" style="left:${p[x]/5*100}%;bottom:${p[y]/5*100}%" aria-label="${esc(r.name)}: ${esc(x)} ${p[x]}, ${esc(y)} ${p[y]}" title="${esc(r.name)}">●</button>`).join('');
  $('#map-caption').textContent=`가로: ${x} · 세로: ${y} · 0~5 · ${points.length}개 (두 축에 기록이 있는 제품)`;
  $('#map-list').innerHTML=points.map(({r,p})=>`<button class="action-button" data-open="${esc(r.id)}">${esc(r.name)} · ${p[x].toFixed(1)} / ${p[y].toFixed(1)}</button>`).join('');
 }
 function wire(){
  $('#detail-content').addEventListener('submit',async e=>{if(e.target.id!=='browser-edit')return;e.preventDefault();const f=e.target,button=f.querySelector('[type=submit]');button.disabled=true;try{await saveForm(f);}catch(err){f.querySelector('.workspace-message').textContent=err.message;}finally{button.disabled=false;}});
  $('#detail-content').addEventListener('click',async e=>{const b=e.target.closest('[data-revert]');if(!b||!confirm('이 제품의 브라우저 수정과 내 기록을 지우고 게시본으로 돌아갈까요?'))return;try{await commit(n=>{delete n.edits[b.dataset.revert];});await refresh();await openDetail(b.dataset.revert);}catch(err){$('#browser-edit .workspace-message').textContent=err.message;}});
  $('#workspace-search').addEventListener('input',renderData);$('#workspace-kind').addEventListener('change',renderData);
  $('#workspace-backup').onclick=async()=>{try{await queue;if(!key)throw error();download('TasteAtlas-browser-backup.json',await pack(saved),'application/json');toast('암호화 백업을 저장했습니다. 복원에는 같은 공유 링크가 필요합니다.');}catch(e){toast(e.message);}};
  $('#workspace-restore').onchange=async e=>{const f=e.target.files[0];try{if(!f)return;if(f.size>8e6)throw error();const next=await unpack(await f.text());if(!confirm(`내 기록 ${Object.keys(next.edits).length}개와 보드를 백업 내용으로 교체할까요? 현재 기록은 먼저 백업하세요.`))return;await commit(n=>{n.edits=next.edits;n.boards=next.boards;});location.reload();}catch(err){toast('복원하지 않았습니다. '+err.message);}finally{e.target.value='';}};
  $('#workspace-csv').onclick=()=>download('TasteAtlas-reviews.csv',csv([['ID','게시일','제품명','분류','종류','구매가격','도수','내 별점','내 메모'],...state.reviews.map(r=>[r.id,r.published,r.name,r.category,r.catalog.primary_type,r.price,r.abv,r.rating?.score,r.memo])]),'text/csv;charset=utf-8');
  for(const sel of ['#map-x','#map-y','#map-stage'])$(sel).addEventListener('change',drawMap);
 }
 return {init,editor,saveBoard,showMap,renderData,wire,download,csv,get writable(){return writable;},async updateEdits(edits){await commit(n=>{for(const [id,p] of Object.entries(edits))n.edits[id]={...n.edits[id],...p};});await refresh();},score};
})();
