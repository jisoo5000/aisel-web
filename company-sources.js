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
  const {host,el,button}=ctx,header=el('div','ce-section-heading'),title=el('div');title.append(el('h2','','매출·광고·수익'),el('p','ce-muted','기존 수집 자료를 재사용합니다. 기간 변경과 합계 계산에 외부 API를 호출하지 않습니다.'));header.append(title);host.append(header);
  const filters=el('div','ce-filters'),select=el('select');select.setAttribute('aria-label','매출·수익 조회 기간');[1,2,3].forEach(n=>{const o=el('option','',n+'개월 · 최근 '+(n*30)+'일');o.value=n;select.append(o);});select.value=months;filters.append(select,button('저장된 자료 다시 확인',()=>load(ctx,'finance',draw,true)));host.append(filters);const body=el('div');host.append(body);let data=cache.get(identity()+':finance')?.data;select.addEventListener('change',()=>{months=Number(select.value);draw(data);});draw(data);load(ctx,'finance',draw);
  function draw(result){data=result;if(!body.isConnected)return;body.replaceChildren();const s=result?.snapshot;if(!s){body.append(el('p','ce-muted',result?.status?.status==='needs_attention'?'매출 원본 연결을 확인해야 합니다. 기존 값을 0으로 표시하지 않습니다.':'저장된 매출 자료를 확인하고 있습니다.'));return;}
   if(result.status?.status==='needs_attention')body.append(el('p','ce-error','최근 원본 연결에 문제가 있어 마지막으로 확인한 자료입니다.'));
   const today=new Date(Date.now()+32400000).toISOString().slice(0,10),start=new Date(Date.parse(today+'T00:00:00Z')-(months*30-1)*86400000).toISOString().slice(0,10),rows=(s.rows||[]).filter(r=>r.date>=start&&r.date<=today),rev=sum(rows,'orderRevenue'),spend=sum(rows,'adSpend'),profit=sum(rows,'estimatedProfit');
   body.append(el('p','ce-muted',start+' ~ '+today+' · '+rows.length+'/'+(months*30)+'일 자료 · 오늘은 수집 시각까지 누적'),el('p','ce-muted','원본 표 확인 '+new Date(s.readAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+(s.collectorAt?' · 최신 수집 '+new Date(s.collectorAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'')));
   const stats=el('div','ce-stats');for(const [label,value]of [['주문 매출액',money(rev)+'원'],['광고비',money(spend)+'원'],['통합 ROAS',rev!==null&&spend>0?rate(rev/spend):'—'],['예상 순익 · 가정값',money(profit)+'원']]){const card=el('div','ce-stat');card.append(el('span','ce-muted',label),el('strong','',value));stats.append(card);}body.append(stats,el('p','ce-muted',s.revenueBasis),el('p','ce-muted',s.profitBasis),el('p','ce-muted','실제 결제·환불·원가·수수료·운임·고정비의 확정 원장이 연결되기 전 실제 순익은 미확인입니다.'));
   if(rows.length<months*30)body.append(el('p','ce-muted','누락 날짜가 있습니다. 위 합계는 표시된 날짜의 소계입니다.'));
   const groups=new Map();for(const r of rows){const key=r.date.slice(0,7);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}body.append(el('h3','ce-table-heading','월별 소계 · 선택 기간에 포함된 날짜'));
   body.append(table(ctx,['월','자료 일수','주문 매출액','광고비','통합 ROAS','예상 순익'],[...groups].map(([month,v])=>{const a=sum(v,'orderRevenue'),b=sum(v,'adSpend');return [month,v.length+'일',money(a),money(b),a!==null&&b>0?rate(a/b):'—',money(sum(v,'estimatedProfit'))];}),'매출 월별 소계'));
   body.append(el('h3','ce-table-heading','일별 매출·광고비'),table(ctx,['날짜','주문 매출액','주문수','광고비','통합 ROAS','예상 순익','집계시각'],rows.map(r=>{const times=(r.sourceTimes||[]).filter(Number.isFinite);return [r.date+(r.partial?' · 당일 누적':''),money(r.orderRevenue),money(r.orders),money(r.adSpend),rate(r.roas),money(r.estimatedProfit),times.length===3?new Date(Math.min(...times)).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'미확인'];}),'매출 일별 표'));
   const a=link(ctx,'매출·광고 원본 시트',s.sourceUrl);if(a)body.append(a);body.append(el('p','ce-muted',s.coverage));
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
 root.AiselCompanySources={finance,hr,reset};
})(window);
