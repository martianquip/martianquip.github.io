'use strict';
const $=s=>document.querySelector(s);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(value,suffix='')=>value===null||value===undefined||value===''?'미확인':Number(value).toLocaleString('ko-KR')+suffix;
const state={reviews:[],mode:'server',profileEditsIncluded:false,encryptedAssets:{},page:1,pages:0,total:0,request:0,detailRequest:0};
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
function fillOptions(selector,values){const select=$(selector);[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko')).forEach(value=>select.add(new Option(value,value)));}
async function requestJson(url,options){const response=await fetch(url,{cache:'no-cache',...options});const result=await response.json();if(!response.ok)throw new Error(result.error||'요청을 처리하지 못했습니다.');return result;}
function showCounters(data){for(const [id,key] of [['total-visitors','total_visitors'],['today-visitors','today_visitors'],['total-views','total_views'],['today-views','today_views']])$('#'+id).textContent=data&&Number.isFinite(data[key])?data[key].toLocaleString('ko-KR'):'연결 안됨';$('#analytics-status').textContent=data?'브라우저 쿠키 기준 · 오늘은 한국 시간':'방문자 집계 연결 안됨';}
let analyticsQueue=Promise.resolve();
function trackView(page){if(state.mode!=='server'){showCounters(null);return Promise.resolve();}const eventId=crypto.randomUUID();analyticsQueue=analyticsQueue.then(async()=>{try{const data=await requestJson('./api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page,event_id:eventId})});showCounters(data);}catch{showCounters(null);}});return analyticsQueue;}
async function render(){
  const version=++state.request;
  const query=$('#search').value.trim().toLowerCase(),type=$('#type').value,cask=$('#cask').value,subtype=$('#subtype').value;
  let rows;
  try{if(state.mode==='server'){const params=new URLSearchParams({page:String(state.page),limit:'24',q:query,type,cask,subtype});const data=await requestJson('./api/public/catalog?'+params);if(version!==state.request)return;rows=data.reviews;state.total=data.total;state.pages=data.pages;}else{const all=state.reviews.filter(r=>!r.is_collection&&(!type||r.catalog.primary_type===type)&&(!cask||r.catalog.casks?.includes(cask))&&(!subtype||r.catalog.subtypes?.includes(subtype))&&(!query||[r.name,r.english,r.catalog.country,r.catalog.region,r.catalog.distillery].join(' ').toLowerCase().includes(query)));state.total=all.length;state.pages=Math.ceil(all.length/24);rows=all.slice((state.page-1)*24,state.page*24);}}catch(error){if(version!==state.request)return;$('#cards').innerHTML=`<div class="empty"><h3>${esc(error.message)}</h3><p>잠시 후 다시 시도해 주세요.</p></div>`;$('#count').textContent='연결 안됨';return;}
  $('#count').textContent=`${state.total}개 제품`;
  $('#page-label').textContent=state.pages?`${state.page} / ${state.pages} 페이지`:'0개 제품';$('#previous-page').disabled=state.page<=1;$('#next-page').disabled=state.page>=state.pages;
  $('#cards').innerHTML=rows.length?rows.map(r=>{const c=r.catalog;const draft=r.liking_estimates.score?.value;return `<button class="review-card" data-id="${esc(r.id)}" type="button"><div class="card-photo">${photo(r)}<span class="type-badge">${esc(c.primary_type)}</span></div><div class="card-copy"><div class="card-origin">${esc(c.origin||c.country||'원산지 미확인')}</div><h3>${esc(r.name)}</h3><p class="english">${esc(r.english)}</p><div class="card-tags">${(c.casks||[]).slice(0,3).map(badge).join('')}</div><div class="card-bottom"><span>${number(r.abv,'%')} · ${number(r.volume,' ml')}</span><span>${draft==null?'평가 근거 부족':`추정 ★ ${Number(draft).toFixed(1)}`}</span></div></div></button>`;}).join(''):'<div class="empty"><h3>해당하는 리뷰가 없습니다.</h3><p>검색어나 분류를 조금 넓혀 보세요.</p></div>';
  $('#cards').querySelectorAll('[data-id]').forEach(button=>button.addEventListener('click',()=>openDetail(button.dataset.id)));
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
  $('#detail-content').innerHTML=`<div class="detail-top"><div class="detail-photo">${photo(record,true)}</div><div><p class="eyebrow">${esc(c.origin||c.primary_type)}</p><h2>${esc(record.name)}</h2><p class="english">${esc(record.english)}</p><div class="card-tags">${(c.subtypes||[]).map(badge).join('')}</div><p class="review-date">${esc(record.published||'')}의 리뷰</p>${record.source_url?`<a class="source-link" href="${esc(record.source_url)}" target="_blank" rel="noopener noreferrer">블로그 원문 읽기 ↗</a>`:''}</div></div><div class="color-airing"><div>${color?`<span class="color-swatch" style="background:${color}"></span>`:''}<b>${esc(c.color||'용액 색 미확인')}</b><small>${color?'원문에 표시한 색':'확인된 색상 정보만 표시합니다'}</small></div><div>${icon?`<img ${icon} alt="잔량 ${number(c.airing_remaining,'%')} 아이콘">`:''}<b>에어링 · ${c.airing_remaining==null?'미확인':`잔량 ${number(c.airing_remaining,'%')}`}</b></div></div><dl class="product-info">${info.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value||'미확인')}</dd></div>`).join('')}</dl><section class="profile-section"><div class="section-heading"><h3>향 · 맛 · 여운 프로파일</h3><span>${state.profileEditsIncluded ? "작성자 보정 반영" : "원문 기반 추정"} · 0.5~4.5</span></div><p class="chart-key"><i></i> 구체적인 과일 노트 <i class="core"></i> 그 밖의 향미</p><div class="stages">${Object.keys(labels).map(stage=>stageProfile(record,stage)).join('')}</div></section><section class="strength-section"><div class="section-heading"><h3>감각의 전체 강도</h3><span>만족도와 별개 · 0~5</span></div>${Object.keys(labels).map(stage=>{const value=record.intensities[stage]?.value;return `<div class="strength-row"><span>${labels[stage]}</span><div class="strength-track"><i style="width:${value==null?0:Math.max(0,Math.min(100,value/5*100))}%"></i></div><b>${value==null?'—':Number(value).toFixed(1)}</b></div>`;}).join('')}<div class="strength-scale"><span>0 · 약함</span><span>5 · 강함</span></div></section><section class="liking-section"><div class="section-heading"><h3>만족도 초안</h3><span>평가 표현을 바탕으로 추정</span></div><div class="liking-values">${[...Object.keys(labels),'score'].map(stage=>`<div><span>${labels[stage]||'종합'}</span><b>${record.liking_estimates[stage]?.value==null?'—':'★ '+Number(record.liking_estimates[stage].value).toFixed(1)}</b></div>`).join('')}</div><p>풍미가 강하다고 만족도가 높아지는 것은 아닙니다. 개인 별점은 공개하지 않습니다.</p></section>`;
  hydrateImages($('#detail-content'));if(!$('#detail').open)$('#detail').showModal();$('#detail').scrollTop=0;trackView('/review/'+id);
}
$('#close-detail').addEventListener('click',()=>{state.detailRequest++;$('#detail').close();});
$('#detail').addEventListener('click',event=>{if(event.target===$('#detail')){state.detailRequest++;$('#detail').close();}});
$('#reset').addEventListener('click',()=>{['#search','#type','#cask','#subtype'].forEach(selector=>$(selector).value='');state.page=1;render();});
let searchTimer;
['#search','#type','#cask','#subtype'].forEach(selector=>$(selector).addEventListener(selector==='#search'?'input':'change',()=>{state.page=1;clearTimeout(searchTimer);if(selector==='#search')searchTimer=setTimeout(render,250);else render();}));
$('#previous-page').addEventListener('click',()=>{if(state.page>1){state.page--;render();}});
$('#next-page').addEventListener('click',()=>{if(state.page<state.pages){state.page++;render();}});
$('#invite-form').addEventListener('submit',event=>{event.preventDefault();if(encryptedConfig)unlockArchive($('#invite-key').value);});
async function startArchive(data){
  state.page=1;
  ['#type','#cask','#subtype'].forEach(selector=>{const select=$(selector);while(select.options.length>1)select.remove(1);});
  if(state.mode==='server'){fillOptions('#type',data.options.primary_type);fillOptions('#cask',data.options.casks);fillOptions('#subtype',data.options.subtypes);}else{state.reviews=data.reviews;data.count=state.reviews.filter(r=>!r.is_collection).length;fillOptions('#type',state.reviews.map(r=>r.catalog.primary_type));fillOptions('#cask',state.reviews.flatMap(r=>r.catalog.casks||[]));fillOptions('#subtype',state.reviews.flatMap(r=>r.catalog.subtypes||[]));showCounters(null);}
  $('#summary').textContent=`${data.count}개 제품 · 읽기 전용 아카이브`;
  if(state.profileEditsIncluded)$('.method-note').textContent='향미와 전체 강도에는 작성자가 수정한 값이 반영되며, 수정하지 않은 항목은 원문 기반 추정입니다. 향미는 0.5~4.5, 전체 강도는 0~5의 별도 척도입니다. 만족도는 원문 기반 추정이며 개인 별점·메모는 공개하지 않습니다.';
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
