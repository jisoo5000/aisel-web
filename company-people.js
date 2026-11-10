(function(root){
 'use strict';
 let data=null,scope='',loadedAt=0,flight=null,month='',all=true,queryKey='';
 const states={working:'근무 중',completed:'퇴근',corrected:'정정 승인',pending:'신청',approved:'승인',rejected:'반려',cancelled:'취소',cancellation_requested:'취소 요청'};
 const kinds={annual:'연차',half:'반차',other:'기타 휴가'};
 const errors={already_clocked_today:'오늘 출퇴근 기록이 있습니다. 수정이 필요하면 정정을 요청해 주세요.',already_clocked_out:'이미 퇴근이 기록되었습니다.',invalid_break_minutes:'휴게시간을 실제 근무 시간 안에서 분 단위로 입력해 주세요.',correction_required:'출근 기록이 오래되었습니다. 실제 시간을 정정 요청으로 기록해 주세요.',invalid_correction:'출근·퇴근·휴게시간을 확인해 주세요. 미래 시각은 입력할 수 없습니다.',invalid_correction_date:'기존 근무일에 해당하는 출근 시각을 입력해 주세요.',correction_pending:'확인 대기 중인 정정 요청이 있습니다.',leave_budget_unconfigured:'이 직원의 휴가 부여 일수를 먼저 설정해 주세요.',leave_balance_insufficient:'확인된 잔여 휴가보다 신청 일수가 많습니다.',leave_overlap:'같은 기간에 진행 중인 휴가 신청이 있습니다.',leave_dates_require_same_year:'연도가 바뀌는 휴가는 연도별로 나눠 신청해 주세요.',invalid_leave_days:'날짜와 신청 일수를 확인해 주세요. 반차는 하루 중 0.5일입니다.',version_conflict:'다른 곳에서 먼저 변경했습니다. 최신 기록을 확인한 뒤 다시 처리해 주세요.',idempotency_conflict:'이 요청은 이미 다른 내용으로 저장되었습니다. 최신 기록을 확인해 주세요.'};
 const stamp=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'미기록';
 const local=value=>value?new Date(value+9*3600000).toISOString().slice(0,16):'';
 function identity(){const s=root.AiselAccess?.session;return [s?.uid,s?.role,s?.credentialVersion||0].join(':');}
 function reset(){data=null;scope='';loadedAt=0;flight=null;queryKey='';}
 root.addEventListener('aisel-access-change',()=>{if(scope!==identity())reset();});
 async function load(ctx,force=false){
  if(scope!==identity()){reset();scope=identity();}const signature=scope,key=scope+':'+month+':'+all;
  if(queryKey!==key){data=null;flight=null;queryKey=key;}
  if(data&&!force&&Date.now()-loadedAt<60000)return data;if(flight)return flight;
  const promise=ctx.request('peopleSummary',{month,...(ctx.owner()?{all}:{})}).then(result=>{if(signature!==identity()||queryKey!==key)return null;data=result;loadedAt=Date.now();return data;}).finally(()=>{if(flight===promise)flight=null;});flight=promise;return promise;
 }
 function render(section,ctx){
  const {host,el,button}=ctx;if(!month)month=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
  const top=el('div','ce-section-heading'),title=el('div');title.append(el('h2','',section==='attendance'?'출퇴근':'휴가 관리'),el('p','ce-muted',section==='attendance'?'한국시간 기준으로 출근·퇴근과 정정 이력을 기록합니다.':'신청·승인·사용 내역과 회사가 등록한 부여 일수를 확인합니다.'));top.append(title);host.append(top);
  const toolbar=el('div','ce-filters'),monthInput=el('input');monthInput.type='month';monthInput.value=month;monthInput.setAttribute('aria-label','조회 월');monthInput.style.width='150px';toolbar.append(monthInput);
  if(ctx.owner()){const sel=el('select');for(const [v,t]of [['all','전체 직원'],['mine','내 기록']]){const o=el('option','',t);o.value=v;sel.append(o);}sel.value=all?'all':'mine';sel.setAttribute('aria-label','근태 조회 대상');sel.addEventListener('change',()=>{all=sel.value==='all';data=null;ctx.redraw();});toolbar.append(sel);}
  monthInput.addEventListener('change',()=>{if(!monthInput.value)return;month=monthInput.value;data=null;ctx.redraw();});toolbar.append(button('새로고침',()=>{data=null;ctx.redraw();}));host.append(toolbar);
  const body=el('div');host.append(body);body.append(el('p','ce-muted','기록을 확인하고 있습니다.'));
  const scopeNow=identity();load(ctx).then(result=>{if(!result||scopeNow!==identity()||!body.isConnected)return;body.replaceChildren();if(section==='attendance')attendance(body,ctx,result);else leaves(body,ctx,result);ctx.message('마지막 확인 '+stamp(loadedAt));}).catch(error=>{if(body.isConnected)ctx.message(errors[error.message]||error.message,true);});
 }
 async function save(ctx,action,payload,requestId='people-'+root.crypto.randomUUID()){
  if(ctx.isWriting())return false;ctx.setWriting(true);const oldScope=identity();ctx.message('저장 중입니다.');
  try{await ctx.request(action,{requestId,...payload});if(oldScope!==identity())return false;await load(ctx,true);if(oldScope!==identity())return false;ctx.setDirty(false);ctx.redraw();ctx.message('저장한 기록을 다시 확인했습니다.');return true;}
  catch(error){if(oldScope===identity())ctx.message(errors[error.message]||error.message,true);return false;}
  finally{if(oldScope===identity())ctx.setWriting(false);}
 }
 function form(ctx,title,fields,submit){const {host,el,button}=ctx;ctx.setDirty(false);host.replaceChildren(el('h2','',title));const f=el('form','ce-form'),controls={};for(const s of fields){const label=el('label','ce-field',s.label),input=el(s.options?'select':s.multiline?'textarea':'input');input.name=s.key;if(s.options){for(const [v,t]of s.options){const o=el('option','',t);o.value=v;input.append(o);}}else if(!s.multiline)input.type=s.type||'text';input.value=s.value??(s.options?s.options[0][0]:'');input.required=s.required!==false;input.maxLength=2000;if(s.type==='number'){input.min=s.min??0;input.max=s.max??366;input.step=s.step??1;}label.append(input);f.append(label);controls[s.key]=input;}const buttons=el('div','ce-actions'),ok=el('button','ce-button','저장');ok.type='submit';const cancel=button('취소',()=>{ctx.setDirty(false);ctx.redraw();});buttons.append(ok,cancel);f.append(buttons);host.append(f);f.addEventListener('input',()=>ctx.setDirty(true));const requestId='people-'+root.crypto.randomUUID();f.addEventListener('submit',async event=>{event.preventDefault();if(!f.reportValidity()||ctx.isWriting())return;const values=Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.type==='number'?Number(v.value):v.value.trim()]));ok.disabled=cancel.disabled=true;const success=await submit(values,requestId);if(!success)ok.disabled=cancel.disabled=false;});}
 function detail(ctx,title,text){const n=ctx.el('p','ce-detail-line');n.append(ctx.el('strong','',title),ctx.el('span','',text));return n;}
 function attendance(body,ctx,result){const {el,button}=ctx,user=root.AiselAccess.session,open=result.attendance.find(r=>r.uid===user.uid&&!r.clockOut),mineToday=result.attendance.find(r=>r.uid===user.uid&&r.date===result.today),actions=el('div','ce-actions');
  const clockIn=button('출근 기록',()=>save(ctx,'peopleClockIn',{}));clockIn.disabled=!!(open||mineToday);actions.append(clockIn);
  const clockOut=button('퇴근 기록',()=>form(ctx,'퇴근 기록',[{key:'breakMinutes',label:'오늘 실제 휴게시간(분)',type:'number',max:2160}],(v,id)=>save(ctx,'peopleClockOut',{id:open.id,expectedVersion:open.version,...v},id)));clockOut.disabled=!open;actions.append(clockOut);body.append(actions);
  if(!result.attendance.length)body.append(el('p','ce-empty','이 기간의 출퇴근 기록이 없습니다.'));
  for(const row of result.attendance){const card=el('article','ce-project');card.append(el('h3','',[row.displayName||'이름 확인 필요',row.date,states[row.status]].join(' · ')),detail(ctx,'출근 / 퇴근',stamp(row.clockIn)+' / '+stamp(row.clockOut)),detail(ctx,'실제 휴게 / 근무',row.breakMinutes==null?'퇴근 때 기록':row.breakMinutes+'분 / '+row.workMinutes+'분'));if(row.uid===user.uid||ctx.owner())card.append(button('시간 정정 요청',()=>form(ctx,'시간 정정 요청',[
   {key:'clockIn',label:'출근 시각 (한국시간)',type:'datetime-local',value:local(row.clockIn)},{key:'clockOut',label:'퇴근 시각 (한국시간)',type:'datetime-local',value:local(row.clockOut)},{key:'breakMinutes',label:'실제 휴게시간(분)',type:'number',max:2160,value:row.breakMinutes??''},{key:'reason',label:'정정 사유',multiline:true}
  ],(v,id)=>save(ctx,'peopleCorrectionRequest',{...v,clockIn:v.clockIn+':00+09:00',clockOut:v.clockOut+':00+09:00',attendanceId:row.id,expectedVersion:row.version},id))));body.append(card);}
  if(result.corrections.length){body.append(el('h3','','정정 확인 대기'));for(const row of result.corrections){const card=el('article','ce-project');card.append(el('strong','',row.displayName||'이름 확인 필요'),el('p','',row.reason),detail(ctx,'요청 시간',stamp(row.clockIn)+' → '+stamp(row.clockOut)));if(ctx.owner()){const actions=el('div','ce-actions');for(const [status,label]of [['approved','정정 승인'],['rejected','반려']])actions.append(button(label,()=>save(ctx,'peopleCorrectionDecide',{id:row.id,expectedVersion:row.version,status})));card.append(actions);}body.append(card);}}
 }
 function leaves(body,ctx,result){const {el,button}=ctx,actions=el('div','ce-actions');actions.append(button('휴가 신청',()=>form(ctx,'휴가 신청',[
  {key:'kind',label:'휴가 종류',options:Object.entries(kinds)},{key:'startDate',label:'시작일',type:'date',value:result.today},{key:'endDate',label:'종료일',type:'date',value:result.today},{key:'days',label:'사용할 일수 (휴무일 제외)',type:'number',step:.5,min:.5,max:366},{key:'reason',label:'신청 메모',multiline:true,required:false}
 ],(v,id)=>save(ctx,'peopleLeaveRequest',v,id))));
  if(ctx.owner())actions.append(button('휴가 부여 설정',()=>{const people=ctx.staff();if(!people.length){ctx.message('직원 목록 확인 후 다시 열어 주세요.',true);return;}form(ctx,'회사에서 확인한 휴가 부여 일수',[
   {key:'uid',label:'직원',options:people.map(p=>[p.uid,p.displayName||p.uid])},{key:'granted',label:'부여 일수',type:'number',step:.5},{key:'carried',label:'이월 일수',type:'number',step:.5},{key:'adjustment',label:'조정 일수',type:'number',step:.5,min:-366},{key:'reason',label:'부여·조정 근거',multiline:true}
  ],(v,id)=>{const year=month.slice(0,4),prior=result.balances.find(b=>b.uid===v.uid&&b.year===year);return save(ctx,'peopleBudgetSave',{...v,year,expectedVersion:prior?.version||0},id);});}));body.append(actions);
  for(const b of result.balances){const name=ctx.staff().find(s=>s.uid===b.uid)?.displayName||(b.uid===root.AiselAccess.session.uid?'내 휴가':'직원'),card=el('div','ce-project');card.append(el('h3','',name+' · '+b.year),el('p','',b.configured?'부여 '+b.granted+'일 · 이월 '+b.carried+'일 · 조정 '+b.adjustment+'일 · 승인 사용 '+b.used+'일 · 잔여 '+b.remaining+'일':'회사 휴가 부여 기준 확인 전'));body.append(card);}
  if(!result.leaves.length)body.append(el('p','ce-empty','이 기간의 휴가 신청이 없습니다.'));
  for(const row of result.leaves){const card=el('article','ce-project');card.append(el('h3','',[row.displayName||'이름 확인 필요',kinds[row.kind],states[row.status]].join(' · ')),el('p','',row.startDate+' ~ '+row.endDate+' · '+row.days+'일'));if(row.reason)card.append(el('p','ce-muted',row.reason));const controls=el('div','ce-actions');if(ctx.owner()&&['pending','cancellation_requested'].includes(row.status)){const choices=row.status==='pending'?[['approved','승인'],['rejected','반려']]:[['cancelled','취소 승인'],['approved','기존 승인 유지']];for(const [status,label]of choices)controls.append(button(label,()=>save(ctx,'peopleLeaveDecide',{id:row.id,expectedVersion:row.version,status})));}if(row.uid===root.AiselAccess.session.uid&&['pending','approved'].includes(row.status))controls.append(button(row.status==='approved'?'취소 요청':'신청 취소',()=>save(ctx,'peopleLeaveCancel',{id:row.id,expectedVersion:row.version})));card.append(controls);body.append(card);}
 }
 root.AiselCompanyPeople={render,reset};
})(window);
