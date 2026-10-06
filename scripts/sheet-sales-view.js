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
   values.forEach((value,i)=>{const cell=document.createElement('span');cell.textContent=value;cell.title=value;if(i===5&&item.returns>20)cell.className='sheet-sales-warning';row.append(cell);});host.append(row);
  }
 }
 async function read(endpoint){
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint))throw Error('시트 연결 주소가 설정되지 않았습니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{const response=await fetch(endpoint+'?action=sales',{signal:controller.signal,credentials:'omit',cache:'no-store'});if(!response.ok)throw Error('시트 연결을 확인해 주세요.');const snapshot=await response.json();if(snapshot.ok!==true||snapshot.source!=='operations-sheet')throw Error('시트 자료를 확인해 주세요.');return snapshot;}finally{clearTimeout(timer);}
 }
 root.AiselSheetSalesView={read,render};
})(globalThis);
