(function(root){'use strict';
const D=root.AiselWorkflowDomain;if(!D)return;let epoch=0,cache={},flights={};
function reset(){epoch++;cache={};flights={};}
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
 function draw(){list.replaceChildren();const rows=(cache[type]||[]).filter(r=>(archived.checked||!r.archived)&&JSON.stringify(r.values).toLowerCase().includes(search.value.toLowerCase())).sort((a,b)=>b.updatedAt-a.updatedAt);if(!rows.length)list.append(el('p','ce-empty',cache[type]?'아직 기록이 없습니다.':'저장된 기록을 확인하고 있습니다.'));for(const r of rows){const card=el('details','ce-project cw-card'),sum=el('summary','',r.values.title+' · '+r.status+(r.archived?' · 보관':''));card.append(sum,el('p','ce-muted',[r.values.productCode,r.values.assigneeName,r.values.dueDate].filter(Boolean).join(' · ')));for(const f of spec.fields){const v=r.values[f.key];if(v===''||v===undefined||v===null)continue;const row=el('p');row.append(el('strong','',f.label+' · '));if(f.type==='url')row.append(link('열기',v));else row.append(document.createTextNode(String(v)));card.append(row);}for(const [name,value]of Object.entries(D.metrics(type,r.values))){const isRate=['판매율','반품률','CTR'].includes(name),formatted=value===null?'미확인':isRate?(value*100).toFixed(1)+'%':name==='ROAS'?value.toFixed(2)+'배':Math.round(value).toLocaleString('ko-KR');card.append(el('p','',name+' · '+formatted+(type==='reaction'&&r.values.sampleState!=='비교 가능'?' · 잠정':'')));}card.append(el('p','ce-muted',r.id+' · 수정 '+new Date(r.updatedAt).toLocaleString('ko-KR')),button(r.archived?'복원':'보관',()=>archiveRecord(r)));if(!r.archived)card.append(button('수정',()=>edit(r)));list.append(card);}}
 search.addEventListener('input',draw);archived.addEventListener('change',draw);draw();
 if(!cache[type]){if(!flights[type])flights[type]=(async()=>{const rows=[],seen=new Set();let cursor;do{const r=await request('workflowList',{type,limit:100,...(cursor?{cursor}:{})});rows.push(...r.items);cursor=r.nextCursor;if(cursor&&seen.has(cursor))throw Error('목록 연결 확인 필요');seen.add(cursor);}while(cursor);if(run===epoch)cache[type]=rows;})().finally(()=>{if(run===epoch)delete flights[type];});flights[type].then(()=>{if(run===epoch&&list.isConnected)draw();}).catch(e=>{if(list.isConnected)list.replaceChildren(el('p','ce-error',e.message));});}
 async function archiveRecord(r){setWriting(true);try{await request('workflowArchive',{type,id:r.id,expectedVersion:r.version,requestId:'req-'+root.crypto.randomUUID(),archived:!r.archived});const checked=await request('workflowGet',{type,id:r.id});if(run!==epoch)return;cache[type]=(cache[type]||[]).map(x=>x.id===r.id?checked.item:x);draw();message('보관 상태를 저장하고 다시 확인했습니다.');}catch(e){message(e.message,true);}finally{if(run===epoch)setWriting(false);}}
 function edit(record){
  setDirty(true);host.replaceChildren();host.append(el('h2','',spec.label+' · '+(record?'수정':'새 기록')),el('p','ce-muted',spec.note));const form=el('form','ce-form'),inputs={};
  for(const f of [{key:'status',label:'상태',type:'select',options:D.statusOptions},...spec.fields]){const label=el('label','ce-field'),input=el(f.type==='textarea'?'textarea':f.type==='select'?'select':'input');label.append(el('span','',f.label));if(f.options)for(const option of f.options){const n=el('option','',option);n.value=option;input.append(n);}else if(f.type!=='textarea')input.type=['date','number','url'].includes(f.type)?f.type:'text';if(f.type==='number')input.step='any';input.name=f.key;input.value=f.key==='status'?record?.status||'대기':record?.values[f.key]??'';if(f.key==='title')input.required=true;label.append(input);form.append(label);inputs[f.key]=input;}
  const actions=el('div','ce-actions'),save=el('button','ce-button','저장'),cancel=button('취소',()=>{setDirty(false);ctx.redraw();});save.type='submit';actions.append(save,cancel);form.append(actions);host.append(form);
  const recordId=record?.id||'record-'+root.crypto.randomUUID(),requestId='req-'+root.crypto.randomUUID();
  form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;save.disabled=cancel.disabled=true;setWriting(true);const values={};for(const f of spec.fields){const v=inputs[f.key].value.trim();values[f.key]=f.type==='number'&&v!==''?Number(v):v;}
   try{const saved=await request('workflowSave',{type,id:recordId,requestId,expectedVersion:record?.version||0,status:inputs.status.value,values}),checked=await request('workflowGet',{type,id:recordId});if(run!==epoch)return;if(checked.item.version<saved.item.version)throw Error('저장된 최신 기록을 확인해야 합니다.');cache[type]=[...(cache[type]||[]).filter(x=>x.id!==recordId),checked.item];setDirty(false);setWriting(false);ctx.redraw();message('저장하고 다시 확인했습니다. 구글 운영대장은 다음 일일 연결에 반영합니다.');}catch(error){if(run===epoch){message(error.message,true);save.disabled=cancel.disabled=false;}}finally{if(run===epoch)setWriting(false);}
  });
 }
}
function glowny(ctx){
 const {host:parentHost,el,button,request,message,setDirty,setWriting}=ctx,run=epoch,type='glowny',host=el('div','cg-workspace');parentHost.append(host);
 const groups=[['candidate','개발 후보'],['market','판매순'],['eunyeong','은영님 사진'],['brand','브랜드'],['performance','판매·반품'],['validation','검증 계획']];
 let current='candidate',query='',selected=null;
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
  if(overview){const v=overview.values,brief=el('div','cg-brief');if(v.application)brief.append(el('p','',v.application));if(v.observedAt)brief.append(el('p','ce-muted',v.observedAt));const actions=el('div','ce-actions');appendLink(actions,'구글 시트',v.sheetUrl);appendLink(actions,'구글 프레젠테이션',v.slidesUrl);if(actions.childNodes.length)brief.append(actions);host.append(brief);}
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
  const links=el('div','ce-actions');appendLink(links,'원상품·근거',v.sourceUrl);appendLink(links,'구글 시트',v.sheetUrl);appendLink(links,'구글 프레젠테이션',v.slidesUrl);body.append(links);
  if(v.productCode&&/^AS-[A-Za-z0-9-]{1,100}$/.test(v.productCode))body.append(button('연결 작업지시서',()=>root.AiselUnified?.show('editor',{code:v.productCode}),'ce-link'));
  body.append(el('p','ce-muted','검토 상태 '+record.status+' · 수정 '+new Date(record.updatedAt).toLocaleString('ko-KR')),button('검토 메모·상태 수정',()=>edit(record)));
 }
 function draw(){
  if(run!==epoch||!host.isConnected)return;host.replaceChildren();header();if(selected){const record=rows().find(r=>r.id===selected);if(record){detail(record);return;}selected=null;}
  const listRows=rows(),tabs=el('div','cg-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','글로니 자료 보기');
  for(const [key,label]of groups){const count=listRows.filter(r=>r.values.collection===key).length,b=button(label+(cache[type]?' '+count:''),()=>{current=key;query='';draw();});b.setAttribute('aria-pressed',String(current===key));tabs.append(b);}host.append(tabs);
  const tools=el('div','ce-filters'),searchWrap=el('label','ce-search'),search=el('input');search.type='search';search.placeholder='검색';search.setAttribute('aria-label','글로니 자료 검색');search.value=query;searchWrap.append(search);tools.append(searchWrap);host.append(tools);
  if(current==='market')host.append(el('p','ce-muted','조회 당시 판매순 관찰입니다. 실제 판매수량·순이익이나 에이슬 제작 승인을 뜻하지 않습니다.'));
  const count=el('p','ce-muted'),grid=el('div','cg-grid');host.append(count,grid);
  function fill(){
   grid.replaceChildren();const found=listRows.filter(r=>r.values.collection===current&&[r.values.title,r.values.referenceBrand,r.values.planningId,r.values.reference,r.values.application,r.values.relatedProduct].join(' ').toLowerCase().includes(query.toLowerCase()));count.textContent=cache[type]?found.length+'개 자료':'';
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
 function edit(record){
  setDirty(true);host.replaceChildren();host.append(el('h2','',record.values.title),el('p','ce-muted','이 자료의 검토 기록을 수정합니다. 생산 승인·기존 작업지시서 상태는 변경하지 않습니다.'));
  const form=el('form','ce-form'),inputs={},keys=['decision','reviewNote','nextAction','evidence','assigneeName','dueDate'];
  for(const f of [{key:'status',label:'자료 검토 상태',type:'select',options:D.statusOptions},...D.specs.glowny.fields.filter(f=>keys.includes(f.key))]){const label=el('label','ce-field'),input=el(f.type==='textarea'?'textarea':f.type==='select'?'select':'input');label.append(el('span','',f.label));input.name=f.key;if(f.options)for(const option of f.options){const n=el('option','',option);n.value=option;input.append(n);}else if(f.type!=='textarea')input.type=f.type==='date'?'date':'text';input.value=f.key==='status'?record.status:record.values[f.key]||'';if(f.type==='textarea')input.maxLength=4000;label.append(input);form.append(label);inputs[f.key]=input;}
  const actions=el('div','ce-actions'),save=el('button','ce-button','저장'),cancel=button('취소',()=>{setDirty(false);draw();});save.type='submit';actions.append(save,cancel);form.append(actions);host.append(form);let saving=false;const requestId='req-'+root.crypto.randomUUID();
  form.addEventListener('submit',async e=>{e.preventDefault();if(saving||!form.reportValidity())return;saving=true;save.disabled=cancel.disabled=true;setWriting(true);const values={...record.values};for(const key of keys)values[key]=inputs[key].value.trim();
   try{const saved=await request('workflowSave',{type,id:record.id,expectedVersion:record.version,requestId,status:inputs.status.value,values}),checked=await request('workflowGet',{type,id:record.id});if(run!==epoch)return;if(!saved.item||!checked.item||checked.item.version<saved.item.version)throw Error('저장된 최신 기록을 확인해야 합니다.');cache[type]=(cache[type]||[]).map(r=>r.id===record.id?checked.item:r);setDirty(false);setWriting(false);draw();message('검토 기록을 저장하고 다시 확인했습니다.');}
   catch(e){if(run===epoch){message(e.message,true);save.disabled=cancel.disabled=false;}}finally{if(run===epoch){saving=false;setWriting(false);}}
  });
 }
 draw();if(!cache[type])fetchRows();
}
function table(host,rows,el){const wrap=el('div','ce-table-scroll'),table=el('table','ce-table');for(const [i,values]of rows.entries()){const tr=el('tr');for(const v of values)tr.append(el(i===0?'th':'td','',String(v??'')));table.append(tr);}wrap.append(table);host.append(wrap);}
async function usage({host,el,request}){const run=epoch;host.append(el('h2','','Google API 사용 내역'),el('p','ce-muted','하루 한 번 자료를 모으고 메뉴 이동·검색에는 Google API를 호출하지 않습니다. 직접 저장·출퇴근은 즉시 서버에 기록합니다.'));const box=el('div');host.append(box);try{const r=await request('companyApiUsage');if(run!==epoch||!box.isConnected)return;box.append(el('p','ce-muted',r.scope));if(!r.items.length)box.append(el('p','ce-muted','계측을 시작한 뒤 실제 호출부터 표시합니다. 과거 호출량은 미측정입니다.'));else table(box,[['한국 날짜','요소','읽기·쓰기','실제 요청','성공','실패','응답 대기'],...r.items.map(x=>[x.date,x.source,x.method==='read'?'읽기':'쓰기',x.requests,x.success,x.failed,x.inFlight])],el);}catch(e){if(box.isConnected)box.append(el('p','ce-error',e.message));}}
root.AiselWorkflows=Object.freeze({render,reset});
})(window);

