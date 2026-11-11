(function(root){
 'use strict';
 let data=null,scope='',loadedAt=0,flight=null,month='',all=true,queryKey='',attendanceView='today';
 const states={working:'근무 중',completed:'퇴근',corrected:'정정 승인',pending:'신청',approved:'승인',rejected:'반려',cancelled:'취소',cancellation_requested:'취소 요청'};
 const kinds={annual:'연차',half:'반차',other:'기타 휴가'};
 const errors={already_clocked_today:'오늘 출퇴근 기록이 있습니다. 수정이 필요하면 정정을 요청해 주세요.',already_clocked_out:'이미 퇴근이 기록되었습니다.',invalid_break_minutes:'휴게시간을 실제 근무 시간 안에서 분 단위로 입력해 주세요.',correction_required:'출근 기록이 오래되었습니다. 실제 시간을 정정 요청으로 기록해 주세요.',invalid_correction:'출근·퇴근·휴게시간을 확인해 주세요. 미래 시각은 입력할 수 없습니다.',invalid_correction_date:'기존 근무일에 해당하는 출근 시각을 입력해 주세요.',correction_pending:'확인 대기 중인 정정 요청이 있습니다.',leave_budget_unconfigured:'이 직원의 휴가 부여 일수를 먼저 설정해 주세요.',leave_balance_insufficient:'확인된 잔여 휴가보다 신청 일수가 많습니다.',leave_overlap:'같은 기간에 진행 중인 휴가 신청이 있습니다.',leave_dates_require_same_year:'연도가 바뀌는 휴가는 연도별로 나눠 신청해 주세요.',invalid_leave_days:'날짜와 신청 일수를 확인해 주세요. 반차는 하루 중 0.5일입니다.',version_conflict:'다른 곳에서 먼저 변경했습니다. 최신 기록을 확인한 뒤 다시 처리해 주세요.',idempotency_conflict:'이 요청은 이미 다른 내용으로 저장되었습니다. 최신 기록을 확인해 주세요.'};
 const stamp=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'미기록';
 const local=value=>value?new Date(value+9*3600000).toISOString().slice(0,16):'';
 function identity(){const s=root.AiselAccess?.session;return [s?.uid,s?.role,s?.credentialVersion||0].join(':');}
 function reset(){data=null;scope='';loadedAt=0;flight=null;queryKey='';attendanceView='today';}
 root.addEventListener('aisel-access-change',()=>{if(scope!==identity())reset();});
 async function load(ctx,force=false){
  if(scope!==identity()){reset();scope=identity();}const signature=scope,key=scope+':'+month+':'+all;
  if(queryKey!==key){data=null;flight=null;queryKey=key;}
  if(data&&!force&&Date.now()-loadedAt<60000)return data;if(flight)return flight;
  const promise=ctx.request('peopleSummary',{month,...(ctx.owner()?{all}:{})}).then(result=>{if(signature!==identity()||queryKey!==key)return null;data=result;loadedAt=Date.now();return data;}).finally(()=>{if(flight===promise)flight=null;});flight=promise;return promise;
 }
 function render(section,ctx){
  const {host,el,button}=ctx;host.classList.toggle('ca-host',section==='attendance');if(!month)month=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
  const top=el('div','ce-section-heading'),title=el('div');title.append(el('h2','',section==='attendance'?'출퇴근':'휴가 관리'),el('p','ce-muted',section==='attendance'?'수동 기록 · 비콘 연결 전':'신청·승인·사용 내역과 회사가 등록한 부여 일수를 확인합니다.'));top.append(title);host.append(top);
  const toolbar=el('div','ce-filters'),monthInput=el('input');monthInput.type='month';monthInput.value=month;monthInput.setAttribute('aria-label','조회 월');monthInput.style.width='150px';toolbar.append(monthInput);
  if(ctx.owner()){const sel=el('select');for(const [v,t]of [['all','전체 직원'],['mine','내 기록']]){const o=el('option','',t);o.value=v;sel.append(o);}sel.value=all?'all':'mine';sel.setAttribute('aria-label','근태 조회 대상');sel.addEventListener('change',()=>{all=sel.value==='all';data=null;ctx.redraw();});toolbar.append(sel);}
  monthInput.addEventListener('change',()=>{if(!monthInput.value)return;month=monthInput.value;if(section==='attendance')attendanceView='month';data=null;ctx.redraw();});toolbar.append(button('새로고침',()=>{data=null;ctx.redraw();}));host.append(toolbar);
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
 // Attendance uses the existing authenticated people service. Beacon reception is not enabled here.
 function minutes(value){return Number.isFinite(value)&&value>=0?Math.floor(value/60)+'시간 '+(value%60)+'분':'미확정';}
 function attendanceCsv(rows){
  const cell=value=>{let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
 }
 function downloadAttendance(ctx,name,rows){
  try{const url=root.URL.createObjectURL(new root.Blob([attendanceCsv(rows)],{type:'text/csv;charset=utf-8'})),a=ctx.el('a');a.href=url;a.download=name;a.hidden=true;ctx.host.append(a);a.click();a.remove();root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);ctx.message('CSV 파일을 내려받았습니다.');}
  catch{ctx.message('파일을 내려받지 못했습니다. 브라우저의 다운로드 설정을 확인해 주세요.',true);}
 }
 function requestAttendanceCorrection(ctx,row){
  form(ctx,'시간 정정 요청',[
   {key:'clockIn',label:'출근 시각 (한국시간)',type:'datetime-local',value:local(row.clockIn)},
   {key:'clockOut',label:'퇴근 시각 (한국시간)',type:'datetime-local',value:local(row.clockOut)},
   {key:'breakMinutes',label:'실제 휴게시간(분)',type:'number',max:2160,value:row.breakMinutes??''},
   {key:'reason',label:'정정 사유',multiline:true}
  ],(v,id)=>save(ctx,'peopleCorrectionRequest',{...v,clockIn:v.clockIn+':00+09:00',clockOut:v.clockOut+':00+09:00',attendanceId:row.id,expectedVersion:row.version},id));
 }
 function attendance(body,ctx,result){
  const {el,button}=ctx,user=root.AiselAccess.session,rows=result.attendance||[],corrections=result.corrections||[];
  const open=rows.find(r=>r.uid===user.uid&&!r.clockOut),mineToday=rows.find(r=>r.uid===user.uid&&r.date===result.today);
  const wrap=el('div','ca-workspace'),actions=el('div','ce-actions ca-actions');body.append(wrap);
  const clockIn=button('출근 기록',()=>save(ctx,'peopleClockIn',{}));clockIn.disabled=!!(open||mineToday);actions.append(clockIn);
  const clockOut=button('퇴근 기록',()=>form(ctx,'퇴근 기록',[{key:'breakMinutes',label:'오늘 실제 휴게시간(분)',type:'number',max:2160}],(v,id)=>save(ctx,'peopleClockOut',{id:open.id,expectedVersion:open.version,...v},id)));clockOut.disabled=!open;actions.append(clockOut);
  actions.append(el('span','ce-muted',open?'내 출근 '+stamp(open.clockIn):mineToday?'오늘 출퇴근 기록 완료':'내 출근 미기록'));wrap.append(actions);
  const nav=el('div','ca-tabs');nav.setAttribute('role','group');nav.setAttribute('aria-label','출퇴근 보기');wrap.append(nav);
  const panel=el('section','ca-panel');panel.setAttribute('aria-label','출퇴근 상세');wrap.append(panel);
  const tabs=[['today','오늘 현황'],['month','월별 기록'],['corrections','정정 요청'],['prepare','비콘·서식']];
  const buttons=new Map();
  for(const [key,label]of tabs){const b=button(label,()=>{
   if(key==='today'&&month!==result.today.slice(0,7)){attendanceView='today';month=result.today.slice(0,7);data=null;ctx.redraw();return;}
   attendanceView=key;draw();
  });b.dataset.attendanceView=key;buttons.set(key,b);nav.append(b);}
  function draw(){
   for(const [key,b]of buttons)b.setAttribute('aria-pressed',String(key===attendanceView));panel.replaceChildren();
   if(attendanceView==='prepare'){attendancePreparation(panel,ctx);return;}
   if(attendanceView==='corrections'){attendanceCorrections(panel,ctx,rows,corrections);return;}
   const todayView=attendanceView==='today',base=rows.filter(r=>todayView?r.date===result.today:String(r.date).startsWith(month+'-'));
   const headline=el('div','ca-headline');headline.append(el('h3','',todayView?result.today+' · 오늘 현황':month+' · 월별 기록'));
   const search=el('input');search.type='search';search.placeholder='이름 검색';search.setAttribute('aria-label','출퇴근 이름 검색');headline.append(search);panel.append(headline);
   const content=el('div');panel.append(content);
   function paint(){
    content.replaceChildren();const needle=search.value.trim().toLocaleLowerCase(),selected=base.filter(r=>String(r.displayName||'').toLocaleLowerCase().includes(needle));
    const done=selected.filter(r=>r.clockOut),confirmed=done.filter(r=>Number.isFinite(r.workMinutes)&&r.workMinutes>=0),stats=el('div','ca-stats');
    const values=todayView?[
     ['출근 기록',new Set(selected.map(r=>r.uid)).size+'명'],['근무 중',new Set(selected.filter(r=>!r.clockOut).map(r=>r.uid)).size+'명'],['퇴근 기록',new Set(done.map(r=>r.uid)).size+'명'],['정정 대기',corrections.filter(r=>String(r.displayName||'').toLocaleLowerCase().includes(needle)).length+'건']
    ]:[['출근 기록',selected.length+'건'],['퇴근 미기록',selected.filter(r=>!r.clockOut).length+'건'],['확정 근무',minutes(confirmed.reduce((n,r)=>n+r.workMinutes,0))],['정정 승인',selected.filter(r=>r.status==='corrected').length+'건']];
    for(const [label,value]of values){const card=el('div','ca-stat');card.append(el('span','ce-muted',label),el('strong','',value));stats.append(card);}content.append(stats);
    content.append(el('p','ce-muted ca-note',todayView?'기록이 있는 직원만 집계합니다. 정정 대기는 조회 월과 관계없는 전체 대기 건입니다.':'확정 근무는 퇴근과 근무시간이 기록된 건의 합계입니다. 진행 중인 근무는 제외합니다.'));
    const exportBar=el('div','ca-export');const download=button('기록 내려받기',()=>downloadAttendance(ctx,'에이슬_출퇴근_'+(todayView?result.today:month)+'.csv',[
     ['근무일','이름','출근(한국시간)','퇴근(한국시간)','휴게(분)','근무(분)','상태','확인 방식'],
     ...selected.map(r=>[r.date,r.displayName,local(r.clockIn).replace('T',' '),local(r.clockOut).replace('T',' '),r.breakMinutes??'',r.workMinutes??'',states[r.status]||'확인 필요','비콘 확인 없음'])
    ]));download.disabled=!selected.length;exportBar.append(download);content.append(exportBar);
    attendanceTable(content,ctx,selected,corrections);
    const oldOpen=rows.filter(r=>!r.clockOut&&r.date<result.today&&String(r.displayName||'').toLocaleLowerCase().includes(needle));
    if(todayView&&oldOpen.length){const old=el('div','ca-card');old.append(el('h3','','이전 출근 · 퇴근 확인 필요'),el('p','ce-muted','이 기록은 오늘 출근 인원에 포함하지 않습니다. 실제 시간을 정정 요청해 주세요.'));attendanceTable(old,ctx,oldOpen,corrections);content.append(old);}
    content.append(el('p','ce-muted ca-note','근무기준 설정 전에는 지각·결근·연장근무를 자동 판정하지 않습니다.'));
   }
   search.addEventListener('input',paint);paint();
  }
  draw();
 }
 function attendanceTable(host,ctx,rows,corrections){
  const {el,button}=ctx;if(!rows.length){host.append(el('p','ce-empty','조회 조건에 맞는 출퇴근 기록이 없습니다.'));return;}
  const table=el('table','ca-table'),caption=el('caption','ca-sr-only','출퇴근 기록 · 한국시간'),head=el('thead'),tr=el('tr'),labels=['근무일','이름','출근','퇴근','휴게 / 근무','상태','정정'];
  for(const label of labels){const th=el('th','',label);th.scope='col';tr.append(th);}head.append(tr);table.append(caption,head);const tbody=el('tbody');
  for(const row of [...rows].sort((a,b)=>(b.clockIn||0)-(a.clockIn||0))){
   const line=el('tr'),pending=corrections.some(r=>r.attendanceId===row.id),values=[row.date,row.displayName||'이름 확인 필요',stamp(row.clockIn),stamp(row.clockOut),row.breakMinutes==null?'퇴근 때 기록':row.breakMinutes+'분 / '+minutes(row.workMinutes),pending?'정정 대기':states[row.status]||'확인 필요'];
   values.forEach((value,i)=>{const td=el('td','',value);td.dataset.label=labels[i];line.append(td);});
   const controls=el('td');controls.dataset.label='정정';
   if(row.uid===root.AiselAccess.session.uid||ctx.owner()){const edit=button(pending?'확인 대기':'시간 정정 요청',()=>requestAttendanceCorrection(ctx,row));edit.disabled=pending;controls.append(edit);}else controls.textContent='—';
   line.append(controls);tbody.append(line);
  }
  table.append(tbody);host.append(table);
 }
 function attendanceCorrections(host,ctx,rows,corrections){
  const {el,button}=ctx;host.append(el('h3','','정정 확인 대기 · '+corrections.length+'건'),el('p','ce-muted ca-note','기존 기록의 출근·퇴근·휴게시간을 요청하고 관리자가 승인합니다. 하루 전체가 빠졌다면 비콘·서식의 누락·정정 신청서를 사용해 주세요.'));
  if(!corrections.length){host.append(el('p','ce-empty','확인 대기 중인 정정 요청이 없습니다.'));return;}
  for(const row of corrections){const before=rows.find(r=>r.id===row.attendanceId),card=el('article','ca-card');card.append(el('h3','',row.displayName||'이름 확인 필요'));
   card.append(detail(ctx,'기존 기록',before?stamp(before.clockIn)+' → '+stamp(before.clockOut)+' · 휴게 '+(before.breakMinutes==null?'미기록':before.breakMinutes+'분'):'해당 근무월에서 원본 기록 확인'),detail(ctx,'요청 시간',stamp(row.clockIn)+' → '+stamp(row.clockOut)+' · 휴게 '+row.breakMinutes+'분'),detail(ctx,'신청 사유',row.reason||''));
   if(ctx.owner()){const actions=el('div','ce-actions');for(const [status,label]of [['approved','정정 승인'],['rejected','반려']])actions.append(button(label,()=>save(ctx,'peopleCorrectionDecide',{id:row.id,expectedVersion:row.version,status})));card.append(actions);}host.append(card);
  }
 }
 function attendancePreparation(host,ctx){
  const {el,button}=ctx;
  const status=el('div','ca-card');status.append(el('h3','','E7 비콘 · 구매 완료'),el('p','','도착 후 설치 위치와 휴대폰 인식을 확인합니다. 자동 출퇴근은 아직 연결되지 않았습니다.'));
  const link=el('a','ce-link','구매한 비콘');link.href='https://www.coupang.com/vp/products/4798909622?itemId=6157838723&vendorItemId=73454074694';link.target='_blank';link.rel='noopener noreferrer';status.append(link);host.append(status);
  host.append(el('p','ce-muted ca-note','아래 서식은 내려받아 작성하는 준비용 파일입니다. ERP에 자동 등록되거나 근무시간에 반영되지 않습니다.'));
  const templates=[
   ['누락·정정 신청서','하루 전체 누락, 외근, 휴대폰 오류 등 확인이 필요한 기록을 모읍니다.','누락_정정신청서',[
    ['신청일','이름','근무일','실제 출근(한국시간)','실제 퇴근(한국시간)','실제 휴게(분)','요청 종류','사유·확인 근거','관리자 확인','처리일'],['','','','','','','','','','']
   ]]
  ];
  if(ctx.owner())templates.unshift(
   ['직원·근무기준표','근무지, 근무요일, 기준 출퇴근시간, 휴게시간과 휴대폰 종류를 정리합니다.','직원_근무기준표',[
    ['직원번호(선택)','이름','근무지','근무요일','기준 출근','기준 퇴근','휴게시간(분)','적용 시작일','휴대폰 종류(아이폰/안드로이드)','확인 메모'],['','','','','','','','','','']
   ]],
   ['비콘 설치대장','도착 후 기기별 설치 위치와 식별값을 적습니다. 설정 비밀번호는 적지 않습니다.','비콘_설치대장',[
    ['모델','설치 장소','설치 위치','기기 일련번호','UUID','Major','Minor','설치일','설치 담당','확인 상태'],['E7','','','','','','','','','구매 완료·설치 전']
   ]],
   ['비콘 시험표','실내·실외, 화면 잠금, 권한 해제, 통신 끊김을 시험하고 실제 결과를 남깁니다.','비콘_시험표',[
    ['시험 항목','확인할 내용','휴대폰 종류','시험일','관측 결과','판정','후속 조치'],
    ['사무실 안 도착','실제 도착 시각과 기록 시각의 차이','','','','',''],
    ['건물 밖·옆 사무실','밖에서 잘못 출근 처리되지 않는지','','','','',''],
    ['화면 잠금·백그라운드','잠금 상태에서도 감지되는지와 지연','','','','',''],
    ['블루투스·권한 해제','연결 문제를 안내하고 근무기록을 임의 확정하지 않는지','','','','',''],
    ['점심·잠깐 외출','일시 이탈을 퇴근으로 확정하지 않는지','','','','',''],
    ['통신 끊김·재전송','복구 후 시각 확인과 중복 기록 방지','','','','',''],
    ['자정 넘어 퇴근','전날 근무에 연결되는지','','','','',''],
    ['휴대폰 미소지·대리 소지','기기 감지만으로 본인을 입증할 수 없는 한계와 운영 기준','','','','','']
   ]]
  );
  const cards=el('div','ca-templates');
  for(const [title,description,name,rows]of templates){const card=el('article','ca-card');card.append(el('h3','',title),el('p','ce-muted',description),button('서식 내려받기',()=>downloadAttendance(ctx,'에이슬_'+name+'.csv',rows)));cards.append(card);}host.append(cards);
  const next=el('div','ca-card');next.append(el('h3','','도착 후 확인할 것'),el('p','','설치할 사무실 · 직원 휴대폰 종류 · 실제 출퇴근 인식 · 오류 시 정정 처리'),el('p','ce-muted','실제 기기 시험과 기존 기록 비교를 마친 뒤 오션 관리자 해지 여부를 정합니다.'));host.append(next);
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

