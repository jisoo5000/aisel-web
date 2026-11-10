(function(root){
 'use strict';
 let snapshot=null,scope='',flight=null,checkedAt=0,months=3;
 const identity=()=>{const s=root.AiselAccess?.session;return [s?.uid,s?.role,s?.credentialVersion||0].join(':');};
 const storageKey='aisel-company-sales-session-v1';
 function reset(){snapshot=null;scope='';flight=null;checkedAt=0;try{sessionStorage.removeItem(storageKey);}catch(_){}}
 function restore(){if(scope===identity())return;scope=identity();snapshot=null;checkedAt=0;try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.scope===scope&&Date.now()-saved.at<24*3600000){snapshot=saved.snapshot;checkedAt=saved.at;}else sessionStorage.removeItem(storageKey);}catch(_){}}
 root.addEventListener('aisel-access-change',()=>{if(!root.AiselAccess?.session?.active||scope&&scope!==identity())reset();});
 function formatCell(value,header){if(value===null||value===undefined||value==='')return '—';if(typeof value!=='number')return String(value);if(/등록일/.test(header)&&value>20000&&value<80000)return new Date((value-25569)*86400000).toISOString().slice(0,10);if(/비중|률|율/.test(header))return new Intl.NumberFormat('ko-KR',{style:'percent',maximumFractionDigits:1}).format(value);return value.toLocaleString('ko-KR');}
 function render(ctx){
  restore();const {host,el,button}=ctx,head=el('div','ce-section-heading'),title=el('div');title.append(el('h2','','판매표'),el('p','ce-muted','저장된 판매 표를 빠르게 확인합니다. 자료 기준 시각과 범위를 함께 표시합니다.'));head.append(title);host.append(head);
  const filters=el('div','ce-filters'),period=el('select');period.setAttribute('aria-label','판매 조회 기간');for(const n of [1,2,3]){const o=el('option','','최근 '+n+'개월');o.value=n;period.append(o);}period.value=months;period.addEventListener('change',()=>{months=Number(period.value);draw();});filters.append(period,button('저장된 표 다시 확인',()=>load(true)));host.append(filters);
  const body=el('div');host.append(body);draw();load(false);
  function table(headers,rows){const wrap=el('div','ce-table-scroll');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','판매 데이터 표');const t=el('table','ce-table'),h=el('thead'),tr=el('tr');headers.forEach(v=>tr.append(el('th','',v)));h.append(tr);t.append(h);const b=el('tbody');for(const row of rows){const r=el('tr');headers.forEach((header,i)=>r.append(el('td','',formatCell(row[i],header))));b.append(r);}t.append(b);wrap.append(t);return wrap;}
  function draw(){if(!body.isConnected)return;body.replaceChildren();if(!snapshot){body.append(el('p','ce-empty','아직 연결된 판매 표가 없습니다. 연결 후 저장된 자료부터 표시합니다.'));return;}
   body.append(el('p','ce-muted','자료 확인 '+new Date(snapshot.readAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})));
   const cutoff=new Date(Date.now()+9*3600000);cutoff.setUTCMonth(cutoff.getUTCMonth()-months);const start=cutoff.toISOString().slice(0,10),daily=(snapshot.daily||[]).filter(r=>r.date>=start);
   body.append(el('h3','','최근 '+months+'개월 · 일별 기록'));
   if(daily.length){body.append(el('p','ce-muted',snapshot.dailyCoverage),table(['날짜','상품명','품번','수량','확인 결제액','환불액','집계 범위'],daily.map(r=>[r.date,r.name,r.code,r.quantity,r.payment,r.refund,r.definition])));}else body.append(el('p','ce-muted','선택 기간의 일별 이력은 아직 연결되지 않았습니다. 아래 기존 표는 원본에 적힌 집계 기간 그대로 표시합니다.'));
   body.append(el('h3','ce-table-heading',snapshot.sourceTitle));for(const note of snapshot.periodNotes||[])body.append(el('p','ce-muted',note));body.append(table(snapshot.headers||[],snapshot.rows||[]));
   const url=root.AiselCompanyDomain.safeUrl(snapshot.sourceUrl);if(url){const a=el('a','ce-link','판매성과 원본 시트 열기');a.href=url;a.target='_blank';a.rel='noopener noreferrer';body.append(a);}
  }
  async function load(force){if(flight)return flight;if(snapshot&&!force&&Date.now()-checkedAt<3600000)return;const signature=scope;const p=ctx.request('companySalesSnapshot').then(result=>{if(signature!==identity())return;snapshot=result.snapshot;checkedAt=Date.now();if(snapshot){try{sessionStorage.setItem(storageKey,JSON.stringify({scope,at:checkedAt,snapshot}));}catch(_){}}draw();ctx.message(snapshot?'저장된 표를 확인했습니다.':'판매 시트 연결 후 자료가 표시됩니다.');}).catch(error=>{if(signature===identity())ctx.message(error.message,true);}).finally(()=>{if(flight===p)flight=null;});flight=p;return p;}
 }
 root.AiselCompanySales={render,reset};
})(window);
