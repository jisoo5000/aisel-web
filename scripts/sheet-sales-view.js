/* v281: reuse verified account/group snapshots; keep rows visible during refresh. */
(function(root){
 'use strict';
 function performance(item){
  const valid=value=>Number.isFinite(value)&&value>=0&&value<=100;
  const shareKnown=valid(item.share),returnsKnown=valid(item.returns);
  if((returnsKnown&&item.returns>=20)||(shareKnown&&item.share<10))return {key:'low',label:'드랍'};
  if(!shareKnown||!returnsKnown)return null;
  return item.share>=20?{key:'good',label:'리오더'}:{key:'normal',label:'보통'};
 }
 function returnMetric(snapshot){
  const key=snapshot.returnMetric?.key;
  if(!key||key==='legacy-sheet-return-rate')return {key:'legacy-sheet-return-rate',label:'운영시트 반품률',shortLabel:'반품%',note:''};
  if(key==='estimated-receipt-return-request-rate')return {
   key,label:'추정 수령 기준 반품 신청률',shortLabel:'반품 신청%',
   note:'발송 다음 날 수령을 가정한 반품 신청률입니다. 관찰 기한이 지난 출고분 기준이며, 실제 수령일이나 최종 반품 완료율을 뜻하지 않습니다.'
  };
  if(key==='sales-cohort-return-request-rate-provisional')return {
   key,label:'판매 대비 반품 접수율(잠정)',shortLabel:'반품 접수%',
   note:'같은 최근 30일 판매수량 대비 반품 접수 수량의 잠정 비율입니다. 교환은 제외하며 추가 반품으로 바뀔 수 있습니다. 출고 대비 비율이나 기한 종료 표본, 최종 반품 완료율과 구분해 주세요.'
  };
  throw Error('시트 반품 지표를 확인해 주세요.');
 }
 function render(host,snapshot,search){
  if(!snapshot||snapshot.source!=='operations-sheet'||!Array.isArray(snapshot.items))throw Error('시트 자료를 확인해 주세요.');
  const metric=returnMetric(snapshot);
  host.replaceChildren();
  const header=document.createElement('div');header.className='sheet-sales-grid sheet-sales-head';
  for(const label of ['상품명 (판매순)','','디자이너','공장','판매%','반품%']){const span=document.createElement('span');span.textContent=label;if(!label)span.setAttribute('aria-hidden','true');header.append(span);}host.append(header);
  const query=String(search||'').trim().toLocaleLowerCase('ko');
  for(const item of snapshot.items.filter(x=>{
   const normalize=value=>String(value || '').toLocaleLowerCase('ko').replace(/\s+/g,'');
   const needle=normalize(query);
   return normalize(x.name).includes(needle) || normalize(root.AiselWorkorderCodeForName?.(x.name)).includes(needle);
  })){
   const row=document.createElement('div');row.className='sheet-sales-grid';
   const values=[item.rank==null?'—':item.rank+'위',item.name,item.designer,item.factory,item.share==null?'—':item.share.toFixed(1)+'%',item.returns==null?'—':item.returns.toFixed(1)+'%'];
   values.forEach((value,i)=>{
    if(i===0)return; // Keep the source rank for details; the list keeps the source order without a rank column.
    const cell=document.createElement(i===1?'button':'span');cell.textContent=value;cell.title=value;
    if(i===1){
     cell.type='button';cell.className='sheet-sales-name';cell.replaceChildren();
     const name=document.createElement('span');name.className='sheet-sales-name-label';name.textContent=value;cell.append(name);
     const rating=performance(item);
     cell.setAttribute('aria-label',rating?value+' · 성과 '+rating.label:value);
     cell.addEventListener('click',()=>details(values,metric));
     row.append(cell);
     const ratingCell=document.createElement('span');ratingCell.className='sheet-sales-rating';
     if(rating){const badge=document.createElement('span');badge.className='sheet-sales-badge sheet-sales-badge-'+rating.key;badge.textContent=rating.label;badge.title=(snapshot.periodLabel||'운영시트 집계 기간')+' · 매장 전체 판매비중·'+metric.label+' 기준';ratingCell.append(badge);}
     else ratingCell.setAttribute('aria-hidden','true');
     row.append(ratingCell);
     return;
    }
    if(i===5){cell.title=value+' · '+metric.label;if(item.returns>=20)cell.className='sheet-sales-warning';else if(item.returns>=15)cell.className='sheet-sales-caution';}
    row.append(cell);
   });host.append(row);
  }
 }
 function details(values,metric){
  const dialog=document.createElement('dialog');dialog.className='sheet-sales-dialog noprint';
  const heading=document.createElement('h3');heading.textContent=values[1];dialog.append(heading);
  ['순위','상품명','디자이너','공장','판매 비중',metric.label].forEach((label,i)=>{const line=document.createElement('p');line.textContent=label+' · '+values[i];dialog.append(line);});
  if(metric.note){const note=document.createElement('p');note.textContent=metric.note;dialog.append(note);}
  const close=document.createElement('button');close.type='button';close.textContent='닫기';close.addEventListener('click',()=>dialog.close());dialog.append(close);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
 }
 async function read(endpoint,group='new'){
  if(!root.AiselAccess?.allowed('sales'))throw Error('로그인 후 판매성과를 확인해주세요.');
  const snapshot=await root.AiselAccess.request('sales',{group});
  if(snapshot.ok!==true||snapshot.source!=='operations-sheet'||!Array.isArray(snapshot.items))throw Error('판매 자료를 확인해주세요.');
  returnMetric(snapshot);return snapshot;
 }
 function start(endpoint){
  const host=document.getElementById('salesTableBody'),search=document.getElementById('salesSearchInput');
  const freshFor=5*60*1000,cacheMaxAge=30*60*1000,cachePrefix='aisel.sales-sheet.account.v281:';
  // Restore only after current server-verified access. Assigned-only accounts
  // keep data in memory because assignments can change independently of roles.
  try{root.localStorage.removeItem('aisel.sales-sheet.cache.v1');}catch(_){}
  let accountScope='',accountUid='',generation=0,group='new',lastPaint='';
  const groups=new Map(),entry=selected=>{if(!groups.has(selected))groups.set(selected,{snapshot:null,inFlight:null,lastRead:0,lastAttempt:0,error:false});return groups.get(selected);};
  const current=()=>entry(group),cacheKey=selected=>cachePrefix+accountUid+':'+selected;
  function forgetCache(){try{if(accountUid)for(const selected of ['new','core'])root.sessionStorage.removeItem(cacheKey(selected));}catch(_){}}
  function compact(value){
   if(value?.ok!==true||value.source!=='operations-sheet'||!Array.isArray(value.items)||value.items.length>500||!Number.isFinite(Date.parse(value.readAt)))throw Error('Invalid sales cache');
   const metric=returnMetric(value),items=value.items.map(row=>{
    if(!row||typeof row.name!=='string'||row.name.length>500||['designer','factory'].some(key=>typeof row[key]!=='string'||row[key].length>200)||['share','returns'].some(key=>row[key]!==null&&(!Number.isFinite(row[key])||row[key]<0))||(row.rank!==null&&(!Number.isSafeInteger(row.rank)||row.rank<1)))throw Error('Invalid sales cache');
    const item={rank:row.rank,name:row.name,designer:row.designer,factory:row.factory,share:row.share,returns:row.returns};
    if(typeof row.code==='string'&&row.code.length<=160)item.code=row.code;return item;
   });
   return {ok:true,source:'operations-sheet',readAt:value.readAt,periodLabel:String(value.periodLabel||'').slice(0,200),returnMetric:{key:metric.key},items};
  }
  function restoreCache(selected){
   if(!root.AiselAccess?.allowed('sales')||root.AiselAccess.ownOnly||!accountUid||(selected==='core'&&!root.AiselAccess.isOwner))return;
   try{
    const raw=root.sessionStorage.getItem(cacheKey(selected));if(!raw)return;
    if(new TextEncoder().encode(raw).length>256*1024)throw Error('Oversized cache');
    const cached=JSON.parse(raw),age=Date.now()-cached.savedAt;
    if(cached.scope!==accountScope||!Number.isFinite(age)||age<0||age>cacheMaxAge)throw Error('Expired cache');
    const state=entry(selected);state.snapshot=compact(cached.snapshot);state.lastRead=cached.savedAt;
   }catch(_){try{root.sessionStorage.removeItem(cacheKey(selected));}catch(_){}}
  }
  function saveCache(selected,state){
   if(root.AiselAccess.ownOnly||!accountUid)return;
   try{
    const raw=JSON.stringify({scope:accountScope,savedAt:state.lastRead,snapshot:compact(state.snapshot)});
    if(new TextEncoder().encode(raw).length<=256*1024)root.sessionStorage.setItem(cacheKey(selected),raw);
    else root.sessionStorage.removeItem(cacheKey(selected));
   }catch(_){try{root.sessionStorage.removeItem(cacheKey(selected));}catch(_){}}
  }
  search.placeholder='검색';search.setAttribute('aria-label','검색');
  document.getElementById('salesAuth').hidden=true;
  document.getElementById('salesSourceNote').textContent='운영시트 신상성과 · 반품 지표는 시트 기준';
  const sort=document.getElementById('salesSort');sort.replaceChildren(new Option('판매순','quantity'));sort.disabled=true;
  const updated=document.getElementById('salesUpdated');
  const meta=updated.parentElement,info=document.createElement('div');info.className='sheet-sales-meta-info';
  const period=document.getElementById('salesPeriod');period.textContent='';period.hidden=true;
  meta.prepend(info);
  const scope=document.getElementById('salesScopeNote');if(scope)info.append(scope);
  info.append(period,updated);
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='새로고침';refresh.className='sheet-sales-refresh';refresh.id='sheetSalesRefresh';meta.append(refresh);
  const readState=document.createElement('span');readState.className='sheet-sales-read-state';readState.id='sheetSalesReadState';readState.hidden=true;readState.setAttribute('role','status');meta.append(readState);
  function showCheckedTime(){
   const state=current(),snapshot=state.snapshot;
   refresh.disabled=!!state.inFlight;
   readState.textContent=snapshot&&state.error?'연결 실패 · 이전 자료 표시 중':snapshot&&state.inFlight?'최신 자료 확인 중':'';
   readState.hidden=!readState.textContent;
   if(!snapshot){updated.textContent=root.AiselAccess?.allowed('sales')?(state.error?'연결 확인 필요':'확인 중'):'로그인 후 확인';return;}
   const checked=new Date(snapshot.readAt),now=new Date(),zone={timeZone:'Asia/Seoul'};
   const valid=Number.isFinite(checked.getTime());
   const oldDate=valid&&checked.toLocaleDateString('ko-KR',zone)!==now.toLocaleDateString('ko-KR',zone);
   const stamp=valid?checked.toLocaleString('ko-KR',{...zone,...(oldDate?{month:'2-digit',day:'2-digit'}:{}),hour:'2-digit',minute:'2-digit'}):'시간 확인 필요';
   updated.textContent='확인 '+stamp;
  }
  function contentKey(value){
   return JSON.stringify([value.periodLabel,returnMetric(value).key,value.items.map(x=>[x.rank,x.name,x.designer,x.factory,x.share,x.returns])]);
  }
  function show(){
   const state=current(),snapshot=state.snapshot;
   if(snapshot){
    const signature=JSON.stringify([group,search.value,contentKey(snapshot),search.value?snapshot.items.map(row=>root.AiselWorkorderCodeForName?.(row.name)||''):[]]);
    if(signature!==lastPaint){
     lastPaint=signature;
     if(snapshot.items.length)render(host,snapshot,search.value);
     else host.textContent=root.AiselAccess.ownOnly?'배정된 신상성과가 없습니다. 담당 자료 연결을 확인해주세요.':group==='core'?'핵심 SKU로 지정된 상품이 없습니다.':'표시할 신상성과가 없습니다.';
    }
   }else{
    const message=!root.AiselAccess?.allowed('sales')?'로그인 후 판매성과를 확인해주세요.':state.error?'시트 자료를 가져오지 못했습니다. 새로고침해 주세요.':'시트 자료를 불러오는 중입니다.';
    if(host.textContent!==message)host.textContent=message;lastPaint='';
   }
   showCheckedTime();
  }
  search.addEventListener('input',show);
  function visible(){
   const view=document.getElementById('salesView');
   return !document.hidden&&(!root.AiselUnified||root.AiselUnified.view==='sales')&&view&&!view.hidden&&getComputedStyle(view).display!=='none';
  }
  function load(){
   if(!root.AiselAccess?.allowed('sales')){show();return Promise.resolve(false);}
   const selected=group,state=current(),expected=generation;
   if(state.inFlight)return state.inFlight;
   state.lastAttempt=Date.now();state.error=false;
   const task=Promise.resolve().then(async()=>{
    try{
     const value=await read(endpoint,selected);if(expected!==generation)return false;
     state.snapshot=value;state.lastRead=Date.now();state.error=false;saveCache(selected,state);return true;
    }catch(error){
     if(expected!==generation)return false;
     if(['permission_denied','unauthenticated','session_changed'].includes(error?.code)){
      forgetCache();generation++;groups.clear();entry(group).error=true;lastPaint='';show();return false;
     }
     state.error=true;return false;
    }finally{
     if(expected===generation){state.inFlight=null;if(selected===group)show();}
    }
   });
   state.inFlight=task;show();return task;
  }
  function refreshIfStale(){
   if(!visible())return Promise.resolve(false);
   const state=current();if(state.inFlight)return state.inFlight;
   if(Date.now()-Math.max(state.lastRead,state.lastAttempt)<freshFor)return Promise.resolve(false);
   return load();
  }
  refresh.addEventListener('click',load);
  const tabs=document.getElementById('salesGroupTabs');
  tabs.addEventListener('click',event=>{
   const choice=event.target.closest('[data-group]');if(!choice)return;event.stopImmediatePropagation();
   if(choice.dataset.group==='core'&&!root.AiselAccess.isOwner)return;
   const selected=choice.dataset.group==='core'?'core':'new';
   if(selected!==group){
    group=selected;
    for(const button of tabs.querySelectorAll('button')){const active=button.dataset.group===group;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
   }
   show();refreshIfStale();
  },true);
  root.AiselAccess.subscribe(session=>{
   const next=session?JSON.stringify([session.uid,session.enabled,session.active,session.role,session.permissions]):'';
   for(const button of tabs.querySelectorAll('[data-group="core"]'))button.hidden=session?.role!=='owner';
   if(next===accountScope)return;
   if(accountUid)forgetCache();accountScope=next;accountUid=session?.uid||'';generation++;groups.clear();lastPaint='';
   if(session?.role!=='owner')group='new';
   for(const button of tabs.querySelectorAll('button')){const selected=button.dataset.group===group;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));}
   restoreCache('new');restoreCache('core');show();if(session)refreshIfStale();
  });
  function invalidate(){forgetCache();generation++;groups.clear();lastPaint='';show();return refreshIfStale();}
  root.addEventListener('aisel-assigned-index-change',event=>{
   if(!root.AiselAccess.ownOnly)return;const codes=new Set(event.detail?.codes||[]);
   if([...groups.values()].some(state=>state.snapshot?.items.some(row=>row.code&&!codes.has(row.code))))invalidate();
  });
  root.AiselSheetSalesSource={render:show,refreshIfStale,invalidate};
  document.addEventListener('visibilitychange',refreshIfStale);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refreshIfStale,{once:true});else queueMicrotask(refreshIfStale);
 }
 root.AiselSheetSalesView={read,render,start,performance};
})(globalThis);
