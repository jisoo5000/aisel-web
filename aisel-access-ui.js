/* Staff administration and immutable attribution. Mutations require owner clicks. */
(function(){
 'use strict';
 const access=window.AiselAccess;if(!access)return;
 const $=id=>document.getElementById(id);
 const el=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));return node;};
 const button=(text,action)=>{const node=el('button',text,{type:'button'});node.addEventListener('click',action);return node;};
 const id=()=>crypto.randomUUID();
 let staff=[],manager=null,detailCode='',metaEpoch=0,staffEpoch=0;
 const roleLabels={owner:'대표',designer:'디자이너',md:'MD',logistics:'물류'};
 const startLabels={owner:'작업지시서',designer:'작업지시서',md:'판매성과',logistics:'출고현황'};
 function modal(title){const dialog=el('dialog',null,{class:'aisel-access-dialog noprint'}),heading=el('div',null,{class:'access-heading'}),body=el('div',null,{class:'access-content'}),status=el('p','',{role:'status','aria-live':'polite'});heading.append(el('h2',title),button('닫기',()=>dialog.close()));dialog.append(heading,body,status);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return {dialog,body,status};}
 const permitted=()=>access.isOwner&&window.AiselManagement?.unlocked===true;
 async function refreshStaff(){window.dispatchEvent(new CustomEvent('aisel-staff-changed'));await loadStaff();}
 async function run(view,fn){if(!permitted()){view.status.textContent='관리 영역에 다시 로그인해주세요.';return;}if(view.busy)return;view.busy=true;view.status.textContent='확인 중…';const buttons=[...view.dialog.querySelectorAll('button')];buttons.forEach(node=>node.disabled=true);try{await fn();}catch(error){view.status.textContent=error.message||'처리하지 못했습니다. 다시 확인해주세요.';}finally{view.busy=false;buttons.filter(node=>node.isConnected).forEach(node=>node.disabled=false);}}
 function field(parent,label,type='text'){const wrap=el('label',null,{class:'access-field'}),input=el('input',null,{type});wrap.append(el('span',label),input);parent.append(wrap);return input;}
 function personOptions(select,except){select.append(new Option('받는 사람 선택',''));for(const person of staff.filter(person=>person.uid!==except&&person.active&&person.role==='designer'))select.append(new Option(person.displayName||person.email,person.uid));}
 function assignmentText(value){return value?.assigneeName||staff.find(person=>person.uid===value?.assigneeUid)?.displayName||'담당자 미지정';}
 function openCreate(prefill={}){
  if(!permitted())return false;
  const view=modal('직원 추가'),form=el('form');view.body.append(form);
  const name=field(form,'이름'),login=field(form,'아이디'),roleWrap=el('label',null,{class:'access-field'}),role=el('select',null,{'aria-label':'업무 권한'});
  name.value=prefill.displayName||'';name.required=true;name.maxLength=80;login.autocomplete='off';login.pattern='[a-z][a-z0-9_]{3,31}';
  for(const [value,label]of [['designer','디자이너'],['md','MD'],['logistics','물류']])role.append(new Option(label,value));
  roleWrap.append(el('span','업무 권한'),role);form.append(roleWrap);
  const email=field(form,'로그인 이메일','email'),password=field(form,'초기 비밀번호','password');password.minLength=12;password.maxLength=128;password.autocomplete='new-password';
  const hint=el('p','',{class:'access-hint'}),submit=el('button','직원 추가',{type:'submit'});form.append(hint,submit);
  const update=()=>{const designer=role.value==='designer';login.closest('label').hidden=!designer;login.required=designer;email.closest('label').hidden=designer;password.closest('label').hidden=designer;email.required=password.required=!designer;hint.textContent=designer?'아이디 등록 후 비밀번호를 설정합니다.':'이메일과 초기 비밀번호로 로그인합니다. 회사 재무·관리 권한은 부여되지 않습니다.';};role.addEventListener('change',update);update();
  let requestId='';form.addEventListener('input',()=>requestId='');
  view.dialog.addEventListener('close',()=>password.value='',{once:true});
  form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;run(view,async()=>{
   const designer=role.value==='designer';requestId=requestId||id();
   const result=await access.request(designer?'provisionStaffLogin':'createStaff',designer?{displayName:name.value.trim(),loginId:login.value.trim()}:{displayName:name.value.trim(),email:email.value.trim(),role:role.value,password:password.value,requestId});
   password.value='';if(!view.dialog.open||!permitted())return;
   form.replaceChildren();view.status.textContent=designer?'아이디를 등록했습니다. 비밀번호를 설정해주세요.':'직원을 등록했습니다.';
   if(designer)form.append(button('비밀번호 설정',()=>issuePassword({uid:result.uid,displayName:name.value.trim(),loginId:result.loginId,active:true})));
   await refreshStaff();
  });});return true;
 }
 function issuePassword(person){
  const view=modal('비밀번호 설정'),form=el('form');
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
     await refreshStaff();
    }finally{clear();}
   });
  }
  form.addEventListener('submit',event=>{event.preventDefault();if(view.busy||!form.reportValidity())return;if(password.value!==confirm.value){view.status.textContent='비밀번호가 일치하지 않습니다.';return;}issue(password.value);});
 }

 function openLink(){
  const view=modal('기존 계정 연결'),form=el('form');view.body.append(form);
  const name=field(form,'이름'),email=field(form,'기존 로그인 이메일','email');name.required=email.required=true;
  const roleField=el('label',null,{class:'access-field'}),role=el('select',null,{'aria-label':'연결할 계정 권한'});role.required=true;role.append(new Option('권한 선택',''));
  for(const [value,label]of [['designer','디자이너'],['md','MD'],['logistics','물류']])role.append(new Option(label,value));
  roleField.append(el('span','권한'),role);form.append(roleField,el('p','이 앱에서 로그인했고 이메일 인증을 완료한 계정을 연결합니다. Google 계정은 먼저 앱에서 Google 로그인을 한 번 해주세요.',{class:'access-hint'}),el('button','계정 연결',{type:'submit'}));
  form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;run(view,async()=>{
   const data=await access.request('linkExistingStaff',{displayName:name.value.trim(),email:email.value.trim(),role:role.value,requestId:id()});
   view.status.textContent=data.staff?.active===false?'기존 계정의 사용 중지 상태가 유지됩니다. 계정 관리에서 상태를 확인해주세요.':'기존 계정을 연결했습니다. 담당 자료를 확인해 배정해주세요.';
   form.replaceChildren();await refreshStaff();
  });});
 }
 function openToggle(person){const requestId=id(),view=modal(person.active?'계정 사용 중지':'계정 다시 사용');view.body.append(el('p',(person.displayName||person.email)+(person.active?'님의 앱 접근을 중지합니다. 작업 자료와 작성 이력은 회사에 남습니다.':'님의 앱 접근을 다시 허용합니다.')));view.body.append(button(person.active?'사용 중지':'다시 사용',()=>run(view,async()=>{await access.request('setStaffActive',{uid:person.uid,active:!person.active,expectedRevision:person.revision,requestId});view.status.textContent=person.active?'사용 중지했습니다.':'다시 사용할 수 있습니다.';await refreshStaff();})));
 }
 function openSelection(person,assign=false,share=false){const view=modal(assign?'미배정 자료 연결':(person.displayName||person.email)+(share?' · 공동 인수인계':' · 담당자 이관')),select=el('select',null,{'aria-label':'받는 사람'});personOptions(select,person?.uid);view.body.append(select,el('p',share?'두 사람이 함께 조회·수정합니다. 기존 담당자의 접근과 최초 작성자를 유지합니다.':'최초 작성자와 작업 내용은 유지됩니다. 실제 담당할 자료를 선택해주세요.',{class:'access-hint'}));const list=el('div',null,{class:'access-selection'}),toolbar=el('div',null,{class:'access-actions'}),result=el('p','',{role:'status'});view.body.append(toolbar,list,result);let rows=[],loadedTo='',retryItems=null,requestId=null;
  const load=button('대상 확인',()=>run(view,async()=>{if(!select.value)throw Error('받는 사람을 선택해주세요.');const data=await access.request(assign?'unassignedWorkorders':'previewHandover',assign?{}:{fromUid:person.uid,toUid:select.value});rows=data.items||[];loadedTo=select.value;retryItems=null;requestId=null;list.replaceChildren();for(const row of rows){const label=el('label',null,{class:'access-check'}),check=el('input',null,{type:'checkbox','data-code':row.code});label.append(check,el('span',(row.title||row.code)+' · '+row.code));list.append(label);}view.status.textContent=rows.length+'건 · 인계할 자료를 선택해주세요.';update();}));toolbar.append(load,button('전체 선택',()=>{list.querySelectorAll('input').forEach(node=>node.checked=true);update();}),button('선택 해제',()=>{list.querySelectorAll('input').forEach(node=>node.checked=false);update();}));
  const submit=button('0건 '+(assign?'배정':share?'공동 접근':'인계'),()=>run(view,async()=>{if(!select.value||loadedTo!==select.value)throw Error('받는 사람이 바뀌었습니다. 대상을 다시 확인해주세요.');const items=retryItems||rows.filter(row=>list.querySelector('input[data-code="'+CSS.escape(row.code)+'"]')?.checked).map(row=>({code:row.code,revision:row.revision}));if(!items.length)throw Error('자료를 선택해주세요.');requestId=requestId||id();const data=await access.request(assign?'assignWorkorders':share?'shareHandover':'handover',{...(assign?{}:{fromUid:person.uid}),toUid:select.value,items,requestId});const done=data.completed||[],conflicts=data.conflicts||[];result.textContent='완료 '+done.length+'건 · 변경되어 제외 '+conflicts.length+'건';for(const code of done){const node=list.querySelector('input[data-code="'+CSS.escape(code)+'"]');if(node){node.checked=false;node.disabled=true;}}retryItems=null;requestId=null;view.status.textContent=conflicts.length?'제외된 자료는 현재 담당자를 다시 확인해주세요.':'선택한 자료를 처리했습니다.';update();window.dispatchEvent(new CustomEvent('aisel-access-workorders-changed'));await refreshStaff();}));view.body.append(submit);function update(){const count=list.querySelectorAll('input:checked:not(:disabled)').length;submit.textContent=count+'건 '+(assign?'배정':share?'공동 접근':'인계');submit.disabled=!count||loadedTo!==select.value;}list.addEventListener('change',()=>{retryItems=null;requestId=null;update();});select.addEventListener('change',update);
 }
 async function staffTaskRequest(action,payload={}){
  const account=window.AiselAuth?.currentUser?.(),generation=window.AiselAuth?.generation,proof=window.AiselManagement?.proof?.();
  if(!permitted()||!proof||!account?.uid||account.uid!==access.session?.uid)throw Error('관리 영역에 다시 로그인해주세요.');
  const current=()=>permitted()&&account.uid===access.session?.uid&&generation===window.AiselAuth?.generation&&proof.id===window.AiselManagement?.proof?.()?.id;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
  try{const token=await account.getIdToken();if(!current())throw Error('로그인 상태가 변경되었습니다.');
   const response=await fetch('https://asia-southeast1-aisel-workorder.cloudfunctions.net/companyErpV1',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},credentials:'omit',cache:'no-store',signal:controller.signal,body:JSON.stringify({...payload,action,managementSession:proof})});
   const result=await response.json();if(!current())throw Error('관리 영역에 다시 로그인해주세요.');
   if(!response.ok||result.ok!==true){const code=result.error||result.code;throw Error(code==='version_conflict'?'다른 곳에서 수정했습니다. 최신 기록을 다시 확인해주세요.':code==='invalid_assignee'?'받는 사람의 계정 상태를 확인해주세요.':code==='management_login_required'?'관리 영역에 다시 로그인해주세요.':'인수인계를 저장하거나 불러오지 못했습니다. 입력 내용은 유지됩니다.');}return result;
  }catch(error){if(error.name==='AbortError')throw Error('연결 시간이 길어지고 있습니다. 입력 내용은 유지됩니다.');throw error;}finally{clearTimeout(timeout);}
 }
 function openTaskHandover(person){
  if(!permitted())return false;
  const view=modal((person.displayName||person.email)+' · 인수인계'),list=el('div',null,{class:'access-handover-list'}),sourceUrl='https://jisoo5000.github.io/aisel-web/work-order-5aa994e7.html?view=staff&handoverFrom='+encodeURIComponent(person.uid);
  const actions=el('div',null,{class:'access-actions'});actions.append(button('+ 인수인계 등록',()=>edit()));
  if(person.role==='designer')actions.append(button('작업지시서 공동 인계',()=>openSelection(person,false,true)),button('작업지시서 담당자 이관',()=>openSelection(person)));
  view.body.append(actions,list);let rows=[];
  const valid=()=>view.dialog.open&&permitted();
  async function load(){let cursor,items=[],seen=new Set();do{const result=await staffTaskRequest('companyList',{limit:200,...(cursor?{cursor}:{})});if(!valid())return;items.push(...result.items);cursor=result.nextCursor;if(cursor&&seen.has(cursor))throw Error('목록을 다시 확인해주세요.');seen.add(cursor);}while(cursor);rows=items.filter(p=>p.id.startsWith('handover-')&&p.sourceUrl===sourceUrl&&!p.archived).sort((a,b)=>b.updatedAt-a.updatedAt);draw();}
  function draw(){if(!valid())return;list.replaceChildren();if(!rows.length)list.append(el('p','등록된 인수인계가 없습니다.',{class:'access-hint'}));
   for(const task of rows){const card=el('article',null,{class:'access-handover-card'}),next=(task.steps||[]).find(s=>s.status!=='done');if(!next)card.classList.add('is-complete');card.append(el('strong',task.title),el('p','받는 사람 '+(task.assigneeName||'미지정')+' · 기한 '+(task.dueDate||'미지정')),el('p',task.notes||''),el('p',next?next.status==='doing'?'진행 중':next.title:'인수인계 완료',{class:'access-hint'}));
    card.append(button('내용 수정',()=>edit(task)));
    if(next){const evidence=field(card,'확인 내용');evidence.maxLength=4000;evidence.placeholder='전달한 자료와 남은 업무, 확인 결과';card.append(button(next.id==='prepare'?'자료 확인 완료':next.id==='execute'?'인계 완료':'최종 확인 완료',()=>run(view,async()=>{if(!evidence.value.trim())throw Error('확인 내용을 입력해주세요.');const result=await staffTaskRequest('companyStep',{id:task.id,expectedVersion:task.version,requestId:id(),stepId:next.id,status:'done',evidence:evidence.value.trim()}),checked=await staffTaskRequest('companyGet',{id:task.id});if(!valid())return;if(checked.item?.version<result.item.version)throw Error('저장된 내용을 다시 확인해주세요.');await load();view.status.textContent='인수인계 상태를 저장하고 확인했습니다.';})));}list.append(card);
   }
  }
  function edit(task){if(!valid())return;const editor=modal(task?'인수인계 수정':'인수인계 등록'),form=el('form');editor.body.append(form);const title=field(form,'전달할 업무'),recipientWrap=el('label',null,{class:'access-field'}),recipient=el('select',null,{'aria-label':'받는 사람'});recipient.required=true;recipient.append(new Option('받는 사람 선택',''));for(const p of staff.filter(p=>p.active&&p.uid!==person.uid))recipient.append(new Option(p.displayName||p.loginId||p.email,p.uid));recipientWrap.append(el('span','받는 사람'),recipient);form.append(recipientWrap);const due=field(form,'완료 기한','date'),notesWrap=el('label',null,{class:'access-field'}),notes=el('textarea');notes.required=true;notes.maxLength=6000;notes.rows=5;notes.placeholder='진행 상황, 다음 할 일, 관련 자료 위치와 주의사항';notesWrap.append(el('span','인수인계 내용'),notes);form.append(notesWrap);title.required=true;title.maxLength=160;due.required=true;title.value=task?.title||'';recipient.value=task?.assigneeUid||'';due.value=task?.dueDate||'';notes.value=task?.notes||'';form.append(el('button','저장',{type:'submit'}));let requestId='',fingerprint='',recordId=task?.id||'handover-'+id();
   form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;run(editor,async()=>{const project={kind:'operation',title:title.value.trim(),assigneeUid:recipient.value,dueDate:due.value,notes:notes.value.trim(),goal:'인계자: '+(person.displayName||person.loginId||person.email),sourceUrl};const next=JSON.stringify(project);if(next!==fingerprint){fingerprint=next;requestId=id();}const result=await staffTaskRequest(task?'companyUpdate':'companyCreate',{id:recordId,requestId,expectedVersion:task?.version||0,project}),checked=await staffTaskRequest('companyGet',{id:recordId});if(!editor.dialog.open||!permitted())return;if(!checked.item||checked.item.version<result.item.version)throw Error('저장된 내용을 다시 확인해주세요.');editor.dialog.close();await load();view.status.textContent='인수인계를 저장하고 확인했습니다.';});});
  }
  run(view,load);return true;
 }

 function openAssigned(person){const view=modal((person.displayName||person.email)+' · 담당 자료');run(view,async()=>{const data=await access.request('staffWorkorders',{uid:person.uid});view.body.replaceChildren();for(const row of data.items||[]){const link=button((row.title||row.code)+' · '+row.code,()=>{view.dialog.close();window.AiselUnified?.show('editor',{code:row.code});});view.body.append(link);}view.status.textContent=(data.items||[]).length+'건';});}
 function managerVisible(){return manager&&manager.dialog.isConnected&&!manager.dialog.hidden;}
 function hideManager(){staffEpoch++;if(managerVisible())document.querySelectorAll('.aisel-access-dialog').forEach(dialog=>dialog.close());if(manager){manager.dialog.hidden=true;manager.body.replaceChildren();manager.status.textContent='';}staff=[];}
 function staffActions(person){if(!permitted()||person.role==='owner')return false;
  const view=modal((person.displayName||person.email)+' · 계정 관리');
  view.body.append(el('p',[person.loginId||person.email,roleLabels[person.role]||person.role].filter(Boolean).join(' · ')));
  const stateWrap=el('label',null,{class:'access-field'}),state=el('select',null,{'aria-label':'접근 권한'});
  state.append(new Option('사용 중 · 접근 허용','active'),new Option('사용 중지 · 접근 차단','inactive'));state.value=person.active?'active':'inactive';stateWrap.append(el('span','접근 권한'),state);view.body.append(stateWrap);
  view.body.append(button('권한 저장',()=>run(view,async()=>{const active=state.value==='active';if(active===person.active){view.status.textContent='변경된 권한이 없습니다.';return;}const result=await access.request('setStaffActive',{uid:person.uid,active,expectedRevision:person.revision,requestId:id()});person={...person,...result.staff};view.status.textContent=person.active?'접근을 허용했습니다.':'접근을 차단했습니다. 업무 자료와 이력은 보존됩니다.';await refreshStaff();})));
  const controls=el('div',null,{class:'access-actions'});
  controls.append(button('업무 인수인계',()=>openTaskHandover(person)));
  if(person.role==='designer')controls.append(button('담당 자료 보기',()=>openAssigned(person)),button('공동 인수인계',()=>openSelection(person,false,true)),button('담당자 이관',()=>openSelection(person)));

  if(person.loginId){const password=button('비밀번호 설정',()=>issuePassword(person));password.disabled=access.session?.enabled!==true||!person.active;password.title=access.session?.enabled?'':'접근 제한을 적용한 뒤 발급할 수 있습니다.';controls.append(password);}
  view.body.append(controls);
 }
 function renderStaff(){
  if(!managerVisible()||!access.isOwner)return;
  const query=manager.query.trim().toLocaleLowerCase(),rows=staff.filter(person=>[person.displayName,person.loginId,person.email,roleLabels[person.role]].join(' ').toLocaleLowerCase().includes(query));
  const tbody=manager.body.querySelector('tbody');if(!tbody)return;tbody.replaceChildren();
  for(const person of rows){
   const row=el('tr',null,{'data-staff-uid':person.uid}),name=String(person.displayName||'').trim();
   const automatic=['designer','md','logistics'].includes(person.role)&&person.active&&!person.passwordChangeRequired&&name&&!name.includes('@')?name:'—';
   const values=[name||'이름 미등록',person.loginId||person.email||'미연결',roleLabels[person.role]||person.role||'확인 필요',startLabels[person.role]||'—',automatic,person.credentialState==='unissued'?'비밀번호 미발급':person.active?'사용 중':'사용 중지'];
   values.forEach((value,index)=>{const cell=el(index===0?'th':'td',value,{'data-label':['이름','로그인 아이디','역할·권한','시작 화면','자동 담당자','상태'][index]});if(index===0)cell.scope='row';row.append(cell);});
   const cell=el('td',null,{'data-label':'관리'});if(person.role!=='owner')cell.append(button('관리',()=>staffActions(person)));else cell.textContent='대표 계정';row.append(cell);tbody.append(row);
  }
  if(!rows.length){const row=el('tr'),cell=el('td','검색 결과가 없습니다.',{colspan:7});row.append(cell);tbody.append(row);}
  manager.status.textContent=(query?'검색 '+rows.length+'명 / ':'')+'등록 계정 '+staff.length+'명';
 }
 async function loadStaff(){
  if(!managerVisible()||!access.isOwner)return;
  const view=manager,epoch=++staffEpoch,uid=access.session?.uid;
  view.status.textContent='직원 목록을 불러오는 중…';
  let data;
  try{data=await access.request('staffList');}catch(error){
   if(epoch===staffEpoch&&managerVisible()&&access.isOwner&&uid===access.session?.uid){view.status.textContent=error.message||'직원 목록을 불러오지 못했습니다.';view.body.replaceChildren(button('다시 불러오기',loadStaff));}
   return;
  }
  if(epoch!==staffEpoch||manager!==view||!managerVisible()||!access.isOwner||uid!==access.session?.uid)return;
  // Live registered accounts only. Never infer an ID or grant from an employee name.
  const accounts=new Map((data.staff||[]).map(person=>[person.uid,person]));
  if(uid)accounts.set(uid,{...access.session});
  staff=[...accounts.values()].sort((a,b)=>(a.role==='owner'?-1:b.role==='owner'?1:0)||String(a.displayName||'').localeCompare(String(b.displayName||''),'ko'));
  const body=view.body;body.replaceChildren();
  const actions=el('div',null,{class:'access-actions'});
  actions.append(button('+ 직원 추가',()=>openCreate()),button('기존 직원 계정 연결',openLink),button('미배정 '+(data.unassignedCount||0)+'건',()=>openSelection(null,true)),button('새로고침',loadStaff));
  body.append(actions);
  const search=el('input',null,{type:'search',placeholder:'검색','aria-label':'직원 검색',class:'staff-search'});search.value=view.query;search.addEventListener('input',()=>{view.query=search.value;renderStaff();});body.append(search);
  const wrap=el('div',null,{class:'staff-table-wrap',tabindex:0,'aria-label':'직원 아이디와 권한 표'}),table=el('table',null,{class:'staff-table'}),caption=el('caption','등록된 직원 계정과 담당자 연결'),head=el('thead'),tr=el('tr');
  for(const title of ['이름','로그인 아이디','역할·권한','시작 화면','자동 담당자','상태','관리'])tr.append(el('th',title,{scope:'col'}));
  head.append(tr);table.append(caption,head,el('tbody'));wrap.append(table);body.append(wrap);
  body.append(el('p','자동 담당자는 새 작업지시서에 입력됩니다. 기존 자료의 담당자는 유지됩니다.',{class:'access-hint'}));
  const more=el('details'),summary=el('summary','접근 설정');more.append(summary);
  more.append(el('p',access.session?.enabled===true?'계정별 접근 제한 적용 중':'계정별 접근 제한 준비 중 · 자료 배정과 공유 경로를 확인해주세요.',{class:'access-hint'}),el('p','출고현황은 공통 메뉴입니다. 자료 조회·수정은 계정에 등록된 권한과 배정을 따릅니다.',{class:'access-hint'}));
  const settings=el('div',null,{class:'access-actions'});settings.append(button('판매성과 연결',openSalesMappings),button('적용 준비 확인',openPreflight));more.append(settings);body.append(more);renderStaff();
 }
 function showManager(){
  if(!access.isOwner||!window.AiselManagement?.unlocked)return false;
  if(!manager){
   const panel=el('section',null,{id:'aiselStaffDirectoryView',class:'aisel-staff-directory noprint','aria-label':'직원·권한 관리'}),heading=el('h2','직원·권한 관리'),body=el('div',null,{class:'access-content'}),status=el('p','',{role:'status','aria-live':'polite'});
   panel.append(heading,body,status);document.body.append(panel);manager={dialog:panel,body,status,query:''};
  }
  manager.dialog.hidden=false;loadStaff();return true;
 }
 function openPreflight(){const view=modal('계정별 접근 제한 준비');run(view,async()=>{const report=await access.request('preflight');view.body.append(el('p',report.enabled?'이미 적용되어 있습니다.':'실제 계정·자료 배정·공유 경로의 확인 결과입니다.'));const labels={unassigned_workorders:'미배정 작업지시서 '+(report.unassignedCount||0)+'건의 담당자를 연결해주세요.',unlinked_active_staff:'기존 직원 계정을 연결해주세요.',inactive_assignee:'사용 중지된 계정에 배정된 자료를 확인해주세요.',verify_rulesDeployed:'앱 접근 제한 연결 확인이 필요합니다.',verify_externalSalesSecured:'판매성과 공유 경로 확인이 필요합니다.',verify_photoAccessSecured:'사진 접근 제한 확인이 필요합니다.',verify_appsScriptRoutesSecured:'자동 수집과 공유 연결 확인이 필요합니다.'};const issues=report.blockers||report.issues||[];for(const issue of issues)view.body.append(el('p',typeof issue==='string'?(labels[issue]||'추가 연결 확인이 필요합니다.'):issue.message||'추가 연결 확인이 필요합니다.'));if(report.ready===true&&!report.enabled)view.body.append(button('접근 제한 적용',()=>run(view,async()=>{await access.request('activate',{expectedRevision:report.revision,requestId:id()});await access.refresh();view.status.textContent='계정별 접근 제한을 적용했습니다.';await refreshStaff();})));else if(!report.enabled)view.body.append(el('p','준비가 완료되면 적용할 수 있습니다. 직원의 계정은 자동 중지되지 않습니다.'));view.status.textContent='확인 완료';});}
 function openManager(){if(access.isOwner)window.AiselUnified?.show('staff');}
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
 function mountAccount(){const actions=$('aiselAccountDialog')?.querySelector('.account-actions');if(!actions)return;let manage=$('aiselStaffManage');if(!manage){manage=button('직원·권한 관리',()=>{$('aiselAccountDialog').close();openManager();});manage.id='aiselStaffManage';actions.prepend(manage);}manage.hidden=!access.isOwner;}
 function metadata(code){detailCode=code||'';const epoch=++metaEpoch;let area=$('aiselWorkorderAttribution');if(!area){area=el('section',null,{id:'aiselWorkorderAttribution',class:'noprint'});$('editorView')?.append(area);}area.replaceChildren();area.hidden=access.legacy===true;if(!code||!access.session||access.legacy)return;
  access.request('assignmentMeta',{code}).then(data=>{if(epoch!==metaEpoch||detailCode!==code)return;const assignment=data.assignment||{};const line=el('div',null,{class:'access-attribution-line'}),name=assignmentText(assignment).replace(/^담당자 /,'');line.append(el('span','담당자 '+name,{class:'access-assignee-name'}));const details=el('div',null,{class:'access-attribution-history',id:'aiselAssignmentHistory'});details.hidden=true;const toggle=button('변경이력',()=>{details.hidden=!details.hidden;toggle.setAttribute('aria-expanded',String(!details.hidden));});toggle.className='access-history-toggle';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',details.id);line.append(el('span','최초 작성자 '+(assignment.creatorName||'미확인'),{class:'access-original-creator'}),toggle);area.append(line);for(const entry of data.history||[]){const date=entry.at?new Date(entry.at).toLocaleString('ko-KR'):'';details.append(el('p',[date,entry.type||'인수인계',entry.actorName||'',entry.fromName||entry.oldCode||'',entry.toName||entry.newCode||''].filter(Boolean).join(' · ')));}if(!(data.history||[]).length)details.append(el('p','등록된 변경 이력이 없습니다.'));area.append(details);if(access.isOwner)details.append(button('담당자 변경',()=>{openManager();}));}).catch(error=>{if(epoch===metaEpoch)area.textContent=error.code==='not_found'?'최초 작성자 미확인':error.message;});
 }
 access.subscribe(()=>{mountAccount();if(detailCode)metadata(detailCode);if(!access.isOwner){hideManager();document.querySelectorAll('.aisel-access-dialog').forEach(dialog=>dialog.close());}});
 window.addEventListener('aisel-session-ready',mountAccount);
 window.addEventListener('aisel-workorder-loaded',event=>{if(detailCode!==event.detail?.code)metadata(event.detail?.code);});
 window.addEventListener('aisel-workorder-detached',()=>metadata(''));
 window.addEventListener('aisel-access-workorders-changed',()=>{if(detailCode)metadata(detailCode);});
 window.addEventListener('aisel-management-locked',()=>{hideManager();document.querySelectorAll('.aisel-access-dialog').forEach(dialog=>dialog.close());});
 window.AiselStaffDirectory={show:showManager,hide:hideManager,create:openCreate,manage(person,people){if(!permitted())return false;staff=people.filter(p=>p.role!=='owner');staffActions(person);return true;},handover(person,people){if(!permitted())return false;staff=people;openTaskHandover(person);return true;}};
 mountAccount();
})();

/* Owner-only, read-only policy audit. No financial values or credentials. */
(function(root){
 'use strict';
 const access=root.AiselAccess;if(!access)return;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const pane=el('section',undefined,'permission-audit noprint');pane.id='aiselPermissionAudit';pane.hidden=true;pane.setAttribute('aria-label','권한 점검');
 const toolbar=el('div',undefined,'permission-audit-toolbar'),refresh=el('button','다시 확인'),status=el('p',''),body=el('div');
 refresh.type='button';status.setAttribute('role','status');status.setAttribute('aria-live','polite');const toolbarActions=el('div',undefined,'permission-audit-actions'),add=el('button','+ 직원 추가');add.type='button';add.addEventListener('click',()=>root.AiselStaffDirectory?.create());toolbarActions.append(add,refresh);toolbar.append(el('h2','직원별 접근 범위'),toolbarActions);pane.append(toolbar,status,body);document.body.append(pane);
 const roles={owner:'대표',designer:'디자이너',md:'MD',logistics:'물류'};
 const columns=[['이름·아이디',null],['계정 상태',null],['레퍼런스','references'],['디자인회의','designmeeting'],['판매성과','sales'],['작업지시서','orders'],['판매표·매출·광고·수익','finance'],['관리','actions']];
 let epoch=0,identity='';
 const key=()=>[access.session?.uid,access.session?.role,access.session?.credentialVersion,root.AiselAuth?.generation].join(':');
 const permitted=()=>access.isOwner===true&&root.AiselManagement?.unlocked===true;
 function clear(){epoch++;body.replaceChildren();status.textContent='';refresh.disabled=false;}
 function hide(){pane.hidden=true;clear();}
 function render(data){
  const summary=el('div',undefined,'permission-audit-summary');
  summary.append(el('p',data.protectionActive?'계정별 접근 제한 적용 중':'접근 제한 설정 확인 필요',data.protectionActive?'':'permission-audit-warning'));
  summary.append(el('p',data.designerCollectionsReady?'디자이너: 레퍼런스 · 디자인회의 · 판매성과 · 작업지시서':'디자이너 레퍼런스·디자인회의 연결 준비 중'));
  summary.append(el('p','판매성과는 본인 담당 신상품의 반응만 표시합니다. 회사 매출·광고비·수익 금액은 대표 전용입니다.'));
  const scroll=el('div',undefined,'permission-audit-scroll'),table=el('table'),head=el('thead'),tr=el('tr');table.setAttribute('aria-label','사람별 열람 권한');
  columns.forEach(([label])=>{const th=el('th',label);th.scope='col';tr.append(th);});head.append(tr);table.append(head);const tbody=el('tbody');
  for(const person of data.staff){
   const row=el('tr'),views=person.loginReady?person.permissions?.views||[]:[];
   const name=el('th');name.scope='row';const identity=el('div',undefined,'audit-value audit-identity');identity.append(el('strong',person.displayName||'이름 미등록'),el('span',[person.loginId||person.email,roles[person.role]||'확인 필요'].filter(Boolean).join(' · ')));name.append(identity);
   const cellValue=text=>{const cell=el('td');cell.append(el('span',text,'audit-value'));return cell;};row.append(name,cellValue(!person.active?'사용 중지':person.loginReady?'사용 중':'로그인 준비 필요'));
   for(const [,view]of columns.slice(2,-1)){
    let text=view==='finance'?(person.loginReady&&person.permissions?.companyFinance?'대표 전용':'차단'):views.includes(view)?'열람 가능':'차단';
    if(view==='orders'&&views.includes(view)&&person.role==='designer')text='본인 '+person.assignedCount+'건'+(person.sharedCount?' · 공동 '+person.sharedCount+'건':'');
    if(view==='sales'&&views.includes(view)&&person.role==='designer')text='본인 신상품';
    row.append(cellValue(text));
   }
   const actions=el('td'),controls=el('div',undefined,'audit-value permission-audit-actions');
   if(person.role==='owner')controls.textContent='대표 전용';else for(const [label,handler]of [['권한 관리',()=>root.AiselStaffDirectory?.manage(person,data.staff)],['인수인계',()=>root.AiselStaffDirectory?.handover(person,data.staff)]]){const b=el('button',label);b.type='button';b.addEventListener('click',handler);controls.append(b);}
   actions.append(controls);row.append(actions);tbody.append(row);
  }
  if(!data.staff.length){const row=el('tr'),cell=el('td','등록된 계정이 없습니다. 직원·권한 관리에서 확인해주세요.');cell.colSpan=columns.length;row.append(cell);tbody.append(row);}
  for(const row of tbody.children)Array.from(row.children).forEach((cell,index)=>cell.setAttribute('data-label',columns[index]?.[0]||''));
  table.append(tbody);scroll.append(table);scroll.tabIndex=0;scroll.setAttribute('aria-label','사람별 권한 표');body.append(summary,scroll);
  const notes=el('div',undefined,'permission-audit-notes');
  notes.append(el('p','담당자 미지정 작업지시서 '+data.unassignedCount+'건 · 담당자 지정 전에는 대표만 확인할 수 있습니다.'));
  if(data.unlinkedNames?.length){notes.append(el('p','계정 미등록'));const pending=el('div',undefined,'permission-audit-actions');for(const name of data.unlinkedNames){const b=el('button','+ '+name);b.type='button';b.addEventListener('click',()=>root.AiselStaffDirectory?.create({displayName:name}));pending.append(b);}notes.append(pending);}
  notes.append(el('p','이 표는 현재 앱 권한입니다. 과거 열람 기록이나 별도로 공유한 구글 문서의 권한을 뜻하지 않습니다. 출고·샘플 공통 공유 화면의 기존 정책은 별도로 유지됩니다.'));
  body.append(notes);
 }
 async function load(){
  if(!permitted()){hide();return false;}
  const run=++epoch,account=key();body.replaceChildren();refresh.disabled=true;status.textContent='현재 계정과 접근 범위를 확인하고 있습니다.';
  try{const data=await access.request('permissionAudit');if(run!==epoch||pane.hidden||account!==key()||!permitted())return false;
   if(!Array.isArray(data.staff)||!Number.isFinite(data.checkedAt)||typeof data.protectionActive!=='boolean')throw Error('권한 확인 결과를 다시 불러와주세요.');
   render(data);status.textContent='확인 시각 '+new Date(data.checkedAt).toLocaleString('ko-KR');return true;
  }catch(error){if(run===epoch&&!pane.hidden){body.replaceChildren();status.textContent=error.message||'권한을 확인하지 못했습니다. 다시 확인해주세요.';}return false;}
  finally{if(run===epoch)refresh.disabled=false;}
 }
 root.addEventListener('aisel-staff-changed',()=>{if(!pane.hidden&&permitted())load();});
 refresh.addEventListener('click',load);
 access.subscribe(()=>{const next=key();if(identity!==next||!access.isOwner){identity=next;hide();}});
 root.addEventListener('aisel-management-locked',hide);
 setInterval(()=>{if(!pane.hidden&&!permitted()){clear();status.textContent='관리 로그인 시간이 끝났습니다. 메뉴를 다시 열어 로그인해주세요.';}},1000);
 root.AiselPermissionAudit=Object.freeze({show(){if(!permitted())return false;pane.hidden=false;load();return true;},hide,get visible(){return !pane.hidden;}});
})(window);

