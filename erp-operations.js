/* Private ERP operations. Existing authenticated access transport is the only data path. */
(function(root){
 'use strict';
 const document=root.document,main=document.getElementById('mainBar');
 if(!main||root.AiselOperations)return;
 const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;};
 const view=node('section','noprint');view.id='erpOperationsView';view.hidden=true;view.setAttribute('aria-label','업무 연결');main.after(view);
 const title=node('h2','','업무 연결'),intro=node('p','ops-muted','후보 전체를 검토하고, 선택한 상품의 담당 업무와 원샘플 구매·반품을 연결합니다.');
 const toolbar=node('div','ops-toolbar'),tabs=node('div','ops-tabs'),notice=node('p','ops-notice'),body=node('div'),formHost=node('div');
 notice.setAttribute('role','status');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','업무 종류');
 const refresh=button('새로 확인',()=>load()),count=node('span','ops-muted'),addCandidate=button('후보 추가',()=>candidateForm());toolbar.append(refresh,addCandidate,count);
 view.append(title,intro,tabs,toolbar,notice,formHost,body);
 const tabLabels={candidates:'디자인 후보',jobs:'MD·담당 업무',purchases:'원샘플 구매',returns:'반품·환불',connections:'연결 상태'};
 const stateLabels={draft:'작성 중',ready:'전달 준비',requested:'반품 접수',prepared:'전달 준비',queued:'전달 준비',awaiting_connector:'피클 연결 대기',awaiting_quote:'견적 확인 대기',waiting_connector:'피클 연결 대기',pending:'확인 대기',blocked:'연결 대기',ordered:'주문 확인',delivered:'수령 확인',return_requested:'반품 접수',submitted:'반품 접수',authorized:'판매처 승인',shipped:'반품 발송',collected:'수거 확인',received:'판매처 도착',refund_pending:'환불 처리 중',refunding:'환불 처리 중',refunded:'실환불 확인',completed:'완료',done:'완료',needs_info:'자료 확인 필요',unassigned:'담당 연결 필요',open:'진행 대기',in_progress:'작업 중',md_review:'MD 검수',awaiting_publication:'등록 대기',verification:'노출 확인',cancelled:'취소'};
 let active='candidates',items=[],epoch=0,visible=false,loading=false,writing=false,loaded=false,lastSignature='',connector={pickle:'unconnected'},links={};
 const access=()=>root.AiselAccess,role=()=>access()?.session?.role;
 function allowed(){const s=access()?.session;return s?.active===true&&!s.legacy&&!!s.uid&&['owner','md','logistics'].includes(s.role);}
 function button(text,handler){const b=node('button','',text);b.type='button';b.addEventListener('click',handler);return b;}
 function safeLink(label,url){try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol))return node('span','',label);}catch(_){return node('span','',label);}const a=node('a','',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
 function value(v){return v===undefined||v===null||v===''?'미확인':Array.isArray(v)?v.map(value).join(' · '):typeof v==='object'?Object.entries(v).map(([k,x])=>k+': '+value(x)).join(' · '):String(v);}
 function status(v){return stateLabels[v]||v||'확인 대기';}
 function setNotice(text,error=false){notice.textContent=text;notice.className='ops-notice'+(error?' ops-error':'');}
 function showTabs(){addCandidate.hidden=active!=='candidates'||role()==='logistics';tabs.replaceChildren();for(const [key,label]of Object.entries(tabLabels)){if(role()==='logistics'&&key==='candidates')continue;const b=button(label,()=>select(key));b.setAttribute('role','tab');b.setAttribute('aria-selected',String(key===active));tabs.append(b);}}
 function select(next){if(writing||formHost.childElementCount)return setNotice('작성 중인 요청을 저장하거나 닫은 뒤 이동해 주세요.');epoch++;loading=false;refresh.disabled=false;active=next;items=[];loaded=false;lastSignature='';showTabs();render();if(next!=='connections')load();}
 function friendly(error){const code=error?.code||'';if(/unknown_action|unsupported|not_found|invalid_action/.test(code))return '업무 연결 서버의 운영 반영을 기다리고 있습니다. 주문·반품 요청은 전송되지 않았습니다.';if(/permission|unauthenticated/.test(code))return '이 업무의 서버 접근 권한을 확인해야 합니다. 기존 계정 권한은 유지됩니다.';if(/conflict/i.test(code))return '다른 곳에서 변경된 기록입니다. 새로 확인한 뒤 다시 진행해 주세요.';return error?.message||'연결 결과를 확인하지 못했습니다. 다시 요청하기 전에 최신 상태를 확인해 주세요.';}
 async function load(){
  if(!visible||!allowed()||loading||writing)return;
  if(active==='connections'){render();return;}
  const run=++epoch,kind=active,uid=access().session.uid;loading=true;refresh.disabled=true;setNotice('담당 계정으로 최신 기록을 확인하고 있습니다.');
  try{
   let cursor=null;const all=[],seen=new Set();
   do{
    const result=await access().request('operationsList',{kind,limit:100,...(cursor?{cursor}:{})});
    if(run!==epoch||uid!==access()?.session?.uid||!visible)return;
    if(!Array.isArray(result.items))throw Error('업무 목록 응답 형식을 확인해야 합니다.');
    for(const item of result.items)if(!seen.has(item.id)){seen.add(item.id);all.push(item);}
    connector=result.connector||connector;links=result.links||links;
    const next=result.nextCursor||null;if(next&&next===cursor)throw Error('다음 목록 연결을 확인해야 합니다.');cursor=next;
   }while(cursor);
   if(run!==epoch)return;items=all;loaded=true;render();
   setNotice(connector.pickle==='connected'?'최신 기록을 확인했습니다. 외부 주문·반품은 각 처리 증빙으로 구분합니다.':'기록 확인 완료 · 피클 미연결. 요청 작성과 실제 주문·반품 접수는 별도 상태입니다.');
  }catch(error){if(run===epoch){items=[];loaded=false;render();setNotice(friendly(error),true);}}
  finally{if(run===epoch){loading=false;refresh.disabled=false;}}
 }
 function detail(label,text){const p=node('p');p.append(node('strong','',label+' '),node('span','',value(text)));return p;}
 function detailsFor(row){const d=node('details');d.append(node('summary','','근거·멍거 판단'));const j=row.judgment||{};for(const [key,label]of Object.entries({demand:'살 이유',supply:'제작 조건',usp:'에이슬 적합성',counterEvidence:'실패할 이유',opportunityCost:'기회비용',nextCheck:'다음 검증'}))d.append(detail(label,j[key]));for(const e of row.rankEvidence||[])d.append(detail('인기 근거',[e.platform,e.category,e.period,e.window,e.rank?e.rank+'위':null,e.observedAt].filter(Boolean).join(' · ')));d.append(detail('대표 결정',row.representativeDecision));return d;}
 function table(headers,rows){const wrap=node('div','ops-scroll'),t=node('table'),head=node('thead'),tr=node('tr'),tbody=node('tbody');for(const text of headers){const th=node('th','',text);th.scope='col';tr.append(th);}head.append(tr);t.append(head,tbody);wrap.append(t);for(const cells of rows){const r=node('tr');cells.forEach((c,i)=>{const td=node('td',i===0?'ops-name':'');td.append(c instanceof root.Node?c:node('span','',value(c)));r.append(td);});tbody.append(r);}return wrap;}
 function linkedName(row){const c=node('div');c.append(node('strong','',row.name||row.productName||row.title||row.id));if(row.productRef||row.url)c.append(node('p','', ''),safeLink('상품 확인',row.productRef||row.url));return c;}
 function render(){
  const sig=JSON.stringify([active,items,loaded,role(),connector]);if(sig===lastSignature)return;lastSignature=sig;
  body.replaceChildren();count.textContent=active==='connections'?'':loaded?'전체 '+items.length+'건':'';
  if(active==='connections'){renderConnections();return;}
  if(!items.length){body.append(node('div','ops-empty',loaded?'등록된 기록이 없습니다. 조사 후보는 개수 제한 없이 보관합니다.':'연결을 확인하면 해당 계정의 업무 기록을 표시합니다.'));return;}
  if(active==='candidates'){
   const rows=(root.AiselErpOperations?.sortCandidates(items)||items).map(row=>{const name=linkedName(row);name.append(detailsFor(row));const actions=node('div','ops-actions');actions.append(button('판단 기록',()=>candidateForm(row)),button('샘플 요청 작성',()=>purchaseForm(row)));return [name,row.material,row.fit||'부츠컷 우선 검토',row.sampleNeed||'원샘플 필요 여부 확인',actions];});
   body.append(table(['후보·근거','소재','기존 패턴 검토','다음 확인','구매 요청'],rows));
  }else if(active==='jobs'){
   body.append(table(['업무','대상 상품','담당','기한','단계·근거'],items.map(row=>{const detailNode=node('div','',status(row.status||row.state));if(row.sourceRef)detailNode.append(node('p'),safeLink('원본 확인',row.sourceRef));detailNode.append(node('p'),button('진행 기록',()=>jobForm(row)));return [row.title||row.kind,row.productKey,row.assigneeName||row.assigneeUid||'담당 연결 필요',row.dueAt||row.dueDate,detailNode];})));
  }else if(active==='purchases'){
   body.append(table(['원샘플','옵션·수량','주문·할인','상태','반품'],items.map(row=>{const facts=node('div');facts.append(detail('주문번호',row.sellerOrderId||row.orderId),detail('실결제',row.paidAmount),detail('확인된 할인',row.discountAmount));const actions=node('div','ops-actions');actions.append(button('반품 요청 작성',()=>returnForm(row)));return [linkedName(row),value(row.options)+' / '+value(row.quantity)+'개',facts,status(row.status||row.state),actions];})));
  }else{
   body.append(table(['주문 상품','반품 수량·사유','담당·기한','접수·수거','환불'],items.map(row=>[row.productName||row.purchaseId||row.id,value(row.quantity)+'개 · '+value(row.reason),value(row.assigneeName||row.assigneeUid||'담당 연결 필요')+' · '+value(row.returnDeadline),status(row.status||row.state),node('div','', '예상 '+value(row.expectedRefund)+' / 실제 '+value(row.actualRefund))])));
  }
 }
 function renderConnections(){
  const grid=node('div','ops-progress');
  for(const [label,text]of [['경쟁사 주간 조사','W컨셉·29CM·무신사 / 여성 바지 / 소재별 근거'],['자사 판매·반품','품번과 집계 기간을 맞춰 연결'],['기존 패턴 검토','아네트 부츠컷·플레어 우선'],['멍거 판단','근거·반대 근거·다음 검증을 분리'],['MD·상세페이지','시즌과 실제 저장된 변경으로 담당 업무 생성'],['원샘플 구매·반품','피클 전달 · 수거 · 실환불을 구분']]){const box=node('div');box.append(node('strong','',label),node('span','ops-muted',text));grid.append(box);}body.append(grid);
  body.append(detail('ERP 업무 서버',loaded?'기록 조회 확인':'운영 연결 확인 필요'),detail('피클',connector.pickle==='connected'?'연결 확인':'미연결 · 외부 주문·반품 접수 미검증'));
  body.append(node('p','ops-muted','예정 작업과 실제 실행은 구분합니다. 서버 연결만으로 주간 수집·시즌 변경·사진 합성·알림이 실행 완료되는 것은 아닙니다.'));
  const actions=node('div','ops-actions');for(const [key,label]of [['sourcing','소싱 시트'],['munger','멍거 판단 시트'],['conceptboard','상품 등록 현황'],['presentation','기존 회의 자료']])if(links[key])actions.append(safeLink(label,links[key]));
  actions.append(button('기존 샘플현황',()=>root.AiselUnified?.show('samples')),safeLink('피클', 'https://www.pickle.com/'));body.append(actions);
 }
 function form(titleText,fields,onSubmit){
  formHost.replaceChildren();const f=node('form','ops-form'),heading=node('h2','',titleText),grid=node('div','ops-form-grid'),inputs={};f.append(heading,grid);
  for(const spec of fields){const label=node('label','',spec.label),input=node(spec.options?'select':spec.multiline?'textarea':'input');input.name=spec.key;if(spec.options){for(const [v,l]of spec.options){const option=node('option','',l);option.value=v;input.append(option);}}else if(!spec.multiline)input.type=spec.type||'text';if(spec.type==='number'){input.min=spec.min??0;input.step='1';}input.required=spec.required!==false;input.value=spec.value??'';input.maxLength=spec.maxLength||500;input.autocomplete='off';inputs[spec.key]=input;label.append(input);grid.append(label);}
  const note=node('p','ops-muted','계정·배송지·결제수단은 피클에 저장된 참조 이름만 입력하세요. 비밀번호와 카드번호는 입력하지 않습니다.');f.append(note);
  const actions=node('div','ops-actions'),submit=node('button','','요청 저장'),cancel=button('닫기',()=>{if(!writing)formHost.replaceChildren();});submit.type='submit';actions.append(submit,cancel);f.append(actions);formHost.append(f);
  f.addEventListener('submit',async event=>{event.preventDefault();if(writing||!f.reportValidity())return;const data=Object.fromEntries(Object.entries(inputs).map(([k,e])=>[k,e.type==='number'?Number(e.value):e.value.trim()]));const saveEpoch=epoch,saveUid=access()?.session?.uid;const current=()=>saveEpoch===epoch&&saveUid===access()?.session?.uid&&visible&&f.isConnected;writing=true;submit.disabled=cancel.disabled=true;try{const destination=await onSubmit(data);if(!current())return;active=destination;showTabs();formHost.replaceChildren();setNotice('요청을 저장했습니다. 실제 처리 상태는 접수·주문 증빙으로 확인합니다.');loaded=false;lastSignature='';}catch(error){if(current())setNotice(friendly(error),true);}finally{if(saveEpoch===epoch&&saveUid===access()?.session?.uid){writing=false;submit.disabled=cancel.disabled=false;}}if(saveEpoch===epoch&&saveUid===access()?.session?.uid&&!formHost.childElementCount)await load();});
  inputs[fields[0].key]?.focus();return f;
 }
 function requestId(){return 'erp-'+root.crypto.randomUUID();}
 function candidateForm(row){
  const item=row||{id:requestId(),productKey:'',name:'',judgment:{}},j=item.judgment||{};
  const fields=[{key:'name',label:'상품명',value:item.name},{key:'productKey',label:'플랫폼 상품 고유번호',value:item.productKey},{key:'productRef',label:'상품 원본 URL',type:'url',value:item.productRef||item.url},{key:'material',label:'확인된 소재',value:item.material,required:false},{key:'fit',label:'기존 패턴 검토',options:[['','확인 필요'],['bootcut','아네트 부츠컷 / 플레어'],['wide','와이드']],value:item.fit,required:false},{key:'sampleNeed',label:'원샘플 필요 이유',value:item.sampleNeed,required:false}];
  for(const [key,label]of Object.entries({demand:'살 이유',supply:'제작 조건',usp:'에이슬 적합성',counterEvidence:'실패할 이유',opportunityCost:'기회비용',nextCheck:'다음 검증'}))fields.push({key,label,multiline:true,required:false,value:(j[key]||[]).map?j[key]?.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n')||'':value(j[key])});
  if(role()==='owner')fields.push({key:'representativeDecision',label:'대표 결정',value:typeof item.representativeDecision==='string'?item.representativeDecision:'',required:false});
  form('후보·멍거 판단 기록',fields,async data=>{const judgment=Object.fromEntries(Object.keys(j).concat(['demand','supply','usp','counterEvidence','opportunityCost','nextCheck']).map(key=>[key,data[key]!==undefined?data[key].split('\n').filter(Boolean):j[key]]));const candidate={...item,...Object.fromEntries(['name','productKey','productRef','material','fit','sampleNeed'].map(k=>[k,data[k]])),judgment};if(role()==='owner')candidate.representativeDecision=data.representativeDecision;else delete candidate.representativeDecision;await access().request('operationsSaveCandidate',{candidate,expectedVersion:item.version||0});return 'candidates';});
 }
 function jobForm(job){
  form('담당 업무 진행 기록',[
   {key:'status',label:'진행 단계',options:[['in_progress','작업 중'],['md_review','MD 검수 대기'],['awaiting_publication','등록 대기'],['verification','고객 노출 확인 중'],['blocked','자료·연결 대기']],value:job.status},
   {key:'waitReason',label:'진행 내용 / 대기 이유',multiline:true,required:false,value:job.waitReason}
  ],async data=>{await access().request('operationsSaveJob',{job:{id:job.id,...data},expectedVersion:job.version});return 'jobs';});
 }
 function purchaseForm(candidate){
  const id=requestId();
  form('원샘플 구매 요청',[
   {key:'productRef',label:'정확한 상품 URL',type:'url',value:candidate.productRef||candidate.url},
   {key:'options',label:'색상·사이즈·기장 (정확한 옵션)'},{key:'quantity',label:'수량',type:'number',min:1},
   {key:'budget',label:'배송비 포함 결제 한도',type:'number',min:1},{key:'accountRef',label:'구매 계정 참조'},
   {key:'paymentRef',label:'승인 결제수단 참조'},{key:'shippingRef',label:'승인 배송지 참조'},{key:'neededBy',label:'필요 도착일',type:'date'},
   {key:'purpose',label:'원샘플에서 확인할 내용',multiline:true,value:candidate.sampleNeed||''}
  ],async data=>{const request={...data,candidateId:candidate.id,productName:candidate.name||candidate.productName||candidate.id,options:{exact:data.options},status:'draft'};await access().request('operationsRequestPurchase',{request,requestId:id,expectedVersion:0});return 'purchases';});
 }
 function returnForm(purchase){
  const id=requestId();
  form('반품 요청',[
   {key:'orderId',label:'주문번호',value:purchase.sellerOrderId||purchase.orderId},{key:'orderLineId',label:'반품할 주문 상품 줄 번호',value:purchase.orderLineId},
   {key:'quantity',label:'반품 수량',type:'number',min:1},{key:'reason',label:'실제 반품 사유',multiline:true},
   {key:'returnFee',label:'확인된 반품비',type:'number'},{key:'returnDeadline',label:'판매처 반품 마감일',type:'date',value:purchase.returnDeadline},
   {key:'collectionRef',label:'수거지 참조'},{key:'condition',label:'택·포장·상품 상태 확인'},
   {key:'policyEvidence',label:'판매처 반품 조건 근거 URL',type:'url'}
  ],async data=>{const request={...data,purchaseId:purchase.id,productName:purchase.productName,orderedQuantity:purchase.quantity,accountRef:purchase.accountRef,reasonTruthful:true,status:'draft'};await access().request('operationsRequestReturn',{request,requestId:id,expectedVersion:0});return 'returns';});
 }
 function hide(){visible=false;view.hidden=true;if(!writing&&formHost.childElementCount)return;epoch++;loading=false;writing=false;refresh.disabled=false;}
 function show(){if(!allowed())return false;visible=true;view.hidden=false;if(role()==='logistics'&&active==='candidates')active='jobs';showTabs();render();load();return true;}
 root.addEventListener('aisel-access-change',()=>{epoch++;hide();items=[];connector={pickle:'unconnected'};links={};loaded=false;lastSignature='';writing=false;formHost.replaceChildren();body.replaceChildren();});
 root.AiselOperations={show,hide,canLeave:({allowDraft=false}={})=>!writing&&(allowDraft||!formHost.childElementCount),get visible(){return visible;}};
})(window);
