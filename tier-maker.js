'use strict';
const TierMaker=(()=>{
 const ranks=['S','A','B','C','D'];
 const kinds=[['all','전체 음료'],['bourbon','버번'],['scotch','스카치'],['peat','피트'],['energy','에너지드링크'],['zero-soda','제로소다']];
 const copy=x=>JSON.parse(JSON.stringify(x));
 let root,records=[],byId=new Map(),doc,revision=0,active,selected='',dragId='',query='',filter='board',sort='newest';
 let changed=0,saved=0,saving=false,error='',timer,loading,epoch=0,history=[];
 const board=()=>doc.boards.find(b=>b.id===active)||doc.boards[0];
 const label=id=>doc.labels[id]||byId.get(id)?.name||id;
 function matches(r,kind){
  const c=r.catalog||{},sub=archiveClassification(r).subtype;
  if(kind==='all')return true;
  if(kind==='bourbon')return c.primary_type==='버번';
  if(kind==='scotch')return /스카치|scotch/i.test(c.origin||'')||c.country==='스코틀랜드';
  if(kind==='peat')return (c.subtypes||[]).includes('피티드')||(r.facets||[]).some(f=>['peat','peat_type'].includes(f.layer)&&!/언피트|비피트|논피트|없|미확인|unpeated/i.test(f.label));
  if(kind==='energy')return c.primary_type==='에너지드링크';
  if(kind==='zero-soda')return sub==='제로소다';
  return sub===kind;
 }
 function pool(){
  const used=new Set(Object.values(board().tiers).flat()),kind=filter==='board'?board().kind:filter;
  const rows=records.filter(r=>!used.has(r.id)&&matches(r,kind)&&`${label(r.id)} ${r.name} ${r.english||''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return rows.sort((a,b)=>sort==='name'?label(a.id).localeCompare(label(b.id),'ko'):sort==='rating'?(b.rating?.score??-1)-(a.rating?.score??-1):sort==='price'?(a.price??Infinity)-(b.price??Infinity):String(b.published).localeCompare(String(a.published)));
 }
 function status(){
  const el=root?.querySelector('[data-tier-status]');if(!el)return;
  el.textContent=error|| (saving?'저장 중…':changed!==saved?'저장 대기 중…':'이 탭에 임시 저장됨');
  el.classList.toggle('tier-error',!!error);
  const retry=root.querySelector('[data-tier-action="save"]');if(retry)retry.disabled=saving||changed===saved;
 }
 async function save(){
  clearTimeout(timer);if(!doc||saving||changed===saved)return;
  const generation=changed,currentEpoch=epoch,snapshot=copy(doc);saving=true;error='';status();
  try{const result=await api('/api/tier-maker',{method:'POST',body:JSON.stringify({revision,document:snapshot})});if(currentEpoch!==epoch)return;revision=result.revision;saved=generation;}
  catch(e){if(currentEpoch===epoch)error=e.message;}
  finally{if(currentEpoch===epoch){saving=false;status();if(!error&&changed!==saved)timer=setTimeout(save,300);}}
 }
 function mutate(fn){
  history.push(copy(doc));if(history.length>40)history.shift();fn();changed++;error='';clearTimeout(timer);timer=setTimeout(save,650);render();
 }
 function move(id,rank,before){
  if(!byId.has(id)||(!ranks.includes(rank)&&rank!=='pool')||before===id)return;
  mutate(()=>{
   for(const key of ranks)board().tiers[key]=board().tiers[key].filter(x=>x!==id);
   if(rank!=='pool'){const list=board().tiers[rank],at=list.indexOf(before);list.splice(at<0?list.length:at,0,id);}
   selected=id;
  });
 }
 const thumbsUp = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 10 11 2c2 0 3 2 2 5l-1 3h7a2 2 0 0 1 2 2l-1 8a2 2 0 0 1-2 2H7Zm0 0H3v12h4Z" fill="#f6c445" stroke="#94671a" stroke-width="1.5" stroke-linejoin="round"/></svg>';
 const recommended=id=>(doc.recommended||[]).includes(id);
 function toggleRecommended(id){
  if(!byId.has(id))return;
  mutate(()=>{const list=doc.recommended||[];doc.recommended=recommended(id)?list.filter(x=>x!==id):[...list,id];});
 }
 function card(id){
  const url=safeImage(byId.get(id)?.catalog?.photo_url);
  return `<article class="tier-product ${recommended(id)?'tier-recommended':''}"><button type="button" class="tier-card ${selected===id?'selected':''}" draggable="true" data-tier-id="${esc(id)}" title="${esc(label(id))}" aria-pressed="${selected===id}">${url?`<img src="${esc(url)}" alt="" loading="lazy" draggable="false">`:'<span class="tier-placeholder">사진 없음</span>'}<span>${esc(label(id))}</span></button><button type="button" class="tier-recommend-badge ${recommended(id)?'active':''}" data-tier-action="recommend" data-id="${esc(id)}" aria-pressed="${recommended(id)}" aria-label="${esc(label(id))} 추천" title="${recommended(id)?'추천 해제':'추천 제품으로 표시'}">${thumbsUp}</button></article>`;
 }
 function renderPool(){
  const rows=pool();root.querySelector('[data-tier-pool]').innerHTML=rows.map(r=>card(r.id)).join('')||'<p class="muted">조건에 맞는 미배치 제품이 없습니다.</p>';
  root.querySelector('[data-tier-count]').textContent=rows.length+'개';
 }
 function render(){
  if(!root?.isConnected||!doc)return;
  const b=board(),placed=Object.values(b.tiers).flat().length;
  root.innerHTML=`<section class="tier-maker"><header class="tier-heading"><h1>TIER MAKER</h1><p>나만의 순위. 제품을 끌어 놓거나 선택한 뒤 등급을 지정하세요.</p></header>
   <div class="tier-toolbar"><label>보드<select data-tier-field="board">${doc.boards.map(x=>`<option value="${esc(x.id)}" ${x.id===b.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><button class="btn" data-tier-action="new">＋ 새 보드</button><button class="btn" data-tier-action="delete" ${doc.boards.length===1?'disabled title="보드는 최소 1개 필요합니다."':''}>보드 삭제</button><label>보드 이름<input data-tier-field="board-name" maxlength="80" value="${esc(b.name)}"></label><label>기본 제품군<select data-tier-field="kind">${kinds.map(([key,name])=>`<option value="${key}" ${key===b.kind?'selected':''}>${name}</option>`).join('')}</select></label></div>
   <div class="tier-savebar"><span data-tier-status role="status" aria-live="polite"></span><button class="btn small" data-tier-action="save">저장</button><button class="btn small" data-tier-action="undo" ${history.length?'':'disabled'}>되돌리기</button><button class="btn small" data-tier-action="image">PNG 이미지 저장</button><button class="btn small" data-tier-action="export">JSON 내보내기</button><button class="btn small" data-tier-action="reload" ${saving?'disabled':''}>저장본 불러오기</button></div>
   <section class="tier-selection" aria-label="선택한 제품 편집">${selected&&byId.has(selected)?`<label>표시 이름<input data-tier-field="label" maxlength="120" value="${esc(label(selected))}"></label><button class="btn small" data-tier-action="reset-label">원래 이름</button><div class="tier-placement" aria-label="선택한 제품 등급">${ranks.map(rank=>`<button class="btn small" data-tier-action="place" data-rank="${rank}">${rank}로 이동</button>`).join('')}<button class="btn small" data-tier-action="unplace">미배치로</button></div><small>티어메이커의 모든 보드에 적용됩니다. 원문 제품명은 유지됩니다.</small>`:'<p>사진을 선택하면 표시 이름과 등급을 편집할 수 있습니다.</p>'}</section>
   <div class="tier-workspace"><section><div class="tier-board-title"><h2>${esc(b.name)}</h2><span>${placed}개 배치</span></div>
   <div class="tier-board" aria-label="${esc(b.name)} 티어 보드">${ranks.map(rank=>`<section class="tier-row" data-rank="${rank}"><h3 class="tier-rank tier-rank-${rank}">${rank}</h3><div class="tier-drop" data-tier-drop="${rank}" aria-label="${rank} 등급">${b.tiers[rank].map(card).join('')||'<span class="tier-empty">여기로 드래그</span>'}</div></section>`).join('')}</div>
   </section><section class="tier-pool-section"><div class="tier-board-title"><h2>미배치 제품</h2><span data-tier-count></span></div><div class="tier-toolbar"><input type="search" data-tier-field="search" placeholder="제품명 검색" aria-label="티어 제품 검색" value="${esc(query)}"><select data-tier-field="filter" aria-label="티어 제품 분류"><option value="board" ${filter==='board'?'selected':''}>이 보드의 제품군</option>${[...kinds,...[...archiveGroups['알콜'],...archiveGroups['소다']].filter(x=>!['버번','에너지드링크','제로소다'].includes(x)).map(x=>[x,x])].map(([key,name])=>`<option value="${key}" ${filter===key?'selected':''}>${esc(name)}</option>`).join('')}</select><select data-tier-field="sort" aria-label="티어 제품 정렬">${[['newest','최신 리뷰순'],['name','이름순'],['rating','별점 높은순'],['price','가격 낮은순']].map(([key,name])=>`<option value="${key}" ${sort===key?'selected':''}>${name}</option>`).join('')}</select></div><div class="tier-pool" data-tier-pool data-tier-drop="pool" aria-label="미배치 제품 목록"></div></section></div></section>`;
  renderPool();status();
 }
 let exporting=false;
 async function exportImage(){
  if(exporting)return;exporting=true;
  const b=copy(board()),names=new Map(Object.values(b.tiers).flat().map(id=>[id,label(id)])),marks=new Set(doc.recommended||[]);
  try{
   toast('제품 사진을 담아 이미지를 만들고 있습니다…');
   const pictures=new Map(await Promise.all([...names.keys()].map(async id=>{
    try{
     const source=safeImage(byId.get(id)?.catalog?.photo_url);if(!source)throw Error('missing');
     const img=new Image();if(new URL(source,location.href).origin!==location.origin)img.crossOrigin='anonymous';
     await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{img.src='';reject(Error('photo timeout'));},10000);img.onload=()=>{clearTimeout(timeout);resolve();};img.onerror=()=>{clearTimeout(timeout);reject(Error('photo'));};img.src=source;});return [id,img];
    }catch{return [id,null];}
   })));
   const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
   const margin=24,axis=76,gap=10,cardWidth=116,photoSize=104;
   const columns=Math.max(1,...ranks.map(rank=>b.tiers[rank].length));
   const width=Math.max(600,margin*2+axis+gap+columns*(cardWidth+gap));
   const wrap=(text,size,maxWidth)=>{
    ctx.font=`${size}px "Malgun Gothic", sans-serif`;const lines=[];let line='';
    for(const char of String(text)){if(line&&ctx.measureText(line+char).width>maxWidth){lines.push(line.trim());line='';}line+=char;}
    if(line)lines.push(line.trim());return lines.length?lines:[''];
   };
   const title=wrap(b.name,28,width-margin*2),labels=new Map([...names].map(([id,name])=>[id,wrap(name,13,cardWidth-12)]));
   const header=40+title.length*34+30;
   const rows=ranks.map(rank=>{
    const items=b.tiers[rank],lines=Math.max(1,...items.map(id=>labels.get(id).length));
    const cardHeight=photoSize+18+lines*18;
    return {rank,items,cardHeight,height:Math.max(150,cardHeight+gap*2)};
   });
   const height=header+rows.reduce((sum,row)=>sum+row.height,0)+margin,scale=Math.min(2,8192/Math.max(width,height));
   canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);ctx.scale(scale,scale);
   ctx.fillStyle='#f8f7f2';ctx.fillRect(0,0,width,height);ctx.fillStyle='#283e35';ctx.textBaseline='top';ctx.font='bold 28px "Malgun Gothic", sans-serif';
   title.forEach((line,i)=>ctx.fillText(line,margin,24+i*34));ctx.font='14px "Malgun Gothic", sans-serif';ctx.fillStyle='#747e71';ctx.fillText('MARTIANQUIP · TIER MAKER · 노란 엄지: 나의 추천',margin,30+title.length*34);
   const badge=new Image();badge.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(thumbsUp);await badge.decode();
   const colors=['#ee9290','#efbb8a','#f0d68e','#eee8a5','#bfdc9d'];let y=header;
   rows.forEach((row,index)=>{
    ctx.fillStyle='#f7f7f1';ctx.fillRect(margin,y,width-margin*2,row.height);ctx.fillStyle=colors[index];ctx.fillRect(margin,y,axis,row.height);
    ctx.strokeStyle='#393e33';ctx.lineWidth=1;ctx.strokeRect(margin,y,width-margin*2,row.height);ctx.strokeRect(margin,y,axis,row.height);
    ctx.fillStyle='#30362b';ctx.font='bold 32px "Malgun Gothic", sans-serif';ctx.textAlign='center';ctx.fillText(row.rank,margin+axis/2,y+row.height/2-16);
    row.items.forEach((id,i)=>{
     const x=margin+axis+gap+i*(cardWidth+gap),top=y+gap,img=pictures.get(id);
     ctx.fillStyle='#fff';ctx.fillRect(x,top,cardWidth,row.cardHeight);ctx.strokeStyle=marks.has(id)?'#dca933':'#dde1d5';ctx.lineWidth=marks.has(id)?2:1;ctx.strokeRect(x,top,cardWidth,row.cardHeight);
     if(img){const ratio=Math.min(photoSize/img.naturalWidth,photoSize/img.naturalHeight),w=img.naturalWidth*ratio,h=img.naturalHeight*ratio;ctx.drawImage(img,x+(cardWidth-w)/2,top+6+(photoSize-h)/2,w,h);}
     else{ctx.fillStyle='#949984';ctx.font='12px "Malgun Gothic", sans-serif';ctx.fillText('사진 없음',x+cardWidth/2,top+48);}
     ctx.fillStyle='#30362b';ctx.font='13px "Malgun Gothic", sans-serif';labels.get(id).forEach((line,j)=>ctx.fillText(line,x+cardWidth/2,top+photoSize+12+j*18));
     if(marks.has(id)){ctx.fillStyle='#fff8db';ctx.fillRect(x,top,28,28);ctx.drawImage(badge,x+3,top+3,22,22);}
    });y+=row.height;
   });
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('이미지를 만들지 못했습니다.');
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=b.name.replace(/[\\/:*?"<>|]/g,'_')+'-tier-maker.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
   const missing=[...pictures.values()].filter(x=>!x).length;toast(missing?`PNG 저장 완료 · 사진 ${missing}개는 ‘사진 없음’으로 표시했습니다.`:'티어 보드를 PNG 이미지로 저장했습니다.');
  }catch(e){toast('이미지 저장 실패: '+e.message);}
  finally{exporting=false;}
 }
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify({revision,document:doc},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='taste-atlas-tier-boards.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function load(){
  const currentEpoch=epoch;
  try{const result=await api('/api/tier-maker');if(currentEpoch!==epoch)return;doc=result.document;revision=result.revision;active=doc.boards.some(b=>b.id===active)?active:doc.boards[0].id;changed=saved=0;error='';history=[];selected='';render();}
  catch(e){if(currentEpoch===epoch&&root?.isConnected)root.innerHTML=`<p class="notice">${esc(e.message)}</p><button class="btn" data-tier-action="reload">다시 불러오기</button>`;}
 }
 function bind(){
  root.onclick=async event=>{
   const btn=event.target.closest('[data-tier-action]'),cardEl=event.target.closest('[data-tier-id]');
   if(!btn){if(cardEl){selected=cardEl.dataset.tierId;render();}return;}
   const action=btn.dataset.tierAction;
   if(action==='recommend'){toggleRecommended(btn.dataset.id);if(event.detail===0)root.querySelector(`[data-tier-action="recommend"][data-id="${CSS.escape(btn.dataset.id)}"]`)?.focus({preventScroll:true});}
   if(action==='new')mutate(()=>{const id=crypto.randomUUID();doc.boards.push({id,name:'새 보드 '+(doc.boards.length+1),kind:'all',tiers:Object.fromEntries(ranks.map(r=>[r,[]]))});active=id;selected='';filter='board';query='';});
   if(action==='delete'&&doc.boards.length>1)mutate(()=>{const id=board().id;doc.boards=doc.boards.filter(b=>b.id!==id);active=doc.boards[0].id;selected='';query='';filter='board';});
   if(action==='place')move(selected,btn.dataset.rank);
   if(action==='unplace')move(selected,'pool');
   if(action==='reset-label')mutate(()=>delete doc.labels[selected]);
   if(action==='undo'&&history.length){const previous=history.pop();doc=previous;if(!doc.boards.some(b=>b.id===active))active=doc.boards[0].id;changed++;error='';timer=setTimeout(save,300);render();}
   if(action==='save')save();
   if(action==='export')download();
   if(action==='image')await exportImage();
   if(action==='reload'&&!saving){if(changed!==saved&&!confirm('저장하지 못한 변경을 버리고 저장본을 불러올까요? 필요하면 먼저 JSON으로 내보내세요.'))return;clearTimeout(timer);await load();}
  };
  root.oninput=event=>{if(event.target.dataset.tierField==='search'){query=event.target.value;renderPool();}};
  root.onchange=event=>{
   const field=event.target.dataset.tierField,value=event.target.value;
   if(field==='board'){active=value;selected='';query='';filter='board';render();}
   if(field==='filter'){filter=value;renderPool();}
   if(field==='sort'){sort=value;renderPool();}
   if(field==='kind')mutate(()=>{board().kind=value;filter='board';});
   if(field==='board-name'){if(!value.trim()){event.target.value=board().name;return;}mutate(()=>board().name=value.trim());}
   if(field==='label'){if(!value.trim()){event.target.value=label(selected);return;}mutate(()=>doc.labels[selected]=value.trim());}
  };
  root.ondragstart=event=>{const el=event.target.closest('[data-tier-id]');if(!el)return;dragId=el.dataset.tierId;event.dataTransfer.setData('text/plain',dragId);event.dataTransfer.effectAllowed='move';};
  root.ondragover=event=>{const zone=event.target.closest('[data-tier-drop]');if(!zone||!dragId)return;event.preventDefault();event.dataTransfer.dropEffect='move';root.querySelectorAll('.tier-drag-over').forEach(el=>el.classList.remove('tier-drag-over'));zone.classList.add('tier-drag-over');};
  root.ondrop=event=>{const zone=event.target.closest('[data-tier-drop]');if(!zone||!dragId)return;event.preventDefault();const id=dragId;dragId='';move(id,zone.dataset.tierDrop,event.target.closest('[data-tier-id]')?.dataset.tierId);};
  root.ondragend=()=>{dragId='';root.querySelectorAll('.tier-drag-over').forEach(el=>el.classList.remove('tier-drag-over'));};
 }
 async function mount(el,items){root=el;records=items;byId=new Map(items.map(r=>[r.id,r]));bind();if(doc){render();return;}root.innerHTML='<p class="muted">티어 보드를 불러오고 있습니다…</p>';if(!loading)loading=load().finally(()=>{loading=null;});await loading;}
 window.addEventListener('beforeunload',event=>{if(doc&&changed!==saved){event.preventDefault();event.returnValue='';}});
 window.addEventListener('atlas-owner-locked',()=>{epoch++;clearTimeout(timer);doc=null;records=[];byId.clear();history=[];changed=saved=0;saving=false;loading=null;root=null;});
 return {mount};
})();
