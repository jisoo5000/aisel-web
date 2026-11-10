/* Additive workspace: does not move or replace any existing menu or view. */
(function(root){
 'use strict';
 const D=root.AiselCompanyDomain,nav=document.getElementById('aiselErpNavigation');
 if(!D||!nav||document.getElementById('aiselCompanyWorkspace'))return;
 const access=()=>root.AiselAccess,session=()=>access()?.session;
 const allowed=()=>session()?.active===true&&['owner','designer','md','logistics'].includes(session()?.role)&&!!session()?.uid&&!session()?.legacy&&!session()?.passwordChangeRequired;
 const owner=()=>session()?.role==='owner';
 const endpoint='https://asia-southeast1-aisel-workorder.cloudfunctions.net/companyErpV1';
 const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
 const button=(txt,fn,cls='ce-button')=>{const b=el('button',cls,txt);b.type='button';b.addEventListener('click',fn);return b;};
 const panel=el('section','noprint');panel.id='aiselCompanyWorkspace';panel.hidden=true;panel.setAttribute('aria-label','업무 화면');
 const main=el('div','ce-main'),notice=el('p','ce-notice');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
 const content=el('div','ce-content');main.append(notice,content);panel.append(main);document.body.append(panel);
 let section='overview',projects=[],staff=[],loaded=false,loading=false,writing=false,epoch=0,loadedAt=0,uid='',dirty=false,selectedId='',filter='',archive=false;
 let workflowCatalog=null,catalogFlight=null,catalogFilter='',catalogGroup='all';
 const controllers=new Set(),tabs={overview:'전체 업무흐름',catalog:'전체 업무목록',operation:'운영 업무',product:'상품·제작',content:'콘텐츠·광고',replenishment:'판매·재고',salesTable:'판매표',finance:'매출·광고·수익',hiring:'채용·인력',attendance:'출퇴근',leave:'휴가 관리',automation:'자동화·연결'};
 const notices={management_login_required:'관리 영역에 다시 로그인해주세요.',sheets_not_enabled:'시트 연결 설정을 확인해야 합니다.',service_unavailable:'저장 서버 연결을 확인해야 합니다.',sync_cooldown:'방금 연결을 확인했습니다. 15분 뒤 다시 갱신할 수 있습니다.',sheets_access_required:'시트 접근 권한을 확인해야 합니다.',permission_denied:'이 계정에서 회사 ERP를 이용할 권한이 없습니다.',unauthenticated:'로그인 상태를 다시 확인해 주세요.',version_conflict:'다른 곳에서 먼저 수정했습니다. 최신 기록을 다시 불러온 뒤 변경해 주세요.',completion_evidence_required:'완료 결과나 확인 근거를 입력해 주세요.',prior_step_incomplete:'이 업무에 먼저 필요한 결과를 확인해 주세요.',invalid_assignee:'담당자 계정이 변경되었습니다. 직원 목록을 새로 확인해 주세요.',completed_step_immutable:'이미 완료한 단계입니다. 후속 수정은 메모와 다음 업무에 기록해 주세요.'};
 function message(text,error=false){notice.textContent=text;notice.classList.toggle('ce-error',error);}
 function friendly(error){return notices[error?.message]||error?.message||'연결을 확인하지 못했습니다.';}
 function valid(run,account){return run===epoch&&allowed()&&session().uid===account;}
 async function request(action,payload={}){
  const account=session()?.uid,run=epoch,user=root.AiselAuth?.currentUser();
  if(!allowed()||!user||user.uid!==account||user.isAnonymous)throw Error('unauthenticated');
  const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),25000);
  try{
   const token=await user.getIdToken();if(!valid(run,account))throw Error('unauthenticated');
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},credentials:'omit',cache:'no-store',signal:controller.signal,body:JSON.stringify({...payload,action,...(root.AiselManagement?.proof()?{managementSession:root.AiselManagement.proof()}:{})})});
   let data;try{data=await response.json();}catch(_){throw Error('회사 ERP 저장 서버의 연결을 확인해야 합니다. 기존 메뉴는 계속 이용할 수 있습니다.');}
   if(!valid(run,account))throw Error('unauthenticated');
   if(!response.ok||data?.ok!==true)throw Error(data?.error||data?.code||'회사 ERP 저장 서버의 연결을 확인해야 합니다.');
   return data;
  }catch(error){if(error?.name==='AbortError')throw Error('연결 시간이 길어지고 있습니다. 다시 확인해 주세요.');throw error;}
  finally{clearTimeout(timer);controllers.delete(controller);}
 }
 const navigation=[['product','상품·제작','제작기획 현황'],['content','상품·제작','콘텐츠·광고'],['salesTable','판매','판매표'],['finance','판매','매출·광고·수익'],['replenishment','판매','판매·재고'],['overview','업무','전체 업무흐름'],['catalog','업무','전체 업무목록'],['operation','업무','운영 업무'],['hiring','관리','채용·인력'],['attendance','관리','출퇴근'],['leave','관리','휴가 관리'],['automation','관리','자동화·연결']];
 const canView=key=>allowed()&&(owner()||['attendance','leave'].includes(key));
 function canLeave(){if(dirty||writing){message(writing?'저장 결과를 확인하고 있습니다.':'작성 중인 내용을 저장하거나 취소한 뒤 이동해 주세요.',true);return false;}return true;}
 function hide(){panel.hidden=true;}
 function close(){return root.AiselUnified?.show('orders');}
 function open(next=owner()?'overview':'attendance'){return root.AiselUnified?.show('company-'+next);}
 function show(next){if(!canView(next))return false;section=next;selectedId='';notice.textContent='';panel.hidden=false;panel.setAttribute('aria-label',tabs[next]);render();load();return true;}
 function navigate(next){return open(next);}
 function buildNav(){}
 for(const [key,,label]of navigation){const entry=el('button','maintab',label);entry.type='button';entry.dataset.main='company-'+key;entry.hidden=!canView(key);entry.setAttribute('aria-controls',panel.id);document.getElementById('mainBar').append(entry);}
 async function load(force=false){
  if(!allowed()||!owner()||loading||writing||dirty)return;if(loaded&&!force&&Date.now()-loadedAt<300000){message('마지막 확인 '+new Date(loadedAt).toLocaleString('ko-KR'));return;}
  const run=epoch,account=session().uid;loading=true;message('회사 업무를 확인하고 있습니다.');
  try{
   const list=async()=>{let cursor=null;const seen=new Set(),items=[];do{const r=await request('companyList',{limit:100,...(cursor?{cursor}:{})});if(!Array.isArray(r.items))throw Error('업무 목록 응답을 확인해야 합니다.');items.push(...r.items);const next=r.nextCursor||null;if(next&&seen.has(next))throw Error('다음 목록 연결을 확인해야 합니다.');if(next)seen.add(next);cursor=next;}while(cursor);return [...new Map(items.map(p=>[p.id,p])).values()];};
   const [items,people]=await Promise.all([list(),request('companyStaff')]);if(!valid(run,account))return;
   projects=items;staff=people.items||[];loaded=true;loading=false;loadedAt=Date.now();message('마지막 확인 '+new Date(loadedAt).toLocaleString('ko-KR'));if(!dirty)render();
  }catch(error){if(valid(run,account))message(friendly(error),true);}
  finally{if(valid(run,account))loading=false;}
 }
 function groupTitle(titleText,subtitle){const row=el('div','ce-section-heading'),text=el('div');text.append(el('h2','',titleText));if(subtitle)text.append(el('p','ce-muted',subtitle));row.append(text);return row;}
 function route(label,view,code){return button(label,async()=>{if(dirty){message('작성 중인 내용을 먼저 저장하거나 취소해 주세요.',true);return;}await root.AiselUnified?.show(code?'editor':view,code?{code}:{});},'ce-link');}
 function shortcuts(){const row=el('div','ce-shortcuts');row.append(el('span','ce-muted','기존 업무 바로가기'));for(const [name,view]of [['작업지시서','orders'],['레퍼런스','references'],['출고현황','products'],['판매성과','sales'],['직원·권한 관리','staff']])row.append(route(name,view));return row;}
 function overview(){
  const top=groupTitle('전체 업무흐름','상품부터 판매 결과까지, 지금 필요한 일을 한곳에서 확인합니다.');const refresh=button('새로고침',()=>load(true));refresh.disabled=loading;top.append(refresh);content.append(top);
  const stats=D.summary(projects),grid=el('div','ce-stats');for(const [key,label]of [['projects','진행·완료 업무'],['blocked','막힌 단계'],['unassigned','담당 미배정'],['overdue','기한 지난 업무']]){const card=el('div','ce-stat');card.append(el('span','ce-muted',label),el('strong','',loaded?String(stats[key]):'—'));grid.append(card);}content.append(grid);
  const flows=el('div','ce-flows');for(const [key,t]of Object.entries(D.templates)){const card=el('section','ce-flow'),head=el('div','ce-flow-head');head.append(button(t.label,()=>navigate(key),'ce-flow-title'));head.append(el('span','ce-muted',loaded?projects.filter(p=>p.kind===key&&!p.archived).length+'건':'연결 확인 전'));card.append(head);const steps=el('ol','ce-flow-steps');for(const [,label]of t.steps)steps.append(el('li','',label));card.append(steps);flows.append(card);}content.append(flows);
  if(loaded){const urgent=projects.filter(p=>!p.archived&&D.nextStep(p)).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).filter(p=>p.steps.some(s=>s.status==='blocked')||!p.assigneeUid||(p.dueDate&&Date.parse(p.dueDate+'T23:59:59+09:00')<Date.now()));content.append(groupTitle('먼저 확인할 업무',urgent.length?'담당 미배정·막힘·기한 경과':'현재 확인된 대기 사항이 없습니다.'));for(const p of urgent)content.append(projectCard(p));}
  content.append(shortcuts());
 }

 function catalogView(){
  content.append(groupTitle('전체 업무목록','기존 업무 기준을 빠짐없이 보고, 담당·상품·실제 진행 기록에 연결합니다.'));
  const host=el('div','ce-catalog');content.append(host);
  const draw=()=>{if(!host.isConnected)return;host.replaceChildren();if(!workflowCatalog){host.append(el('p','ce-muted','업무 기준을 확인하고 있습니다.'));return;}
   const info=el('p','ce-muted',workflowCatalog.groups.map(g=>g.label+' '+g.count+'개').join(' · '));host.append(info);
   host.append(el('p','ce-muted','원본의 미체크는 완료 근거 확인 전이라는 뜻입니다. 실제 진행 상태는 연결한 업무에서 확인합니다.'));
   const controls=el('div','ce-filters'),searchLabel=el('label','ce-search'),search=el('input');search.type='search';search.placeholder='검색';search.setAttribute('aria-label','전체 업무 검색');search.value=catalogFilter;searchLabel.append(search);
   const group=el('select');group.setAttribute('aria-label','업무 목록 구분');for(const x of [{id:'all',label:'전체'},...workflowCatalog.groups]){const o=el('option','',x.label);o.value=x.id;group.append(o);}group.value=catalogGroup;controls.append(searchLabel,group);host.append(controls);
   const count=el('p','ce-muted'),list=el('div','ce-project-list');host.append(count,list);
   const fill=()=>{list.replaceChildren();const rows=workflowCatalog.items.filter(x=>(catalogGroup==='all'||x.group===catalogGroup)&&[x.title,x.section,x.doneWhen,x.id].join(' ').toLowerCase().includes(catalogFilter.toLowerCase()));count.textContent=rows.length+'개 업무';for(const x of rows){const card=el('details','ce-project'),heading=el('summary','ce-catalog-title',x.title);card.append(heading,el('p','ce-muted',x.section+' · '+x.id),paragraph('완료를 확인할 근거',x.doneWhen),paragraph('다음 행동',x.nextAction));if(x.context)card.append(paragraph('기존 확인 내용',x.context));const linked=projects.filter(p=>p.workflowId===x.id);card.append(el('p','ce-muted',loaded?(linked.length?'연결된 업무 '+linked.length+'건':'진행 기록 연결 전'):'진행 기록 확인 중'));for(const p of linked)card.append(projectCard(p));const add=button('새 진행 기록 연결',()=>{section='operation';selectedId='';editProject(null,{title:x.title.replace(/\s*\([^)]*\)\s*$/,'').slice(0,160),workflowId:x.id,goal:x.nextAction,nextValidation:x.doneWhen,sourceUrl:workflowCatalog.sourceUrl,notes:'원본 업무 '+x.id+' · '+x.section});});add.disabled=!loaded||writing;card.append(add);list.append(card);}};
   search.addEventListener('input',()=>{catalogFilter=search.value;fill();});group.addEventListener('change',()=>{catalogGroup=group.value;fill();});fill();
   const link=el('a','ce-link','기준 원본');link.href=workflowCatalog.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';host.append(link,el('p','ce-muted','원본 기준일 '+workflowCatalog.sourceUpdatedOn));
  };draw();if(workflowCatalog)return;const run=epoch,account=session()?.uid;if(!catalogFlight){const pending=request('companyWorkflowCatalog').then(data=>{if(valid(run,account)&&Array.isArray(data.items))workflowCatalog=data;return data;}).finally(()=>{if(catalogFlight===pending)catalogFlight=null;});catalogFlight=pending;}catalogFlight.then(draw).catch(e=>{if(host.isConnected)host.replaceChildren(el('p','ce-error',friendly(e)),button('다시 확인',()=>render()));});
 }
 function projectCard(project){
  const card=el('article','ce-project'),titleRow=el('div','ce-project-title');titleRow.append(button(project.title,()=>showProject(project.id),'ce-project-open'));
  const completed=project.steps.filter(s=>s.status==='done').length,next=D.nextStep(project);titleRow.append(el('span','ce-badge',project.archived?'보관':next?D.statuses[next.status]:'완료'));card.append(titleRow);
  const actualStaff=staff.find(s=>s.uid===project.assigneeUid);const who=project.assigneeUid?(actualStaff?.displayName||project.assigneeName||'이름 확인 필요')+(actualStaff?'':' · 계정 확인 필요'):'담당 미배정';
  card.append(el('p','ce-muted',[who,project.productCode,project.dueDate?'기한 '+project.dueDate:'',completed+'/'+project.steps.length+' 단계 완료'].filter(Boolean).join(' · ')),el('p','',next?'다음: '+next.title:'전체 단계 완료'));
  if(next?.waitReason)card.append(el('p','ce-error',next.waitReason));return card;
 }
 function projectList(){
  const spec=D.templates[section],top=groupTitle(spec.label,section==='hiring'?'역할별 채용·합류·배정 과정을 관리합니다. 재직 여부와 계정 권한은 기존 직원 관리에서 확인합니다.':section==='replenishment'?'판매성과·반품·재고·입고 예정·납기를 함께 확인하고 다음 행동을 기록합니다.':'성공 사례 → 작동 원리 → 에이슬 적용 → 결과 검증');
  const create=button('업무 만들기',()=>editProject());create.disabled=!loaded||writing;top.append(create);content.append(top);
  const filters=el('div','ce-filters'),searchLabel=el('label','ce-search'),search=el('input');search.type='search';search.placeholder='검색';search.setAttribute('aria-label','ERP 업무 검색');search.value=filter;searchLabel.append(search);
  const state=el('select');state.setAttribute('aria-label','진행·보관 선택');for(const [value,label]of [['active','진행·완료'],['archive','보관함']]){const o=el('option','',label);o.value=value;state.append(o);}state.value=archive?'archive':'active';
  filters.append(searchLabel,state,button('새로고침',()=>load(true)));content.append(filters);const list=el('div','ce-project-list');content.append(list);
  const fill=()=>{list.replaceChildren();const rows=projects.filter(p=>p.kind===section&&!!p.archived===archive&&[p.title,p.productCode,p.assigneeName,p.goal].join(' ').toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>b.updatedAt-a.updatedAt);if(!rows.length)list.append(el('p','ce-empty',loaded?'등록된 업무가 없습니다. 업무를 만들면 전체 단계가 연결됩니다.':'저장 서버를 연결하면 실제 업무를 불러옵니다.'));for(const p of rows)list.append(projectCard(p));};
  search.addEventListener('input',()=>{filter=search.value;fill();});state.addEventListener('change',()=>{archive=state.value==='archive';fill();});fill();
  if(section==='hiring'&&root.AiselCompanySources)root.AiselCompanySources.hr({host:content,el,button,request,message,projects:()=>projects,openProject:showProject,createRole:(r,url)=>editProject(null,{title:r.cells[0]+' 채용',recruitmentId:r.id,goal:r.cells[3],nextValidation:r.cells[6],sourceUrl:r.cells[9]||url,notes:'채용 원본 '+r.id+' · '+r.cells[1]+' · 모집인원 '+r.cells[7]+' · 우선순위 '+r.cells[8]})});
  if(section==='hiring')content.append(route('직원·권한 관리 열기','staff'));
  else content.append(shortcuts());
 }
 function paragraph(label,value){const p=el('p','ce-detail-line');p.append(el('strong','',label),el('span','',value||'미입력'));return p;}
 function showProject(id){selectedId=id;render();}
 function projectDetail(project){
  content.append(button('목록으로',()=>{selectedId='';render();},'ce-link'));const top=groupTitle(project.title,D.templates[project.kind].label),edit=button('업무 정보 수정',()=>editProject(project));edit.disabled=project.archived;top.append(edit);content.append(top);
  const facts=el('div','ce-detail');for(const [key,label]of [['goal','목표'],['successExample','성공 사례·근거'],['mechanism','작동 원리'],['application','에이슬 적용안'],['nextValidation','다음 검증'],['notes','진행 메모']])facts.append(paragraph(label,project[key]));
  facts.append(paragraph('담당',staff.find(s=>s.uid===project.assigneeUid)?.displayName||project.assigneeName||'미배정'),paragraph('기한',project.dueDate));
  if(project.sourceUrl&&D.safeUrl(project.sourceUrl)){const a=el('a','ce-link','참고 자료 열기');a.href=D.safeUrl(project.sourceUrl);a.target='_blank';a.rel='noopener noreferrer';facts.append(a);}if(project.productCode)facts.append(route(project.productCode+' 작업지시서','editor',project.productCode));content.append(facts);
  const flow=el('ol','ce-timeline');project.steps.forEach((step,index)=>{const row=el('li','ce-step '+(step.status==='done'?'ce-complete':'')),head=el('div','ce-step-heading');head.append(el('h3','',step.title),el('span','ce-badge',D.statuses[step.status]));row.append(head);if(step.evidence)row.append(paragraph('결과·근거',step.evidence));if(step.waitReason)row.append(paragraph('대기 이유',step.waitReason));if(step.status==='waiting'){const needed=D.dependencies(project,step).map(id=>project.steps.find(s=>s.id===id)?.title||id);row.append(paragraph('먼저 필요한 결과',needed.join(' · ')));}const actions=el('div','ce-actions');if(step.view)actions.append(route('기존 업무 열기',step.view,step.view==='orders'?project.productCode:undefined));if(!project.archived&&step.status!=='done'&&D.canStart(project,step))actions.append(button('진행 기록',()=>editStep(project,step)));row.append(actions);flow.append(row);});content.append(flow);
  content.append(button(project.archived?'업무 복원':'보관함으로 이동',()=>mutate('companyArchive',project,{archived:!project.archived}), 'ce-link'));
 }
 function field(form,name,labelText,value='',options={}){const label=el('label','ce-field',labelText),input=el(options.options?'select':options.multiline?'textarea':'input');input.name=name;if(options.options){for(const [key,name]of options.options){const o=el('option','',name);o.value=key;input.append(o);}}else if(!options.multiline)input.type=options.type||'text';input.value=value||'';input.required=!!options.required;input.maxLength=options.maxLength||3000;input.autocomplete='off';label.append(input);form.append(label);return input;}
 function editProject(project,seed={}){
  dirty=false;content.replaceChildren();content.append(groupTitle(project?'업무 정보 수정':'새 '+D.templates[section].label+(section==='operation'?'':' 업무')));
  const form=el('form','ce-form');const input={};input.title=field(form,'title','업무 이름',project?.title||seed.title,{required:true,maxLength:160});
  input.assigneeUid=field(form,'assigneeUid','담당자',project?.assigneeUid,{options:[['','미배정'],...staff.map(p=>[p.uid,p.displayName||p.uid]),...(project?.assigneeUid&&!staff.some(s=>s.uid===project.assigneeUid)?[[project.assigneeUid,(project.assigneeName||'기존 담당')+' · 계정 확인 필요']]:[])]});
  input.dueDate=field(form,'dueDate','기한',project?.dueDate,{type:'date',maxLength:10});input.productCode=field(form,'productCode','연결할 품번',project?.productCode,{maxLength:100});
  for(const [key,label]of [['goal','목표'],['successExample','성공 사례·근거'],['mechanism','왜 잘됐는지'],['application','에이슬에 어떻게 적용할지'],['nextValidation','다음에 무엇으로 검증할지'],['notes','진행 메모']])input[key]=field(form,key,label,project?.[key]||seed[key],{multiline:true,maxLength:key==='goal'?2000:key==='notes'?6000:3000});
  input.sourceUrl=field(form,'sourceUrl','참고 자료 주소',project?.sourceUrl||seed.sourceUrl,{type:'url',maxLength:2048});
  const actions=el('div','ce-actions'),save=el('button','ce-button','저장');save.type='submit';const cancel=button('취소',()=>{dirty=false;render();});actions.append(save,cancel);form.append(actions);content.append(form);input.title.focus();form.addEventListener('input',()=>{dirty=true;});
  const id=project?.id||'erp-'+root.crypto.randomUUID(),requestId='req-'+root.crypto.randomUUID();
  form.addEventListener('submit',async event=>{event.preventDefault();if(writing||!form.reportValidity())return;const values=Object.fromEntries(Object.entries(input).map(([key,n])=>[key,n.value.trim()]));save.disabled=cancel.disabled=true;const ok=await mutate(project?'companyUpdate':'companyCreate',project||{id,version:0},{project:{...values,...(!project?{kind:section,...(seed.workflowId?{workflowId:seed.workflowId}:{}),...(seed.recruitmentId?{recruitmentId:seed.recruitmentId}:{})}:{})}},requestId);if(!ok){save.disabled=cancel.disabled=false;}});
 }
 function editStep(project,step){
  dirty=false;content.replaceChildren();content.append(groupTitle(step.title,'완료 근거를 남기면 필요한 조건을 갖춘 다음 업무가 열립니다. 병행 가능한 일은 함께 진행할 수 있습니다.'));
  const form=el('form','ce-form'),state=field(form,'status','진행 상태',step.status==='ready'?'doing':step.status,{options:[['doing','진행 중'],['blocked','막힘'],['done','완료']]}),evidence=field(form,'evidence','결과·확인 근거',step.evidence,{multiline:true,maxLength:4000}),reason=field(form,'waitReason','대기 이유',step.waitReason,{multiline:true,maxLength:2000});
  const update=()=>{evidence.required=state.value==='done';reason.required=state.value==='blocked';};state.addEventListener('change',update);update();form.addEventListener('input',()=>{dirty=true;});const actions=el('div','ce-actions'),save=el('button','ce-button','저장');save.type='submit';const cancel=button('취소',()=>{dirty=false;render();});actions.append(save,cancel);form.append(actions);content.append(form);const requestId='req-'+root.crypto.randomUUID();
  form.addEventListener('submit',async event=>{event.preventDefault();if(writing||!form.reportValidity())return;save.disabled=cancel.disabled=true;const ok=await mutate('companyStep',project,{stepId:step.id,status:state.value,evidence:evidence.value.trim(),waitReason:reason.value.trim()},requestId);if(!ok)save.disabled=cancel.disabled=false;});
 }
 async function mutate(action,project,payload,requestId='req-'+root.crypto.randomUUID()){
  if(writing||!allowed())return false;const run=epoch,account=session().uid;writing=true;message('저장 중입니다.');
  try{
   const saved=await request(action,{id:project.id,expectedVersion:project.version||0,requestId,...payload});if(!valid(run,account))return false;
   // Read back the canonical record. A network loss never becomes a false "saved" message.
   const checked=await request('companyGet',{id:project.id});if(checked.item?.version<saved.item?.version)throw Error('저장 결과를 다시 확인해야 합니다.');
   projects=[...projects.filter(p=>p.id!==project.id),checked.item];dirty=false;selectedId=project.id;loadedAt=Date.now();render();message('저장과 다시 불러오기를 확인했습니다.');return true;
  }catch(error){if(valid(run,account))message(friendly(error),true);return false;}
  finally{if(valid(run,account))writing=false;}
 }
 function connections(){
  content.append(groupTitle('자동화·연결','실제 확인된 실행과 연결 준비를 구분합니다.'));
  const rows=[['업무 단계 연결',loaded?'저장 서버 연결 확인':'저장 서버 확인 필요','완료 근거를 기록하면 다음 단계가 진행 가능으로 바뀝니다.'],['작업지시서·레퍼런스·출고현황','기존 화면 연결','기존 화면을 그대로 열어 원본에서 작업합니다.'],['판매·반품·재고','기존 수집 재사용','최근 3개월 주문 매출·광고비·가정 기반 예상 순익을 연결합니다. 상품별 전체 집계와 실제 순익은 근거 확인이 필요합니다.'],['채용·인력','기존 원본과 진행 업무 연결','기존 인력·채용·체크리스트를 읽고 채용ID로 ERP 진행 업무를 연결합니다. 직원 로그인 권한은 별도로 관리합니다.'],['외부 실행·야간 자동 운영','실행 확인 전','구매·광고 집행·채용 연락·새 예약은 이 화면에서 자동 실행하지 않습니다.']];
  for(const [name,state,description]of rows){const card=el('section','ce-connection');card.append(el('h3','',name),el('span','ce-badge',state),el('p','ce-muted',description));content.append(card);}content.append(shortcuts());
  const sheetCard=el('section','ce-connection');sheetCard.append(el('h3','','구글 운영대장'),el('p','ce-muted','앱 기록을 하루 한 번 모아서 반영합니다. 표를 열 때는 저장된 요약을 사용합니다.'));const stateText=el('p','ce-muted','연결 상태 확인 중');sheetCard.append(stateText);const sync=button('지금 시트에 반영',async()=>{sync.disabled=true;try{await request('companySync');stateText.textContent='시트 저장과 다시 읽기를 확인했습니다.';}catch(e){message(friendly(e),true);}finally{sync.disabled=false;}});sync.disabled=true;sheetCard.append(sync);content.append(sheetCard);request('companyConnectionStatus').then(s=>{if(!sheetCard.isConnected)return;stateText.textContent=s.lastSuccessAt?'마지막 반영 '+new Date(s.lastSuccessAt).toLocaleString('ko-KR')+(s.status==='needs_attention'?' · 연결 확인 필요':''):'아직 시트 반영을 확인하지 않았습니다.';sync.disabled=!s.enabled;if(s.workbookUrl&&D.safeUrl(s.workbookUrl)){const link=el('a','ce-link','운영대장 열기');link.href=D.safeUrl(s.workbookUrl);link.target='_blank';link.rel='noopener noreferrer';sheetCard.append(link);}}).catch(e=>{if(sheetCard.isConnected)stateText.textContent=friendly(e);});
 }
 function render(){if(dirty)return;buildNav();content.replaceChildren();if(selectedId){const p=projects.find(p=>p.id===selectedId);if(p){projectDetail(p);return;}selectedId='';}if(['attendance','leave'].includes(section)&&root.AiselCompanyPeople){root.AiselCompanyPeople.render(section,{host:content,el,button,owner,staff:()=>staff,request,message,redraw:render,setDirty:value=>{dirty=value;},setWriting:value=>{writing=value;},isWriting:()=>writing});return;}if(section==='finance'&&root.AiselCompanySources){root.AiselCompanySources.finance({host:content,el,button,request,message});return;}if(section==='salesTable'&&root.AiselCompanySales){root.AiselCompanySales.render({host:content,el,button,request,message});return;}if(section==='overview')overview();else if(section==='catalog')catalogView();else if(section==='automation')connections();else projectList();}
 function identityChanged(){const next=[session()?.uid,session()?.role,session()?.credentialVersion||0].join(':'),ok=allowed();for(const [key]of navigation){const entry=nav.querySelector('[data-main="company-'+key+'"]');if(entry)entry.hidden=!canView(key);}if(uid!==next||!ok){uid=next;epoch++;for(const c of controllers)c.abort();controllers.clear();projects=[];staff=[];workflowCatalog=null;catalogFlight=null;catalogFilter='';catalogGroup='all';loaded=false;loadedAt=0;loading=false;writing=false;dirty=false;selectedId='';root.AiselCompanyPeople?.reset();root.AiselCompanySources?.reset();section=owner()?'overview':'attendance';content.replaceChildren();notice.textContent='';hide();}}
 root.addEventListener('aisel-management-unlocked',()=>{loaded=false;loadedAt=0;});
 root.addEventListener('aisel-management-locked',()=>{projects=projects.filter(p=>p.kind!=='hiring');root.AiselCompanyPeople?.reset();root.AiselCompanySources?.reset();if(['hiring','attendance','leave','automation'].includes(section))hide();});
 root.addEventListener('aisel-access-change',identityChanged);root.addEventListener('beforeunload',event=>{if(dirty||writing){event.preventDefault();event.returnValue='';}});
 root.AiselCompanyERP=Object.freeze({open,close,hide,canLeave,navigation:()=>navigation.map(([key,group,label])=>({view:'company-'+key,group,label})),route:view=>{const key=String(view).replace(/^company-/, '');return String(view).startsWith('company-')&&Object.hasOwn(tabs,key)?{label:navigation.find(n=>n[0]===key)?.[2]||tabs[key],allowed:()=>canView(key),show:()=>show(key)}:null;},get visible(){return !panel.hidden;}});
 identityChanged();root.AiselErpShell?.refresh();

})(window);
