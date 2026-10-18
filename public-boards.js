 'use strict';
const BoardImages=new Set();
let sharedBoards={},sharedRecords=null;
const archiveGroups={'알콜':['싱글몰트','블렌디드','아이리시 싱글 팟스틸','아이리시 블렌디드','버번','라이','아메리칸 위스키','전통주','사케','리큐르','와인','주정강화와인','맥주','꼬냑','RTD'],'소다':['제로슈가 에너지드링크','에너지드링크','제로소다','소다','제로혼합음료']};
function archiveClassification(r){
 const c=r.catalog||{},type=c.primary_type||'',raw=r.meta?.종류||'',tags=(c.subtypes||[]).join(' '),kind=raw+' '+tags;
 if(r.is_collection){
  const group=c.manual_fields?.includes('primary_type')&&Object.keys(archiveGroups).find(g=>archiveGroups[g].includes(type));
  return group?{group,subtype:type,reason:'직접 지정한 묶음 글 분류'}:{group:'기타',subtype:'',reason:'방문·레시피·공지 또는 묶음 글'};
 }
 let sub=type;
 if(type==='에너지드링크')sub=/제로|zero/i.test(kind)?'제로슈가 에너지드링크':'에너지드링크';
 else if(type==='소다')sub=/혼합/.test(kind)&&/제로|zero/i.test(kind)?'제로혼합음료':/제로|zero/i.test(kind)?'제로소다':'소다';
 else if(/팟\s*스틸/.test(kind))sub='아이리시 싱글 팟스틸';
 else if(/아이리시/.test(kind)&&/블렌디드/.test(kind))sub='아이리시 블렌디드';
 else if(/주정강화/.test(kind))sub='주정강화와인';
 else if(/꼬냑|코냑|cognac/i.test(kind))sub='꼬냑';
 else if(/라이스 위스키/.test(kind))sub='전통주';
 else if(/일반 증류주/.test(kind))sub='블렌디드';
 else if(/아메리칸 위스키/.test(kind))sub='아메리칸 위스키';
 const group=Object.keys(archiveGroups).find(g=>archiveGroups[g].includes(sub));
 return {group:group||'미분류',subtype:group?sub:'',reason:raw||type||'종류 정보 없음'};
}

function toast(message){document.querySelector('#discovery-status').textContent=message;}
function initializeSharedBoards(data){
 sharedBoards={};sharedRecords=null;
 for(const [view,key] of [['whisky-tree','whisky_tree'],['tier-maker','tier_maker']]){
  if(data[key])sharedBoards['/api/'+view]=structuredClone(data[key]);
  document.querySelector('[data-view="'+view+'"]').hidden=!data[key];
 }
}
async function api(path,options={}){
 const current=sharedBoards[path];if(!current)throw Error('게시된 보드가 없습니다.');
 if(options.method==='POST'){
  const next=JSON.parse(options.body);
  if(next.revision!==current.revision)throw Error('보드 버전이 변경되었습니다. 다시 불러오세요.');
  current.document=structuredClone(next.document);current.revision++;
 }
 return structuredClone(current);
}
async function mountSharedBoard(view){
 sharedRecords ||= Promise.all(state.reviews.map(async record=>{
  const result=structuredClone(record),url=result.catalog.photo_url;
  if(encryptedConfig&&Object.hasOwn(state.encryptedAssets,url)){
   if(!imageCache.has(url))imageCache.set(url,decryptFile(url).then(bytes=>URL.createObjectURL(new Blob([bytes],{type:state.encryptedAssets[url]}))));
   try{result.catalog.photo_url=await imageCache.get(url);BoardImages.add(result.catalog.photo_url);}catch{result.catalog.photo_url='';}
  }
  return result;
 }));
 const items=await sharedRecords;
 if(view==='whisky-tree')await WhiskyTree.mount(document.querySelector('#shared-tree'),items);
 else await TierMaker.mount(document.querySelector('#shared-tiers'),items);
}
