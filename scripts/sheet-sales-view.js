/* Prepared integration. No endpoint is enabled until access approval and live readback. */
(function(root){
 'use strict';
 function render(host,snapshot,search){
  if(!snapshot||snapshot.source!=='operations-sheet'||!Array.isArray(snapshot.items))throw Error('시트 자료를 확인해 주세요.');
  host.replaceChildren();
  const header=document.createElement('div');header.className='sheet-sales-grid sheet-sales-head';
  for(const label of ['순위','상품명','디자이너','공장','판매%','반품%']){const span=document.createElement('span');span.textContent=label;header.append(span);}host.append(header);
  const query=String(search||'').trim().toLocaleLowerCase('ko');
  for(const item of snapshot.items.filter(x=>x.name.toLocaleLowerCase('ko').includes(query))){
   const row=document.createElement('div');row.className='sheet-sales-grid';
   const values=[item.rank==null?'—':item.rank+'위',item.name,item.designer,item.factory,item.share==null?'—':item.share.toFixed(1)+'%',item.returns==null?'—':item.returns.toFixed(1)+'%'];
   values.forEach((value,i)=>{const cell=document.createElement(i===1?'button':'span');cell.textContent=value;cell.title=value;if(i===1){cell.type='button';cell.className='sheet-sales-name';cell.addEventListener('click',()=>details(values));}if(i===5){cell.title=value+' · 운영시트에 표시된 반품률';if(item.returns>20)cell.className='sheet-sales-warning';}row.append(cell);});host.append(row);
  }
 }
 function details(values){
  const dialog=document.createElement('dialog');dialog.className='sheet-sales-dialog noprint';
  const heading=document.createElement('h3');heading.textContent=values[1];dialog.append(heading);
  ['순위','상품명','디자이너','공장','판매 비중','반품률'].forEach((label,i)=>{const line=document.createElement('p');line.textContent=label+' · '+values[i];dialog.append(line);});
  const close=document.createElement('button');close.type='button';close.textContent='닫기';close.addEventListener('click',()=>dialog.close());dialog.append(close);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
 }
 async function read(endpoint){
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint))throw Error('시트 연결 주소가 설정되지 않았습니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{const response=await fetch(endpoint+'?action=sales',{signal:controller.signal,credentials:'omit',cache:'no-store'});if(!response.ok)throw Error('시트 연결을 확인해 주세요.');const snapshot=await response.json();if(snapshot.ok!==true||snapshot.source!=='operations-sheet')throw Error('시트 자료를 확인해 주세요.');return snapshot;}finally{clearTimeout(timer);}
 }
 function start(endpoint){
  const host=document.getElementById('salesTableBody'),search=document.getElementById('salesSearchInput');
  let snapshot=null,busy=false,lastRead=0;
  const show=()=>{if(snapshot)render(host,snapshot,search.value);};
  root.AiselSheetSalesSource={render:show};
  search.placeholder='상품명 검색';search.setAttribute('aria-label','상품명 검색');
  document.getElementById('salesAuth').hidden=true;
  document.getElementById('salesSourceNote').textContent='운영시트 신상성과 · 반품률은 시트 기준';
  const sort=document.getElementById('salesSort');sort.replaceChildren(new Option('판매순','quantity'));sort.disabled=true;
  const updated=document.getElementById('salesUpdated');
  const meta=updated.parentElement,info=document.createElement('div');info.className='sheet-sales-meta-info';
  meta.prepend(info);info.append(document.getElementById('salesPeriod'),updated);
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='새로고침';refresh.className='sheet-sales-refresh';meta.append(refresh);
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
 root.AiselSheetSalesView={read,render,start};
})(globalThis);
