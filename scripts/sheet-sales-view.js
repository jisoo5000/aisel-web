/* v154: approved read-only sheet feed; return-rate semantics follow explicit metadata. */
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
  throw Error('시트 반품 지표를 확인해 주세요.');
 }
 function render(host,snapshot,search){
  if(!snapshot||snapshot.source!=='operations-sheet'||!Array.isArray(snapshot.items))throw Error('시트 자료를 확인해 주세요.');
  const metric=returnMetric(snapshot);
  host.replaceChildren();
  const header=document.createElement('div');header.className='sheet-sales-grid sheet-sales-head';
  for(const label of ['순위','상품명','디자이너','공장','판매%',metric.shortLabel]){const span=document.createElement('span');span.textContent=label;header.append(span);}host.append(header);
  const query=String(search||'').trim().toLocaleLowerCase('ko');
  for(const item of snapshot.items.filter(x=>{
   const normalize=value=>String(value || '').toLocaleLowerCase('ko').replace(/\s+/g,'');
   const needle=normalize(query);
   return normalize(x.name).includes(needle) || normalize(root.AiselWorkorderCodeForName?.(x.name)).includes(needle);
  })){
   const row=document.createElement('div');row.className='sheet-sales-grid';
   const values=[item.rank==null?'—':item.rank+'위',item.name,item.designer,item.factory,item.share==null?'—':item.share.toFixed(1)+'%',item.returns==null?'—':item.returns.toFixed(1)+'%'];
   values.forEach((value,i)=>{
    const cell=document.createElement(i===1?'button':'span');cell.textContent=value;cell.title=value;
    if(i===1){
     cell.type='button';cell.className='sheet-sales-name';cell.replaceChildren();
     const name=document.createElement('span');name.className='sheet-sales-name-label';name.textContent=value;cell.append(name);
     const rating=performance(item);
     if(rating){const badge=document.createElement('span');badge.className='sheet-sales-badge sheet-sales-badge-'+rating.key;badge.textContent=rating.label;badge.title=(snapshot.periodLabel||'운영시트 집계 기간')+' · 매장 전체 판매비중·'+metric.label+' 기준';cell.append(badge);cell.setAttribute('aria-label',value+' · 성과 '+rating.label);}
     cell.addEventListener('click',()=>details(values,metric));
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
  let snapshot=null,busy=false,lastRead=0;
  const show=()=>{if(snapshot)render(host,snapshot,search.value);};
  root.AiselSheetSalesSource={render:show};
  search.placeholder='품명 또는 품번으로 검색';search.setAttribute('aria-label','품명 또는 품번으로 검색');
  document.getElementById('salesAuth').hidden=true;
  document.getElementById('salesSourceNote').textContent='운영시트 신상성과 · 반품 지표는 시트 기준';
  const sort=document.getElementById('salesSort');sort.replaceChildren(new Option('판매순','quantity'));sort.disabled=true;
  const updated=document.getElementById('salesUpdated');
  const meta=updated.parentElement,info=document.createElement('div');info.className='sheet-sales-meta-info';
  meta.prepend(info);info.append(document.getElementById('salesPeriod'),updated);
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='새로고침';refresh.className='sheet-sales-refresh';refresh.id='sheetSalesRefresh';meta.append(refresh);
  search.addEventListener('input',show);
  async function load(){
   if(busy)return;busy=true;refresh.disabled=true;
   if(!snapshot)host.textContent='시트 자료를 불러오는 중입니다.';
   try{const value=await read(endpoint);snapshot=value;show();lastRead=Date.now();document.getElementById('salesPeriod').textContent=value.periodLabel||'집계 기간은 신상성과 탭 기준';updated.textContent='시트 확인 '+new Date(value.readAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'});}
   catch(error){if(!snapshot)host.textContent='시트 자료를 가져오지 못했습니다. 새로고침해 주세요.';updated.textContent=snapshot?'연결 실패 · 이전에 읽은 자료':'시트 연결 확인 필요';}
   finally{busy=false;refresh.disabled=false;}
  }
  refresh.addEventListener('click',load);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRead>300000)load();});
  load();
 }
 root.AiselSheetSalesView={read,render,start,performance};
})(globalThis);

