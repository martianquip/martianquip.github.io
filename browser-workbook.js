'use strict';
// Small OOXML subset: typed cells, shared strings, stored/deflated ZIP entries.
// Formulas are rejected on import; only explicit sensory scores are accepted.
const BrowserWorkbook=(()=>{
 const labels={nose:'향',palate:'맛',finish:'여운'};
 const families=['과일','건과일','시트러스','꽃·허브','단맛','바닐라·크림','견과·고소','초콜릿·커피','스파이스','오크·나무','스모크·피트','곡물·몰트','산미','쓴맛','짠맛·미네랄','탄산','캔디·인공향'];
 const enc=new TextEncoder(),dec=new TextDecoder(),stages=['nose','palate','finish'];
 const columns=stages.flatMap(s=>['강도',...(s==='palate'?['바디']:s==='finish'?['길이']:[]),...families].map(f=>({s,f,title:labels[s]+' '+f})));
 const headers=['ID','제품명','분류','종류',...columns.map(c=>c.title)];
 const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 function col(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
 function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return (c^0xffffffff)>>>0;}
 function zip(files){
  const parts=[],central=[];let offset=0;
  for(const [name,text] of Object.entries(files)){
   const nameBytes=enc.encode(name),data=enc.encode(text),sum=crc(data),local=new Uint8Array(30+nameBytes.length),v=new DataView(local.buffer);
   v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,sum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,nameBytes.length,true);local.set(nameBytes,30);
   const entry=new Uint8Array(46+nameBytes.length),d=new DataView(entry.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,sum,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,nameBytes.length,true);d.setUint32(42,offset,true);entry.set(nameBytes,46);
   parts.push(local,data);central.push(entry);offset+=local.length+data.length;
  }
  const size=central.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 }
 function workbook(sheets){
  const files={'[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
   '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
   'xl/workbook.xml':`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"${s.hidden?' state="hidden"':''}/>`).join('')}</sheets></workbook>`,
   'xl/_rels/workbook.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`};
  sheets.forEach((s,i)=>{files[`xl/worksheets/sheet${i+1}.xml`]=`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>${s.rows.map((row,j)=>`<row r="${j+1}">${row.map((v,k)=>v==null?'':`<c r="${col(k)}${j+1}"${typeof v==='number'?'':' t="inlineStr"'}>${typeof v==='number'?`<v>${v}</v>`:`<is><t xml:space="preserve">${xml(v)}</t></is>`}</c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;});
  return zip(files);
 }
 async function unzip(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw Error('XLSX 파일 형식을 확인하세요.');let at=v.getUint32(end+16,true),total=0;const count=v.getUint16(end+10,true);if(count>2000)throw Error('엑셀 파일이 너무 복잡합니다.');
  for(let i=0;i<count;i++){
   if(v.getUint32(at,true)!==0x02014b50)throw Error('손상된 ZIP입니다.');const flags=v.getUint16(at+8,true),method=v.getUint16(at+10,true),compressed=v.getUint32(at+20,true),size=v.getUint32(at+24,true),nl=v.getUint16(at+28,true),el=v.getUint16(at+30,true),cl=v.getUint16(at+32,true),pos=v.getUint32(at+42,true),sum=v.getUint32(at+16,true),name=dec.decode(bytes.slice(at+46,at+46+nl));at+=46+nl+el+cl;
   if(!name.endsWith('.xml')&&!name.endsWith('.rels'))continue;
   if(flags&1||![0,8].includes(method)||size>20e6||(total+=size)>50e6||files.has(name))throw Error('지원하지 않거나 너무 큰 엑셀입니다.');
   if(v.getUint32(pos,true)!==0x04034b50)throw Error('손상된 파일입니다.');const start=pos+30+v.getUint16(pos+26,true)+v.getUint16(pos+28,true);let data=bytes.slice(start,start+compressed);
   if(data.length!==compressed)throw Error('손상된 파일입니다.');
   if(method===8){const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let n=0;while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>size){await reader.cancel();throw Error('압축 해제 크기가 올바르지 않습니다.');}chunks.push(value);}data=new Uint8Array(await new Blob(chunks).arrayBuffer());}
   if(data.length!==size||crc(data)!==sum)throw Error('파일 검사에 실패했습니다.');files.set(name,dec.decode(data));
  }
  return files;
 }
 function parseXML(s){if(!s||/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('XML 형식 오류');const d=new DOMParser().parseFromString(s,'application/xml');if(d.querySelector('parsererror'))throw Error('XML 형식 오류');return d;}
 async function read(bytes){
  const files=await unzip(bytes),wb=parseXML(files.get('xl/workbook.xml')),rels=parseXML(files.get('xl/_rels/workbook.xml.rels'));
  const strings=files.has('xl/sharedStrings.xml')?[...parseXML(files.get('xl/sharedStrings.xml')).getElementsByTagNameNS('*','si')].map(el=>[...el.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join('')):[];
  const sheets={};for(const s of wb.getElementsByTagNameNS('*','sheet')){
   const id=s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),rel=[...rels.getElementsByTagNameNS('*','Relationship')].find(r=>r.getAttribute('Id')===id);if(!rel||rel.getAttribute('TargetMode')==='External')throw Error('외부 시트 연결은 지원하지 않습니다.');
   const target=rel.getAttribute('Target'),path=target.startsWith('/')?target.slice(1):'xl/'+target;const doc=parseXML(files.get(path)),rows=[];
   for(const row of doc.getElementsByTagNameNS('*','row')){
    const values=[];for(const c of row.getElementsByTagNameNS('*','c')){const addr=c.getAttribute('r');if(!/^[A-Z]{1,3}[1-9][0-9]*$/.test(addr))throw Error('셀 주소 오류');let index=0;for(const ch of addr.match(/^[A-Z]+/)[0])index=index*26+ch.charCodeAt(0)-64;if(index>200)continue;
     if(c.getElementsByTagNameNS('*','f').length)values[index-1]={formula:true};else {const t=c.getAttribute('t'),raw=c.getElementsByTagNameNS('*','v')[0]?.textContent;values[index-1]=t==='inlineStr'?[...c.getElementsByTagNameNS('*','t')].map(x=>x.textContent).join(''):t==='s'?strings[Number(raw)]:raw===undefined?null:t==='str'?raw:Number(raw);}}
    rows.push(values);
   }
   sheets[s.getAttribute('name')]=rows;
  }return sheets;
 }
 function value(r,s,f){return f==='강도'?r.intensities?.[s]?.value??null:f==='바디'?r.mouthfeel_body?.value??null:f==='길이'?r.finish_duration?.score??null:r.features.find(x=>x.stage===s&&x.family===f)?.value??null;}
 function exportBook(){
  const npf=state.reviews.filter(r=>!r.is_collection&&r.profile_schema==='martianquip-npf-17-v1');
  const rows=[headers,...npf.map(r=>[r.id,r.name,r.category,r.catalog.primary_type,...columns.map(({s,f})=>value(r,s,f))])];
  const long=[['ID','제품명','단계','항목','종류','점수','기준점수']];
  for(const r of state.reviews.filter(r=>!r.is_collection&&!r.profile_schema)){
   for(const kind of ['features','fruit_features'])for(const f of r[kind]||[])long.push([r.id,r.name,f.stage,f.family,kind,f.value,f.value]);
   for(const s of stages)long.push([r.id,r.name,s,'강도','intensities',r.intensities?.[s]?.value??null,r.intensities?.[s]?.value??null]);
  }
  const sheets=[{name:'NPF 점수(가로)',rows},{name:'게시본 기준',rows:copyRows(rows),hidden:true},{name:'기존 향미 기록',rows:long}];
  BrowserWorkspace.download('TasteAtlas-NPF.xlsx',workbook(sheets),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 }
 const copyRows=rows=>rows.map(r=>[...r]);
 const score=v=>BrowserWorkspace.score(v===''?null:v??null);
 function preview(sheets){
  const edits={},current=new Map(state.reviews.map(r=>[r.id,r]));let changes=0;const details=[];
  const change=(r,patch,label,before,after)=>{if(before===after)return;edits[r.id]||={};patch(edits[r.id]);changes++;if(details.length<100)details.push(`${r.name} · ${label}: ${before??'빈칸'} → ${after??'빈칸'}`);};
  const rows=sheets['NPF 점수(가로)'],baseline=sheets['게시본 기준'],seen=new Set(),wide=new Map();
  if(rows){
   if(headers.some((h,i)=>rows[0]?.[i]!==h))throw Error('NPF 점수(가로) 열 제목·순서를 확인하세요.');
   const bases=new Map((baseline||[]).slice(1).map(row=>[String(row[0]),row]));
   for(const row of rows.slice(1)){
    if(row.every(v=>v==null||v===''))continue;const id=String(row[0]),r=current.get(id);if(!r||r.is_collection||seen.has(id))throw Error('중복 또는 미등록 제품 ID: '+id);seen.add(id);
    if(r.profile_schema!=='martianquip-npf-17-v1')throw Error(r.name+': 기존 추정과 17개 NPF 척도가 다릅니다. 먼저 로컬앱에서 MARTIANQUIP 엑셀을 가져와 다시 게시하세요.');
    columns.forEach(({s,f,title},i)=>{
     const next=score(row[i+4]),before=value(r,s,f);wide.set(id+'|'+s+'|'+f,next);
     if(baseline){if(!bases.has(id))throw Error('연결 기준이 없는 제품입니다.');const old=score(bases.get(id)[i+4]);if(next===old)return;if(before!==old&&before!==next)throw Error(r.name+' · '+title+': 엑셀 다운로드 이후 앱에서도 수정했습니다.');}
     change(r,p=>{if(f==='강도'){p.intensities||=structuredClone(r.intensities);p.intensities[s]={value:next};}else if(f==='바디')p.mouthfeel_body={value:next};else if(f==='길이')p.finish_duration={score:next};else {p.features||=structuredClone(r.features);p.features=p.features.filter(x=>x.stage!==s||x.family!==f);if(next!==null)p.features.push({stage:s,family:f,value:next});}},title,before,next);
    });
   }
  }
  if(sheets['NPF 점수(세로)']){const vertical=new Map();for(const row of sheets['NPF 점수(세로)'].slice(1)){if(!row[0])continue;const s=Object.keys(labels).find(s=>labels[s]===row[3]),f=row[4]==='여운 길이'?'길이':row[4],k=String(row[0])+'|'+s+'|'+f;if(vertical.has(k)||!wide.has(k))throw Error('세로 시트에 중복 또는 알 수 없는 항목이 있습니다.');vertical.set(k,score(row[5]));}for(const [k,v] of wide)if((vertical.get(k)??null)!==v)throw Error('가로·세로 NPF 점수가 다릅니다: '+k);}
  const legacy=sheets['기존 향미 기록'];
  if(legacy){if(['ID','제품명','단계','항목','종류','점수','기준점수'].some((h,i)=>legacy[0]?.[i]!==h))throw Error('기존 향미 기록 열을 확인하세요.');const seenLegacy=new Set();
   for(const row of legacy.slice(1)){if(!row[0])continue;const [id,,s,f,kind,raw,oldRaw]=row,r=current.get(String(id)),k=[id,s,f,kind].join('|');if(!r||r.is_collection||r.profile_schema||!stages.includes(s)||!['features','fruit_features','intensities'].includes(kind)||seenLegacy.has(k)||typeof f!=='string'||f.length>80)throw Error('기존 향미 셀을 확인하세요.');seenLegacy.add(k);const next=score(raw),old=score(oldRaw);if(kind!=='intensities'&&next>sensoryMax(r))throw Error('기존 향미 점수는 '+sensoryMax(r)+' 이하여야 합니다.');if(next===old)continue;const before=kind==='intensities'?r.intensities?.[s]?.value??null:r[kind].find(x=>x.stage===s&&x.family===f)?.value??null;if(before!==old&&before!==next)throw Error(r.name+' · '+f+': 브라우저와 엑셀 변경 충돌');
    change(r,p=>{if(kind==='intensities'){p.intensities||=structuredClone(r.intensities);p.intensities[s]={value:next};}else{p[kind]||=structuredClone(r[kind]);p[kind]=p[kind].filter(x=>x.stage!==s||x.family!==f);if(next!==null)p[kind].push({stage:s,family:f,value:next});}},labels[s]+' '+f,before,next);
   }
  }
  if(!rows&&!legacy)throw Error('지원하는 NPF 시트가 없습니다.');return {edits,changes,details};
 }
 function wire(){
  $('#workspace-xlsx').onclick=exportBook;
  $('#workspace-xlsx-import').onchange=async e=>{
   const box=$('#workspace-import-preview'),file=e.target.files[0];box.replaceChildren();try{if(!file)return;if(!BrowserWorkspace.writable)throw Error('이 브라우저에서는 저장할 수 없습니다.');if(file.size>25e6)throw Error('25MB 이하의 XLSX를 선택하세요.');const sheets=await read(new Uint8Array(await file.arrayBuffer())),result=preview(sheets),snapshot=JSON.stringify(state.reviews);box.innerHTML=`<p>${result.changes}개 점수 변경 · ${Object.keys(result.edits).length}개 제품</p><pre class="workspace-message">${esc(result.details.join('\n'))}</pre>`;
    if(result.changes){const b=document.createElement('button');b.className='action-button primary';b.textContent='확인한 변경을 이 브라우저에 반영';box.append(b);b.onclick=async()=>{b.disabled=true;try{if(JSON.stringify(state.reviews)!==snapshot)throw Error('미리보기 이후 내용이 바뀌었습니다. 파일을 다시 선택하세요.');await BrowserWorkspace.updateEdits(result.edits);box.textContent='NPF 점수를 저장했습니다.';}catch(err){box.append(document.createTextNode(err.message));}};}
   }catch(err){box.textContent='가져오지 않았습니다. '+err.message;}finally{e.target.value='';}
  };
 }
 return {wire,read,preview,workbook};
})();
