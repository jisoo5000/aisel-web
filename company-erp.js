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
 let peopleStaffAt=0,peopleStaffFlight=null;
 let replenishmentView='summary',recruitmentReferenceView='summary',productionView='planning';
 let workflowCatalog=null,catalogFlight=null,catalogFilter='',catalogGroup='all';
 const drafts=new Map();
 const controllers=new Set(),tabs={overview:'전체 업무흐름',catalog:'전체 업무목록',operation:'운영 업무',product:'상품·제작',content:'콘텐츠·광고',replenishment:'판매·재고',salesTable:'판매표',finance:'매출·광고·수익',growth:'매출·순익',hiring:'채용·인력',recruitmentReferences:'채용 레퍼런스',attendance:'출퇴근',leave:'휴가 관리',myLeave:'휴가 관리',automation:'자동화·연결'};
 const notices={invalid_record_field:'기록 항목을 확인해주세요.',invalid_record_text:'입력 내용의 길이와 형식을 확인해주세요.',invalid_number:'숫자 입력을 확인해주세요.',invalid_period:'시작일과 종료일을 확인해주세요.',invalid_record_option:'선택한 상태를 확인해주세요.',decision_evidence_required:'판단 근거와 확인한 결과를 기록해주세요.',review_evidence_required:'합의한 기준·근거·본인 의견·다음 확인일을 기록해주세요.',management_login_required:'관리 영역에 다시 로그인해주세요.',sheets_not_enabled:'시트 연결 설정을 확인해야 합니다.',service_unavailable:'저장 서버 연결을 확인해야 합니다.',sync_cooldown:'방금 연결을 확인했습니다. 15분 뒤 다시 갱신할 수 있습니다.',sheets_access_required:'시트 접근 권한을 확인해야 합니다.',permission_denied:'이 계정에서 회사 ERP를 이용할 권한이 없습니다.',unauthenticated:'로그인 상태를 다시 확인해 주세요.',version_conflict:'다른 곳에서 먼저 수정했습니다. 최신 기록을 다시 불러온 뒤 변경해 주세요.',completion_evidence_required:'완료 결과나 확인 근거를 입력해 주세요.',prior_step_incomplete:'이 업무에 먼저 필요한 결과를 확인해 주세요.',invalid_assignee:'담당자 계정이 변경되었습니다. 직원 목록을 새로 확인해 주세요.',completed_step_immutable:'이미 완료한 단계입니다. 후속 수정은 메모와 다음 업무에 기록해 주세요.'};
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
 const navigation=[['product','상품·제작','제작기획 현황'],['content','상품·제작','콘텐츠·광고'],['salesTable','판매','판매표'],['finance','판매','매출·광고·수익'],['growth','판매','매출·순익'],['replenishment','판매','판매·재고'],['overview','업무','전체 업무흐름'],['catalog','업무','전체 업무목록'],['operation','업무','운영 업무'],['hiring','관리','채용·인력'],['recruitmentReferences','관리','채용 레퍼런스'],['attendance','관리','출퇴근'],['leave','관리','휴가 관리'],['myLeave','근무·휴가','휴가 관리'],['automation','관리','자동화·연결']];
 for(const [key,spec]of Object.entries(root.AiselWorkflowDomain?.specs||{})){tabs[key]=spec.label;navigation.push([key,spec.group,spec.label]);}tabs.apiUsage='Google API 사용 내역';navigation.push(['apiUsage','관리','Google API 사용 내역']);
 const canView=key=>allowed()&&(key==='myLeave'||session()?.role!=='designer'&&(owner()||key==='attendance'));
 function canLeave(){
  if(writing){message('저장 결과를 확인하고 있습니다. 연결 오류가 나면 입력 내용을 유지한 채 이동할 수 있습니다.',true);return false;}
  if(dirty)drafts.set(section,{nodes:[...content.childNodes],selectedId,notice:notice.textContent,error:notice.classList.contains('ce-error')});
  return true;
 }
 function hide(){if(drafts.has(section))dirty=false;panel.hidden=true;content.querySelectorAll('.ce-replenishment-frame, .ce-recruitment-frame, .ce-production-frame').forEach(frame=>frame.remove());}
 function close(){return root.AiselUnified?.show('orders');}
 function open(next=owner()?'overview':'attendance'){return root.AiselUnified?.show('company-'+next);}
 function show(next){if(!canView(next)||next==='recruitmentReferences'&&!root.AiselManagement?.unlocked)return false;if(drafts.has(section))dirty=false;section=next;selectedId='';notice.textContent='';panel.hidden=false;panel.setAttribute('aria-label',tabs[next]);const draft=drafts.get(next);if(draft){drafts.delete(next);content.replaceChildren(...draft.nodes);root.AiselCompanyPeople?.refreshLeaveForm?.(content);selectedId=draft.selectedId;dirty=true;message(draft.notice||'작성 중인 내용을 유지했습니다.',draft.error);return true;}render();if(next==='leave')loadPeopleStaff();else if(!['recruitmentReferences','myLeave'].includes(next)&&(next!=='replenishment'||replenishmentView==='tasks')&&(next!=='product'||productionView==='tasks'))load();return true;}
 function navigate(next){return open(next);}
 function buildNav(){}
 for(const [key,,label]of navigation){const entry=el('button','maintab',label);entry.type='button';entry.dataset.main='company-'+key;entry.hidden=!canView(key);entry.setAttribute('aria-controls',panel.id);document.getElementById('mainBar').append(entry);}
 async function loadPeopleStaff(){
  if(!owner()||peopleStaffFlight)return;
  const kst=value=>new Date(value+9*3600000).toISOString().slice(0,10);
  if(peopleStaffAt&&kst(peopleStaffAt)===kst(Date.now()))return;
  const run=epoch,account=session().uid;
  const promise=request('companyStaff').then(result=>{if(!valid(run,account))return;staff=result.items||[];peopleStaffAt=Date.now();if(section==='leave'&&!dirty&&!writing&&!panel.hidden)render();}).catch(error=>{if(valid(run,account)&&section==='leave')message(friendly(error),true);}).finally(()=>{if(peopleStaffFlight===promise)peopleStaffFlight=null;});peopleStaffFlight=promise;return promise;
 }
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
 function route(label,view,code){return button(label,async()=>{await root.AiselUnified?.show(code?'editor':view,code?{code}:{});},'ce-link');}
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

 function recruitmentReferences(){
  const source='https://docs.google.com/spreadsheets/d/1zho3CXpJtXJH_qirPo4dcImDcFf2IK0qtI4dg-FgRqM/edit';
  const views={summary:{label:'공고 목록',gid:'1112',range:'A1'},detail:{label:'상세 내용',gid:'1113',range:'A1'},history:{label:'수집 기록',gid:'1115',range:'A1'}};
  const bar=el('div','ce-filters ce-recruitment-tabs');bar.setAttribute('aria-label','채용 레퍼런스 보기');
  const frame=el('iframe','ce-recruitment-frame');frame.loading='lazy';frame.referrerPolicy='strict-origin-when-cross-origin';
  const fallback=el('a','ce-link','구글시트');fallback.target='_blank';fallback.rel='noopener noreferrer';
  const choose=key=>{
   recruitmentReferenceView=key;const view=views[key],url=source+'?rm=minimal&gid='+view.gid+'#gid='+view.gid+'&range='+view.range;
   if(frame.getAttribute('src')!==url)frame.src=url;frame.title='채용 레퍼런스 · '+view.label;fallback.href=source+'#gid='+view.gid;
   for(const b of bar.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.referenceView===key));
  };
  for(const [key,view]of Object.entries(views)){const b=button(view.label,()=>choose(key));b.dataset.referenceView=key;bar.append(b);}
  const help=el('p','ce-muted ce-recruitment-help');help.append(document.createTextNode('같은 시트 원본입니다. 표가 보이지 않으면 '),fallback,document.createTextNode('에서 Google 로그인을 확인해주세요.'));
  content.append(bar,frame,help);choose(recruitmentReferenceView);
 }

 function productionBoard(){
  const source='https://docs.google.com/spreadsheets/d/1zkd_VXxnqw27LArmZ7lNfOhwQnTDjDGqnYrJrvRs-Xg/edit',gid='2026111201';
  content.append(groupTitle('제작기획 현황','상품별로 유지할 패턴, 바꿀 원단, 현재 단계와 다음 할 일을 기록합니다.'));
  const bar=el('div','ce-filters ce-production-tabs');bar.setAttribute('aria-label','제작기획 보기');
  for(const [key,label]of [['planning','기획표'],['tasks','진행 업무']]){
   const b=button(label,()=>{productionView=key;selectedId='';render();if(key==='tasks')load();});
   b.setAttribute('aria-pressed',String(key===productionView));bar.append(b);
  }content.append(bar);
  if(productionView==='tasks'){projectList();return;}
  const url=source+'#gid='+gid+'&range=A1:J6',open=el('a','ce-link','구글 시트에서 크게 보기');
  open.href=url;open.target='_blank';open.rel='noopener noreferrer';content.append(open);
  content.append(el('p','ce-muted','아래 표에 바로 입력합니다. 표가 보이지 않거나 편집하기 어려우면 위 링크로 열어주세요.'));
  const frame=el('iframe','ce-production-frame');frame.title='제작기획 현황';frame.loading='lazy';frame.referrerPolicy='strict-origin-when-cross-origin';
  frame.src=source+'?rm=minimal&gid='+gid+'#gid='+gid+'&range=A1:J6';content.append(frame);
 }

 function replenishmentBoard(){
  const source='https://docs.google.com/spreadsheets/d/1Nj3gn7oJ1q0mtTdMzE8ScPlITY9FoTweB8aTVguxoO8/edit';
  const views={summary:{label:'판매 TOP20 · 신상10',gid:'2026111110',range:'A1:D40'},orders:{label:'통합 발주 상세',gid:'870159575',range:'A1:Y40'}};
  if(replenishmentView!=='tasks')content.append(groupTitle('판매·재고','판매수량순 TOP20과 신상 10개를 봅니다. 표 오른쪽 위에서 최근 3·7·30일을 선택합니다.'));
  const bar=el('div','ce-filters');bar.setAttribute('aria-label','판매·재고 보기');
  for(const [key,label]of [['summary',views.summary.label],['orders',views.orders.label],['tasks','진행 업무']]){
   const b=button(label,()=>{replenishmentView=key;selectedId='';render();if(key==='tasks')load();});
   b.setAttribute('aria-pressed',String(key===replenishmentView));bar.append(b);
  }content.append(bar);
  if(replenishmentView==='tasks'){projectList();return;}
  const view=views[replenishmentView],url=source+'#gid='+view.gid+'&range='+view.range;
  const open=el('a','ce-link','구글 시트에서 크게 보기');open.href=url;open.target='_blank';open.rel='noopener noreferrer';content.append(open);
  content.append(el('p','ce-muted','시트와 같은 원본입니다. 표가 보이지 않으면 위 링크에서 Google 계정을 확인해주세요. 판매 기준일과 발주 반영일은 표 상단에 표시됩니다.'));
  const frame=el('iframe','ce-replenishment-frame');frame.title=view.label;frame.loading='lazy';frame.referrerPolicy='strict-origin-when-cross-origin';
  frame.src=source+'?rm=minimal&gid='+view.gid+'#gid='+view.gid+'&range='+view.range;content.append(frame);
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
  const sheetCard=el('section','ce-connection');sheetCard.append(el('h3','','구글 운영대장'),el('p','ce-muted','앱 기록을 하루 한 번 모아서 반영합니다. 표를 열 때는 저장된 요약을 사용합니다.'));const stateText=el('p','ce-muted','연결 상태 확인 중');sheetCard.append(stateText);const sync=button('지금 시트에 반영',async()=>{sync.disabled=true;try{const result=await request('companySync');stateText.textContent=result.status==='needs_attention'?'운영대장 저장·재조회는 확인했습니다. 일부 원본 읽기는 확인이 필요합니다. 해당 업무의 원본 연결 상태를 확인해 주세요.':'시트 저장과 다시 읽기를 확인했습니다.';}catch(e){message(friendly(e),true);}finally{sync.disabled=false;}});sync.disabled=true;sheetCard.append(sync);content.append(sheetCard);request('companyConnectionStatus').then(s=>{if(!sheetCard.isConnected)return;stateText.textContent=s.lastSuccessAt?'마지막 반영 '+new Date(s.lastSuccessAt).toLocaleString('ko-KR')+(s.status==='needs_attention'?' · 연결 확인 필요':''):'아직 시트 반영을 확인하지 않았습니다.';sync.disabled=!s.enabled;if(s.workbookUrl&&D.safeUrl(s.workbookUrl)){const link=el('a','ce-link','운영대장 열기');link.href=D.safeUrl(s.workbookUrl);link.target='_blank';link.rel='noopener noreferrer';sheetCard.append(link);}}).catch(e=>{if(sheetCard.isConnected)stateText.textContent=friendly(e);});
 }
 function render(){if(dirty)return;if(section==='product'&&productionView==='planning'&&content.querySelector('.ce-production-frame'))return;content.classList.toggle('cl-host',['leave','myLeave'].includes(section));if(section==='recruitmentReferences'&&content.querySelector('.ce-recruitment-frame'))return;buildNav();content.replaceChildren();if(section==='recruitmentReferences'){recruitmentReferences();return;}if(section==='growth'&&root.AiselGrowthProfit){root.AiselGrowthProfit.render({host:content,el,button,request,message,redraw:render,projects:()=>projects,staff:()=>staff,ready:()=>loaded&&!loading,dirty:()=>dirty,setDirty:value=>{dirty=value;},setWriting:value=>{writing=value;},upsert:item=>{projects=[...projects.filter(p=>p.id!==item.id),item];selectedId='';loadedAt=Date.now();}});return;}if(root.AiselWorkflows&&(section==='apiUsage'||root.AiselWorkflowDomain?.specs[section])){root.AiselWorkflows.render(section,{host:content,el,button,request,message,redraw:render,setDirty:value=>{dirty=value;},setWriting:value=>{writing=value;}});return;}if(selectedId){const p=projects.find(p=>p.id===selectedId);if(p){projectDetail(p);return;}selectedId='';}if(section==='product'){productionBoard();return;}if(section==='replenishment'){replenishmentBoard();return;}if(['attendance','leave','myLeave'].includes(section)&&root.AiselCompanyPeople){root.AiselCompanyPeople.render(section,{host:content,el,button,owner,staff:()=>staff,request,message,redraw:render,setDirty:value=>{dirty=value;},setWriting:value=>{writing=value;},isWriting:()=>writing});return;}if(section==='finance'&&root.AiselCompanySources){root.AiselCompanySources.finance({host:content,el,button,request,message});return;}if(section==='salesTable'&&root.AiselCompanySales){root.AiselCompanySales.render({host:content,el,button,request,message});return;}if(section==='overview')overview();else if(section==='catalog')catalogView();else if(section==='automation')connections();else projectList();}
 function identityChanged(){const next=[session()?.uid,session()?.role,session()?.credentialVersion||0].join(':'),ok=allowed();for(const [key]of navigation){const entry=nav.querySelector('[data-main="company-'+key+'"]');if(entry)entry.hidden=!canView(key);}if(uid!==next||!ok){drafts.clear();uid=next;epoch++;for(const c of controllers)c.abort();controllers.clear();projects=[];staff=[];peopleStaffAt=0;peopleStaffFlight=null;workflowCatalog=null;catalogFlight=null;catalogFilter='';catalogGroup='all';loaded=false;loadedAt=0;loading=false;writing=false;dirty=false;selectedId='';root.AiselWorkflows?.reset();root.AiselCompanyPeople?.reset();root.AiselCompanySources?.reset();root.AiselGrowthProfit?.reset();section=owner()?'overview':'attendance';content.replaceChildren();notice.textContent='';hide();}}
 root.addEventListener('aisel-management-unlocked',()=>{loaded=false;loadedAt=0;});
 root.addEventListener('aisel-management-locked',()=>{for(const key of drafts.keys())if(key!=='myLeave')drafts.delete(key);projects=projects.filter(p=>p.kind!=='hiring');root.AiselWorkflows?.reset();root.AiselCompanyPeople?.resetManagement();root.AiselCompanySources?.reset();if(['hiring','recruitmentReferences','attendance','leave','automation','evaluation','apiUsage'].includes(section)){content.replaceChildren();hide();}});
 root.addEventListener('aisel-access-change',identityChanged);root.addEventListener('beforeunload',event=>{if(dirty||writing||drafts.size){event.preventDefault();event.returnValue='';}});
 root.AiselCompanyERP=Object.freeze({open,close,hide,canLeave,navigation:()=>navigation.map(([key,group,label])=>({view:'company-'+key,group,label})),route:view=>{const key=String(view).replace(/^company-/, '');return String(view).startsWith('company-')&&Object.hasOwn(tabs,key)?{label:navigation.find(n=>n[0]===key)?.[2]||tabs[key],allowed:()=>canView(key),show:()=>show(key)}:null;},get visible(){return !panel.hidden;}});
 identityChanged();root.AiselErpShell?.refresh();

})(window);



/* Growth-profit workspace. Records use the existing owner-authorized project service. */
(function(root){
 'use strict';
 const schema='aisel-growth-profit-v1',prefix='growth-',tabs={summary:'요약',product:'월간 바지',traffic:'유입·전환',customer:'객단가·재구매',experiment:'실행·검증'};
 const states=['미확인','검토 중','확인','보완 필요','해당 없음'],statuses=['대기','진행 중','확인 필요','완료','보류'];
 const checks=[['reason','구매 이유'],['fit','핏·사이즈'],['fabric','소재·세탁'],['styling','코디·옵션 재고'],['profit','원가·재고 부담'],['content','사진·상세·광고'],['stock','입고·출시 준비']];
 const periodFields=[['periodStart','시작일','date'],['periodEnd','종료일','date']];
 const fields={
  product:[['category','품목','select',['바지','스커트']],['material','소재','select',['슬랙스','데님','코듀로이','기모·보온','기타']],['spec','확인한 소재 사양','text'],['fit','핏·기장','text'],['previous','이미 구매한 상품·해결되지 않은 용도','text'],['reason','다시 살 이유','textarea'],['usp','이 가격에 에이슬을 살 이유·실물 근거','textarea'],['styling','연결할 상의·하의 품번 / 상품번호','text'],['inventory','옵션 재고·입고·납기 확인','text'],['sampleEvidence','착용·세탁·소재 검사 결과','textarea'],['releaseDate','출시 예정일','date']],
  traffic:[['channel','유입 경로','select',['광고','오가닉','CRM','전체']],...periodFields,['hypothesis','전환을 높일 가설','textarea'],['change','바꿀 광고·랜딩·사이즈·재고 안내','textarea'],['sessions','방문 세션 수','number'],['orders','같은 범위의 주문수','number'],['clicks','광고 클릭수','number'],['spend','같은 범위의 광고비','number'],['baseline','비교기간·현재 기준값','textarea'],['result','실행 결과·분모·관찰기간','textarea']],
  basket:[['product','기준 하의 품번 / 상품번호','text'],['styling','함께 제안할 상의·다른 하의','text'],...periodFields,['hypothesis','동반 구매 가설','textarea'],['eligible','대상 하의 주문수','number'],['converted','상의를 함께 산 주문수','number'],['baseline','비교군·기준 동반율','textarea'],['result','주문당 이익·전체 전환·부분 반품 결과','textarea']],
  repeat:[['product','첫 구매 상품·고객군','text'],['nextProduct','다음에 제안할 상품·새 용도','text'],...periodFields,['window','관찰기간','select',['30일','60일','90일','180일']],['mature','관찰기간 경과','select',['확인 전','경과 확인']],['eligible','최초 대상 고객수','number'],['converted','유효한 두 번째 구매 고객수','number'],['hypothesis','다시 살 이유·제안 가설','textarea'],['baseline','비교 고객군·기준 재구매율','textarea'],['result','고객당 이익·반품·수신 거부 결과','textarea']],
  experiment:[['axis','실행 구분','select',['상품 구성','유입','전환','객단가','재구매','반품·재고','수익']],['hypothesis','근거와 가설','textarea'],['change','이번에 바꿀 것','textarea'],['baseline','비교군·기준값','textarea'],['primary','핵심 결과 지표·목표','text'],['guardrail','악화시키면 안 되는 지표','text'],['result','확인한 결과·해석','textarea'],['decision','다음 판단','select',['검토 전','확대','수정','보류','중단']]],
  closing:[...periodFields,['basis','확인 상태','select',['잠정','마감 대사 완료']],['netRevenue','할인·취소·환불 반영 순매출 (부가세 제외)','number'],['cogs','판매원가 (회수 재고 조정 후)','number'],['variableCost','결제·배송·포장·반품 등 변동비','number'],['ads','광고비','number'],['crm','CRM 비용','number'],['fixed','고정·운영비','number'],['other','영업외 순손익 (+이익 / -손실)','signed'],['tax','법인세 등 이익 관련 세금','number']]
 };
 const kindLabel={product:'월간 바지 계획',traffic:'유입·전환 과제',basket:'객단가 과제',repeat:'재구매 과제',experiment:'실행·검증',closing:'손익 마감'};
 let tab='summary',month=kst().slice(0,7),search='',archived=false,finance=null,loadedFinance=false,account='',revision=0;
 function kst(now=Date.now()){return new Date(now+32400000).toISOString().slice(0,10);}
 const finite=n=>typeof n==='number'&&Number.isFinite(n),amount=n=>finite(n)?Math.round(n).toLocaleString('ko-KR')+'원':'미확인';
 const ratio=(a,b)=>finite(a)&&finite(b)&&b>0?a/b:null;
 const percent=n=>finite(n)?(n*100).toLocaleString('ko-KR',{maximumFractionDigits:1})+'%':'미확인';
 function reset(){revision++;account='';finance=null;loadedFinance=false;tab='summary';month=kst().slice(0,7);search='';archived=false;}
 function identity(){const s=root.AiselAccess?.session;return [s?.uid,s?.role,s?.credentialVersion||0].join(':');}
 function read(project){
  if(!project?.id?.startsWith(prefix))return null;
  try{const n=JSON.parse(project.notes);if(n.schema!==schema||!fields[n.type]||!/^\d{4}-(0[1-9]|1[0-2])$/.test(n.month)||!statuses.includes(n.status)||!n.data||typeof n.data!=='object'||Array.isArray(n.data))return null;return {...n,project};}catch(_){return null;}
 }
 function profit(data){
  const keys=['netRevenue','cogs','variableCost','ads','crm','fixed','other','tax'];
  if(!keys.every(k=>finite(data[k]))||keys.filter(k=>k!=='other').some(k=>data[k]<0))return null;
  const contribution=data.netRevenue-data.cogs-data.variableCost,afterMarketing=contribution-data.ads-data.crm,operating=afterMarketing-data.fixed;
  return {contribution,afterMarketing,operating,net:operating+data.other-data.tax};
 }
 function period(value=month,now=Date.now()){
  const today=kst(now),start=value+'-01',last=new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5)),0)).toISOString().slice(0,10);
  const yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  return {start,end:value===today.slice(0,7)?yesterday:last,future:value>today.slice(0,7)};
 }
 function totals(snapshot,p){
  const rows=(snapshot?.rows||[]).filter(r=>r.date>=p.start&&r.date<=p.end&&!p.future),dates=rows.map(r=>r.date),unique=new Set(dates).size===dates.length;
  const days=p.end>=p.start&&!p.future?Math.round((Date.parse(p.end)-Date.parse(p.start))/86400000)+1:0;
  const sum=k=>rows.length&&unique&&rows.every(r=>finite(r[k]))?rows.reduce((n,r)=>n+r[k],0):null;
  return {rows,days,complete:!!days&&rows.length===days&&unique,revenue:sum('orderRevenue'),orders:sum('orders'),spend:sum('adSpend'),aov:ratio(sum('orderRevenue'),sum('orders')),mer:ratio(sum('orderRevenue'),sum('adSpend'))};
 }
 function metric(record){const d=record.data;
  if(record.type==='traffic')return [['주문/세션',percent(ratio(d.orders,d.sessions))],['CPC',amount(ratio(d.spend,d.clicks))]];
  if(record.type==='basket')return [['상의 동반 구매율',d.converted>d.eligible?'분자·분모 확인':percent(ratio(d.converted,d.eligible))]];
  if(record.type==='repeat')return [['두 번째 구매율',d.mature!=='경과 확인'?'관찰 중':d.converted>d.eligible?'분자·분모 확인':percent(ratio(d.converted,d.eligible))]];
  return [];
 }
 function render(ctx){
  const {host,el,button}=ctx,s=root.AiselAccess?.session;
  if(!s?.active||s.role!=='owner'||s.legacy||s.passwordChangeRequired){host.replaceChildren();return;}
  if(account&&account!==identity())reset();account=identity();const run=revision;
  const records=()=>ctx.projects().map(read).filter(Boolean),visible=()=>records().filter(r=>r.month===month&&!!r.project.archived===archived);
  const wrap=el('div','gp-workspace');host.append(wrap);
  const bar=el('div','gp-toolbar'),monthInput=el('input');monthInput.type='month';monthInput.value=month;monthInput.setAttribute('aria-label','매출·순익 기준월');
  const refresh=button('다시 확인',()=>{if(root.AiselCompanySources?.financeSnapshot){refresh.disabled=true;root.AiselCompanySources.financeSnapshot({host,request:ctx.request,message:(text,error)=>{refresh.disabled=false;ctx.message(text,error);}},data=>{if(run!==revision||account!==identity())return;finance=data;if(host.querySelector('.gp-workspace')&&!ctx.dirty())ctx.redraw();},true);}});
  bar.append(monthInput,refresh);wrap.append(bar);
  const nav=el('div','gp-tabs');nav.setAttribute('role','tablist');nav.setAttribute('aria-label','매출·순익 보기');
  for(const [key,label]of Object.entries(tabs)){const b=button(label,()=>{tab=key;ctx.redraw();});b.setAttribute('role','tab');b.setAttribute('aria-selected',String(key===tab));nav.append(b);}wrap.append(nav);
  monthInput.addEventListener('change',()=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput.value)){month=monthInput.value;ctx.redraw();}});
  const body=el('div','gp-body');wrap.append(body);
  const note=(text,cls='ce-muted')=>el('p',cls,text);
  const heading=text=>el('h3','gp-heading',text);
  const line=(label,value)=>{const p=el('p','gp-line');p.append(el('strong','',label),el('span','',value||'미입력'));return p;};
  const jump=(label,key)=>button(label,()=>root.AiselUnified?.show('company-'+key),'ce-link');
  const selected=records().filter(r=>r.month===month&&!r.project.archived);
  function stats(items,target=body){const grid=el('div','gp-stats');for(const [label,value]of items){const c=el('div','gp-stat');c.append(el('span','ce-muted',label),el('strong','',value));grid.append(c);}target.append(grid);}
  function financePanel(){
   const panel=el('section','gp-panel'),p=period(),t=totals(finance?.snapshot,p);body.append(panel);
   panel.append(heading('매출과 수익'),note(p.end>=p.start&&!p.future?p.start+' ~ '+p.end+' · 완료된 날짜 기준':'이 달의 완료된 날짜가 아직 없습니다.'));
   stats([['주문매출'+(!t.complete?' · 확인분 소계':''),amount(t.revenue)],['광고비',amount(t.spend)],['주문당 금액 · 원본 기준',amount(t.aov)],['주문매출 / 광고비',finite(t.mer)?t.mer.toFixed(2)+'배':'미확인']],panel);
   if(!finance?.snapshot)panel.append(note(loadedFinance?'저장된 매출 원본을 확인해야 합니다.':'저장된 매출 자료를 불러오고 있습니다.'));
   else {panel.append(note('자료 '+t.rows.length+'/'+t.days+'일 · '+(finance.snapshot.revenueBasis||'원본 주문매출 기준')));if(!t.complete)panel.append(note('날짜 또는 값이 빠진 소계는 전체 기간 실적과 직접 비교하지 않습니다.'));if(finance.status?.status==='needs_attention')panel.append(note('최근 원본 연결 오류가 있어 이전 확인 자료입니다.','ce-error'));const details=el('details','gp-details');details.append(el('summary','','자료 기준'),note('원본 확인 '+new Date(finance.snapshot.readAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})));panel.append(details);}
   const closings=records().filter(r=>r.type==='closing'&&r.month===month&&!r.project.archived&&r.data.periodStart===p.start&&r.data.periodEnd===p.end),closing=closings.length===1?closings[0]:null,calc=closing&&profit(closing.data),confirmed=closing?.data.basis==='마감 대사 완료'&&!!closing.data.evidence;
   stats([['반품 후 순매출',calc?amount(closing.data.netRevenue):'미확인'],['마케팅 차감 공헌이익',calc?amount(calc.afterMarketing):'미확인'],['예상 영업이익',calc?amount(calc.operating):'미확인'],[confirmed?'확정 순익':'순익',calc&&confirmed?amount(calc.net):'미확정']],panel);
   panel.append(note(closings.length>1?'같은 기간의 마감표가 여러 개입니다. 사용할 기록을 정리하면 수익을 표시합니다.':calc?'마감표의 직접 입력값입니다. 원본 주문매출과 세금·환불 기준이 다릅니다.':'해당 기간의 순매출·원가·비용을 마감표에 입력하면 이익을 계산합니다. 빠진 비용을 0원으로 계산하지 않습니다.'));
   const actions=el('div','ce-actions');actions.append(button('손익 마감 입력',()=>edit('closing',closing)),jump('기존 매출·광고 보기','finance'));panel.append(actions);
   for(const r of records().filter(r=>r.type==='closing'&&r.month===month&&!r.project.archived&&r!==closing))panel.append(card(r));
  }
  function card(r){
   const p=r.project,d=r.data,article=el('article','gp-card'),head=el('div','gp-card-head');head.append(button(p.title,()=>edit(r.type,r),'ce-project-open'),el('span','ce-badge',p.archived?'보관':r.status));article.append(head);
   article.append(note([kindLabel[r.type],p.assigneeName||'담당 미배정',p.dueDate||'',p.productCode||''].filter(Boolean).join(' · ')));
   if(r.type==='product'){article.append(line('다시 살 이유',d.reason),line('소재·핏',[d.material,d.spec,d.fit].filter(Boolean).join(' · ')),line('코디',d.styling));const confirmed=checks.filter(([key])=>d.checks?.[key]==='확인').length;article.append(note('출시 예정 '+(d.releaseDate||'미정')+' · 확인 '+confirmed+'/'+checks.length+'항목'));}
   else if(r.type==='closing'){const v=profit(d);article.append(line('기간',(d.periodStart||'미정')+' ~ '+(d.periodEnd||'미정')),line('확인 상태',d.basis),line('예상 영업이익',v?amount(v.operating):'비용 확인 필요'));}
   else article.append(line('가설',d.hypothesis),...metric(r).map(([k,v])=>line(k,v)),line('결과',d.result));
   article.append(line('다음 행동',d.nextAction));const controls=el('div','ce-actions'),editButton=button('수정',()=>edit(r.type,r));editButton.disabled=!!p.archived;controls.append(editButton,button(p.archived?'복원':'보관',async()=>{await persist(r,null,!p.archived);},'ce-link'));article.append(controls);return article;
  }
  function drawList(types){
   const controls=el('div','gp-toolbar'),input=el('input');input.type='search';input.placeholder='검색';input.setAttribute('aria-label','성장 과제 검색');input.value=search;
   const select=el('select');select.setAttribute('aria-label','진행·보관 선택');for(const [v,l]of [['active','진행·완료'],['archive','보관']]){const o=el('option','',l);o.value=v;select.append(o);}select.value=archived?'archive':'active';controls.append(input,select);for(const type of types){const b=button(kindLabel[type]+' 추가',()=>edit(type));b.disabled=!ctx.ready();controls.append(b);}body.append(controls);
   const list=el('div','gp-list');body.append(list);
   const fill=()=>{list.replaceChildren();const rows=visible().filter(r=>types.includes(r.type)&&[r.project.title,r.project.productCode,r.project.assigneeName,...Object.values(r.data).filter(v=>typeof v==='string')].join(' ').toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(a.data.releaseDate||a.project.dueDate||'9999').localeCompare(b.data.releaseDate||b.project.dueDate||'9999')||b.project.updatedAt-a.project.updatedAt);if(!rows.length)list.append(note(ctx.ready()?'등록된 기록이 없습니다. 위에서 계획과 과제를 추가하세요.':'저장된 업무를 불러오고 있습니다.'));for(const r of rows)list.append(card(r));};input.addEventListener('input',()=>{search=input.value;fill();});select.addEventListener('change',()=>{archived=select.value==='archive';fill();});fill();
  }
  function editorField(form,key,label,type,value,options){
   const row=el('label','ce-field',label),input=el(type==='textarea'?'textarea':type==='select'?'select':'input');input.name=key;
   if(type==='select'){const blank=el('option','','선택');blank.value='';input.append(blank);for(const option of options||[]){const o=el('option','',Array.isArray(option)?option[1]:option);o.value=Array.isArray(option)?option[0]:option;input.append(o);}}
   else if(type!=='textarea'){input.type=type==='signed'?'number':type;if(type==='number'||type==='signed'){input.step='any';if(type==='number')input.min='0';}}
   input.value=value??'';input.maxLength=type==='textarea'?700:200;row.append(input);form.append(row);return input;
  }
  function edit(type,record){
   if(!ctx.ready()){ctx.message('업무 목록을 확인한 뒤 입력할 수 있습니다.',true);return;}
   const p=record?.project||{},d=record?.data||{},inputs={},checkInputs={};body.replaceChildren();bar.hidden=nav.hidden=true;ctx.setDirty(false);
   body.append(heading(kindLabel[type]+(record?' 수정':' 추가')));const form=el('form','ce-form gp-form');body.append(form);
   inputs.title=editorField(form,'title','이름','text',p.title);inputs.title.required=true;inputs.title.maxLength=160;
   inputs.planningMonth=editorField(form,'planningMonth','기준월','month',record?.month||month);inputs.planningMonth.required=true;
   inputs.assigneeUid=editorField(form,'assigneeUid','담당자','select',p.assigneeUid,ctx.staff().map(x=>[x.uid,x.displayName||x.uid]));
   if(p.assigneeUid&&!ctx.staff().some(x=>x.uid===p.assigneeUid)){const o=el('option','',(p.assigneeName||'기존 담당')+' · 계정 확인 필요');o.value=p.assigneeUid;inputs.assigneeUid.append(o);inputs.assigneeUid.value=p.assigneeUid;}
   inputs.status=editorField(form,'status','상태','select',record?.status||'대기',statuses);inputs.status.required=true;
   inputs.dueDate=editorField(form,'dueDate','다음 확인일','date',p.dueDate);inputs.productCode=editorField(form,'productCode','연결 품번','text',p.productCode);inputs.productCode.pattern='AS-[A-Za-z0-9-]+';
   const dataInputs={};for(const [key,label,fieldType,options]of fields[type]){dataInputs[key]=editorField(form,key,label,fieldType,d[key]??(type==='closing'&&key==='periodStart'?period().start:type==='closing'&&key==='periodEnd'&&period().end>=period().start?period().end:''),options);}
   if(type==='product'){
    const section=el('details','gp-checklist');section.open=true;section.append(el('summary','','출시 체크리스트'));const grid=el('div','gp-check-grid');section.append(grid);form.append(section);
    for(const [key,label]of checks)checkInputs[key]=editorField(grid,'check_'+key,label,'select',d.checks?.[key]||'미확인',states);
    const hint=note('데님: 이염·수축·신축 회복 / 코듀로이: 부피감·마찰·표면 변화 / 기모: 두께·보풀·세탁 변화. 새 소재의 핏은 실물로 확인합니다.');section.append(hint);
   }
   dataInputs.evidence=editorField(form,'evidence','확인 근거·자료 기준일','textarea',d.evidence);dataInputs.nextAction=editorField(form,'nextAction','다음 행동','textarea',d.nextAction);
   inputs.sourceUrl=editorField(form,'sourceUrl','근거 링크','url',p.sourceUrl);inputs.sourceUrl.maxLength=2048;
   if(type==='closing')form.append(note('금액은 모두 같은 기간·부가세 제외 기준입니다. 없는 비용은 확인 후 0을 입력하세요. 할인·환불을 순매출에 이미 반영했다면 다시 차감하지 않습니다.'));
   const validation=note('','ce-error');validation.setAttribute('role','alert');form.append(validation);const actions=el('div','ce-actions'),save=el('button','ce-button','저장'),cancel=button('취소',()=>{ctx.setDirty(false);ctx.redraw();});save.type='submit';actions.append(save,cancel);form.append(actions);
   form.addEventListener('input',()=>ctx.setDirty(true));form.addEventListener('change',()=>ctx.setDirty(true));
   let pending=null;
   form.addEventListener('submit',async event=>{
    event.preventDefault();if(save.disabled||!form.reportValidity())return;validation.textContent='';
    const values={};for(const [key,input]of Object.entries(dataInputs)){const spec=fields[type].find(x=>x[0]===key),numeric=spec&&['number','signed'].includes(spec[2]);values[key]=numeric?(input.value===''?null:Number(input.value)):input.value.trim();}
    if(type==='product')values.checks=Object.fromEntries(Object.entries(checkInputs).map(([key,input])=>[key,input.value||'미확인']));
    if(values.periodStart&&values.periodEnd&&values.periodEnd<values.periodStart){validation.textContent='종료일을 시작일 이후로 정해주세요.';return;}
    if(finite(values.eligible)&&finite(values.converted)&&values.converted>values.eligible){validation.textContent='구매한 수가 대상 수보다 클 수 없습니다.';return;}
    if((inputs.status.value==='완료'||type==='closing'&&values.basis==='마감 대사 완료')&&!values.evidence){validation.textContent='완료 또는 마감 대사에는 확인 근거가 필요합니다.';return;}
    if(type==='closing'&&values.basis==='마감 대사 완료'&&(!profit(values)||!values.periodStart||!values.periodEnd)){validation.textContent='확정 마감에는 기간과 모든 비용을 입력해주세요. 확인한 0원은 직접 0을 입력합니다.';return;}
    const noteValue=JSON.stringify({schema,type,month:inputs.planningMonth.value,status:inputs.status.value,data:values});if(noteValue.length>6000){validation.textContent='기록이 길어졌습니다. 세부 근거는 링크로 연결하고 입력 내용을 줄여주세요.';return;}
    const payload={title:inputs.title.value.trim(),assigneeUid:inputs.assigneeUid.value,dueDate:inputs.dueDate.value,productCode:inputs.productCode.value.trim(),sourceUrl:inputs.sourceUrl.value.trim(),goal:values.reason||values.hypothesis||'매출과 반품 후 이익 확인',application:values.usp||values.change||values.styling||'',nextValidation:values.nextAction||'',notes:noteValue};
    const signature=JSON.stringify(payload);if(!pending||pending.signature!==signature)pending={signature,id:p.id||prefix+type+'-'+root.crypto.randomUUID(),requestId:'req-'+root.crypto.randomUUID()};save.disabled=cancel.disabled=true;
    const ok=await persist(record,{payload,...pending});if(!ok){save.disabled=cancel.disabled=false;}
   });inputs.title.focus();
  }
  async function persist(record,change,archiveValue){
   const requestAccount=identity(),run=revision;ctx.setWriting(true);ctx.message('저장 중입니다.');
   try{
    const p=record?.project,id=change?.id||p.id,requestId=change?.requestId||'req-'+root.crypto.randomUUID(),action=change?(p?'companyUpdate':'companyCreate'):'companyArchive';
    const response=await ctx.request(action,{id,requestId,expectedVersion:p?.version||0,...(change?{project:{...change.payload,...(!p?{kind:record?.type==='product'||JSON.parse(change.payload.notes).type==='product'?'product':'operation'}:{})}}:{archived:archiveValue})});
    const checked=await ctx.request('companyGet',{id});if(requestAccount!==identity()||run!==revision)return false;
    if(checked.item?.id!==id||checked.item?.version<response.item?.version)throw Error('저장 결과를 다시 확인해주세요.');
    ctx.upsert(checked.item);ctx.setDirty(false);ctx.redraw();ctx.message('저장 완료');return true;
   }catch(e){if(requestAccount===identity()&&run===revision)ctx.message(e.message==='version_conflict'?'다른 곳에서 먼저 수정했습니다. 입력 내용을 보관한 뒤 취소하고 최신 기록을 다시 확인해주세요.':e.message||'저장 결과를 확인하지 못했습니다.',true);return false;}
   finally{if(requestAccount===identity()&&run===revision)ctx.setWriting(false);}
  }
  if(tab==='summary'){
   financePanel();body.append(heading('이번 달 먼저 확인할 일'));
   const focus=selected.filter(r=>r.type!=='closing'&&!['완료','보류'].includes(r.status)).sort((a,b)=>(a.status==='확인 필요'?-1:0)-(b.status==='확인 필요'?-1:0)||(a.project.dueDate||'9999').localeCompare(b.project.dueDate||'9999'));
   if(!focus.length)body.append(note('월간 바지 계획이나 성장 과제를 추가하면 다음 행동이 여기에 표시됩니다.'));
   for(const r of focus.slice(0,3))body.append(card(r));if(focus.length>3)body.append(button('전체 과제 '+focus.length+'개 보기',()=>{tab='experiment';ctx.redraw();}));
   const ready=selected.filter(r=>r.type==='product');body.append(heading('출시 준비'),note(ready.length?'계획 '+ready.length+'개 · 보완 필요 '+ready.filter(r=>Object.values(r.data.checks||{}).includes('보완 필요')).length+'개':'이번 달 하의 계획을 입력해주세요.'));
  }else if(tab==='product'){body.append(note('월간 구성을 잡고 주별 출시일을 기록합니다. 이미 산 고객이 다시 살 이유와 실제 소재 검수를 연결하세요.'));drawList(['product']);}
  else if(tab==='traffic'){const p=period(),t=totals(finance?.snapshot,p);stats([['광고비',amount(t.spend)],['주문수',finite(t.orders)?t.orders.toLocaleString('ko-KR')+'건':'미확인']]);body.append(note('방문·클릭이 연결되지 않은 전환율과 CPC는 과제에 같은 범위의 실측값을 입력해 확인합니다. 광고 증액은 자동 실행하지 않습니다.'),jump('기존 광고·마케팅 기록','campaign'));drawList(['traffic']);}
  else if(tab==='customer'){body.append(note('객단가는 이번 주문, 재구매는 이후 주문입니다. 관찰기간이 지난 고객끼리 비교하세요.'),jump('기존 코디 기록','styling'));drawList(['basket','repeat']);}
  else {body.append(note('가설·변경·결과·다음 판단을 기록합니다. 상품 계획과 다른 탭의 과제도 함께 볼 수 있습니다.'));drawList(['experiment','product','traffic','basket','repeat']);}
  if(!loadedFinance&&root.AiselCompanySources?.financeSnapshot){loadedFinance=true;root.AiselCompanySources.financeSnapshot({host,request:ctx.request,message:ctx.message},data=>{if(run!==revision||account!==identity())return;finance=data;if(host.querySelector('.gp-workspace')&&!ctx.dirty())ctx.redraw();});}
 }
 root.AiselGrowthProfit=Object.freeze({render,reset,read,profit,period,totals,metric,schema});
})(window);
