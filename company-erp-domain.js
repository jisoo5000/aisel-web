/* Shared company workflow vocabulary. No business records are bundled here. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AiselCompanyDomain=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const templates=Object.freeze({
  product:{label:'상품·제작',steps:[['research','성공 사례·수요 확인','references'],['plan','상품 기획·원가 검토','designmeeting'],['sample','샘플·핏 검증','samples'],['spec','제작 사양 확정','orders'],['production','생산·입고 확인','products'],['launch','콘텐츠·판매 준비','operations'],['review','판매·반품·수익 검증','sales']]},
  content:{label:'콘텐츠·광고',steps:[['research','잘되는 구성·근거 수집','references'],['adapt','에이슬 제품·고객에 맞춰 기획','designmeeting'],['produce','촬영·제작','operations'],['publish','게시·집행 확인','operations'],['review','매출·수익·고객 반응 검증','sales'],['repeat','개선·다음 실험','operations']]},
  replenishment:{label:'판매·재고',steps:[['review','판매·반품·재고 확인','sales'],['supply','옵션·입고·납기 확인','products'],['decide','리오더 수량·수익 검토','orders'],['receive','입고·출고 확인','products'],['verify','판매 결과 검증','sales']]},
  hiring:{label:'채용·인력',steps:[['need','필요 업무·역할 정리',''],['recruit','모집·지원자 확인',''],['interview','면접·업무 적합성 확인',''],['start','합류 확정·계정 연결','staff'],['handover','업무 배정·인수인계','staff'],['review','업무 결과·개선 확인','']]},
  operation:{label:'운영 업무',steps:[['prepare','자료·기준 확인',''],['execute','업무 진행·결과 기록',''],['verify','결과 재확인·다음 행동','']]}
 });
 const prerequisites={product:{launch:['plan'],review:['production','launch']},replenishment:{supply:[],decide:['review','supply']}};
 function dependencies(project,step){if(step.independent===true)return [];if(Array.isArray(step.dependsOn))return step.dependsOn;const i=project.steps.findIndex(s=>s.id===step.id);return i>0?[project.steps[i-1].id]:[];}
 function canStart(project,step){return dependencies(project,step).every(id=>project.steps.some(s=>s.id===id&&s.status==='done'));}
 function readySteps(project){return project.steps.filter(s=>s.status!=='done'&&canStart(project,s));}
 function refreshReady(project){for(const step of project.steps)if(step.status==='waiting'&&canStart(project,step))step.status='ready';return project;}
 const statuses=Object.freeze({waiting:'대기',ready:'진행 가능',doing:'진행 중',blocked:'막힘',done:'완료'});
 function nextStep(project){return readySteps(project)[0]||project.steps.find(step=>step.status!=='done')||null;}
 function summary(projects,now=Date.now()){
  const live=projects.filter(p=>!p.archived),steps=live.flatMap(p=>p.steps||[]);
  return {projects:live.length,complete:live.filter(p=>!nextStep(p)).length,blocked:steps.filter(s=>s.status==='blocked').length,unassigned:live.filter(p=>!p.assigneeUid&&nextStep(p)).length,overdue:live.filter(p=>p.dueDate&&Date.parse(p.dueDate+'T23:59:59+09:00')<now&&nextStep(p)).length};
 }
 function makeSteps(kind){if(!templates[kind])throw Error('invalid_kind');const steps=templates[kind].steps.map(([id,title,view],i,all)=>{const dependsOn=prerequisites[kind]?.[id]??(i?[all[i-1][0]]:[]);return {id,title,view,dependsOn,independent:!dependsOn.length,status:dependsOn.length?'waiting':'ready',evidence:'',completedAt:null};});return steps;}
 function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch(_){return null;}}
 return Object.freeze({templates,statuses,nextStep,summary,makeSteps,safeUrl,canStart,dependencies,readySteps,refreshReady});
});
