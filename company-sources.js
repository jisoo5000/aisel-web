(function(root){
 'use strict';
 const cache=new Map(),flights=new Map();let epoch=0,months=3,hrTab='roles',hrSearch='';
 const identity=()=>{const s=root.AiselAccess?.session;return [s?.uid,s?.role,s?.credentialVersion||0].join(':');};
 function reset(){epoch++;cache.clear();flights.clear();hrSearch='';}
 root.addEventListener('aisel-access-change',reset);
 async function load(ctx,kind,draw,force=false){
  const requestEpoch=epoch,key=identity()+':'+kind,old=cache.get(key);if(old&&!force&&Date.now()-old.at<3600000){draw(old.data);return;}
  let p=flights.get(key);if(!p){const run=epoch;p=ctx.request(kind==='finance'?'companyFinanceSnapshot':'companyHrSnapshot').then(data=>{if(epoch!==run||key!==identity()+':'+kind)return null;cache.set(key,{at:Date.now(),data});return data;}).finally(()=>{if(flights.get(key)===p)flights.delete(key);});flights.set(key,p);}
  try{const data=await p;if(data&&ctx.host.isConnected)draw(data);}catch(e){if(requestEpoch===epoch&&ctx.host.isConnected)ctx.message('저장된 자료를 확인하지 못했습니다. '+e.message,true);}
 }
 const money=x=>typeof x==='number'&&Number.isFinite(x)?Math.round(x).toLocaleString('ko-KR'):'—';
 const rate=x=>typeof x==='number'&&Number.isFinite(x)?(x*100).toLocaleString('ko-KR',{maximumFractionDigits:1})+'%':'—';
 const sum=(rows,key)=>rows.length&&rows.every(r=>typeof r[key]==='number'&&Number.isFinite(r[key]))?rows.reduce((n,r)=>n+r[key],0):null;
 function table(ctx,headers,rows,label){const {el}=ctx,wrap=el('div','ce-table-scroll'),table=el('table','ce-table'),head=el('thead'),tr=el('tr'),body=el('tbody');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',label);headers.forEach(h=>tr.append(el('th','',h)));head.append(tr);table.append(head);rows.forEach(row=>{const tr=el('tr');row.forEach(v=>tr.append(el('td','',v??'—')));body.append(tr);});table.append(body);wrap.append(table);return wrap;}
 function link(ctx,label,url){const safe=root.AiselCompanyDomain.safeUrl(url);if(!safe)return null;const a=ctx.el('a','ce-link',label);a.href=safe;a.target='_blank';a.rel='noopener noreferrer';return a;}
 function finance(ctx){
  const {host,el,button}=ctx,header=el('div','ce-section-heading'),title=el('div');
  title.append(el('h2','','광고 성과'),el('p','ce-muted','저장된 매출·광고 자료를 한눈에 확인합니다.'));header.append(title);host.append(header);
  let days=7,data=cache.get(identity()+':finance')?.data;
  const filters=el('div','ce-filters sp-finance-filters'),select=el('select');select.setAttribute('aria-label','광고 성과 조회 기간');
  [[1,'어제'],[7,'최근 7일'],[30,'최근 30일']].forEach(([v,label])=>{const o=el('option','',label);o.value=v;select.append(o);});select.value=days;
  filters.append(select,button('저장 자료 확인',()=>load(ctx,'finance',draw,true)));host.append(filters);
  const body=el('div','sp-finance');host.append(body);select.addEventListener('change',()=>{days=Number(select.value);draw(data);});draw(data);load(ctx,'finance',draw);
  function card(label,value,note){const c=el('div','ce-stat sp-finance-stat');c.append(el('span','ce-muted',label),el('strong','',value));if(note)c.append(el('small','ce-muted',note));return c;}
  function draw(result){
   data=result;if(!body.isConnected)return;body.replaceChildren();
   const s=result?.snapshot;if(!s){body.append(el('p','ce-muted','저장된 광고 자료를 확인하고 있습니다.'));return;}
   if(result.status?.status==='needs_attention')body.append(el('p','ce-error','갱신 확인 필요 · 마지막으로 저장된 자료입니다.'));
   const today=new Date(Date.now()+32400000).toISOString().slice(0,10),end=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10),start=new Date(Date.parse(end+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
   const rows=(s.rows||[]).filter(r=>r.date>=start&&r.date<=end),complete=rows.length===days,spend=sum(rows,'adSpend'),rev=sum(rows,'orderRevenue'),orders=sum(rows,'orders');
   body.append(el('p','ce-muted',start+' ~ '+end+' · '+rows.length+'/'+days+'일 자료'),el('p','ce-muted','마지막 갱신 '+new Date(s.collectorAt||s.readAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})));
   if(!complete)body.append(el('p','ce-muted','누락 날짜가 있어 확인된 날짜의 소계만 표시합니다.'));
   const stats=el('div','sp-finance-stats');
   stats.append(card('총 광고비',money(spend)+'원'),card('자사몰 주문 매출',money(rev)+'원'),card('매출 / 광고비',rev!==null&&spend>0?(rev/spend).toFixed(2)+'배':'—','전체 주문 매출 기준'),card('자사몰 주문수',money(orders)+'건'));body.append(stats);
   const accounts=el('div','sp-finance-accounts');
   for(const [prefix,name]of [['aisel','에이슬'],['loveu','러브유']]){
    const cost=sum(rows,prefix+'Spend'),valid=rows.length&&rows.every(r=>typeof r[prefix+'Spend']==='number'&&Number.isFinite(r[prefix+'Spend'])&&typeof r[prefix+'Roas']==='number'&&Number.isFinite(r[prefix+'Roas']));
    const attributed=valid?rows.reduce((a,r)=>a+r[prefix+'Spend']*r[prefix+'Roas'],0):null;
    const account=el('section','sp-finance-account');account.append(el('h3','',name));
    const d=el('dl','sp-finance-definition');[['광고비',money(cost)+'원'],['ROAS',attributed!==null&&cost>0?(attributed/cost).toFixed(2)+'배':'미연결']].forEach(([a,b])=>d.append(el('dt','',a),el('dd','',b)));
    account.append(d,el('p','ce-muted','계정 ROAS는 광고비로 가중 합산'));accounts.append(account);
   }body.append(accounts);
   const detail=el('details','sp-finance-detail');detail.append(el('summary','','날짜별 자세히 보기'));
   const dates=el('div','sp-finance-dates');
   for(const r of rows){const c=el('section','sp-finance-date');c.append(el('strong','',r.date));const dl=el('dl','sp-finance-definition');[['주문 매출',money(r.orderRevenue)+'원'],['광고비',money(r.adSpend)+'원'],['주문수',money(r.orders)+'건']].forEach(([a,b])=>dl.append(el('dt','',a),el('dd','',b)));c.append(dl);dates.append(c);}detail.append(dates);body.append(detail);
   const basis=el('details','sp-finance-detail');basis.append(el('summary','','집계 기준'),el('p','ce-muted',s.revenueBasis||''),el('p','ce-muted','자사몰 전체 주문 매출과 광고 기여 매출은 집계 기준이 다릅니다.'));
   const a=link(ctx,'원본 시트 보기',s.sourceUrl);if(a)basis.append(a);body.append(basis);
  }
 }
 function hr(ctx){
  const {host,el,button}=ctx,box=el('section','ce-hr-source');host.append(box);const controls=el('div','ce-filters');for(const [id,label]of [['roles','채용 현황'],['people','전체 인력'],['checklist','채용 준비 체크리스트']])controls.append(button(label,()=>{hrTab=id;draw(data);}));const search=el('input');search.type='search';search.placeholder='이름·직무·할 일 검색';search.setAttribute('aria-label','채용·인력 원본 검색');search.value=hrSearch;controls.append(search,button('저장된 원본 다시 확인',()=>load(ctx,'hr',draw,true)));box.append(controls);const body=el('div');box.append(body);let data=cache.get(identity()+':hr')?.data;search.addEventListener('input',()=>{hrSearch=search.value;draw(data);});draw(data);load(ctx,'hr',draw);
  function draw(result){data=result;if(!body.isConnected)return;body.replaceChildren();const s=result?.snapshot;if(!s){body.append(el('p','ce-muted',result?.status?.status==='needs_attention'?'채용 원본 연결 확인이 필요합니다.':'기존 채용·인력 원본을 확인하고 있습니다.'));return;}
   body.append(el('p','ce-muted','원본 확인 '+new Date(s.readAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' · 원본의 현재 여부·미정 표시를 그대로 유지합니다.'));if(result.status?.status==='needs_attention')body.append(el('p','ce-error','최근 연결 오류가 있어 이전에 확인한 자료입니다.'));
   const a=link(ctx,'기존 채용·인력 시트 열기',s.sourceUrl);if(a)body.append(a);const rows=(s[hrTab]||[]).filter(r=>r.cells.join(' ').toLowerCase().includes(hrSearch.toLowerCase()));body.append(el('p','ce-muted',rows.length+'개 기록'));
   for(const r of rows){const c=r.cells,card=el('details','ce-project'),label=hrTab==='roles'?c[0]:hrTab==='people'?c[1]+' · '+c[2]:c[2];card.append(el('summary','ce-catalog-title',label));
    const fields=hrTab==='roles'?[[1,'진행 단계'],[2,'현재 연관 인원'],[3,'맡길 결과'],[4,'필수 경력'],[5,'고용 형태'],[6,'다음 할 일'],[7,'모집인원'],[8,'우선순위']]:hrTab==='people'?[[0,'구분'],[3,'현재 상태'],[4,'핵심 업무'],[5,'확인할 것'],[7,'근거·확인 상태']]:[[1,'대상'],[3,'완료 기준'],[4,'담당'],[5,'기한'],[6,'진행 상태']];
    for(const [n,label]of fields){const p=el('p','ce-detail-line');p.append(el('strong','',label),el('span','',c[n]===null||c[n]===undefined||c[n]===''?'미입력':typeof c[n]==='number'&&n===5&&hrTab==='checklist'?new Date((c[n]-25569)*86400000).toISOString().slice(0,10):String(c[n])));card.append(p);}
    const url=c[hrTab==='roles'?9:hrTab==='people'?6:7],doc=link(ctx,'관련 문서',url);if(doc)card.append(doc);card.append(el('p','ce-muted','원본 기록 '+r.id));
    if(hrTab==='roles'){const linked=ctx.projects().filter(p=>p.recruitmentId===r.id);linked.forEach(p=>card.append(button((p.archived?'보관 · ':'')+p.title,()=>ctx.openProject(p.id),'ce-link')));card.append(button(linked.length?'추가 진행 업무 연결':'진행 업무 연결',()=>ctx.createRole(r,s.sourceUrl)));}
    body.append(card);
   }
  }
 }
 root.AiselCompanySources={finance,hr,reset,financeSnapshot:(ctx,draw,force=false)=>load(ctx,'finance',draw,force)};
})(window);

