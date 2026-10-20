/* Staff administration and immutable attribution. Mutations require owner clicks. */
(function(){
 'use strict';
 const access=window.AiselAccess;if(!access)return;
 const $=id=>document.getElementById(id);
 const el=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));return node;};
 const button=(text,action)=>{const node=el('button',text,{type:'button'});node.addEventListener('click',action);return node;};
 const id=()=>crypto.randomUUID();
 let staff=[],manager=null,detailCode='',metaEpoch=0;
 function modal(title){const dialog=el('dialog',null,{class:'aisel-access-dialog noprint'}),heading=el('div',null,{class:'access-heading'}),body=el('div',null,{class:'access-content'}),status=el('p','',{role:'status','aria-live':'polite'});heading.append(el('h2',title),button('닫기',()=>dialog.close()));dialog.append(heading,body,status);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return {dialog,body,status};}
 async function run(view,fn){if(view.busy)return;view.busy=true;view.status.textContent='확인 중…';const buttons=[...view.dialog.querySelectorAll('button')];buttons.forEach(node=>node.disabled=true);try{await fn();}catch(error){view.status.textContent=error.message||'처리하지 못했습니다. 다시 확인해주세요.';}finally{view.busy=false;buttons.filter(node=>node.isConnected).forEach(node=>node.disabled=false);}}
 function field(parent,label,type='text'){const wrap=el('label',null,{class:'access-field'}),input=el('input',null,{type});wrap.append(el('span',label),input);parent.append(wrap);return input;}
 function personOptions(select,except){select.append(new Option('받는 사람 선택',''));for(const person of staff.filter(person=>person.uid!==except&&person.active&&person.role==='designer'))select.append(new Option(person.displayName||person.email,person.uid));}
 function assignmentText(value){return value?.assigneeName||staff.find(person=>person.uid===value?.assigneeUid)?.displayName||'담당자 미지정';}
 function openCreate(){const view=modal('직원 계정 추가'),form=el('form');view.body.append(form);const name=field(form,'이름'),login=field(form,'아이디');login.autocomplete='off';login.pattern='[a-z][a-z0-9_]{3,31}';name.required=login.required=true;form.append(el('p','아이디를 등록한 뒤 대표님이 비밀번호를 설정합니다.',{class:'access-hint'}),el('button','계정 준비',{type:'submit'}));form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;run(view,async()=>{await access.request('provisionStaffLogin',{displayName:name.value.trim(),loginId:login.value.trim()});form.replaceChildren();view.status.textContent='아이디를 준비했습니다. 직원에게 전달할 비밀번호를 설정해주세요.';await loadStaff();});});}
 function issuePassword(person){
  const view=modal('직원 비밀번호 설정'),form=el('form');
  view.body.append(el('p',person.displayName+' · '+person.loginId),el('p','대표님이 정한 비밀번호로 직원이 로그인합니다. 직원은 비밀번호를 변경할 수 없습니다. 새로 설정하면 이전 비밀번호는 사용할 수 없습니다.'),form);
  const password=field(form,'새 비밀번호','password'),confirm=field(form,'새 비밀번호 확인','password');
  for(const input of [password,confirm]){input.required=true;input.minLength=12;input.maxLength=128;input.autocomplete='new-password';}
  const actions=el('div',null,{class:'access-actions'}),submit=el('button','설정',{type:'submit'});
  actions.append(submit,button('자동 생성',()=>issue()));form.append(el('p','12~128자로 입력해주세요.',{class:'access-hint'}),actions);
  const clear=()=>{password.value='';confirm.value='';};view.dialog.addEventListener('close',clear,{once:true});
  async function issue(chosen){
   await run(view,async()=>{
    try{
     const result=await access.request('issueStaffPassword',{uid:person.uid,...(chosen!==undefined?{password:chosen}:{})});
     clear();if(!view.dialog.open)return;
     view.body.replaceChildren(el('p',person.displayName+' · '+result.loginId));
     if(chosen===undefined){
      const generated=field(view.body,'발급한 비밀번호');generated.value=result.password;generated.readOnly=true;generated.autocomplete='off';
      view.body.append(button('복사',async()=>{try{await navigator.clipboard.writeText(generated.value);view.status.textContent='복사됨';}catch(_){view.status.textContent='비밀번호를 선택해 복사해주세요.';}}));
      view.dialog.addEventListener('close',()=>{generated.value='';},{once:true});
     }
     view.status.textContent='비밀번호를 설정했습니다. 해당 직원에게 아이디와 비밀번호를 전달해주세요.';
     await loadStaff();
    }finally{clear();}
   });
  }
  form.addEventListener('submit',event=>{event.preventDefault();if(view.busy||!form.reportValidity())return;if(password.value!==confirm.value){view.status.textContent='비밀번호가 일치하지 않습니다.';return;}issue(password.value);});
 }

 function openLink(){
  const view=modal('기존 직원 계정 연결'),form=el('form');view.body.append(form);
  const name=field(form,'이름'),email=field(form,'기존 로그인 이메일','email');name.required=email.required=true;
  const roleField=el('label',null,{class:'access-field'}),role=el('select',null,{'aria-label':'연결할 계정 권한'});role.required=true;role.append(new Option('권한 선택',''));
  for(const [value,label]of [['designer','디자이너'],['md','MD'],['logistics','물류']])role.append(new Option(label,value));
  roleField.append(el('span','권한'),role);form.append(roleField,el('p','이 앱에서 로그인했고 이메일 인증을 완료한 계정을 연결합니다. Google 계정은 먼저 앱에서 Google 로그인을 한 번 해주세요.',{class:'access-hint'}),el('button','계정 연결',{type:'submit'}));
  form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;run(view,async()=>{
   const data=await access.request('linkExistingStaff',{displayName:name.value.trim(),email:email.value.trim(),role:role.value,requestId:id()});
   view.status.textContent=data.staff?.active===false?'기존 계정의 사용 중지 상태가 유지됩니다. 직원 관리에서 상태를 확인해주세요.':'기존 계정을 연결했습니다. 담당 자료를 확인해 배정해주세요.';
   form.replaceChildren();await loadStaff();
  });});
 }
 function openToggle(person){const requestId=id(),view=modal(person.active?'계정 사용 중지':'계정 다시 사용');view.body.append(el('p',(person.displayName||person.email)+(person.active?'님의 앱 접근을 중지합니다. 작업 자료와 작성 이력은 회사에 남습니다.':'님의 앱 접근을 다시 허용합니다.')));view.body.append(button(person.active?'사용 중지':'다시 사용',()=>run(view,async()=>{await access.request('setStaffActive',{uid:person.uid,active:!person.active,expectedRevision:person.revision,requestId});view.status.textContent=person.active?'사용 중지했습니다.':'다시 사용할 수 있습니다.';await loadStaff();})));
 }
 function openSelection(person,assign=false,share=false){const view=modal(assign?'미배정 자료 연결':(person.displayName||person.email)+(share?' · 공동 인수인계':' · 담당자 이관')),select=el('select',null,{'aria-label':'받는 사람'});personOptions(select,person?.uid);view.body.append(select,el('p',share?'두 사람이 함께 조회·수정합니다. 기존 담당자의 접근과 최초 작성자를 유지합니다.':'최초 작성자와 작업 내용은 유지됩니다. 실제 담당할 자료를 선택해주세요.',{class:'access-hint'}));const list=el('div',null,{class:'access-selection'}),toolbar=el('div',null,{class:'access-actions'}),result=el('p','',{role:'status'});view.body.append(toolbar,list,result);let rows=[],loadedTo='',retryItems=null,requestId=null;
  const load=button('대상 확인',()=>run(view,async()=>{if(!select.value)throw Error('받는 사람을 선택해주세요.');const data=await access.request(assign?'unassignedWorkorders':'previewHandover',assign?{}:{fromUid:person.uid,toUid:select.value});rows=data.items||[];loadedTo=select.value;retryItems=null;requestId=null;list.replaceChildren();for(const row of rows){const label=el('label',null,{class:'access-check'}),check=el('input',null,{type:'checkbox','data-code':row.code});label.append(check,el('span',(row.title||row.code)+' · '+row.code));list.append(label);}view.status.textContent=rows.length+'건 · 인계할 자료를 선택해주세요.';update();}));toolbar.append(load,button('전체 선택',()=>{list.querySelectorAll('input').forEach(node=>node.checked=true);update();}),button('선택 해제',()=>{list.querySelectorAll('input').forEach(node=>node.checked=false);update();}));
  const submit=button('0건 '+(assign?'배정':share?'공동 접근':'인계'),()=>run(view,async()=>{if(!select.value||loadedTo!==select.value)throw Error('받는 사람이 바뀌었습니다. 대상을 다시 확인해주세요.');const items=retryItems||rows.filter(row=>list.querySelector('input[data-code="'+CSS.escape(row.code)+'"]')?.checked).map(row=>({code:row.code,revision:row.revision}));if(!items.length)throw Error('자료를 선택해주세요.');requestId=requestId||id();const data=await access.request(assign?'assignWorkorders':share?'shareHandover':'handover',{...(assign?{}:{fromUid:person.uid}),toUid:select.value,items,requestId});const done=data.completed||[],conflicts=data.conflicts||[];result.textContent='완료 '+done.length+'건 · 변경되어 제외 '+conflicts.length+'건';for(const code of done){const node=list.querySelector('input[data-code="'+CSS.escape(code)+'"]');if(node){node.checked=false;node.disabled=true;}}retryItems=null;requestId=null;view.status.textContent=conflicts.length?'제외된 자료는 현재 담당자를 다시 확인해주세요.':'선택한 자료를 처리했습니다.';update();window.dispatchEvent(new CustomEvent('aisel-access-workorders-changed'));await loadStaff();}));view.body.append(submit);function update(){const count=list.querySelectorAll('input:checked:not(:disabled)').length;submit.textContent=count+'건 '+(assign?'배정':share?'공동 접근':'인계');submit.disabled=!count||loadedTo!==select.value;}list.addEventListener('change',()=>{retryItems=null;requestId=null;update();});select.addEventListener('change',update);
 }
 function openAssigned(person){const view=modal((person.displayName||person.email)+' · 담당 자료');run(view,async()=>{const data=await access.request('staffWorkorders',{uid:person.uid});view.body.replaceChildren();for(const row of data.items||[]){const link=button((row.title||row.code)+' · '+row.code,()=>{view.dialog.close();manager?.dialog.close();window.AiselUnified?.show('editor',{code:row.code});});view.body.append(link);}view.status.textContent=(data.items||[]).length+'건';});}
 async function loadStaff(){if(!manager?.dialog.open)return;const data=await access.request('staffList');staff=data.staff||[];const body=manager.body;body.replaceChildren();const enabled=access.session?.enabled===true;body.append(el('p',enabled?'계정별 접근 제한이 적용되어 있습니다.':'계정별 접근 제한 준비 중입니다. 자료 배정과 공유 경로 확인 후 적용할 수 있습니다.',{class:'access-hint'}));const actions=el('div',null,{class:'access-actions'});actions.append(button('직원 추가',openCreate),button('기존 계정 연결',openLink),button('미배정 '+(data.unassignedCount||0)+'건',()=>openSelection(null,true)),button('판매성과 연결',openSalesMappings),button('적용 준비 확인',openPreflight));body.append(actions);for(const person of staff){const row=el('article',null,{class:'access-staff-row'}),heading=el('div');heading.append(el('strong',person.displayName||person.email),el('small',(person.credentialState==='unissued'?'비밀번호 미발급':person.active?'사용 중':'사용 중지')+' · '+(person.assignedCount||0)+'건'));row.append(heading,el('p',person.loginId||person.email||''));const controls=el('div',null,{class:'access-actions'});controls.append(button('담당 자료 보기',()=>openAssigned(person)),button('공동 인수인계',()=>openSelection(person,false,true)),button('담당자 이관',()=>openSelection(person)),button(person.active?'사용 중지':'다시 사용',()=>openToggle(person)));if(person.loginId){const password=button('비밀번호 설정',()=>issuePassword(person));password.disabled=!enabled||!person.active;password.title=enabled?'':'접근 제한을 적용한 뒤 발급할 수 있습니다.';controls.append(password);}row.append(controls);body.append(row);}manager.status.textContent=staff.length+'명';}
 function openPreflight(){const view=modal('계정별 접근 제한 준비');run(view,async()=>{const report=await access.request('preflight');view.body.append(el('p',report.enabled?'이미 적용되어 있습니다.':'실제 계정·자료 배정·공유 경로의 확인 결과입니다.'));const labels={unassigned_workorders:'미배정 작업지시서 '+(report.unassignedCount||0)+'건의 담당자를 연결해주세요.',unlinked_active_staff:'기존 직원 계정을 연결해주세요.',inactive_assignee:'사용 중지된 계정에 배정된 자료를 확인해주세요.',verify_rulesDeployed:'앱 접근 제한 연결 확인이 필요합니다.',verify_externalSalesSecured:'판매성과 공유 경로 확인이 필요합니다.',verify_photoAccessSecured:'사진 접근 제한 확인이 필요합니다.',verify_appsScriptRoutesSecured:'자동 수집과 공유 연결 확인이 필요합니다.'};const issues=report.blockers||report.issues||[];for(const issue of issues)view.body.append(el('p',typeof issue==='string'?(labels[issue]||'추가 연결 확인이 필요합니다.'):issue.message||'추가 연결 확인이 필요합니다.'));if(report.ready===true&&!report.enabled)view.body.append(button('접근 제한 적용',()=>run(view,async()=>{await access.request('activate',{expectedRevision:report.revision,requestId:id()});await access.refresh();view.status.textContent='계정별 접근 제한을 적용했습니다.';await loadStaff();})));else if(!report.enabled)view.body.append(el('p','준비가 완료되면 적용할 수 있습니다. 직원의 계정은 자동 중지되지 않습니다.'));view.status.textContent='확인 완료';});}
 function openManager(){if(!access.isOwner)return;manager=modal('직원 관리');run(manager,loadStaff);}
 function openSalesMappings(){
  const view=modal('판매성과 연결');let inventory=null,requestId=null;
  view.body.append(el('p','신상성과 상품을 작업지시서 품번에 연결합니다. 담당자 접근은 작업지시서 배정을 따릅니다.',{class:'access-hint'}));
  const source=el('select',null,{'aria-label':'신상성과 상품'}),target=el('select',null,{'aria-label':'연결할 작업지시서'}),label=el('label',null,{class:'access-check'}),core=el('input',null,{type:'checkbox'});
  label.append(core,el('span','핵심 SKU에도 표시 · 대표자만'));view.body.append(el('p','신상성과 상품'),source,el('p','작업지시서'),target,label);
  const item=()=>inventory?.items?.find(row=>row.itemKey===source.value);
  function profile(){const row=item();return inventory?.products?.[target.value]|| (row?.code===target.value?{coreSku:row.coreSku,updatedAt:row.productUpdatedAt}:{coreSku:false,updatedAt:0});}
  function selectSource(){const row=item();target.value=row?.code||'';core.checked=profile().coreSku===true;requestId=null;}
  async function load(){const previous=source.value;inventory=await access.request('listSalesMappings');source.replaceChildren(new Option('상품 선택',''));target.replaceChildren(new Option('품번 선택',''));for(const row of inventory.items||[])source.append(new Option(row.name+(row.code?' · 연결됨':''),row.itemKey));for(const [code,row]of Object.entries(inventory.workorders||{}))target.append(new Option((row.pumMyeong||'품명 미정')+' · '+code,code));if(previous)source.value=previous;selectSource();view.status.textContent=(inventory.items||[]).length+'개 상품';}
  source.addEventListener('change',selectSource);target.addEventListener('change',()=>{core.checked=profile().coreSku===true;requestId=null;});core.addEventListener('change',()=>{requestId=null;});
  view.body.append(button('연결 저장',()=>run(view,async()=>{const row=item();if(!row||!target.value)throw Error('상품과 작업지시서 품번을 선택해주세요.');requestId=requestId||id();await access.request('mapSalesProduct',{itemKey:row.itemKey,code:target.value,expectedRevision:row.revision||0,coreSku:core.checked,expectedProductUpdatedAt:profile().updatedAt||0,requestId});await load();view.status.textContent='상품 연결을 저장했습니다.';window.AiselSheetSalesSource?.invalidate?.();})));
  run(view,load);
 }
 function mountAccount(){const actions=$('aiselAccountDialog')?.querySelector('.account-actions');if(!actions)return;let manage=$('aiselStaffManage');if(!manage){manage=button('직원 관리',()=>{$('aiselAccountDialog').close();openManager();});manage.id='aiselStaffManage';actions.prepend(manage);}manage.hidden=!access.isOwner;}
 function metadata(code){detailCode=code||'';const epoch=++metaEpoch;let area=$('aiselWorkorderAttribution');if(!area){area=el('section',null,{id:'aiselWorkorderAttribution',class:'noprint'});$('editorView')?.append(area);}area.replaceChildren();area.hidden=access.legacy===true;if(!code||!access.session||access.legacy)return;
  access.request('assignmentMeta',{code}).then(data=>{if(epoch!==metaEpoch||detailCode!==code)return;const assignment=data.assignment||{};const line=el('div',null,{class:'access-attribution-line'}),name=assignmentText(assignment).replace(/^담당자 /,'');line.append(el('span','담당자 '+name,{class:'access-assignee-name'}));const details=el('div',null,{class:'access-attribution-history',id:'aiselAssignmentHistory'});details.hidden=true;const toggle=button('변경이력',()=>{details.hidden=!details.hidden;toggle.setAttribute('aria-expanded',String(!details.hidden));});toggle.className='access-history-toggle';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',details.id);line.append(el('span','최초 작성자 '+(assignment.creatorName||'미확인'),{class:'access-original-creator'}),toggle);area.append(line);for(const entry of data.history||[]){const date=entry.at?new Date(entry.at).toLocaleString('ko-KR'):'';details.append(el('p',[date,entry.type||'인수인계',entry.actorName||'',entry.fromName||entry.oldCode||'',entry.toName||entry.newCode||''].filter(Boolean).join(' · ')));}if(!(data.history||[]).length)details.append(el('p','등록된 변경 이력이 없습니다.'));area.append(details);if(access.isOwner)details.append(button('담당자 변경',()=>{openManager();}));}).catch(error=>{if(epoch===metaEpoch)area.textContent=error.code==='not_found'?'최초 작성자 미확인':error.message;});
 }
 access.subscribe(()=>{mountAccount();if(detailCode)metadata(detailCode);if(!access.isOwner){staff=[];manager?.dialog.close();document.querySelectorAll('.aisel-access-dialog').forEach(dialog=>dialog.close());}});
 window.addEventListener('aisel-session-ready',mountAccount);
 window.addEventListener('aisel-workorder-loaded',event=>{if(detailCode!==event.detail?.code)metadata(event.detail?.code);});
 window.addEventListener('aisel-workorder-detached',()=>metadata(''));
 window.addEventListener('aisel-access-workorders-changed',()=>{if(detailCode)metadata(detailCode);});
 mountAccount();
})();
