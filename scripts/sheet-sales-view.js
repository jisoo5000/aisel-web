/* v281: reuse verified account/group snapshots; keep rows visible during refresh. */
(function(root){
 'use strict';
 function periodStatus(snapshot,now=new Date()){
  if(snapshot?.source==='sales-comparison'){const p=snapshot.period;if(!p)return '주간 집계 연결 필요';const yesterday=new Date(now.getTime()+9*3600000-86400000).toISOString().slice(0,10);return (p.end<yesterday?'갱신 지연 · ':'집계 ')+p.start+' ~ '+p.end;}
  const label=String(snapshot?.periodLabel||'').trim();
  const match=label.match(/^(\d{4})\.(\d{2})\.(\d{2})\s*[–—~-]\s*(?:(\d{4})\.)?(\d{2})\.(\d{2})$/);
  if(!match)return '집계기간 확인 필요';
  const start=match[1]+'-'+match[2]+'-'+match[3];
  let year=Number(match[4]||match[1]);
  if(!match[4]&&Number(match[5])<Number(match[2]))year++;
  const end=year+'-'+match[5]+'-'+match[6];
  const endDate=new Date(end+'T00:00:00Z');
  if(!Number.isFinite(endDate.getTime())||endDate.toISOString().slice(0,10)!==end||start>end)return '집계기간 확인 필요';
  const yesterday=new Date(now.getTime()+9*3600000-86400000).toISOString().slice(0,10);
  return (end<yesterday?'갱신 지연 · ':end>yesterday?'집계기간 확인 필요 · ':'집계 ')+label;
 }
 function performance(item){
  const valid=value=>Number.isFinite(value)&&value>=0&&value<=100;
  const shareKnown=valid(item.share),returnsKnown=valid(item.returns);
  if((returnsKnown&&item.returns>=20)||(shareKnown&&item.share<10))return {key:'low',label:'드랍'};
  if(!shareKnown||!returnsKnown)return null;
  return item.share>=20?{key:'good',label:'리오더'}:{key:'normal',label:'보통'};
 }
 function returnMetric(snapshot){
  if(snapshot.source==='sales-comparison')return {key:'comparison-return',label:snapshot.returnLabel||'반품 지표',shortLabel:'반품',note:snapshot.returnPeriod||''};
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
 function render(host,snapshot,search,pageScope=""){
  if(!snapshot||!Array.isArray(snapshot.items))throw Error('판매 자료를 확인해 주세요.');
  host.replaceChildren();host.classList.add('sp-list');
  const E=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;};
  const ready=snapshot.source==='sales-comparison',metric=returnMetric(snapshot);
  const notice=E('p','sp-coverage',ready?'전체 신상품 '+snapshot.totalCount+'개 · 판매수량 연결 '+snapshot.rankedCount+'개'+(snapshot.rankScope==='all_new'?' · 전체 순위':' · 연결된 상품 기준 순위'):'전체 비교 연결 준비 중 · 현재 조회 권한의 상품');
  host.append(notice);
  if(ready&&snapshot.period)host.append(E('p','sp-period','이번 기간 '+snapshot.period.start+' ~ '+snapshot.period.end+' / 전주 '+snapshot.comparisonPeriod.start+' ~ '+snapshot.comparisonPeriod.end));
  const header=E('div','sp-grid sp-head');
  ['전체 순위','상품','전주 → 이번 기간','판매 변화','반품','한줄 분석'].forEach(x=>header.append(E('span','',x)));host.append(header);
  const q=String(search||'').toLocaleLowerCase('ko').replace(/\s/g,'');
  const matches=snapshot.items.filter(x=>String(x.name||'').toLocaleLowerCase('ko').replace(/\s/g,'').includes(q));
  const shown=root.AiselListPagination?.take?root.AiselListPagination.take('sales',matches,{host,filter:JSON.stringify([pageScope,q]),onMore:()=>{if(root.AiselAccess?.allowed('sales'))render(host,snapshot,search,pageScope);}}):matches;
  const number=v=>typeof v==='number'&&Number.isFinite(v),qty=v=>number(v)?v.toLocaleString('ko-KR')+'장':'미연결';
  for(const item of shown){
   const mine=item.isMine===true||(!ready&&root.AiselAccess?.ownOnly===true);
   const row=E('article','sp-grid sp-row'+(mine?' sp-mine':''));row.dataset.mine=String(mine);
   const rank=E('div','sp-rank',number(item.rank)?item.rank+'위':'—');rank.setAttribute('aria-label','전체 순위');row.append(rank);
   const product=E('div','sp-product'),image=E('div','sp-photo');
   const photo=safeImage(item.imageUrl);
   if(photo){const img=E('img');img.src=photo;img.alt='';img.loading='lazy';img.decoding='async';img.width=48;img.height=64;img.addEventListener('error',()=>{img.remove();image.textContent='사진 없음';},{once:true});image.append(img);}else image.append(E('span','','사진 없음'));
   const identity=E('div','sp-identity'),name=E('strong','sp-name',item.name);identity.append(name);
   if(mine)identity.append(E('span','sp-own','내 상품'));
   if(item.isNew)identity.append(E('span','sp-new','신규'));
   if(item.launchDate)identity.append(E('span','sp-launch','출시 '+item.launchDate));
   product.append(image,identity);row.append(product);
   const sales=E('div','sp-sales'),label=E('span','sp-mobile-label','전주 → 이번 기간');
   sales.append(label,E('strong','',ready?qty(item.previous)+' → '+qty(item.current):'주간 수량 미연결'));row.append(sales);
   const change=E('div','sp-change');change.append(E('span','sp-mobile-label','판매 변화'));
   change.append(E('span','',number(item.delta)?(item.delta>0?'+':'')+item.delta.toLocaleString('ko-KR')+'장':item.isNew?'신규':'—'));
   if(number(item.changeRate))change.append(E('small','',(item.changeRate>0?'+':'')+item.changeRate.toFixed(1)+'%'));
   if(number(item.rankChange))change.append(E('small','',item.rankChange>0?'↑ '+item.rankChange+'계단':item.rankChange<0?'↓ '+Math.abs(item.rankChange)+'계단':'순위 유지'));
   row.append(change);
   const returns=E('div','sp-returns');returns.append(E('span','sp-mobile-label',metric.shortLabel),E('span','',number(item.returns)?item.returns.toFixed(1)+'%':'미연결'));returns.title=metric.label+' · '+(snapshot.returnPeriod||snapshot.periodLabel||'기간 확인 필요');row.append(returns);
   const insight=E('div','sp-insight');insight.append(E('span','sp-insight-label',item.insight?.kind==='gpt'?'GPT 한줄 분석':'수치 요약'));
   insight.append(E('span','',item.insight?.text||'주간 판매수량이 연결되면 전주 대비 변화를 확인할 수 있어요.'));row.append(insight);host.append(row);
  }
  if(!shown.length)host.append(E('p','sp-empty','표시할 상품이 없습니다.'));
  host.append(E('p','sp-footnote',metric.label+' · '+(snapshot.returnPeriod||snapshot.periodLabel||'집계기간 확인 필요')+' · 반품 관찰 기간은 주간 판매 비교와 다를 수 있습니다.'));
 }
 function safeImage(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.search&&!u.username&&!u.password&&(u.hostname==='aisel.me'||u.hostname==='cafe24.com'||u.hostname.endsWith('.cafe24.com')||u.hostname.endsWith('.cafe24img.com'))&&/\/web\/product\//.test(u.pathname)?u.href:'';}catch{return '';}}
 async function read(endpoint,group='new'){
  if(!root.AiselAccess?.allowed('sales'))throw Error('로그인 후 판매성과를 확인해주세요.');
  let snapshot;
  if(group==='core'||root.AiselAccess.session?.permissions?.salesComparisonVersion!==1)snapshot=await root.AiselAccess.request('sales',{group});
  else try{snapshot=await root.AiselAccess.request('salesComparison');}
  catch(error){if(!['invalid_action','comparison_not_ready'].includes(error?.code))throw error;snapshot=await root.AiselAccess.request('sales',{group});}
  if(snapshot.ok!==true||!['operations-sheet','sales-comparison'].includes(snapshot.source)||!Array.isArray(snapshot.items))throw Error('판매 자료를 확인해주세요.');
  returnMetric(snapshot);return snapshot;
 }
 function start(endpoint){
  const host=document.getElementById('salesTableBody'),search=document.getElementById('salesSearchInput');
  const freshFor=5*60*1000,cacheMaxAge=30*60*1000,cachePrefix='aisel.sales-sheet.account.v20261116:';
  // Restore only after current server-verified access. Assigned-only accounts
  // keep data in memory because assignments can change independently of roles.
  try{root.localStorage.removeItem('aisel.sales-sheet.cache.v1');}catch(_){}
  let accountScope='',accountUid='',generation=0,group='new',lastPaint='';
  const groups=new Map(),entry=selected=>{if(!groups.has(selected))groups.set(selected,{snapshot:null,inFlight:null,lastRead:0,lastAttempt:0,error:false,retrying:false});return groups.get(selected);};
  const current=()=>entry(group),cacheKey=selected=>cachePrefix+accountUid+':'+selected;
  function forgetCache(){try{if(accountUid)for(const selected of ['new','core'])root.sessionStorage.removeItem(cacheKey(selected));}catch(_){}}
  function compact(value){
   if(value?.ok!==true||!['operations-sheet','sales-comparison'].includes(value.source)||!Array.isArray(value.items)||value.items.length>500||!Number.isFinite(Date.parse(value.readAt)))throw Error('Invalid sales cache');
   const metric=returnMetric(value),n=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
   const items=value.items.map(row=>{
    if(typeof row?.name!=='string'||row.name.length>500)throw Error('Invalid sales item');
    const item={name:row.name,rank:n(row.rank),share:n(row.share),returns:n(row.returns),designer:'',factory:''};
    for(const k of ['current','previous','previousRank','delta','changeRate','rankChange'])item[k]=n(row[k]);
    item.isMine=row.isMine===true;item.isNew=row.isNew===true;item.imageUrl=safeImage(row.imageUrl);item.launchDate=/^\d{4}-\d{2}-\d{2}$/.test(row.launchDate||'')?row.launchDate:null;
    if(row.insight&&typeof row.insight.text==='string'&&row.insight.text.length<=180)item.insight={text:row.insight.text,kind:row.insight.kind==='gpt'?'gpt':'numeric'};
    return item;
   });
   return {ok:true,source:value.source,readAt:value.readAt,periodLabel:String(value.periodLabel||'').slice(0,200),returnMetric:{key:metric.key},returnLabel:metric.label,returnPeriod:String(value.returnPeriod||'').slice(0,300),period:value.period||null,comparisonPeriod:value.comparisonPeriod||null,totalCount:n(value.totalCount),rankedCount:n(value.rankedCount),rankScope:value.rankScope,items};
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
  document.getElementById('salesSourceNote').textContent='전체 상품 비교 · 내 상품 강조';
  document.querySelector('#salesView h2').textContent='신상품 판매 성과';
  document.querySelectorAll('[data-main="sales"]').forEach(x=>x.textContent='신상품 판매 성과');
  const scan=document.querySelector('#salesView .sales-scan-note');if(scan)scan.hidden=true;
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
   readState.textContent=state.retrying?'연결이 지연되어 한 번 더 확인 중':snapshot&&state.error?'연결 실패 · 이전 자료 표시 중':snapshot&&state.inFlight?'최신 자료 확인 중':'';
   readState.hidden=!readState.textContent;
   period.textContent=snapshot?periodStatus(snapshot):'';period.hidden=!snapshot;
   if(!snapshot){updated.textContent=root.AiselAccess?.allowed('sales')?(state.error?'연결 확인 필요':'확인 중'):'로그인 후 확인';return;}
   const checked=new Date(snapshot.readAt),now=new Date(),zone={timeZone:'Asia/Seoul'};
   const valid=Number.isFinite(checked.getTime());
   const oldDate=valid&&checked.toLocaleDateString('ko-KR',zone)!==now.toLocaleDateString('ko-KR',zone);
   const stamp=valid?checked.toLocaleString('ko-KR',{...zone,...(oldDate?{month:'2-digit',day:'2-digit'}:{}),hour:'2-digit',minute:'2-digit'}):'시간 확인 필요';
   updated.textContent='화면 조회 '+stamp;
  }
  function contentKey(value){
   return JSON.stringify(compact(value));
  }
  function show(){
   const state=current(),snapshot=state.snapshot;
   if(snapshot){
    const signature=JSON.stringify([group,search.value,contentKey(snapshot),search.value?snapshot.items.map(row=>root.AiselWorkorderCodeForName?.(row.name)||''):[]]);
    if(signature!==lastPaint){
     lastPaint=signature;
     if(snapshot.items.length)render(host,snapshot,search.value,group);
     else host.textContent=root.AiselAccess.ownOnly?'배정된 신상성과가 없습니다. 담당 자료 연결을 확인해주세요.':group==='core'?'핵심 SKU로 지정된 상품이 없습니다.':'표시할 신상성과가 없습니다.';
    }
   }else{
    root.AiselListPagination.clear('sales');
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
   state.lastAttempt=Date.now();state.error=false;state.retrying=false;
   const task=Promise.resolve().then(async()=>{
    try{
     let value;
     for(let attempt=0;attempt<2;attempt++){
      try{value=await read(endpoint,selected);break;}
      catch(error){
       const transient=['AbortError','TimeoutError','TypeError'].includes(error?.name)||['offline','network_error','timeout','service_unavailable','source_unavailable'].includes(error?.code);
       // One retry belongs to this read, never to a timer or a polling loop.
       // Access changes and hidden/other groups must not create another request.
       if(attempt||!transient||expected!==generation||selected!==group||!visible()||!root.AiselAccess?.allowed('sales'))throw error;
       state.retrying=true;show();
      }
     }
     if(expected!==generation)return false;
     state.snapshot=value;state.lastRead=Date.now();state.error=false;saveCache(selected,state);root.dispatchEvent(new CustomEvent('aisel-sales-snapshot'));return true;
    }catch(error){
     if(expected!==generation)return false;
     if(['permission_denied','unauthenticated','session_changed'].includes(error?.code)){
      forgetCache();generation++;groups.clear();entry(group).error=true;lastPaint='';show();return false;
     }
     state.error=true;return false;
    }finally{
     if(expected===generation){state.inFlight=null;state.retrying=false;state.lastAttempt=Date.now();if(selected===group)show();}
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
   document.querySelector('#salesView h2').textContent=session?.role==='designer'?'내 신상품 판매 성과':'신상품 판매 성과';
   const newTab=document.querySelector('#salesGroupTabs [data-group="new"]');if(newTab)newTab.textContent='신상품 전체';
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
  async function readSummary(){
   if(root.AiselAccess?.session?.role!=='designer'||!root.AiselAccess.ownOnly||!root.AiselAccess.allowed('sales'))return null;
   const expected=generation,state=entry('new');
   if(group!=='new')return null;
   if(state.inFlight)await state.inFlight;
   else if(!state.snapshot||Date.now()-Math.max(state.lastRead,state.lastAttempt)>=freshFor)await load();
   if(expected!==generation||root.AiselAccess?.session?.role!=='designer'||!root.AiselAccess.ownOnly||!root.AiselAccess.allowed('sales'))return null;
   if(!state.snapshot||state.error)return null;const summary=compact(state.snapshot);if(summary.source==='sales-comparison')summary.items=summary.items.filter(x=>x.isMine);return summary;
  }
  root.AiselSheetSalesSource={render:show,refreshIfStale,invalidate,readSummary};
  root.dispatchEvent(new CustomEvent('aisel-sales-source-ready'));
  document.addEventListener('visibilitychange',refreshIfStale);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refreshIfStale,{once:true});else queueMicrotask(refreshIfStale);
 }
 root.AiselSheetSalesView={read,render,start,performance,periodStatus};
})(globalThis);
