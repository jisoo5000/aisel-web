(function(root){'use strict';
const D=root.AiselWorkflowDomain;if(!D)return;let epoch=0,cache={},flights={},complete={};

function createProductWorkflowLinks(){
 const types=['meeting','naming','purchase','contentPlan','styling','reaction','campaign'];
 const clean=v=>typeof v==='string'?v.trim():'';
 const code=v=>clean(v).toUpperCase();
 const key=r=>clean(r?.type)+'/'+clean(r?.id);
 function identity(r){const v=r?.values||{};return {productCode:code(v.productCode),planningId:clean(v.planningId),assetId:clean(v.assetId),adId:clean(v.adId)};}
 function related(anchor,record){
  if(!anchor||!record||!types.includes(record.type))return false;
  if(key(anchor)===key(record))return true;
  const a=identity(anchor),b=identity(record);
  // A shared reference or video must never join two different products.
  if(a.productCode&&b.productCode)return a.productCode===b.productCode;
  return ['planningId','assetId','adId'].some(k=>a[k]&&a[k]===b[k]);
 }
 function records(anchor,input,{includeArchived=false}={}){
  const found=new Map();
  for(const r of input||[]){
   if(!r||!clean(r.id)||!related(anchor,r)||!includeArchived&&r.archived)continue;
   const old=found.get(key(r));
   if(!old||Number(r.version)>Number(old.version))found.set(key(r),r);
  }
  return [...found.values()].sort((a,b)=>types.indexOf(a.type)-types.indexOf(b.type)||(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0)||key(a).localeCompare(key(b)));
 }
 function available(r){return Object.values(identity(r)).some(Boolean);}
 function date(v){const s=clean(v);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
 function handoffKey(r,target,meetingDate=''){
  if(!types.includes(r?.type)||!clean(r?.id)||!types.includes(target))throw Error('연결할 원본 기록을 확인해 주세요.');
  if(target==='meeting'&&!date(meetingDate))throw Error('실제 회의일을 선택해 주세요.');
  return JSON.stringify(['aisel-workflow-handoff-v1',r.type,r.id,target,target==='meeting'?meetingDate:'']);
 }
 function seed(r,target){
  if(!types.includes(target)||!available(r))throw Error('품번 또는 기획·영상 ID를 먼저 연결해 주세요.');
  const v=r.values||{},out={};
  for(const k of ['productCode','planningId','assigneeName','sourceUrl'])if(clean(v[k]))out[k]=v[k];
  out.title=clean(v.title)+(target==='meeting'?' · 후속 검토':'');
  const context=['원본 기록: '+key(r),'원본 버전: '+r.version];
  if(v.periodStart||v.periodEnd)context.push('관찰기간: '+(v.periodStart||'미확인')+' ~ '+(v.periodEnd||'미확인'));
  if(v.returnEnd)context.push('반품 관찰 종료: '+v.returnEnd);
  for(const [k,label]of [['evidence','확인 근거'],['rationale','판단 근거'],['experiment','비교 조건'],['nextAction','다음 행동']])if(clean(v[k]))context.push(label+': '+v[k]);
  if(target==='meeting'){
   out.reference=context.join('\n').slice(0,4000);
   out.hypothesis=clean(v.hypothesis||v.testHypothesis);
   out.nextAction=clean(v.nextAction);
   out.meetingDate='';
  }else{
   out.evidence=context.join('\n').slice(0,4000);
   out.nextAction=clean(v.nextAction);
   if(['contentPlan','styling','campaign'].includes(target)&&v.assetId)out.assetId=v.assetId;
  }
  // Do not copy completion, orders, quantities, costs, approval or dates.
  return out;
 }
 function sameValues(a,b){const keys=[...new Set([...Object.keys(a||{}),...Object.keys(b||{})])];return keys.every(k=>(a?.[k]??'')===(b?.[k]??''));}
 function verified(saved,checked,p){
  const a=saved?.item,b=checked?.item;
  return !!a&&!!b&&a.id===p.id&&b.id===p.id&&a.type===p.type&&b.type===p.type&&
   Number.isSafeInteger(a.version)&&a.version===p.expectedVersion+1&&b.version===a.version&&
   a.status===p.status&&b.status===p.status&&!a.archived&&!b.archived&&sameValues(a.values,p.values)&&sameValues(b.values,p.values);
 }
 return Object.freeze({types,identity,related,records,available,date,handoffKey,seed,sameValues,verified});
}
const ProductLinks=createProductWorkflowLinks();

async function readRecords(type,request,run){
 if(complete[type])return cache[type];if(flights[type])return flights[type];
 const pending=(async()=>{
  const rows=[],seen=new Set();let cursor;
  do{
   const result=await request('workflowList',{type,limit:100,...(cursor?{cursor}:{})});
   if(run!==epoch)throw Error('계정 또는 권한이 변경되었습니다.');
   if(!Array.isArray(result?.items)||result.items.some(r=>!r||r.type!==type||typeof r.id!=='string'||!r.values))throw Error('연결 기록의 형식을 확인하지 못했습니다.');
   rows.push(...result.items);cursor=result.nextCursor;
   if(cursor&&seen.has(cursor))throw Error('목록 연결 확인 필요');if(cursor)seen.add(cursor);
  }while(cursor);
  if(run!==epoch)throw Error('계정 또는 권한이 변경되었습니다.');
  const merged=new Map(rows.map(r=>[r.id,r]));for(const r of cache[type]||[]){const current=merged.get(r.id);if(!current||r.version>current.version)merged.set(r.id,r);}cache[type]=[...merged.values()];complete[type]=true;return cache[type];
 })().finally(()=>{if(run===epoch&&flights[type]===pending)delete flights[type];});
 flights[type]=pending;return pending;
}

function reset(){epoch++;cache={};flights={};complete={};usageCache=null;usageFlight=null;usageView='costs';}
const sources={meeting:'https://docs.google.com/spreadsheets/d/1Phnl7244HYoFLcVMw_u4zJ-KCZ1SrziQAfUIfDFmkBw/edit',content:'https://docs.google.com/spreadsheets/d/1KztjNTkAeu6aa82EGecJewU0W-DtK-PUGcGs_DRGQ5E/edit',sales:'https://docs.google.com/spreadsheets/d/1lgJpmwHFRQYT0XqXyZOdTiMswaPOmUj2e_36cFQrit0/edit#gid=2026100512',finance:'https://docs.google.com/spreadsheets/d/1N341S2gmxCWkpIiTy9A2Jj05C3ayWKFC-tNTS9IRX9Y/edit'};
function render(type,ctx){
 const {host,el,button,request,message,setDirty,setWriting}=ctx,run=epoch,spec=D.specs[type];
 if(type==='apiUsage')return usage(ctx);
 if(type==='glowny')return glowny(ctx);
 const link=(label,url)=>{const a=el('a','ce-link',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 const head=el('div','ce-section-heading');head.append(el('h2','',spec.label),button('새 기록',()=>edit()));host.append(head,el('p','ce-muted',spec.note));
 const flow=el('ol','ce-flow-steps');for(const step of spec.workflow)flow.append(el('li','',step));host.append(flow);
 if(spec.source){host.append(link('기존 원본 열기',sources[spec.source]));if(['meeting','content'].includes(spec.source)){const details=el('details','ce-project');details.append(el('summary','','하루 한 번 연결한 원본 보기'));const box=el('div');details.append(box);host.append(details);details.addEventListener('toggle',async()=>{if(!details.open||box.childNodes.length)return;box.append(el('p','ce-muted','원본 연결 확인 중'));try{const r=await request('companySourceSnapshot',{kind:spec.source});if(run!==epoch||!box.isConnected)return;box.replaceChildren();box.append(el('p','ce-muted',r.status?.status==='needs_attention'?'원본 연결 확인 필요 · 마지막 성공 자료가 있으면 함께 표시합니다.':r.snapshot?'원본 확인 '+new Date(r.snapshot.readAt).toLocaleString('ko-KR'):'아직 원본을 읽은 기록이 없습니다.'));for(const t of r.snapshot?.tables||[]){box.append(el('h3','',t.range));table(box,t.rows,el);}if(r.snapshot?.coverage)box.append(el('p','ce-muted',r.snapshot.coverage));}catch(e){if(box.isConnected)box.replaceChildren(el('p','ce-error',e.message));}});}}
 const controls=el('div','ce-list-tools'),search=el('input');search.type='search';search.placeholder='검색';search.setAttribute('aria-label','검색');const archived=el('input');archived.type='checkbox';const archiveLabel=el('label');archiveLabel.append(archived,document.createTextNode('보관 포함'));const searchLabel=el('label','ce-search');searchLabel.append(search);controls.append(searchLabel,archiveLabel);host.append(controls);const list=el('div','ce-projects');host.append(list);
 function draw(){list.replaceChildren();const rows=(cache[type]||[]).filter(r=>(archived.checked||!r.archived)&&JSON.stringify(r.values).toLowerCase().includes(search.value.toLowerCase())).sort((a,b)=>b.updatedAt-a.updatedAt);if(!rows.length)list.append(el('p','ce-empty',cache[type]?'아직 기록이 없습니다.':'저장된 기록을 확인하고 있습니다.'));for(const r of rows){const card=el('details','ce-project cw-card'),sum=el('summary','',r.values.title+' · '+r.status+(r.archived?' · 보관':''));card.append(sum,el('p','ce-muted',[r.values.productCode,r.values.assigneeName,r.values.dueDate].filter(Boolean).join(' · ')));for(const f of spec.fields){const v=r.values[f.key];if(v===''||v===undefined||v===null)continue;const row=el('p');row.append(el('strong','',f.label+' · '));if(f.type==='url')row.append(link('열기',v));else row.append(document.createTextNode(String(v)));card.append(row);}for(const [name,value]of Object.entries(D.metrics(type,r.values))){const isRate=['판매율','반품률','CTR'].includes(name),formatted=value===null?'미확인':isRate?(value*100).toFixed(1)+'%':name==='ROAS'?value.toFixed(2)+'배':Math.round(value).toLocaleString('ko-KR');card.append(el('p','',name+' · '+formatted+(type==='reaction'&&r.values.sampleState!=='비교 가능'?' · 잠정':'')));}card.append(el('p','ce-muted',r.id+' · 수정 '+new Date(r.updatedAt).toLocaleString('ko-KR')),button(r.archived?'복원':'보관',()=>archiveRecord(r)));if(!r.archived)card.append(button('수정',()=>edit(r)));productHistory(r,card);list.append(card);}}
 search.addEventListener('input',draw);archived.addEventListener('change',draw);draw();
 if(!complete[type])readRecords(type,request,run).then(()=>{if(run===epoch&&list.isConnected)draw();}).catch(e=>{if(run===epoch&&list.isConnected)list.replaceChildren(el('p','ce-error',e.message));});
 async function archiveRecord(r){setWriting(true);try{await request('workflowArchive',{type,id:r.id,expectedVersion:r.version,requestId:'req-'+root.crypto.randomUUID(),archived:!r.archived});const checked=await request('workflowGet',{type,id:r.id});if(run!==epoch)return;cache[type]=(cache[type]||[]).map(x=>x.id===r.id?checked.item:x);draw();message('보관 상태를 저장하고 다시 확인했습니다.');}catch(e){message(e.message,true);}finally{if(run===epoch)setWriting(false);}}

 function productHistory(record,card){
  if(!ProductLinks.types.includes(record.type))return;
  const details=el('details','ce-project cw-product-history'),summary=el('summary','','상품 연결 이력'),box=el('div');
  details.append(summary,box);card.append(details);let loaded=false,pending=false;
  details.addEventListener('toggle',async()=>{
   if(!details.open||loaded||pending||run!==epoch)return;
   if(!ProductLinks.available(record)){box.replaceChildren(el('p','ce-muted','품번 또는 기획·영상 ID를 입력하면 연결 이력이 표시됩니다.'));return;}
   pending=true;box.replaceChildren(el('p','ce-muted','저장된 연결 이력을 확인하고 있습니다.'));
   const outcomes=await Promise.all(ProductLinks.types.map(async kind=>{
    try{await readRecords(kind,request,run);return {kind,ok:true};}catch(error){return {kind,ok:false,error};}
   }));
   pending=false;if(run!==epoch||!box.isConnected)return;loaded=true;box.replaceChildren();
   const failed=outcomes.filter(x=>!x.ok);
   if(failed.length){box.append(el('p','ce-error','연결 확인 필요: '+failed.map(x=>D.specs[x.kind].label).join(', ')),button('실패한 목록 다시 확인',()=>{loaded=false;details.open=false;details.open=true;}));}
   const items=ProductLinks.records(record,ProductLinks.types.flatMap(k=>cache[k]||[]));
   if(!items.length){box.append(el('p','ce-muted',failed.length?'일부 이력을 확인하지 못했습니다.':'같은 품번·기획·영상 ID로 연결된 기록이 아직 없습니다.'));return;}
   const wrap=el('div','ce-table-scroll'),table=el('table','ce-table'),thead=el('thead'),tr=el('tr');
   for(const label of ['업무','기록 상태','대상·일정','다음 행동','열기'])tr.append(el('th','',label));thead.append(tr);table.append(thead);const tbody=el('tbody');
   for(const item of items){const v=item.values||{},row=el('tr');row.append(el('td','',D.specs[item.type].label),el('td','',item.status));
    row.append(el('td','',[v.productCode,v.orderType,v.meetingDate||v.dueDate||v.periodEnd].filter(Boolean).join(' · ')),el('td','',v.nextAction||''));
    const cell=el('td');cell.append(button('기록 보기',()=>edit(item,{},item.type)));row.append(cell);tbody.append(row);}
   table.append(tbody);wrap.append(table);box.append(wrap,el('p','ce-muted','기존 기록의 상태입니다. 실제 발주·상품등록·광고 집행 결과는 각 기록의 근거로 확인합니다.'));
   const actions=el('div','ce-actions'),next=el('select');next.setAttribute('aria-label','연결할 다음 업무');
   for(const kind of ProductLinks.types.filter(k=>k!==record.type||k==='meeting')){const option=el('option','',D.specs[kind].label);option.value=kind;next.append(option);}
   if(['reaction','campaign'].includes(record.type))next.value='meeting';
   actions.append(next,button('다음 업무 준비',()=>{try{edit(null,ProductLinks.seed(record,next.value),next.value,record);}catch(e){message(e.message,true);}}));box.append(actions);
  });
 }

 function edit(record,seed={},editType=type,origin=null){
  const spec=D.specs[editType];if(!spec)return;
  let base=record,saving=false,pendingAttempt=null;
  setDirty(true);host.replaceChildren();host.append(el('h2','',spec.label+' · '+(record?'수정':'새 기록')),el('p','ce-muted',spec.note));
  if(origin)host.append(el('p','ce-muted','이전 기록의 품번·기획 ID와 검토 근거를 가져왔습니다. 담당자·일정을 확인하고 저장하세요.'));
  const form=el('form','ce-form'),inputs={};
  for(const f of [{key:'status',label:'상태',type:'select',options:D.statusOptions},...spec.fields]){
   const label=el('label','ce-field'),input=el(f.type==='textarea'?'textarea':f.type==='select'?'select':'input');label.append(el('span','',f.label));
   if(f.options)for(const option of f.options){const n=el('option','',option);n.value=option;input.append(n);}else if(f.type!=='textarea')input.type=['date','number','url'].includes(f.type)?f.type:'text';
   if(f.type==='number')input.step='any';else input.maxLength=f.type==='textarea'?4000:2048;
   input.name=f.key;input.value=f.key==='status'?record?.status||'대기':record?.values[f.key]??seed[f.key]??'';
   if(f.key==='title'||origin&&editType==='meeting'&&f.key==='meetingDate')input.required=true;
   label.append(input);form.append(label);inputs[f.key]=input;
  }
  const actions=el('div','ce-actions'),save=el('button','ce-button','저장'),cancel=button('취소',()=>{setDirty(false);ctx.redraw();});save.type='submit';actions.append(save,cancel);form.append(actions);host.append(form);
  let recordId=record?.id||'record-'+root.crypto.randomUUID(),lastFingerprint='',requestId='';
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(saving||run!==epoch||!host.isConnected||!form.reportValidity())return;
   saving=true;save.disabled=cancel.disabled=true;setWriting(true);
   const values={...(base?.values||{})};for(const f of spec.fields){const v=inputs[f.key].value.trim();values[f.key]=f.type==='number'&&v!==''?Number(v):v;}
   const status=inputs.status.value,fingerprint=JSON.stringify({values,status});
   try{
    if(origin){
     const identity=ProductLinks.handoffKey(origin,editType,values.meetingDate);
     if(!root.crypto?.subtle)throw Error('안전한 연결 저장을 사용할 수 없습니다. HTTPS 주소에서 다시 열어 주세요.');
     const hash=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
     if(run!==epoch||!host.isConnected)return;
     recordId='handoff-'+Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
     let existing;try{existing=await request('workflowGet',{type:editType,id:recordId});}catch(error){if(error.message!=='not_found'&&error.code!=='not_found')throw error;}
     if(run!==epoch||!host.isConnected)return;
     if(existing?.item){if(existing.item.id!==recordId||existing.item.type!==editType)throw Error('연결된 기록을 확인하지 못했습니다.');if(existing.item.archived)throw Error('같은 연결 기록이 보관되어 있습니다. 해당 업무에서 보관 포함으로 확인해 주세요.');
      if(pendingAttempt&&fingerprint===lastFingerprint&&ProductLinks.verified(existing,existing,pendingAttempt)){cache[editType]=[...(cache[editType]||[]).filter(x=>x.id!==recordId),existing.item];setDirty(false);setWriting(false);ctx.redraw();message('이전 저장 결과를 확인했습니다. 중복으로 만들지 않았습니다.');return;}throw Error('같은 원본에서 이미 연결한 기록이 있습니다. 입력은 유지했습니다. 취소 후 상품 연결 이력에서 기존 기록을 확인해 주세요.');}
    }
    if(pendingAttempt&&fingerprint!==lastFingerprint){
     let current;try{current=await request('workflowGet',{type:editType,id:recordId});}catch(error){if(error.message!=='not_found'&&error.code!=='not_found')throw error;}
     if(run!==epoch||!host.isConnected)return;
     if(current?.item&&current.item.version>pendingAttempt.expectedVersion)throw Error('이전 저장이 이미 반영됐거나 다른 곳에서 수정했습니다. 입력은 유지했습니다. 내용을 복사한 뒤 취소하여 최신 기록과 합쳐 주세요.');
    }
    if(fingerprint!==lastFingerprint){requestId='req-'+root.crypto.randomUUID();lastFingerprint=fingerprint;}
    const payload={type:editType,id:recordId,requestId,expectedVersion:base?.version||0,status,values};pendingAttempt=payload;
    const saved=await request('workflowSave',payload),checked=await request('workflowGet',{type:editType,id:recordId});
    if(run!==epoch||!host.isConnected)return;
    if(!ProductLinks.verified(saved,checked,payload))throw Error('저장 결과가 입력 내용과 다르거나 이후 수정됐습니다. 입력은 유지했습니다. 최신 기록을 확인해 주세요.');
    cache[editType]=[...(cache[editType]||[]).filter(x=>x.id!==recordId),checked.item];pendingAttempt=null;
    setDirty(false);setWriting(false);ctx.redraw();message(origin?'다음 업무에 연결해 저장했습니다. 구글 운영대장은 다음 일일 연결에 반영합니다.':'저장하고 다시 확인했습니다. 구글 운영대장은 다음 일일 연결에 반영합니다.');
   }catch(error){if(run===epoch&&host.isConnected){message(error.message,true);save.disabled=cancel.disabled=false;}}
   finally{if(run===epoch){saving=false;setWriting(false);}}
  });
 }

}
function glowny(ctx){
 const {host:parentHost,el,button,request,message,setDirty,setWriting}=ctx,run=epoch,type='glowny',host=el('div','cg-workspace');parentHost.append(host);
 const groups=[['guide','개발 기준'],['candidate','개발 후보'],['market','판매순'],['eunyeong','은영님 사진'],['brand','브랜드'],['performance','판매·반품'],['validation','검증 계획']];
 let current='guide',query='',selected=null;
 const isGuide=r=>String(r.values.planningId||'').startsWith('GUIDE-');
 const stageIds=['GUIDE-ACQUIRE','GUIDE-EXPERIENCE','GUIDE-REPEAT'];
 const isPrice=r=>String(r.values.planningId||'').startsWith('GUIDE-PRICE-');
 const numeric=value=>{const text=String(value??'').replace(/,/g,'').trim();return text!==''&&/^\d+(\.\d+)?$/.test(text)?Number(text):NaN;};
 const money=value=>Number.isFinite(value)?Math.floor(value).toLocaleString('ko-KR')+'원':'확인 필요';
 const safe=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch(_){return null;}};
 const link=(label,value)=>{const url=safe(value);if(!url)return null;const a=el('a','ce-link',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 const appendLink=(box,label,value)=>{const a=link(label,value);if(a)box.append(a);};
 const field=(box,label,value)=>{if(value===undefined||value===null||value==='')return;const row=el('div','cg-field');row.append(el('h3','',label),el('p','',String(value)));box.append(row);};
 const rows=()=> (cache[type]||[]).filter(r=>!r.archived).sort((a,b)=>(Number(a.values.order)||0)-(Number(b.values.order)||0)||a.id.localeCompare(b.id));
 function photo(record,large=false){
  const v=record.values,url=safe(large?(v.originalImageUrl||v.imageUrl):v.imageUrl),box=el('div','cg-photo');
  if(!url){box.append(el('p','ce-muted','사진 연결 전'));return box;}
  const img=el('img');img.alt=v.title||'참고 사진';img.loading=large?'eager':'lazy';img.decoding='async';img.referrerPolicy='no-referrer';
  img.addEventListener('error',()=>{img.hidden=true;box.querySelector('.cg-image-error')?.remove();const err=el('div','cg-image-error');err.append(el('p','ce-muted','사진을 불러오지 못했습니다.'),button('사진 다시 불러오기',()=>{err.remove();img.hidden=false;img.src=url;}));box.append(err);});
  // Existing AiselMedia intercepts private Storage URLs and performs authorized reads.
  img.src=url;box.append(img);
  if(!large){const open=button('사진 크게 보기',()=>lightbox(record),'ce-link cg-photo-open');box.append(open);}return box;
 }
 function lightbox(record){
  const dialog=el('dialog','cg-lightbox'),prior=document.activeElement,close=button('닫기',()=>dialog.close());dialog.setAttribute('aria-label',record.values.title+' 사진');dialog.append(close,photo(record,true),el('p','',record.values.title));host.append(dialog);
  const cleanup=()=>{dialog.remove();prior?.focus?.();};dialog.addEventListener('close',cleanup,{once:true});dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.showModal();close.focus();
 }
 function header(){
  const head=el('div','ce-section-heading');head.append(el('div','',undefined));head.firstChild.append(el('h2','','글로니 Like'),el('p','ce-muted','사진과 판매 근거를 함께 보고, 에이슬 적용안과 다음 검증을 정리합니다.'));
  const refresh=button('새로고침',()=>fetchRows(true));refresh.disabled=!!flights[type];const headActions=el('div','ce-actions');headActions.style.marginTop='0';headActions.append(refresh,button('자료 가져오기',()=>importer()));head.append(headActions);host.append(head);
  const overview=rows().find(r=>r.values.collection==='overview');
  if(overview&&current!=='guide'){const v=overview.values,brief=el('div','cg-brief');if(v.application)brief.append(el('p','',v.application));if(v.observedAt)brief.append(el('p','ce-muted',v.observedAt));const actions=el('div','ce-actions');appendLink(actions,'구글시트',v.sheetUrl);appendLink(actions,'구글 프레젠테이션',v.slidesUrl);if(actions.childNodes.length)brief.append(actions);host.append(brief);}
 }
 function importer(){
  setDirty(true);host.replaceChildren();host.append(el('h2','','글로니 자료 가져오기'),el('p','ce-muted','준비된 자료와 사진을 이 작업공간에 추가합니다. 같은 ID의 기존 자료는 유지합니다.'));
  const jsonLabel=el('label','ce-field'),jsonFile=el('input');jsonFile.type='file';jsonFile.accept='.json,application/json';jsonLabel.append(el('span','','자료 파일'),jsonFile);
  const pasted=el('textarea');pasted.setAttribute('aria-label','자료 내용');pasted.placeholder='자료 파일을 선택하거나 준비된 JSON 내용을 붙여넣으세요.';pasted.rows=8;
  const photosLabel=el('label','ce-field'),photos=el('input');photos.type='file';photos.multiple=true;photos.accept='image/jpeg,image/png,image/webp';photosLabel.append(el('span','','함께 넣을 사진'),photos);
  const note=el('p','ce-muted'),preview=el('div','cg-import-preview'),actions=el('div','ce-actions');let prepared=null,busy=false;
  const cancel=button('목록으로',()=>{setDirty(false);draw();}),check=button('자료 확인',()=>prepare()),save=button('확인한 자료 저장',()=>commit());save.disabled=true;actions.append(check,save,cancel);host.append(jsonLabel,pasted,photosLabel,note,preview,actions);
  function invalidated(){prepared=null;save.disabled=true;preview.replaceChildren();note.textContent='자료를 확인한 뒤 저장할 수 있습니다.';}
  pasted.addEventListener('input',invalidated);photos.addEventListener('change',invalidated);
  jsonFile.addEventListener('change',async()=>{invalidated();const f=jsonFile.files[0];if(!f)return;if(f.size>2000000){note.textContent='자료 파일은 2MB 이하로 나눠 주세요.';return;}try{pasted.value=await f.text();if(run!==epoch||!host.isConnected)return;prepare();}catch(e){note.textContent='자료 파일을 읽지 못했습니다.';}});
  function prepare(){
   if(busy)return;prepared=null;save.disabled=true;preview.replaceChildren();
   try{
    if(pasted.value.length>2000000)throw Error('자료를 2MB 이하로 나눠 주세요.');const raw=JSON.parse(pasted.value),records=Array.isArray(raw)?raw:raw.records;
    if(!Array.isArray(records)||!records.length||records.length>200)throw Error('한 번에 1~200개 자료를 넣을 수 있습니다.');
    const ids=new Set(),files=new Map();for(const f of photos.files){if(files.has(f.name))throw Error('같은 이름의 사진이 둘 있습니다: '+f.name);files.set(f.name,f);}
    const known=new Set((cache[type]||[]).map(r=>r.id));let skipped=0;
    const clean=[];for(const r of records){
     if(!r||!/^[-A-Za-z0-9_]{8,100}$/.test(r.id)||ids.has(r.id))throw Error('자료 ID가 잘못되었거나 겹칩니다.');ids.add(r.id);
     if(known.has(r.id)){skipped++;continue;}const v=r.values;
     if(!v||typeof v!=='object'||Array.isArray(v)||!v.title||!D.specs.glowny.fields.find(f=>f.key==='collection').options.includes(v.collection))throw Error('자료명과 구분을 확인해 주세요.');
     for(const [key,value]of Object.entries(v)){const f=D.specs.glowny.fields.find(f=>f.key===key);if(!f)throw Error('등록되지 않은 자료 항목: '+key);if(value===''||value===null)continue;if(f.type==='number'){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12)throw Error('숫자 확인: '+key);continue;}if(typeof value!=='string'||value.length>(f.type==='textarea'?4000:2048)||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw Error('자료 길이·형식 확인: '+key);if(f.type==='select'&&!f.options.includes(value))throw Error('선택값 확인: '+key);if(f.type==='url'&&!safe(value))throw Error('https 링크를 확인해 주세요: '+key);if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error('날짜 확인: '+key);}
     const status=r.status||'대기';if(!D.statusOptions.includes(status)||status==='완료'&&!v.evidence)throw Error('검토 상태와 근거를 확인해 주세요.');if(v.productCode&&!/^AS-[A-Za-z0-9-]{1,100}$/.test(v.productCode))throw Error('기존 품번을 확인해 주세요.');
     const file=r.photoFile?files.get(r.photoFile):null;if(r.photoFile&&!file)throw Error('함께 넣을 사진을 선택해 주세요: '+r.photoFile);if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024))throw Error('사진은 JPG·PNG·WebP, 20MB 이하로 준비해 주세요.');
     if(JSON.stringify(v).length>28000)throw Error('한 자료의 내용을 28KB 이하로 나눠 주세요.');clean.push({id:r.id,status,values:{...v},file,requestId:'req-'+root.crypto.randomUUID()});
    }
    prepared=clean;note.textContent='새 자료 '+clean.length+'개 · 기존 자료 유지 '+skipped+'개 · 사진 '+clean.filter(r=>r.file).length+'개';
    for(const r of clean){const p=el('p');p.append(el('strong','',r.values.title),document.createTextNode(' · '+r.values.collection+' · '+(r.values.decision||'판단 미입력')+(r.file?' · '+r.file.name:'')));preview.append(p);}save.disabled=!clean.length;
   }catch(e){note.textContent=e.message;}
  }
  async function commit(){
   if(busy||!prepared?.length)return;busy=true;setWriting(true);for(const control of [check,save,cancel,jsonFile,pasted,photos])control.disabled=true;let done=0;
   try{
    for(const r of prepared){
     if(run!==epoch||!host.isConnected)throw Error('화면이나 로그인 상태가 변경되었습니다.');note.textContent='저장 확인 중 '+(done+1)+' / '+prepared.length+' · '+r.values.title;
     if(r.file){
      if(!root.AiselMedia||!await root.AiselMedia.ready())throw Error('보호된 사진 저장 연결을 확인해야 합니다.');
      const bytes=await r.file.arrayBuffer(),hash=[...new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join(''),base='moodboardRefPhotos/glowny-like/'+r.id+'/'+hash;
      const bitmap=await createImageBitmap(r.file);let thumb;try{const scale=Math.min(1,960/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);thumb=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.86));}finally{bitmap.close();}if(!thumb)throw Error('미리보기 사진을 준비하지 못했습니다.');
      if(run!==epoch)throw Error('로그인 상태가 변경되었습니다.');const original=await root.AiselMedia.upload({fullPath:base+'/original'},r.file);if(run!==epoch)throw Error('로그인 상태가 변경되었습니다.');const small=await root.AiselMedia.upload({fullPath:base+'/thumb'},thumb);if(run!==epoch)throw Error('로그인 상태가 변경되었습니다.');if(!safe(original)||!safe(small)||!root.AiselMedia.pathOf(original)||!root.AiselMedia.pathOf(small))throw Error('보호된 사진 저장 결과를 확인해야 합니다.');await root.AiselMedia.imageURL(small);r.values.originalImageUrl=original;r.values.imageUrl=small;
     }
     const saved=await request('workflowSave',{type,id:r.id,expectedVersion:0,requestId:r.requestId,status:r.status,values:r.values}),checked=await request('workflowGet',{type,id:r.id});if(run!==epoch)throw Error('로그인 상태가 변경되었습니다.');if(!saved.item||!checked.item||checked.item.version<saved.item.version)throw Error('저장된 자료를 다시 확인해야 합니다.');cache[type]=[...(cache[type]||[]).filter(x=>x.id!==r.id),checked.item];done++;
    }
    setDirty(false);setWriting(false);draw();message('자료 '+done+'개와 연결 사진을 저장하고 다시 확인했습니다.');
   }catch(e){if(run===epoch&&host.isConnected){note.textContent='저장 확인 '+done+'개. '+e.message;message(e.message,true);prepared=null;save.disabled=true;for(const control of [check,cancel,jsonFile,pasted,photos])control.disabled=false;}}
   finally{if(run===epoch){busy=false;setWriting(false);}}
  }
 }
 function detail(record){
  const v=record.values;host.append(button('목록으로',()=>{selected=null;draw();},'ce-link'),el('h2','',v.title));
  const layout=el('div','cg-detail'),media=el('div'),body=el('div');media.append(photo(record));layout.append(media,body);host.append(layout);
  field(body,'자료',[[...groups,['overview','전체 방향']].find(([key])=>key===v.collection)?.[1],v.planningId,v.referenceBrand].filter(Boolean).join(' · '));
  for(const [key,label]of [['rankLabel','판매순 관찰'],['observedAt','확인 시각·기간'],['priceText','확인 가격'],['decision','검토 판단'],['reference','관찰한 특징·기존 자산'],['mechanism','작동 원리·살 이유'],['application','에이슬 적용안'],['counterEvidence','반대 근거·반품 위험'],['evidence','판매·반품·출처 근거'],['relatedProduct','기존 상품·코디 연결'],['nextAction','다음 검증'],['reviewNote','검토 메모'],['assigneeName','검토 담당'],['dueDate','다음 확인일']])field(body,label,v[key]);
  const links=el('div','ce-actions');appendLink(links,'원상품·근거',v.sourceUrl);appendLink(links,'구글시트',v.sheetUrl);appendLink(links,'구글 프레젠테이션',v.slidesUrl);body.append(links);
  if(v.productCode&&/^AS-[A-Za-z0-9-]{1,100}$/.test(v.productCode))body.append(button('연결 작업지시서',()=>root.AiselUnified?.show('editor',{code:v.productCode}),'ce-link'));
  body.append(el('p','ce-muted','검토 상태 '+record.status+' · 수정 '+new Date(record.updatedAt).toLocaleString('ko-KR')),button('검토 메모·상태 수정',()=>edit(record)));
 }

 function guide(){
  const list=rows().filter(isGuide),section=el('section','cg-guide');section.setAttribute('aria-label','상품 개발 기준');host.append(section);
  const actions=el('div','ce-actions cg-guide-actions'),add=button('기준 추가',()=>edit(null));add.disabled=!cache[type];actions.append(add);
  const source=list.find(r=>r.values.sourceUrl),sheet=list.find(r=>r.values.sheetUrl);if(source)appendLink(actions,'개발 가이드',source.values.sourceUrl);if(sheet)appendLink(actions,'구글시트',sheet.values.sheetUrl);section.append(actions);
  if(!list.length){section.append(el('p','ce-empty',cache[type]?'등록된 개발 기준이 없습니다. 기준을 추가하거나 자료를 가져오세요.':'저장된 개발 기준을 확인하고 있습니다.'));return;}
  const stages=el('div','cg-guide-stages');
  for(const key of stageIds){const r=list.find(x=>x.values.planningId===key);if(!r)continue;const v=r.values,card=el('article','cg-guide-stage');card.append(el('span','ce-muted',v.rankLabel||''),el('h3','',v.title),el('p','cg-guide-lead',v.mechanism||''),el('p','',v.application||''));const b=button('수정',()=>edit(r));b.setAttribute('aria-label',v.title+' 수정');card.append(b);stages.append(card);}if(stages.childNodes.length)section.append(stages);
  function makeTable(title,headers,items,render){
   if(!items.length)return;const box=el('section','cg-guide-section');box.append(el('h3','',title));const table=el('table','ce-table cg-guide-table'),thead=el('thead'),head=el('tr');for(const name of headers)head.append(el('th','',name));thead.append(head);table.append(thead);const body=el('tbody');
   for(const r of items){const tr=el('tr'),cells=render(r);cells.forEach((value,i)=>{const td=el('td');td.dataset.label=headers[i];if(value?.nodeType)td.append(value);else td.textContent=String(value??'');tr.append(td);});const td=el('td');td.dataset.label='수정';const b=button('수정',()=>edit(r));b.setAttribute('aria-label',r.values.title+' 수정');td.append(b);tr.append(td);body.append(tr);}table.append(body);box.append(table);section.append(box);
  }
  const policy=list.find(r=>r.values.planningId==='GUIDE-COST'),factor=numeric(policy?.values.reference),shipping=numeric(policy?.values.mechanism),valid=Number.isFinite(factor)&&factor>0&&Number.isFinite(shipping)&&Number.isInteger(shipping)&&shipping>=0;
  if(policy){const p=el('div','cg-guide-policy'),v=policy.values;p.append(el('strong','',v.title),el('p','',valid?'판매가 = 총제작원가 × '+factor+' + '+money(shipping)+' · 원가 한도 = (판매가 − '+money(shipping)+') ÷ '+factor:'배수와 택배비를 확인해 주세요.'),el('p','',v.application||''));if(v.counterEvidence)p.append(el('p','ce-muted',v.counterEvidence));const b=button('계산 기준 수정',()=>edit(policy));p.append(b);section.append(p);}
  makeTable('가격별 제작원가 한도',['구분','판매가','원가 한도','적용 기준','수정'],list.filter(isPrice),r=>{const price=numeric(r.values.priceText);return[r.values.title,money(price),valid&&Number.isInteger(price)&&price>shipping?money((price-shipping)/factor):'계산 기준 확인',r.values.application||''];});
  makeTable('상품 개발·판매 판단',['항목','핵심 기준','적용·확인','수정'],list.filter(r=>!stageIds.includes(r.values.planningId)&&!isPrice(r)&&r!==policy),r=>{const box=el('div');if(r.values.application)box.append(el('p','',r.values.application));if(r.values.counterEvidence)box.append(el('p','ce-muted','점검 · '+r.values.counterEvidence));if(r.values.nextAction)box.append(el('p','ce-muted','다음 · '+r.values.nextAction));return[r.values.title,r.values.mechanism||'',box];});
  section.append(el('p','ce-muted','항목별 수정 후 저장하면 다음 접속에도 유지됩니다. 구글시트에는 다음 일일 연결 때 반영됩니다.'));
 }

 function draw(){
  if(run!==epoch||!host.isConnected)return;host.replaceChildren();header();if(selected){const record=rows().find(r=>r.id===selected);if(record){detail(record);return;}selected=null;}
  const listRows=rows(),tabs=el('div','cg-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','글로니 자료 보기');
  for(const [key,label]of groups){const count=listRows.filter(r=>key==='guide'?isGuide(r):r.values.collection===key&&!isGuide(r)).length,b=button(label+(cache[type]?' '+count:''),()=>{current=key;query='';draw();});b.setAttribute('aria-pressed',String(current===key));tabs.append(b);}host.append(tabs);
  if(current==='guide'){guide();return;}
  const tools=el('div','ce-filters'),searchWrap=el('label','ce-search'),search=el('input');search.type='search';search.placeholder='검색';search.setAttribute('aria-label','글로니 자료 검색');search.value=query;searchWrap.append(search);tools.append(searchWrap);host.append(tools);
  if(current==='market')host.append(el('p','ce-muted','조회 당시 판매순 관찰입니다. 실제 판매수량·순이익이나 에이슬 제작 승인을 뜻하지 않습니다.'));
  const count=el('p','ce-muted'),grid=el('div','cg-grid');host.append(count,grid);
  function fill(){
   grid.replaceChildren();const found=listRows.filter(r=>!isGuide(r)&&r.values.collection===current&&[r.values.title,r.values.referenceBrand,r.values.planningId,r.values.reference,r.values.application,r.values.relatedProduct].join(' ').toLowerCase().includes(query.toLowerCase()));count.textContent=cache[type]?found.length+'개 자료':'';
   if(!found.length)grid.append(el('p','ce-empty',cache[type]?'이 보기에 해당하는 자료가 없습니다.':'저장된 자료를 확인하고 있습니다.'));
   for(const record of found){const v=record.values,card=el('article','cg-card');if(v.imageUrl)card.append(photo(record));const content=el('div','cg-card-body'),title=button(v.title,()=>{selected=record.id;draw();},'ce-project-open');content.append(title);if(v.rankLabel||v.referenceBrand)content.append(el('p','ce-muted',[v.rankLabel,v.referenceBrand].filter(Boolean).join(' · ')));if(v.priceText)content.append(el('p','ce-muted',v.priceText));if(v.decision)content.append(el('p','cg-decision',v.decision));for(const key of ['application','reference','nextAction'])if(v[key]){content.append(el('p','cg-excerpt',v[key]));break;}content.append(button('근거·적용안 보기',()=>{selected=record.id;draw();},'ce-link'));card.append(content);grid.append(card);}
  }
  search.addEventListener('input',()=>{query=search.value;fill();});fill();
 }
 async function fetchRows(force=false){
  if(run!==epoch)return;if(force)delete cache[type];
  if(!flights[type]){const pending=(async()=>{const all=[],seen=new Set();let cursor;do{const data=await request('workflowList',{type,limit:100,...(cursor?{cursor}:{})});if(!Array.isArray(data.items))throw Error('자료 목록을 확인해야 합니다.');all.push(...data.items);cursor=data.nextCursor;if(cursor&&seen.has(cursor))throw Error('다음 자료 연결을 확인해야 합니다.');if(cursor)seen.add(cursor);}while(cursor);if(run===epoch)cache[type]=[...new Map(all.map(r=>[r.id,r])).values()];})().finally(()=>{if(run===epoch&&flights[type]===pending)delete flights[type];});flights[type]=pending;}
  try{await flights[type];if(run===epoch&&host.isConnected)draw();}catch(e){if(run===epoch&&host.isConnected){message(e.message,true);host.replaceChildren(el('h2','','글로니 Like'),el('p','ce-error','자료를 불러오지 못했습니다. 확인되지 않은 내용을 0건으로 표시하지 않습니다.'),button('다시 확인',()=>fetchRows(true)));}}
 }

 function edit(existing){
  const record=existing||{id:'glowny-guide-'+root.crypto.randomUUID(),version:0,status:'대기',values:{title:'',collection:'brand',planningId:'GUIDE-CUSTOM-'+root.crypto.randomUUID(),order:100,decision:'검토 제안'}},guideRecord=isGuide(record),cost=record.values.planningId==='GUIDE-COST',price=isPrice(record);
  setDirty(true);host.replaceChildren();host.append(el('h2','',existing?record.values.title:'새 개발 기준'),el('p','ce-muted',guideRecord?'개발 기준을 수정한 뒤 저장해 주세요.':'상품의 살 이유·적용안과 검토 내용을 수정합니다.'));
  const keys=cost?['title','reference','mechanism','application','counterEvidence']:price?['title','priceText','application']:['title','mechanism','application','counterEvidence','reference','relatedProduct','decision','reviewNote','nextAction','evidence','assigneeName','dueDate'];
  const labels={title:guideRecord?'항목명':'자료명',mechanism:guideRecord?'핵심 기준':'USP · 이 옷을 살 이유',application:'적용·확인',counterEvidence:'반대 근거·위험',reference:'참고 근거',priceText:'판매가'};if(cost){labels.reference='원가 배수';labels.mechanism='택배비';}
  const form=el('form','ce-form cg-guide-form'),inputs={};
  const fields=[...keys.map(key=>D.specs.glowny.fields.find(f=>f.key===key)),...(!cost&&!price?[{key:'status',label:'자료 검토 상태',type:'select',options:D.statusOptions}]:[])];
  for(const f of fields){const label=el('label','ce-field'),number=price&&f.key==='priceText'||cost&&['reference','mechanism'].includes(f.key),input=el(number?'input':f.type==='textarea'?'textarea':f.type==='select'?'select':'input');label.append(el('span','',labels[f.key]||f.label));input.name=f.key;if(f.options)for(const option of f.options){const n=el('option','',option);n.value=option;input.append(n);}else if(number){input.type='number';input.step=cost&&f.key==='reference'?'any':'1';input.min=cost&&f.key==='mechanism'?'0':price?'1':'0.000001';input.required=true;}else if(f.type!=='textarea')input.type=f.type==='date'?'date':'text';input.value=f.key==='status'?record.status:record.values[f.key]??'';if(f.key==='title')input.required=true;input.maxLength=f.type==='textarea'?4000:2048;label.append(input);form.append(label);inputs[f.key]=input;}
  const note=el('p','ce-muted cg-guide-calc');note.setAttribute('aria-live','polite');if(price){const recalc=()=>{const p=rows().find(r=>r.values.planningId==='GUIDE-COST'),factor=numeric(p?.values.reference),shipping=numeric(p?.values.mechanism),retail=numeric(inputs.priceText.value);note.textContent=factor>0&&Number.isInteger(shipping)&&shipping>=0&&Number.isInteger(retail)&&retail>shipping?'제작원가 한도 · '+money((retail-shipping)/factor):'판매가와 계산 기준을 확인해 주세요.';};inputs.priceText.addEventListener('input',recalc);recalc();form.append(note);}
  const error=el('p','ce-error');error.setAttribute('role','alert');form.append(error);const actions=el('div','ce-actions'),save=el('button','ce-button','저장'),cancel=button('취소',()=>{setDirty(false);draw();});save.type='submit';actions.append(save,cancel);form.append(actions);host.append(form);let saving=false,lastFingerprint='',requestId='';
  form.addEventListener('submit',async e=>{e.preventDefault();if(saving||run!==epoch||!host.isConnected||!form.reportValidity())return;const values={...record.values};for(const key of keys)values[key]=inputs[key].value.trim();if(!values.title){error.textContent='항목명을 입력해 주세요.';return;}
   if(cost&&(!(numeric(values.reference)>0)||!Number.isInteger(numeric(values.mechanism))||numeric(values.mechanism)<0)||price&&(!Number.isInteger(numeric(values.priceText))||numeric(values.priceText)<=0)){error.textContent='배수·택배비·판매가를 올바른 숫자로 입력해 주세요.';return;}
   const status=inputs.status?.value||record.status;if(status==='완료'&&!values.evidence){error.textContent='완료로 저장하려면 근거를 입력해 주세요.';return;}
   const fingerprint=JSON.stringify({values,status});if(fingerprint!==lastFingerprint){requestId='req-'+root.crypto.randomUUID();lastFingerprint=fingerprint;}saving=true;save.disabled=cancel.disabled=true;error.textContent='';setWriting(true);
   try{const saved=await request('workflowSave',{type,id:record.id,expectedVersion:record.version,requestId,status,values}),checked=await request('workflowGet',{type,id:record.id});if(run!==epoch||!host.isConnected)return;if(!saved.item||!checked.item||checked.item.version<saved.item.version)throw Error('저장된 최신 기록을 확인해야 합니다.');cache[type]=[...(cache[type]||[]).filter(r=>r.id!==record.id),checked.item];setDirty(false);setWriting(false);draw();message('내용을 저장하고 다시 확인했습니다.');}
   catch(e){if(run===epoch&&host.isConnected){const text=String(e.code||'')+' '+e.message;error.textContent=text.includes('version_conflict')?'다른 곳에서 먼저 수정했습니다. 입력 내용은 유지했습니다. 내용을 복사한 뒤 취소·새로고침하여 최신 내용과 합쳐 주세요.':e.message;message(error.textContent,true);save.disabled=cancel.disabled=false;}}finally{if(run===epoch){saving=false;setWriting(false);}}
  });
 }

 draw();if(!cache[type])fetchRows();
}
function table(host,rows,el){const wrap=el('div','ce-table-scroll'),table=el('table','ce-table');for(const [i,values]of rows.entries()){const tr=el('tr');for(const v of values)tr.append(el(i===0?'th':'td','',String(v??'')));table.append(tr);}wrap.append(table);host.append(wrap);}
const USAGE_BOOK='https://docs.google.com/spreadsheets/d/1zkd_VXxnqw27LArmZ7lNfOhwQnTDjDGqnYrJrvRs-Xg/edit';
const USAGE_VIEWS={costs:{label:'비용 요약',gid:'2026111303'},audit:{label:'호출 점검',gid:'2026111302'},api:{label:'사용 내역',gid:'2026111121'}};
let usageView='costs',usageCache=null,usageFlight=null;
const usageIdentity=()=>{const s=root.AiselAccess?.session;return s?.active&&s.role==='owner'&&!s.passwordChangeRequired&&root.AiselManagement?.unlocked?[s.uid,s.credentialVersion||0].join(':'):'';};
async function readUsage(request,force=false){
 const identity=usageIdentity(),run=epoch,now=Date.now();
 if(!identity)throw Error('관리 영역에 다시 로그인해주세요.');
 if(usageCache?.identity===identity&&now-usageCache.at<(force?60000:300000))return usageCache;
 if(usageFlight?.identity===identity&&usageFlight.run===run)return usageFlight.promise;
 const flight={identity,run,promise:null};
 flight.promise=Promise.resolve().then(()=>request('companyApiUsage')).then(data=>{
  if(run!==epoch||identity!==usageIdentity())throw Error('계정 또는 관리 권한이 변경되었습니다.');
  if(!Array.isArray(data?.items))throw Error('사용량 응답을 확인하지 못했습니다.');
  return usageCache={identity,at:Date.now(),data};
 }).finally(()=>{if(usageFlight===flight)usageFlight=null;});
 usageFlight=flight;return flight.promise;
}
function usage({host,el,button,request}){
 const run=epoch,identity=usageIdentity();
 if(!identity){host.append(el('p','ce-error','관리 영역에 다시 로그인해주세요.'));return;}
 const panel=el('section','ce-usage-panel'),head=el('div','ce-section-heading'),link=el('a','ce-link','구글시트');
 link.target='_blank';link.rel='noopener noreferrer';head.append(el('h2','','사용량·비용'),link);
 const bar=el('div','ce-filters ce-usage-tabs');bar.setAttribute('aria-label','사용량·비용 보기');
 const body=el('div','ce-usage-body');panel.append(head,bar,body);host.append(panel);
 let selected='',revision=0;
 const valid=stamp=>run===epoch&&identity===usageIdentity()&&panel.isConnected&&revision===stamp;
 async function drawApi(force=false){
  const stamp=++revision;body.replaceChildren();
  body.append(el('p','ce-muted','이 앱에서 구글시트를 읽고 저장한 사용 내역입니다.'));
  const tools=el('div','ce-usage-tools'),readAt=el('span','ce-muted'),refresh=button('새로고침',()=>drawApi(true));
  refresh.disabled=true;tools.append(readAt,refresh);body.append(tools);const result=el('div');body.append(result);
  readAt.textContent='사용량 확인 중';
  try{
   const entry=await readUsage(request,force);if(!valid(stamp))return;
   readAt.textContent='확인 '+new Date(entry.at).toLocaleString('ko-KR')+' · 5분간 재사용';
   refresh.disabled=false;

   if(!entry.data.items.length)result.append(el('p','ce-empty','아직 집계된 호출이 없습니다. 과거 호출량은 미측정입니다.'));
   else{
    const groups=new Map(),dates=[...new Set(entry.data.items.map(x=>String(x.date||'')).filter(Boolean))].sort();let total=0;
    for(const x of entry.data.items){const count=Number(x.requests),source=String(x.source||'미분류');if(Number.isFinite(count)&&count>=0){groups.set(source,(groups.get(source)||0)+count);total+=count;}}
    const overview=el('section','ce-usage-overview');overview.setAttribute('aria-label','기능별 사용 요약');
    overview.append(el('p','ce-usage-total','기록된 사용 '+total.toLocaleString('ko-KR')+'회'),el('p','ce-muted',dates.length?dates[0]+(dates.length>1?' ~ '+dates[dates.length-1]:''):'기록 날짜 미확인'));
    const list=el('dl','ce-usage-summary');for(const [source,count]of [...groups].sort((a,b)=>b[1]-a[1])){const row=el('div');row.append(el('dt','',source),el('dd','',count.toLocaleString('ko-KR')+'회'));list.append(row);}overview.append(list,el('p','ce-muted','이 횟수만으로 Firebase 비용이나 과다 사용을 판단할 수는 없습니다.'));result.append(overview);
    const details=el('details','ce-usage-details');details.append(el('summary','','개발자 상세'));if(entry.data.scope)details.append(el('p','ce-muted',entry.data.scope));result.append(details);
    const labels=['한국 날짜','항목','읽기·쓰기','요청','성공','실패','응답 대기'];
    const wrap=el('div','ce-usage-results'),grid=el('table','ce-usage-table'),head=el('thead'),header=el('tr'),rows=el('tbody');
    grid.setAttribute('aria-label','Google API 사용 내역');
    for(const label of labels){const th=el('th','',label);th.scope='col';header.append(th);}head.append(header);grid.append(head,rows);
    for(const x of entry.data.items){
     const row=el('tr'),values=[x.date,x.source,x.method==='read'?'읽기':x.method==='write'?'쓰기':x.method||'미확인',x.requests,x.success,x.failed,x.inFlight];
     values.forEach((value,i)=>{const cell=el('td','',String(value??''));cell.dataset.label=labels[i];row.append(cell);});rows.append(row);
    }wrap.append(grid);details.append(wrap);
   }
  }catch(error){if(valid(stamp)){readAt.textContent='';refresh.disabled=false;result.append(el('p','ce-error',error.message));}}
 }
 function choose(key){
  if(selected===key)return;selected=key;usageView=key;revision++;
  const view=USAGE_VIEWS[key];link.href=USAGE_BOOK+'#gid='+view.gid;
  for(const b of bar.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.usageView===key));
  body.replaceChildren();
  if(key==='api'){drawApi();return;}
  body.append(el('p','ce-muted',key==='costs'?'비용·예산 상태와 줄일 부분만 요약합니다. 마지막으로 기록한 청구 내역 기준입니다.':'불필요한 호출, 유지할 호출, 조치와 검증 결과를 기록합니다.'));
  const frame=el('iframe','ce-usage-frame');frame.title='사용량·비용 · '+view.label;frame.loading='lazy';frame.referrerPolicy='strict-origin-when-cross-origin';
  frame.src=USAGE_BOOK+'?rm=minimal&gid='+view.gid+'#gid='+view.gid+'&range=A1';body.append(frame);
  body.append(el('p','ce-muted','같은 구글시트에 바로 기록됩니다. 표가 보이지 않으면 오른쪽 위 구글시트에서 Google 로그인을 확인해주세요.'));
 }
 for(const [key,view]of Object.entries(USAGE_VIEWS)){const b=button(view.label,()=>choose(key));b.dataset.usageView=key;bar.append(b);}
 choose(usageView);
}
root.AiselWorkflows=Object.freeze({render,reset,productLinks:ProductLinks});
})(window);


