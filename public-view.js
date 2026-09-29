'use strict';
const $=s=>document.querySelector(s);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sentenceText=value=>String(value??'').trim().split(/(?<=[.!?])\s+/).filter(Boolean).map(text=>`<span class="sentence">${esc(text)}</span>`).join(' ');
const number=(value,suffix='')=>value===null||value===undefined||value===''?'미확인':Number(value).toLocaleString('ko-KR')+suffix;
const state={reviews:[],mode:'server',profileEditsIncluded:false,encryptedAssets:{},page:1,pages:0,total:0,request:0,detailRequest:0,view:'library',compare:[]};
let encryptedConfig=null,archiveKey=null,unlockBusy=false;
const imageCache=new Map();
async function decryptFile(url){
  if(!archiveKey||!/^\.\/(data|assets)\/[a-f0-9]{32}\.bin$/.test(url))throw new Error('Invalid encrypted asset');
  const response=await fetch(url,{cache:'no-cache',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error('Encrypted file unavailable');
  const packed=new Uint8Array(await response.arrayBuffer());
  if(packed.length<28)throw new Error('Invalid encrypted file');
  return crypto.subtle.decrypt({name:'AES-GCM',iv:packed.slice(0,12),tagLength:128,additionalData:new TextEncoder().encode('MARTIANQUIP:encrypted-link:v1:'+url.slice(2))},archiveKey,packed.slice(12));
}
function imageAttributes(url){
  if(encryptedConfig){
    if(/^\.\/assets\/[a-f0-9]{32}\.bin$/.test(url)&&Object.hasOwn(state.encryptedAssets,url))return `data-encrypted-src="${esc(url)}"`;
    return /^https:\/\//i.test(url||'')&&safeImage(url)?`src="${esc(url)}"`:'';
  }
  const safe=safeImage(url);return safe?`src="${esc(safe)}"`:'';
}
function hydrateImages(root){
  root.querySelectorAll('img[data-encrypted-src]').forEach(img=>{
    const url=img.dataset.encryptedSrc,mime=state.encryptedAssets[url];
    if(!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(mime||''))return;
    if(!imageCache.has(url))imageCache.set(url,decryptFile(url).then(bytes=>URL.createObjectURL(new Blob([bytes],{type:mime}))));
    imageCache.get(url).then(blob=>{if(img.isConnected)img.src=blob;}).catch(()=>{if(img.isConnected)img.outerHTML='<div class="photo-placeholder"><small>사진을 열 수 없습니다</small></div>';});
  });
}
async function unlockArchive(value){
  if(unlockBusy)return;unlockBusy=true;$('#unlock').disabled=true;
  try{
    let key=value.trim();if(!/^[A-Za-z0-9_-]{43}$/.test(key))key=new URLSearchParams(new URL(key).hash.slice(1)).get('key')||'';
    if(!/^[A-Za-z0-9_-]{43}$/.test(key))throw new Error('Invalid invite');
    const raw=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')+'='),c=>c.charCodeAt(0));
    archiveKey=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
    const data=JSON.parse(new TextDecoder().decode(await decryptFile(encryptedConfig.catalog_url)));
    if(!Array.isArray(data.reviews)||!data.encrypted_assets)throw new Error('Invalid catalog');
    state.encryptedAssets=data.encrypted_assets;
    await startArchive(data);
    history.replaceState(null,'',location.pathname+location.search+'#key='+key);
    $('.brand').href=location.pathname+location.search+'#key='+key;
    $('#invite-key').value='';$('#access-gate').hidden=true;$('#archive').hidden=false;
  }catch{
    archiveKey=null;state.reviews=[];$('#archive').hidden=true;$('#access-gate').hidden=false;
    $('#gate-message').textContent='링크가 올바르지 않거나 데이터를 열 수 없습니다. 전달받은 전체 링크를 다시 확인해 주세요.';
  }finally{unlockBusy=false;$('#unlock').disabled=false;}
}
const labels={nose:'향',palate:'맛',finish:'여운'};
const badge=text=>`<span class="badge">${esc(text)}</span>`;
function safeImage(url){try{const parsed=new URL(url,location.href);return url&&((parsed.origin===location.origin&&url.startsWith('./assets/'))||parsed.protocol==='https:')?url:'';}catch{return '';}}
function photo(record,large=false){const attrs=imageAttributes(record.catalog.photo_url);return attrs?`<img class="product-photo${large?' large':''}" ${attrs} alt="${esc(record.name)} 제품 사진" loading="lazy" referrerpolicy="no-referrer">`:`<div class="photo-placeholder${large?' large':''}" aria-label="제품 사진 미확인"><span>▱</span><small>사진 미확인</small></div>`;}
$('#whisky-journey').addEventListener('error',event=>{if(event.target.matches?.('.wj-photo img'))event.target.outerHTML='<span class="photo-placeholder">사진 미확인</span>';},true);
function fillOptions(selector,values){const select=$(selector);[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko')).forEach(value=>select.add(new Option(value,value)));}
function reviewScore(record){const value=record.liking_estimates?.score?.value;return Number.isFinite(value)?value:null;}
function compareReviews(a,b,sort){
  if(sort==='price_asc'||sort==='price_desc')return Discovery.comparePurchasePrice(a,b,sort);
  if(sort==='rating_desc'||sort==='rating_asc'){
    const left=reviewScore(a),right=reviewScore(b);
    if((left===null)!==(right===null))return left===null?1:-1;
    if(left!==null&&left!==right)return (sort==='rating_asc'?1:-1)*(left-right);
  }
  const leftDate=a.published||'',rightDate=b.published||'';
  if(leftDate!==rightDate)return leftDate>rightDate?-1:1;
  return String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0;
}
async function requestJson(url,options){const response=await fetch(url,{cache:'no-cache',...options});const result=await response.json();if(!response.ok)throw new Error(result.error||'요청을 처리하지 못했습니다.');return result;}
function showCounters(data){for(const [id,key] of [['total-visitors','total_visitors'],['today-visitors','today_visitors'],['total-views','total_views'],['today-views','today_views']])$('#'+id).textContent=data&&Number.isFinite(data[key])?data[key].toLocaleString('ko-KR'):'연결 안됨';$('#analytics-status').textContent=data?'브라우저 쿠키 기준 · 오늘은 한국 시간':'방문자 집계 연결 안됨';}
let analyticsQueue=Promise.resolve();
function trackView(page){if(state.mode!=='server'){showCounters(null);return Promise.resolve();}const eventId=crypto.randomUUID();analyticsQueue=analyticsQueue.then(async()=>{try{const data=await requestJson('./api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page,event_id:eventId})});showCounters(data);}catch{showCounters(null);}});return analyticsQueue;}
async function render(){
  const version=++state.request;
  const query=$('#search').value.trim().toLowerCase(),type=$('#type').value,cask=$('#cask').value,subtype=$('#subtype').value,sort=$('#sort').value;
  $('#sort-note').textContent=sort.startsWith('price_')?'가격 정렬 기준: 리뷰 당시 구매가격 · 미확인 제품은 마지막':'별점 정렬 기준: 추정 종합 별점 · 미평가 제품은 마지막';
  let rows;
  try{if(state.mode==='server'){const params=new URLSearchParams({page:String(state.page),limit:'24',q:query,type,cask,subtype,sort});const data=await requestJson('./api/public/catalog?'+params);if(version!==state.request)return;rows=data.reviews;state.total=data.total;state.pages=data.pages;}else{const all=state.reviews.filter(r=>!r.is_collection&&(!type||r.catalog.primary_type===type)&&(!cask||r.catalog.casks?.includes(cask))&&(!subtype||r.catalog.subtypes?.includes(subtype))&&(!query||[r.name,r.english,r.catalog.country,r.catalog.region,r.catalog.distillery].join(' ').toLowerCase().includes(query)));all.sort((a,b)=>compareReviews(a,b,sort));state.total=all.length;state.pages=Math.ceil(all.length/24);rows=all.slice((state.page-1)*24,state.page*24);}}catch(error){if(version!==state.request)return;$('#cards').innerHTML=`<div class="empty"><h3>${esc(error.message)}</h3><p>잠시 후 다시 시도해 주세요.</p></div>`;$('#count').textContent='연결 안됨';return;}
  $('#count').textContent=`${state.total}개 제품`;
  $('#page-label').textContent=state.pages?`${state.page} / ${state.pages} 페이지`:'0개 제품';$('#previous-page').disabled=state.page<=1;$('#next-page').disabled=state.page>=state.pages;
  $('#cards').innerHTML=rows.length?rows.map(r=>{const c=r.catalog;const draft=reviewScore(r);return `<article class="review-card" data-id="${esc(r.id)}"><button class="card-open" data-open="${esc(r.id)}" type="button"><div class="card-photo">${photo(r)}<span class="type-badge">${esc(c.primary_type)}</span></div><div class="card-copy"><div class="card-origin">${esc(c.origin||c.country||'원산지 미확인')}</div><h3>${esc(r.name)}</h3><p class="english">${esc(r.english)}</p><div class="card-tags">${(c.casks||[]).slice(0,3).map(badge).join('')}</div><p class="card-price">구매가 ${number(Discovery.purchasePrice(r),'원')}</p><div class="card-bottom"><span>${number(r.abv,'%')} · ${number(r.volume,' ml')}</span><span>${draft==null?'평가 근거 부족':`추정 ★ ${Number(draft).toFixed(1)}`}</span></div></div></button>${state.mode==='static'?`<div class="card-actions">${compareButton(r)}</div>`:''}</article>`;}).join(''):'<div class="empty"><h3>해당하는 리뷰가 없습니다.</h3><p>검색어나 분류를 조금 넓혀 보세요.</p></div>';
  $('#cards').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.outerHTML='<div class="photo-placeholder"><span>▱</span><small>사진을 불러오지 못했습니다</small></div>';},{once:true}));
  hydrateImages($('#cards'));
}
function stageProfile(record,stage){
  const fruits=record.fruit_features.filter(f=>f.stage===stage).map(f=>({...f,fruit:true}));
  const core=record.features.filter(f=>f.stage===stage&&!['과일','시트러스'].includes(f.family));
  const features=[...fruits,...core].sort((a,b)=>b.value-a.value);
  return `<section class="stage"><h4>${labels[stage]} <small>${stage.toUpperCase()}</small></h4>${features.length?features.map(f=>`<div class="flavor-row${f.fruit?' fruit':''}"><span>${esc(f.family)}</span><div class="flavor-track"><i style="width:${Math.max(0,Math.min(100,f.value/4.5*100))}%"></i></div><b>${Number(f.value).toFixed(1)}</b></div>`).join(''):'<p class="unknown">이 단계의 세부 노트 근거가 부족합니다.</p>'}</section>`;
}
async function openDetail(id){
  const version=++state.detailRequest;let record;
  try{record=state.mode==='server'?await requestJson('./api/public/reviews/'+encodeURIComponent(id)):state.reviews.find(r=>r.id===id);}catch(error){$('#count').textContent=error.message;return;}if(version!==state.detailRequest||!record)return;const c=record.catalog;
  const color=/^#[0-9a-f]{6}$/i.test(c.color_hex||'')?c.color_hex:null;
  const icon=imageAttributes(c.airing_icon);
  const info=[['구매가격',number(record.price,'원')],['용량',number(record.volume,' ml')],['도수',number(record.abv,'%')],['잔당가격',`${number(c.serving_price,'원')} / ${number(c.serving_ml,' ml')}${c.serving_price_method==='derived'?' · 계산값':''}`],['종류',[c.primary_type,...(c.subtypes||[])].filter(Boolean).join(' · ')],['캐스크',(c.casks||[]).join(' · ')],['숙성년수',c.age],['색',c.color],['생산국가',c.country],['지역',c.region],['증류소',c.distillery],['소유주',c.owner],['시음 형태',c.sample_type]];
  $('#detail-content').innerHTML=`<div class="detail-top"><div class="detail-photo">${photo(record,true)}</div><div><p class="eyebrow">${esc(c.origin||c.primary_type)}</p><h2>${esc(record.name)}</h2><p class="english">${esc(record.english)}</p><div class="card-tags">${(c.subtypes||[]).map(badge).join('')}</div><p class="review-date">${esc(record.published||'')}의 리뷰</p>${record.source_url?`<a class="source-link" href="${esc(record.source_url)}" target="_blank" rel="noopener noreferrer">블로그 원문 읽기 ↗</a>`:''}</div></div><div class="color-airing"><div>${color?`<span class="color-swatch" style="background:${color}"></span>`:''}<b>${esc(c.color||'용액 색 미확인')}</b><small>${color?'원문에 표시한 색':'확인된 색상 정보만 표시합니다'}</small></div><div>${icon?`<img ${icon} alt="잔량 ${number(c.airing_remaining,'%')} 아이콘">`:''}<b>에어링 · ${c.airing_remaining==null?'미확인':`잔량 ${number(c.airing_remaining,'%')}`}</b></div></div><dl class="product-info">${info.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value||'미확인')}</dd></div>`).join('')}</dl><section class="profile-section"><div class="section-heading"><h3>향 · 맛 · 여운 프로파일</h3><span>${state.profileEditsIncluded ? "작성자 보정 반영" : "원문 기반 추정"} · 0.5~4.5</span></div><p class="chart-key"><i></i> 구체적인 과일 노트 <i class="core"></i> 그 밖의 향미</p><div class="stages">${Object.keys(labels).map(stage=>stageProfile(record,stage)).join('')}</div></section><section class="strength-section"><div class="section-heading"><h3>감각의 전체 강도</h3><span>만족도와 별개 · 0~5</span></div>${Object.keys(labels).map(stage=>{const value=record.intensities[stage]?.value;return `<div class="strength-row"><span>${labels[stage]}</span><div class="strength-track"><i style="width:${value==null?0:Math.max(0,Math.min(100,value/5*100))}%"></i></div><b>${value==null?'—':Number(value).toFixed(1)}</b></div>`;}).join('')}<div class="strength-scale"><span>0 · 약함</span><span>5 · 강함</span></div></section><section class="liking-section"><div class="section-heading"><h3>만족도 초안</h3><span>평가 표현을 바탕으로 추정</span></div><div class="liking-values">${[...Object.keys(labels),'score'].map(stage=>`<div><span>${labels[stage]||'종합'}</span><b>${record.liking_estimates[stage]?.value==null?'—':'★ '+Number(record.liking_estimates[stage].value).toFixed(1)}</b></div>`).join('')}</div><p><span class="sentence">풍미가 강하다고 만족도가 높아지는 것은 아닙니다.</span> <span class="sentence">개인 별점은 공개하지 않습니다.</span></p></section>`;
  if(state.mode==='static')$('#detail-content .detail-top').insertAdjacentHTML('afterend',`<div class="detail-actions">${compareButton(record)}<button type="button" class="action-button primary" data-recommend="${esc(id)}">이 제품과 비슷한 한 잔</button></div>`);
  hydrateImages($('#detail-content'));if(!$('#detail').open)$('#detail').showModal();$('#detail').scrollTop=0;trackView('/review/'+id);
}
function compareButton(record){
  const selected=state.compare.includes(record.id);
  return `<button type="button" class="action-button" data-compare="${esc(record.id)}" aria-pressed="${selected}" aria-label="${esc(record.name)} ${selected?'비교에서 제외':'비교에 담기'}">${selected?'✓ 비교에 담음':'＋ 비교에 담기'}</button>`;
}
function showView(view){
  if(state.mode!=='static'||!['library','recommend','compare'].includes(view))return;
  state.view=view;$('#discovery-status').textContent='';
  document.querySelectorAll('[data-view-panel]').forEach(panel=>panel.hidden=panel.dataset.viewPanel!==view);
  document.querySelectorAll('#discovery-nav [data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===view)));
  if(view==='compare')renderComparison();
  updateCompareControls();
  const heading=$('#'+view+'-view');heading.focus({preventScroll:true});
  $('#discovery-nav').scrollIntoView({block:'start',behavior:'instant'});
}
function updateCompareControls(){
  $('#compare-count').textContent=state.compare.length;
  $('#tray-summary').textContent=`${state.compare.length} / 3개 선택`;
  $('#compare-tray').hidden=state.mode!=='static'||!state.compare.length||state.view==='compare';
  document.querySelectorAll('[data-compare]').forEach(button=>{
    const selected=state.compare.includes(button.dataset.compare),record=state.reviews.find(r=>r.id===button.dataset.compare);
    button.setAttribute('aria-pressed',String(selected));button.textContent=selected?'✓ 비교에 담음':'＋ 비교에 담기';
    button.setAttribute('aria-label',`${record?.name||'제품'} ${selected?'비교에서 제외':'비교에 담기'}`);
  });
}
function toggleCompare(id){
  if(state.mode!=='static'||!state.reviews.some(r=>r.id===id&&!r.is_collection))return;
  const index=state.compare.indexOf(id);
  if(index>=0)state.compare.splice(index,1);
  else if(state.compare.length<3)state.compare.push(id);
  else{
    $('#discovery-status').textContent='최대 3개까지 비교할 수 있습니다. 담긴 제품을 먼저 제외해 주세요.';
    if($('#detail').open){$('#detail').close();showView('compare');$('#discovery-status').textContent='최대 3개까지 비교할 수 있습니다. 담긴 제품을 먼저 제외해 주세요.';}
    return;
  }
  $('#discovery-status').textContent=`비교할 제품 ${state.compare.length}개를 선택했습니다.`;
  updateCompareControls();if(state.view==='compare')renderComparison();
}
function clearComparison(){state.compare=[];updateCompareControls();renderComparison();$('#discovery-status').textContent='비교 목록을 비웠습니다.';}
function strengthBars(record){
  return `<h4>향 · 맛 · 여운 전체 강도</h4><p class="unknown">향미 구성·만족도와 별개 · 0~5</p>${Object.keys(labels).map(stage=>{const value=record.intensities?.[stage]?.value,known=Number.isFinite(value)&&value>=0&&value<=5;return `<div class="strength-row"><span>${labels[stage]}</span><div class="strength-track"><i style="width:${known?value/5*100:0}%"></i></div><b>${known?value.toFixed(1):'—'}</b></div>`;}).join('')}`;
}
function renderComparison(){
  const rows=state.compare.map(id=>state.reviews.find(r=>r.id===id)).filter(Boolean),stage=$('#compare-stage').value;
  $('#clear-compare').disabled=!rows.length;
  if(!rows.length){$('#comparison-content').innerHTML='<div class="empty"><h3>비교할 한 잔을 담아주세요.</h3><p>리뷰 카드의 ‘비교에 담기’를 눌러 최대 3개를 선택하세요.</p><button type="button" class="action-button primary" data-view="library">리뷰 서재에서 고르기</button></div>';return;}
  const profiles=rows.map(r=>Discovery.profile(r,stage));
  const axes=[...new Set(profiles.flatMap(p=>Object.keys(p)))].sort((a,b)=>Math.max(...profiles.map(p=>p[b]??-1))-Math.max(...profiles.map(p=>p[a]??-1))||a.localeCompare(b,'ko'));
  const mixed=new Set(rows.map(r=>r.category)).size>1;
  $('#comparison-content').innerHTML=`<p class="comparison-note">${stage==='all'?'전체 프로파일은 기록된 향·맛·여운 값의 평균입니다.':'선택한 단계의 향미를 비교합니다.'} 같은 향미를 같은 줄에 표시합니다. —는 미확인이며 0점이 아닙니다.${mixed?' 서로 다른 음료 종류가 함께 선택되어 있으므로 향미 표현을 참고해 비교해 주세요.':''}</p><div class="comparison-grid" style="--compare-columns:${rows.length}" role="region" aria-label="선택한 제품 비교표" tabindex="0">${rows.map((record,index)=>{
    const c=record.catalog,p=profiles[index],score=reviewScore(record);
    const meta=[['종류',[c.primary_type,...(c.subtypes||[])].filter(Boolean).join(' · ')],['캐스크',(c.casks||[]).join(' · ')],['구매가격',number(record.price,'원')],['잔당가격',`${number(c.serving_price,'원')} / ${number(c.serving_ml,' ml')}${c.serving_price_method==='derived'?' · 계산값':''}`],['용량',number(record.volume,' ml')],['도수',number(record.abv,'%')],['숙성년수',c.age],['국가 / 지역',[c.country,c.region].filter(Boolean).join(' / ')],['증류소',c.distillery],['시음 형태',c.sample_type],['카페인',number(record.caffeine,' mg')],['열량',number(record.calories,' kcal')]];
    return `<article class="comparison-card"><div class="comparison-photo">${photo(record)}</div><button class="action-button" type="button" data-remove-compare="${esc(record.id)}" aria-label="${esc(record.name)} 비교에서 제외">비교에서 제외 ×</button><h3><button type="button" class="name-button" data-open="${esc(record.id)}">${esc(record.name)}</button></h3><p class="english">${esc(record.english)}</p><p class="comparison-rating">${score===null?'만족도 근거 부족':`추정 종합 ★ ${score.toFixed(1)}`}</p><dl class="comparison-meta">${meta.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value||'미확인')}</dd></div>`).join('')}</dl><section class="comparison-flavors"><h4>${labels[stage]||'전체'} 향미 프로파일</h4><p class="unknown">향미의 두드러짐 · 0.5~4.5</p>${axes.length?axes.map(axis=>{const value=p[axis],known=Number.isFinite(value);return `<div class="compare-flavor-row"><span>${esc(axis)}</span><div class="flavor-track"><i style="width:${known?Math.max(0,Math.min(100,value/4.5*100)):0}%"></i></div><b>${known?value.toFixed(1):'—'}</b></div>`;}).join(''):'<p class="unknown">이 단계의 향미 정보가 없습니다.</p>'}</section><section class="comparison-strength">${strengthBars(record)}</section><button type="button" class="action-button primary" data-recommend="${esc(record.id)}">이 제품과 비슷한 한 잔</button></article>`;
  }).join('')}</div>`;
  hydrateImages($('#comparison-content'));
}
function resetRecommendation(){
  $('#recommend-results').innerHTML='<div class="empty"><h3>어떤 한 잔에서 출발할까요?</h3><p>조건을 고른 뒤 ‘취향 추천받기’를 눌러 주세요.</p></div>';
}
function refreshRecommendationInputs(){
  const category=$('#rec-category').value,stage=$('#rec-stage').value,previous=$('#rec-seed').value;
  const rows=state.reviews.filter(r=>!r.is_collection&&r.category===category&&Object.values(Discovery.profile(r,stage)).some(v=>v>0)).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  $('#rec-seed').innerHTML='<option value="">기준 제품을 선택하세요</option>'+rows.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  if(rows.some(r=>r.id===previous))$('#rec-seed').value=previous;
  const axes=Discovery.axes(state.reviews,category,stage);
  $('#flavor-inputs').innerHTML=axes.length?axes.map((axis,index)=>`<label class="flavor-input" for="flavor-${index}"><span>${esc(axis)}</span><output for="flavor-${index}">0</output><input id="flavor-${index}" type="range" min="0" max="4.5" step="0.5" value="0" data-flavor="${esc(axis)}" aria-label="${esc(axis)} 원하는 두드러짐"></label>`).join(''):'<p class="unknown">이 분류·단계에는 사용할 수 있는 향미 정보가 없습니다.</p>';
  updateRecommendationMode();resetRecommendation();
}
function updateRecommendationMode(){
  const custom=$('#rec-mode').value==='custom';$('#custom-flavors').hidden=!custom;
  $('#rec-seed').disabled=custom;$('#rec-seed').required=!custom;
}
function runRecommendation(){
  const mode=$('#rec-mode').value,seed=$('#rec-seed').value;
  if(mode!=='custom'&&!seed){$('#recommend-results').innerHTML='<div class="empty"><h3>기준 제품을 먼저 선택해 주세요.</h3><p>좋아하는 제품에서 출발해 향미가 겹치는 다른 제품을 찾습니다.</p></div>';return;}
  const weights=Object.fromEntries([...document.querySelectorAll('[data-flavor]')].map(input=>[input.dataset.flavor,Number(input.value)]));
  const result=Discovery.recommend(state.reviews,{category:$('#rec-category').value,seed,mode,stage:$('#rec-stage').value,weights});
  const seedName=state.reviews.find(r=>r.id===seed)?.name;
  const title=mode==='custom'?'선택한 향미에서 찾은 한 잔':`${seedName||'기준 제품'}에서 ${mode==='explore'?'한 걸음 다른 취향':'이어지는 취향'}`;
  $('#recommend-results').innerHTML=result.items.length?`<div class="section-heading"><h3>${esc(title)}</h3><span>${result.items.length}개 추천</span></div><p class="recommend-method">${sentenceText(result.reason+' 개인 별점이나 추정 만족도는 추천에 사용하지 않습니다.')}</p>${result.items.map(({record,score,shared},index)=>`<article class="recommend-card"><div class="recommend-photo">${photo(record)}</div><div class="recommend-info"><p class="eyebrow">${String(index+1).padStart(2,'0')} · ${esc(record.catalog.primary_type)}</p><h3><button class="name-button" type="button" data-open="${esc(record.id)}">${esc(record.name)}</button></h3><p class="english">${esc(record.english)}</p><p>함께 나타나는 향미: <strong>${shared.map(esc).join(' · ')}</strong></p><div class="card-tags">${(record.catalog.casks||[]).map(badge).join('')}</div><div class="detail-actions"><button class="action-button" type="button" data-open="${esc(record.id)}">프로파일 살펴보기</button>${compareButton(record)}</div></div><div class="match-score"><b>${score}</b><span>${mode==='explore'?'탐색 지수':'향미 유사도'} / 100</span></div></article>`).join('')}`:`<div class="empty"><h3>추천할 제품을 찾지 못했습니다.</h3><p>${esc(result.reason)}</p></div>`;
  hydrateImages($('#recommend-results'));
}
function recommendFrom(id){
  const record=state.reviews.find(r=>r.id===id);if(!record)return;
  state.detailRequest++;$('#detail').close();$('#rec-category').value=record.category;$('#rec-mode').value='similar';$('#rec-stage').value='all';
  refreshRecommendationInputs();$('#rec-seed').value=id;$('#classic-recommendation').open=true;showView('recommend');runRecommendation();
}
function discoveryClick(event){
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.open)openDetail(button.dataset.open);
  if(button.dataset.view)showView(button.dataset.view);
  if(button.dataset.compare)toggleCompare(button.dataset.compare);
  if(button.dataset.removeCompare)toggleCompare(button.dataset.removeCompare);
  if(button.dataset.recommend)recommendFrom(button.dataset.recommend);
}
$('#archive').addEventListener('click',discoveryClick);
$('#detail-content').addEventListener('click',discoveryClick);
$('#compare-stage').addEventListener('change',renderComparison);
$('#clear-compare').addEventListener('click',clearComparison);
$('#tray-clear').addEventListener('click',clearComparison);
$('#rec-category').addEventListener('change',refreshRecommendationInputs);
$('#rec-stage').addEventListener('change',refreshRecommendationInputs);
$('#rec-mode').addEventListener('change',()=>{updateRecommendationMode();resetRecommendation();});
$('#rec-seed').addEventListener('change',resetRecommendation);
$('#flavor-inputs').addEventListener('input',event=>{if(event.target.matches('[data-flavor]')){event.target.closest('label').querySelector('output').textContent=event.target.value;resetRecommendation();}});
$('#recommend-form').addEventListener('submit',event=>{event.preventDefault();runRecommendation();});
$('#close-detail').addEventListener('click',()=>{state.detailRequest++;$('#detail').close();});
$('#detail').addEventListener('click',event=>{if(event.target===$('#detail')){state.detailRequest++;$('#detail').close();}});
$('#reset').addEventListener('click',()=>{['#search','#type','#cask','#subtype'].forEach(selector=>$(selector).value='');$('#sort').value='newest';state.page=1;render();});
let searchTimer;
['#search','#type','#cask','#subtype','#sort'].forEach(selector=>$(selector).addEventListener(selector==='#search'?'input':'change',()=>{state.page=1;clearTimeout(searchTimer);if(selector==='#search')searchTimer=setTimeout(render,250);else render();}));
$('#previous-page').addEventListener('click',()=>{if(state.page>1){state.page--;render();}});
$('#next-page').addEventListener('click',()=>{if(state.page<state.pages){state.page++;render();}});
$('#invite-form').addEventListener('submit',event=>{event.preventDefault();if(encryptedConfig)unlockArchive($('#invite-key').value);});
async function startArchive(data){
  state.page=1;
  ['#type','#cask','#subtype'].forEach(selector=>{const select=$(selector);while(select.options.length>1)select.remove(1);});
  if(state.mode==='server'){fillOptions('#type',data.options.primary_type);fillOptions('#cask',data.options.casks);fillOptions('#subtype',data.options.subtypes);}else{state.reviews=data.reviews;data.count=state.reviews.filter(r=>!r.is_collection).length;fillOptions('#type',state.reviews.map(r=>r.catalog.primary_type));fillOptions('#cask',state.reviews.flatMap(r=>r.catalog.casks||[]));fillOptions('#subtype',state.reviews.flatMap(r=>r.catalog.subtypes||[]));showCounters(null);}
  $('#summary').textContent=`${data.count}개 제품 · 읽기 전용 아카이브`;
  $('#discovery-nav').hidden=state.mode!=='static';
  if(state.mode==='static'){
    $('#rec-category').innerHTML='';fillOptions('#rec-category',state.reviews.filter(r=>!r.is_collection).map(r=>r.category));
    if(state.reviews.some(r=>r.category==='위스키'))$('#rec-category').value='위스키';
    refreshRecommendationInputs();updateCompareControls();
    WhiskyJourney.reset();WhiskyJourney.mount($('#whisky-journey'),state.reviews,id=>openDetail(id),{photo,hydrateImages});
  }
  if(state.profileEditsIncluded)$('.method-note').innerHTML=sentenceText('향미와 전체 강도에는 작성자가 수정한 값이 반영되며, 수정하지 않은 항목은 원문 기반 추정입니다. 향미는 0.5~4.5, 전체 강도는 0~5의 별도 척도입니다. 만족도는 원문 기반 추정이며 개인 별점·메모는 공개하지 않습니다.');
  $('#updated').textContent=`데이터 생성 ${new Date(data.generated_at).toLocaleDateString('ko-KR')}`;await render();trackView('/');
}
(async()=>{
  const config=await requestJson('./public-config.json');state.mode=config.mode;state.profileEditsIncluded=Boolean(config.profile_edits_included);$('.visitor-strip').hidden=state.mode==='static';
  if(config.access_mode==='encrypted-link'){
    encryptedConfig=config;$('#access-gate').hidden=false;
    const e=config.encryption;
    if(config.mode!=='static'||!e||e.version!==1||e.algorithm!=='AES-GCM'||e.iv_bytes!==12||e.tag_bits!==128||e.aad_prefix!=='MARTIANQUIP:encrypted-link:v1:'||!/^\.\/data\/[a-f0-9]{32}\.bin$/.test(config.catalog_url))throw new Error('Invalid encrypted configuration');
    const key=new URLSearchParams(location.hash.slice(1)).get('key');if(key)await unlockArchive(key);
    return;
  }
  if(config.access_mode)throw new Error('Unsupported access mode');
  await startArchive(await requestJson(state.mode==='server'?'./api/public/bootstrap':'./records.json'));$('#archive').hidden=false;
})().catch(()=>{
  $('.visitor-strip').hidden=true;$('#archive').hidden=true;$('#access-gate').hidden=false;$('#unlock').disabled=true;
  $('#gate-message').textContent='데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.';
});
