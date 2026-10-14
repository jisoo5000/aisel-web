/* v178: compact six-column sales view; bounded read-only cache and metric semantics preserved. */
(function(root){
 'use strict';
 function performance(item){
  const valid=value=>Number.isFinite(value)&&value>=0&&value<=100;
  const shareKnown=valid(item.share),returnsKnown=valid(item.returns);
  if((returnsKnown&&item.returns>=20)||(shareKnown&&item.share<10))return {key:'low',label:'저조'};
  if(!shareKnown||!returnsKnown)return null;
  return item.share>=20?{key:'good',label:'좋음'}:{key:'normal',label:'보통'};
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
 async function read(endpoint){
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint))throw Error('시트 연결 주소가 설정되지 않았습니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{const response=await fetch(endpoint+'?action=sales',{signal:controller.signal,credentials:'omit',cache:'no-store'});if(!response.ok)throw Error('시트 연결을 확인해 주세요.');const snapshot=await response.json();if(snapshot.ok!==true||snapshot.source!=='operations-sheet'||!Array.isArray(snapshot.items))throw Error('시트 자료를 확인해 주세요.');returnMetric(snapshot);return snapshot;}finally{clearTimeout(timer);}
 }
 function start(endpoint){
  const host=document.getElementById('salesTableBody'),search=document.getElementById('salesSearchInput');
  const cacheKey='aisel.sales-sheet.cache.v1',freshFor=5*60*1000,maxAge=7*24*60*60*1000,maxCacheBytes=256*1024;
  let snapshot=null,inFlight=null,lastRead=0,lastAttempt=0;
  const show=()=>{if(snapshot)render(host,snapshot,search.value);};
  search.placeholder='품명 또는 품번으로 검색';search.setAttribute('aria-label','품명 또는 품번으로 검색');
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
  search.addEventListener('input',show);
  function compact(value){
   if(!value||value.ok!==true||value.source!=='operations-sheet'||!Array.isArray(value.items)||value.items.length>2000||!Number.isFinite(Date.parse(value.readAt)))return null;
   returnMetric(value);
   const numberOrNull=x=>x==null||(typeof x==='number'&&Number.isFinite(x));
   const textOrNull=x=>x==null||typeof x==='string';
   if(value.items.some(x=>!x||!numberOrNull(x.rank)||typeof x.name!=='string'||!textOrNull(x.designer)||!textOrNull(x.factory)||!numberOrNull(x.share)||!numberOrNull(x.returns)))return null;
   return {ok:true,source:'operations-sheet',readAt:value.readAt,periodLabel:typeof value.periodLabel==='string'?value.periodLabel:'',returnMetric:{key:returnMetric(value).key},items:value.items.map(x=>({rank:x.rank??null,name:x.name,designer:x.designer??'',factory:x.factory??'',share:x.share??null,returns:x.returns??null}))};
  }
  function bytes(text){return new TextEncoder().encode(text).byteLength;}
  function restore(){
   try{
    const text=root.localStorage.getItem(cacheKey);if(!text||text.length>maxCacheBytes||bytes(text)>maxCacheBytes)return;
    const record=JSON.parse(text),age=Date.now()-record.savedAt;
    if(record.endpoint!==endpoint||!Number.isFinite(record.savedAt)||age<0||age>maxAge)return;
    const value=compact(record.snapshot);if(!value)return;
    snapshot=value;lastRead=record.savedAt;show();showCheckedTime();
   }catch(error){/* A blocked or stale cache never prevents a fresh read. */}
  }
  function remember(value){
   try{
    const small=compact(value);if(!small){root.localStorage.removeItem(cacheKey);return;}
    const text=JSON.stringify({endpoint,savedAt:lastRead,snapshot:small});
    if(bytes(text)<=maxCacheBytes)root.localStorage.setItem(cacheKey,text);else root.localStorage.removeItem(cacheKey);
   }catch(error){/* Sales remain usable when browser storage is unavailable. */}
  }
  function showCheckedTime(failed=false){
   readState.hidden=!failed||!snapshot;readState.textContent=failed&&snapshot?'연결 실패 · 이전 자료 표시 중':'';
   if(!snapshot){updated.textContent='연결 확인 필요';return;}
   const checked=new Date(snapshot.readAt),now=new Date(),zone={timeZone:'Asia/Seoul'};
   const valid=Number.isFinite(checked.getTime());
   const oldDate=valid&&checked.toLocaleDateString('ko-KR',zone)!==now.toLocaleDateString('ko-KR',zone);
   const stamp=valid?checked.toLocaleString('ko-KR',{...zone,...(oldDate?{month:'2-digit',day:'2-digit'}:{}),hour:'2-digit',minute:'2-digit'}):'시간 확인 필요';
   updated.textContent='확인 '+stamp;
  }
  function contentKey(value){
   return JSON.stringify([value.periodLabel,returnMetric(value).key,value.items.map(x=>[x.rank,x.name,x.designer,x.factory,x.share,x.returns])]);
  }
  function visible(){
   const view=document.getElementById('salesView');
   return !document.hidden&&(!root.AiselUnified||root.AiselUnified.view==='sales')&&view&&!view.hidden&&getComputedStyle(view).display!=='none';
  }
  function load(){
   if(inFlight)return inFlight;
   lastAttempt=Date.now();refresh.disabled=true;
   if(!snapshot)host.textContent='시트 자료를 불러오는 중입니다.';
   inFlight=(async()=>{
    try{
     const value=await read(endpoint),changed=!snapshot||contentKey(snapshot)!==contentKey(value);
     snapshot=value;lastRead=Date.now();if(changed)show();showCheckedTime();remember(value);return true;
    }catch(error){
     if(!snapshot)host.textContent='시트 자료를 가져오지 못했습니다. 새로고침해 주세요.';
     showCheckedTime(true);return false;
    }finally{inFlight=null;refresh.disabled=false;}
   })();
   return inFlight;
  }
  function refreshIfStale(){
   if(!visible())return Promise.resolve(false);
   if(inFlight)return inFlight;
   if(Date.now()-Math.max(lastRead,lastAttempt)<freshFor)return Promise.resolve(false);
   return load();
  }
  refresh.addEventListener('click',load);
  root.AiselSheetSalesSource={render:show,refreshIfStale};
  restore();
  document.addEventListener('visibilitychange',refreshIfStale);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refreshIfStale,{once:true});else queueMicrotask(refreshIfStale);
 }
 root.AiselSheetSalesView={read,render,start,performance};
})(globalThis);
