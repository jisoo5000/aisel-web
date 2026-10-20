/* Isolated workflow UI. No Firebase reads, localStorage, background polling or authority inference.
 * Mount after design-workflow-core.js and the existing unified app. Server scopes every DTO.
 * Hooks: AiselDesignWorkflow.refresh(); observeSaved(code) ONLY after confirmed original save.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else api.mount(root);})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const TTL=300000, esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const isOwner=data=>data?.profile?.role==='owner';
 function createClient(env){
  let key='',epoch=0,data=null,at=0,flight=null,status='idle',message='',mutation=0;const pending=new Set(),changed=new Map();
  const identity=()=>{const u=env.auth();return u?.uid&&u.isAnonymous!==true?u:null;};
  const authKey=()=>{const u=identity();return u?u.uid+':'+(env.generation?.()||0):'';};
  const state=()=>({status,data,message,accountKey:key});
  function emit(){env.onChange?.(state());}
  function sync(){const next=authKey();if(next===key)return false;key=next;epoch++;for(const c of pending)c.abort();pending.clear();changed.clear();mutation=0;data=null;at=0;flight=null;status=key?'idle':'signed-out';message='';emit();return true;}
  function current(stamp){return stamp.epoch===epoch&&stamp.key===key&&stamp.key===authKey();}
  async function request(action,extra={}){
   sync();const user=identity(),stamp={key,epoch};if(!user)throw Error('로그인 후 확인할 수 있어요.');
   const endpoint=env.endpoint();if(!endpoint)throw Error('업무 연결을 확인하지 못했어요.');
   const controller=new AbortController();pending.add(controller);const timer=setTimeout(()=>controller.abort(),45000);
   try{const token=await user.getIdToken();if(!current(stamp))throw Object.assign(Error('계정이 바뀌었어요.'),{code:'session_changed'});
    const response=await env.fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
     body:JSON.stringify({...extra,action,token}),redirect:'follow',signal:controller.signal});
    if(!response.ok)throw Error('업무 응답을 확인하지 못했어요.');const out=await response.json();
    if(!current(stamp))throw Object.assign(Error('계정이 바뀌었어요.'),{code:'session_changed'});
    if(out?.ok!==true)throw Object.assign(Error(out?.error||'업무 자료를 확인하지 못했어요.'),{code:out?.code});return out;
   }finally{clearTimeout(timer);pending.delete(controller);}
  }
  function validate(out){
   if(!out?.profile||out.profile.uid!==identity()?.uid||out.profile.active!==true||!['owner','designer'].includes(out.profile.role)||
      !Array.isArray(out.records)||out.records.some(r=>!r||typeof r.code!=='string'||!r.code||typeof r.revision!=='number'))throw Error('업무 자료의 계정 또는 형식을 확인하지 못했어요.');
   return out;
  }
  function refresh(force=false){
   sync();if(!key)return Promise.resolve(null);if(!force&&data&&env.now()-at<TTL)return Promise.resolve(data);if(flight)return flight;
   const stamp={key,epoch,mutation};status='loading';message='';emit();
   const work=request('workflowRead').then(out=>{if(!current(stamp))return null;const next=validate(out);
    if(data&&mutation>stamp.mutation){const rows=new Map(next.records.map(r=>[r.code,r]));for(const r of data.records)if((changed.get(r.code)||0)>stamp.mutation&&(!rows.has(r.code)||rows.get(r.code).revision<r.revision))rows.set(r.code,r);next.records=[...rows.values()];}
    data=next;at=env.now();status='ready';emit();return data;})
    .catch(error=>{if(current(stamp)){data=null;at=0;status='error';message=error.message;emit();}return null;})
    .finally(()=>{if(current(stamp)&&flight===work)flight=null;});flight=work;return work;
  }
  async function mutate(action,payload){
   sync();const stamp={key,epoch};const out=await request(action,payload);
   if(!current(stamp))return null;
   if(!out.record||out.record.code!==payload.code||typeof out.record.revision!=='number')throw Error('저장 결과를 확인하지 못했어요. 다시 확인해 주세요.');
   let saved=out.record;changed.set(saved.code,++mutation);if(data){const previous=data.records.find(r=>r.code===saved.code);
    if(previous){const sameSource=previous.sourceCode===saved.sourceCode;saved={...previous,...saved};
     if(!sameSource){saved.metrics=null;saved.feedback=null;}else for(const field of ['metrics','feedback','orderCandidates'])if(out.record[field]===undefined)saved[field]=previous[field];}
    const records=data.records.filter(r=>r.code!==saved.code);records.push(saved);data={...data,records};at=env.now();status='ready';emit();}
   return action==='workflowObserveSaved'&&out.observed===false?{...saved,_observationIgnored:true}:saved;
  }
  function dispose(){epoch++;for(const c of pending)c.abort();pending.clear();data=null;flight=null;at=0;}
  return {state,sync,refresh,mutate,dispose};
 }
 function weeklyCards(data,now,C){
  if(!data||!C||!C.validDate(data.weekStart))return [];
  const owner=isOwner(data),names=owner?['장은영','강혜주']:[...new Set(data.records.map(r=>r.designer))];
  if(!owner&&C.getPolicy(data.profile.displayName))names.push(data.profile.displayName);
  const used=new Set();return names.map(name=>{
   const p=C.getPolicy(name);if(!p||used.has(p.id))return null;used.add(p.id);
   const date=new Date(Date.parse(data.weekStart+'T00:00:00Z')+(p.weekday-1)*86400000).toISOString().slice(0,10);
   const confirmed=data.confirmedMeetings?.[date+'_'+p.id];
   const manual=confirmed?.status==='owner_confirmed'&&C.getPolicy(confirmed.designer)?.id===p.id&&confirmed.meetingDate===date&&
    Number.isInteger(confirmed.confirmedBaseCount)&&confirmed.confirmedBaseCount>=0&&confirmed.confirmedBy&&confirmed.confirmedAt?confirmed:null;
   const records=data.records.filter(r=>{const assigned=r.workflow?.meetingDate||r.meetingDate;return assigned===date||!assigned&&r.trackingEligible===true;});
   try{return {...C.summarizeMeeting({designer:name,meetingDate:date,now,sourceState:data.source?.recordState==='ready'?'ready':'unknown',records}),name:p.name,manual};}
   catch(_){return {name:p.name,meetingDate:date,baseline:p.baseline,status:'unknown',onTime:null,target:null};}
  }).filter(Boolean);
 }
 function actualOrder(record){const c=record?.order?.confirmation;return !!(c?.kind==='production-order'&&
  typeof c.reference==='string'&&c.reference.trim()&&Number.isInteger(c.quantity)&&c.quantity>0&&
  !!c.orderedAt&&!!c.confirmedAt&&!!c.confirmedBy);}
 function orderRows(data,tab){return (data?.records||[]).filter(r=>tab==='done'?actualOrder(r):
  !actualOrder(r)&&(r.order?.requested===true||r.workStatus==='order'));}
 function metricLine(r,data){
  const m=r.metrics;if(!m)return r.sourceCode?'광고·반품 성과 확인 중':'광고·반품 성과 연결 확인 필요';
  if(m.status!=='ready')return '광고·반품 집계 확인 필요 · 결과 판단 대기';
  const parts=[];if(typeof m.metaRoas==='number')parts.push('광고 ROAS '+(m.metaRoas/100).toFixed(2));
  if(typeof m.returnRatio==='number')parts.push('기간 반품·구매 수량비 '+m.returnRatio.toFixed(1)+'% (잠정)');
  parts.push('반품 사유 미연결');
  if(m.latestDataDate||data.source?.dataThrough)parts.push(String(m.latestDataDate||data.source.dataThrough)+' 기준');return parts.join(' · ');
 }
 function createObservationGate(now){
  const rows=new Map(),get=code=>rows.get(code)||{attempts:0,lastAt:-Infinity,pending:false,complete:false};
  return {eligible:code=>{const r=get(code);return !r.complete&&r.attempts<3&&now()-r.lastAt>=30000;},
   mark:code=>rows.set(code,{...get(code),pending:true}),
   begin:code=>{const r=get(code);rows.set(code,{...r,attempts:r.attempts+1,lastAt:now(),pending:true});},
   finish:(code,complete)=>rows.set(code,{...get(code),complete:!!complete,pending:!complete}),
   pending:()=>[...rows].filter(([,r])=>r.pending).map(([code])=>code),
   retry:code=>rows.delete(code),clear:()=>rows.clear()};
 }
 function meaningfulSaved(record){return !!String(record?.pumMyeong||'').trim()&&!!(record.p1||record.p1Thumb||record.photo||
  Array.isArray(record.sizeSpec)&&record.sizeSpec.some(row=>Array.isArray(row?.values)&&row.values.some(value=>String(value??'').trim()!=='')));}
 function mount(w){
  if(w.AiselDesignWorkflow||!w.document)return;const d=w.document,C=w.AiselDesignWorkflowCore;
  const gallery=d.getElementById('galleryView'),editor=d.getElementById('editorView');if(!gallery||!editor||!C)return;
  const panel=d.createElement('section');panel.className='dw-panel noprint';panel.id='designWorkflowPanel';panel.hidden=true;
  panel.setAttribute('aria-label','디자인 업무와 발주');gallery.prepend(panel);
  const strip=d.createElement('section');strip.className='dw-panel dw-editor noprint';strip.id='designWorkflowEditor';strip.hidden=true;
  strip.setAttribute('aria-label','이 상품의 성과와 다음 개선');editor.prepend(strip); // Deliberately outside #sheet.
  let currentCode='',tab='request',busy=false,notice='',sessionKey='',observeTimers=new Map();const observations=createObservationGate(()=>Date.now());
  const client=createClient({auth:()=>w.AiselAuth?.currentUser?.(),generation:()=>w.AiselAuth?.generation,
   endpoint:()=>w.AISEL_DESIGN_MEETING_BRIDGE||'',fetch:(...args)=>w.fetch(...args),now:()=>Date.now(),onChange:render});
  const label={complete:'완료',ongoing:'진행 중',incomplete:'미완료',late:'지연 완료',unknown:'확인 필요'};
  const field=(name,type,value,labelText,extra='')=>`<label>${labelText}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  function visible(){const user=w.AiselAuth?.currentUser?.();return !!user?.uid&&user.isAnonymous!==true;}
  function compact(date){return C.validDate(date)?date.slice(5).replace('-','/'):'날짜 확인 필요';}
  function row(code){return client.state().data?.records.find(r=>r.code===code);}
  function recordTitle(r){return r.name||r.code;}
  function weeklyHtml(data){
   const cards=weeklyCards(observations.pending().length?{...data,source:{...data.source,recordState:'unknown'}}:data,Date.now(),C);return cards.length?cards.map(s=>{
    const known=s.status!=='unknown',progress=s.manual?`기본 ${s.manual.confirmedBaseCount}개 · 대표 확인`:known?`${s.onTime} / ${s.target}개`:'제출 결과 확인 필요';
    const detail=s.name==='혜주'?'기본 8개 · 일반 6 + 팬츠 신규소재 1 + 스커트 신규소재 1':'기본 6개 · 종류 제한 없음';
    return `<div class="dw-week-card"><strong>${esc(s.name)} · ${compact(s.meetingDate)} 자정</strong><b>${esc(progress)} <span>${s.manual?(s.manual.confirmedBaseCount>=s.baseline?'기본 완료':'기본 일부 확인'):label[s.status]}</span></b><small>${detail}${s.additionalTarget?' · 대표 추가 '+s.additionalTarget+'개':''}${s.late?' · 지연 제출 '+s.late+'개':''}</small></div>`;
   }).join(''):'<p class="dw-muted">배정된 주간 업무를 확인하고 있어요.</p>';
  }
  function ordersHtml(data){
   if(!isOwner(data))return '';const rows=orderRows(data,tab),pending=orderRows(data,'request').length,done=orderRows(data,'done').length;
   return `<details class="dw-orders"><summary>발주 확인 · 요청 ${pending} / 초도 완료 ${done}</summary><div class="dw-tabs" role="tablist" aria-label="발주 상태"><button data-tab="request" role="tab" aria-selected="${tab==='request'}">발주할 상품 (${pending})</button><button data-tab="done" role="tab" aria-selected="${tab==='done'}">초도 발주 완료 (${done})</button></div><div class="dw-order-list">${rows.length?rows.map(r=>`<div class="dw-order-row"><button data-open="${esc(r.code)}">${esc(recordTitle(r))}<small>${esc(r.code)} · ${esc(r.designer||'담당 확인 필요')}</small></button><span>${actualOrder(r)?compact(r.order.confirmation.orderDate)+' · '+r.order.confirmation.quantity+'장':'실제 발주 확인 전'}</span></div>`).join(''):'<p class="dw-muted">이 상태의 상품이 없어요.</p>'}</div></details>`;
  }
  function ownerForms(r,data){
   if(!isOwner(data))return '';const policy=C.getPolicy(r.designer);
   const target=policy?`<details><summary>회의 목표 조정</summary><form data-form="assign">${field('meetingDate','date',r.meetingDate||C.suggestMeetingDate(r.designer,Date.now()),'회의일','required')}<label>업무 구분<select name="slot"><option value="general" ${r.slot==='general'?'selected':''}>일반 작업</option><option value="comfort-pants" ${r.slot==='comfort-pants'?'selected':''}>컴포트팬츠 신규 소재</option><option value="comfort-skirt" ${r.slot==='comfort-skirt'?'selected':''}>컴포트스커트 신규 소재</option></select></label><label class="dw-check"><input name="additional" type="checkbox" ${r.additional?'checked':''}>대표 추가 요청 (기본 목표에 +1)</label><button type="submit">목표 반영</button></form></details>`:'';
   const candidates=(r.orderCandidates||[]).filter(c=>typeof c.candidateId==='string'&&C.validDate(c.date)&&Number.isInteger(c.quantity)&&c.quantity>0);
   const candidateHtml=candidates.map(c=>`<form data-form="candidate" class="dw-candidate"><input type="hidden" name="candidateId" value="${esc(c.candidateId)}"><div><strong>${esc(c.date)} · ${c.quantity}장 · ${esc(c.factory||'공장 확인 필요')}</strong><small>${esc(c.reference||'발주 원장 기록')}<br>${c.stale?'이전 조회 기록 · 현재 확인 필요':'원장 조회 확인'}${C.timestamp(c.snapshotAt)!==null?' · '+esc(C.kstDate(c.snapshotAt)):''}</small></div><button type="submit">실제 초도 발주 맞음</button></form>`).join('');
   const manualHtml=`<form data-form="confirm">${field('orderDate','date',C.kstDate(Date.now()),'실제 발주일','required')}${field('quantity','number','','초도 수량','min="1" step="1" required')}${field('reference','text','','발주번호 또는 확인 기록','placeholder="예: 발주서 번호 / 거래처 확인 내용" maxlength="500" required')}<button type="submit">실제 초도 발주 확인</button></form>`;
   const confirmation=actualOrder(r)?`<p>초도 발주 완료 · ${esc(r.order.confirmation.orderDate)} · ${r.order.confirmation.quantity}장<br><small>${esc(r.order.confirmation.reference)}</small></p>`:
    `<details><summary>실제 초도 발주 확인</summary><p class="dw-muted">공장 지정만으로는 완료되지 않아요. 아래 기록이 실제 초도 발주일 때만 확인해 주세요. 샘플·재주문이면 누르지 마세요.</p>${candidateHtml}${candidates.length?'<details><summary>맞는 기록이 없으면 직접 확인</summary>'+manualHtml+'</details>':manualHtml}</details>`;
   const mapping=Array.isArray(data.metricChoices)&&data.metricChoices.length?`<details><summary>광고·판매 상품 연결</summary><form data-form="map"><label>카페24 상품<select name="sourceCode" required><option value="">상품 직접 선택</option>${data.metricChoices.map(p=>`<option value="${esc(p.sourceCode)}" ${r.sourceCode===p.sourceCode?'selected':''}>${esc(p.name)} · ${esc(p.sourceCode)}</option>`).join('')}</select></label><button type="submit">연결 저장</button></form></details>`:'';
   return `<div class="dw-owner-tools">${target}${confirmation}${mapping}</div>`;
  }
  function renderEditor(state){
   const r=state.data?.records.find(item=>item.code===currentCode);strip.hidden=!visible()||!currentCode;
   if(strip.hidden){strip.replaceChildren();return;}
   if(state.status!=='ready'||!r){strip.innerHTML='<p class="dw-muted">이 상품의 업무·성과 자료를 확인하고 있어요.</p>';return;}
   const f=r.feedback||{};strip.innerHTML=`<strong>성과와 다음 개선</strong><p class="dw-metric">${esc(metricLine(r,state.data))}</p><details><summary>가설 · 결과 · 다음 개선</summary><dl><dt>가설</dt><dd>${esc(f.hypothesis||'가설 초안 준비 중')}</dd><dt>결과</dt><dd>${esc(f.result||'자료가 쌓이면 확인할 수 있어요.')}</dd><dt>다음 개선</dt><dd>${esc(f.next||'성과 확인 후 다음 작업에 반영해요.')}</dd></dl>${r.metrics?.returnNote?'<p class="dw-muted">'+esc(r.metrics.returnNote)+'</p>':''}</details>${ownerForms(r,state.data)}<p class="dw-notice" role="status">${esc(notice)}</p>`;
   strip.querySelectorAll('button,input,select').forEach(el=>el.disabled=busy);
  }
  function render(){
   const s=client.state();panel.hidden=!visible();if(panel.hidden){panel.replaceChildren();strip.hidden=true;strip.replaceChildren();return;}
   for(const code of observations.pending()){const r=s.data?.records.find(item=>item.code===code);if(r?.submittedAt||r?.workflow?.submittedAt)observations.finish(code,true);}
   const open=panel.querySelector('.dw-orders')?.open;
   panel.innerHTML=`<div class="dw-heading"><strong>이번 주 디자인 업무</strong><button data-refresh>새로 확인</button></div>${s.status==='ready'?'<div class="dw-week-grid">'+weeklyHtml(s.data)+'</div>'+ordersHtml(s.data):'<p class="dw-muted" role="status">'+(s.status==='error'?'자료를 확인하지 못했어요. 완료 여부는 아직 판단하지 않아요.':'업무 자료 확인 중…')+'</p>'}${observations.pending().length?'<p class="dw-muted" role="status">제출 자동 확인 대기 · '+observations.pending().length+'건 (저장된 작지는 유지돼요.)</p>':''}`;
   if(open&&panel.querySelector('.dw-orders'))panel.querySelector('.dw-orders').open=true;
   panel.querySelector('[data-refresh]').disabled=s.status==='loading';renderEditor(s);
  }
  panel.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;
   if(button.hasAttribute('data-refresh'))void client.refresh(true).then(()=>{if(currentCode&&observations.pending().includes(currentCode)){observations.retry(currentCode);void observeSaved(currentCode);}});
   if(button.dataset.tab){tab=button.dataset.tab;render();}
   if(button.dataset.open&&row(button.dataset.open))w.AiselUnifiedAdapter?.open(button.dataset.open);
  });
  strip.addEventListener('submit',async event=>{
   const form=event.target;if(!form.dataset.form)return;event.preventDefault();if(busy)return;
   const data=client.state().data,r=row(currentCode);if(!isOwner(data)||!r)return;
   const code=r.code,revision=r.revision,kind=form.dataset.form,values=new FormData(form);let action,payload={code,expectedRevision:revision};
   if(kind==='assign'){action='workflowAssign';Object.assign(payload,{meetingDate:String(values.get('meetingDate')),slot:String(values.get('slot')),additional:values.get('additional')==='on'});}
   if(kind==='confirm'){action='workflowConfirmOrder';Object.assign(payload,{orderDate:String(values.get('orderDate')),quantity:Number(values.get('quantity')),reference:String(values.get('reference')||'').trim()});if(!Number.isInteger(payload.quantity)||payload.quantity<1||!payload.reference)return;}
   if(kind==='candidate'){action='workflowConfirmOrder';payload.candidateId=String(values.get('candidateId'));if(!r.orderCandidates?.some(c=>c.candidateId===payload.candidateId))return;}
   if(kind==='map'){action='workflowMapMetric';payload.sourceCode=String(values.get('sourceCode'));if(!data.metricChoices?.some(p=>p.sourceCode===payload.sourceCode))return;}
   if(!action)return;const stamp=client.state().accountKey;busy=true;notice='저장 중…';strip.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
   let saved=false;try{await client.mutate(action,payload);if(kind==='map')await client.refresh(true);if(stamp===client.state().accountKey){notice='저장됐어요.';saved=true;}}
   catch(error){if(stamp===client.state().accountKey)notice=error.message;}
   finally{if(stamp===client.state().accountKey){busy=false;if(saved)render();else{const message=strip.querySelector('.dw-notice');if(message)message.textContent=notice;strip.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}}}
  });
  async function observeSaved(code){
   client.sync();if(!visible()||!code)return;const state=w.AiselEditorAdapter?.state?.();if(state?.code!==code||!state.record)return;
   const record=state.record;if(!C.getPolicy(record.designer))return;
   const registered=row(code);if(registered?.submittedAt||registered?.workflow?.submittedAt){observations.finish(code,true);return;}
   if(registered?.trackingEligible===false&&!registered.meetingDate){observations.finish(code,true);return;}
   if(!meaningfulSaved(record)||!observations.eligible(code))return;
   observations.mark(code);render();clearTimeout(observeTimers.get(code));const stamp=client.state().accountKey;
   observeTimers.set(code,setTimeout(async()=>{observeTimers.delete(code);if(stamp!==client.state().accountKey)return;
    if(!observations.eligible(code))return;observations.begin(code);
    try{const saved=await client.mutate('workflowObserveSaved',{code});if(stamp===client.state().accountKey){observations.finish(code,!!(saved?._observationIgnored||saved?.submittedAt||saved?.workflow?.submittedAt));render();}}
    catch(_){if(stamp===client.state().accountKey){notice='제출 자동 확인이 늦어지고 있어요. 기존 작지는 저장돼 있어요.';render();}}
   },1200));
  }
  function session(){client.sync();const next=client.state().accountKey;if(next!==sessionKey){sessionKey=next;observations.clear();for(const timer of observeTimers.values())clearTimeout(timer);observeTimers.clear();busy=false;notice='';currentCode='';}void client.refresh();}
  w.addEventListener('aisel-session-change',session);w.addEventListener('aisel-session-ready',session);
  w.addEventListener('aisel-workorder-loaded',event=>{currentCode=event.detail?.code||w.AiselEditorAdapter?.state?.()?.code||'';notice='';render();void client.refresh();});
  w.addEventListener('aisel-workorder-detached',()=>{currentCode='';notice='';render();});
  d.addEventListener('visibilitychange',()=>{if(!d.hidden)void client.refresh();});
  w.AiselDesignWorkflow=Object.freeze({refresh:()=>client.refresh(true),observeSaved,state:client.state});session();
 }
 return {createClient,createObservationGate,meaningfulSaved,weeklyCards,actualOrder,orderRows,metricLine,mount};
});
