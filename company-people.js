(function(root){
 'use strict';
 let data=null,scope='',loadedAt=0,flight=null,month='',all=true,queryKey='',attendanceView='today',leaveMode=false,leaveView='usage',adminLeaveView='summary',employeeFilter='',leaveStatus='',revision=0;
 const leaveCache=new Map();
 const dayKey=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const states={working:'근무 중',completed:'퇴근',corrected:'정정 승인',pending:'신청',approved:'승인',rejected:'반려',cancelled:'취소',cancellation_requested:'취소 요청'};
 const kinds={annual:'연차',half:'반차',other:'기타 휴가'};
 const errors={leave_application_required:'부서·직급·연락처·사용사유·인수인계 내용을 확인해 주세요.',already_clocked_today:'오늘 출퇴근 기록이 있습니다. 수정이 필요하면 정정을 요청해 주세요.',already_clocked_out:'이미 퇴근이 기록되었습니다.',invalid_break_minutes:'휴게시간을 실제 근무 시간 안에서 분 단위로 입력해 주세요.',correction_required:'출근 기록이 오래되었습니다. 실제 시간을 정정 요청으로 기록해 주세요.',invalid_correction:'출근·퇴근·휴게시간을 확인해 주세요. 미래 시각은 입력할 수 없습니다.',invalid_correction_date:'기존 근무일에 해당하는 출근 시각을 입력해 주세요.',correction_pending:'확인 대기 중인 정정 요청이 있습니다.',leave_budget_unconfigured:'이 직원의 휴가 부여 일수를 먼저 설정해 주세요.',leave_balance_insufficient:'확인된 잔여 휴가보다 신청 일수가 많습니다.',leave_overlap:'같은 기간에 진행 중인 휴가 신청이 있습니다.',leave_dates_require_same_year:'연도가 바뀌는 휴가는 연도별로 나눠 신청해 주세요.',invalid_leave_days:'날짜와 신청 일수를 확인해 주세요. 반차는 하루 중 0.5일입니다.',version_conflict:'다른 곳에서 먼저 변경했습니다. 최신 기록을 확인한 뒤 다시 처리해 주세요.',idempotency_conflict:'이 요청은 이미 다른 내용으로 저장되었습니다. 최신 기록을 확인해 주세요.'};
 const stamp=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'미기록';
 const local=value=>value?new Date(value+9*3600000).toISOString().slice(0,16):'';
 function identity(){const s=root.AiselAccess?.session;return [s?.uid,s?.role,s?.credentialVersion||0].join(':');}
 function reset(){revision++;data=null;scope='';loadedAt=0;flight=null;queryKey='';attendanceView='today';leaveCache.clear();employeeFilter='';leaveStatus='';leaveView='usage';adminLeaveView='summary';}
 function resetManagement(){if(!leaveMode||all){reset();return;}for(const key of leaveCache.keys())if(key.includes(':true:leave'))leaveCache.delete(key);}
 root.addEventListener('aisel-access-change',()=>{if(scope!==identity())reset();});
 async function load(ctx,force=false){
  if(scope!==identity()){reset();scope=identity();}const signature=scope,run=revision,key=scope+':'+month+':'+all+':'+(leaveMode?'leave':'attendance'),cacheKey=dayKey()+':'+key,isLeave=leaveMode;
  if(queryKey!==key){data=null;flight=null;queryKey=key;}
  const cached=isLeave&&!force&&leaveCache.get(cacheKey);if(cached){data=cached.data;loadedAt=cached.at;return data;}
  if(data&&!force&&!isLeave&&Date.now()-loadedAt<60000)return data;if(flight)return flight;
  const promise=ctx.request('peopleSummary',{month,...(ctx.owner()?{all}:{})}).then(result=>{if(signature!==identity()||run!==revision||queryKey!==key)return null;data=result;loadedAt=Date.now();if(isLeave){for(const k of leaveCache.keys())if(!k.startsWith(dayKey()+':'))leaveCache.delete(k);leaveCache.set(cacheKey,{data,at:loadedAt});}return data;}).finally(()=>{if(flight===promise)flight=null;});flight=promise;return promise;
 }
 function render(section,ctx){
  const {host,el,button}=ctx;leaveMode=section!=='attendance';host.classList.toggle('ca-host',!leaveMode);host.classList.toggle('cl-host',leaveMode);if(!month)month=dayKey().slice(0,7);
  if(leaveMode)all=section==='leave'&&ctx.owner();
  const top=el('div','ce-section-heading'),title=el('div');title.append(el('h2','',section==='attendance'?'출퇴근':'휴가 관리'),el('p','ce-muted',section==='attendance'?'수동 기록 · 비콘 연결 전':all?'직원별 신청과 승인·사용 내역을 확인합니다.':'휴가 사용 내역과 남은 휴가를 확인합니다.'));top.append(title);host.append(top);
  const toolbar=el('div','ce-filters cl-toolbar'),monthInput=el('input');monthInput.type='month';monthInput.value=month;monthInput.setAttribute('aria-label','조회 월');monthInput.style.width='150px';toolbar.append(monthInput);
  if(!leaveMode&&ctx.owner()){const sel=el('select');for(const [v,t]of [['all','전체 직원'],['mine','내 기록']]){const o=el('option','',t);o.value=v;sel.append(o);}sel.value=all?'all':'mine';sel.setAttribute('aria-label','근태 조회 대상');sel.addEventListener('change',()=>{all=sel.value==='all';data=null;ctx.redraw();});toolbar.append(sel);}
  monthInput.addEventListener('change',()=>{if(!monthInput.value)return;month=monthInput.value;if(section==='attendance')attendanceView='month';data=null;ctx.redraw();});
  if(!leaveMode)toolbar.append(button('새로고침',()=>{data=null;ctx.redraw();}));
  host.append(toolbar);
  const body=el('div','cl-body');host.append(body);body.append(el('p','ce-muted','기록을 확인하고 있습니다.'));
  const scopeNow=identity();const promise=load(ctx),run=revision;promise.then(result=>{if(!result||scopeNow!==identity()||run!==revision||!body.isConnected)return;body.replaceChildren();if(section==='attendance')attendance(body,ctx,result);else leaves(body,ctx,result,all);ctx.message(leaveMode?'':'마지막 확인 '+stamp(loadedAt));}).catch(error=>{if(body.isConnected&&run===revision){body.replaceChildren(el('p','ce-empty','기록을 불러오지 못했습니다. 연결 상태를 확인해 주세요.'));ctx.message(errors[error.message]||error.message,true);}});
 }
 async function save(ctx,action,payload,requestId='people-'+root.crypto.randomUUID()){
  if(ctx.isWriting())return false;ctx.setWriting(true);const oldScope=identity();ctx.message('저장 중입니다.');
  try{await ctx.request(action,{requestId,...payload});if(oldScope!==identity())return false;leaveCache.clear();await load(ctx,true);if(oldScope!==identity())return false;ctx.setDirty(false);ctx.redraw();ctx.message('저장한 기록을 다시 확인했습니다.');return true;}
  catch(error){if(oldScope===identity())ctx.message(errors[error.message]||error.message,true);return false;}
  finally{if(oldScope===identity())ctx.setWriting(false);}
 }
 function form(ctx,title,fields,submit){const {host,el,button}=ctx;ctx.setDirty(false);ctx.message('');host.replaceChildren(el('h2','',title));const f=el('form','ce-form'),controls={};for(const s of fields){const label=el('label','ce-field',s.label),input=el(s.options?'select':s.multiline?'textarea':'input');input.name=s.key;if(s.options){for(const [v,t]of s.options){const o=el('option','',t);o.value=v;input.append(o);}}else if(!s.multiline)input.type=s.type||'text';input.value=s.value??(s.options?s.options[0][0]:'');input.required=s.required!==false;input.maxLength=s.maxLength||2000;if(s.readOnly)input.readOnly=true;if(s.type==='number'){input.min=s.min??0;input.max=s.max??366;input.step=s.step??1;}label.append(input);f.append(label);controls[s.key]=input;}const buttons=el('div','ce-actions'),ok=el('button','ce-button','저장');ok.type='submit';const cancel=button('취소',()=>{ctx.setDirty(false);ctx.redraw();});buttons.append(ok,cancel);f.append(buttons);host.append(f);f.addEventListener('input',()=>ctx.setDirty(true));const requestId='people-'+root.crypto.randomUUID();f.addEventListener('submit',async event=>{event.preventDefault();if(!f.reportValidity()||ctx.isWriting())return;const values=Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.type==='number'?Number(v.value):v.value.trim()]));ok.disabled=cancel.disabled=true;const success=await submit(values,requestId);if(!success)ok.disabled=cancel.disabled=false;});return {f,controls};}
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

 function leaveRequest(ctx,result){
  const user=root.AiselAccess.session,profile=result.leaveProfile||{},fallback={md:'MD팀',logistics:'물류팀'};
  const {f,controls}=form(ctx,'휴가 신청',[
   {key:'displayName',label:'성명',value:user.displayName||'',readOnly:true},
   {key:'department',label:'부서',value:profile.department||fallback[user.role]||'',maxLength:80},
   {key:'position',label:'직급',value:profile.position||(['md','logistics'].includes(user.role)?'사원':''),maxLength:40},
   {key:'contact',label:'연락처',type:'tel',value:profile.contact||'',maxLength:40},
   {key:'kind',label:'휴가 종류',options:Object.entries(kinds)},
   {key:'startDate',label:'시작일',type:'date',value:result.today},
   {key:'endDate',label:'종료일',type:'date',value:result.today},
   {key:'days',label:'사용일수',type:'number',step:.5,min:.5,max:366,value:1},
   {key:'reason',label:'사용사유',multiline:true},
   {key:'handover',label:'인수인계 내용',multiline:true}
  ],(v,id)=>{const {displayName,...payload}=v;return save(ctx,'peopleLeaveRequest',{...payload,formVersion:2},id);});
  f.classList.add('cl-request-form');
  const group=(keys,cls)=>{const row=ctx.el('div',cls),labels=keys.map(k=>controls[k].parentElement);labels[0].before(row);row.append(...labels);};
  group(['displayName','department','position'],'cl-person-row');
  group(['contact','kind'],'cl-contact-row');
  group(['startDate','endDate','days'],'cl-date-row');
  controls.days.setAttribute('aria-label','사용일수');controls.days.inputMode='decimal';
  controls.contact.autocomplete='tel';controls.contact.placeholder='본인 연락처';
  controls.handover.placeholder='담당자·전달할 업무 또는 없음';
  controls.days.parentElement.append(ctx.el('span','cl-day-hint','휴무일 제외'));
  controls.kind.addEventListener('change',()=>{if(controls.kind.value==='half'){controls.endDate.value=controls.startDate.value;controls.days.value='0.5';}else if(controls.days.value==='0.5')controls.days.value='1';});
  let lastStart=controls.startDate.value;
  controls.startDate.addEventListener('change',()=>{if(controls.endDate.value===lastStart||controls.endDate.value<controls.startDate.value||controls.kind.value==='half')controls.endDate.value=controls.startDate.value;lastStart=controls.startDate.value;});
 }
 function leaveBudget(ctx,result){
  const people=ctx.staff();if(!people.length){ctx.message('직원 목록을 확인하지 못했습니다. 휴가 부여 설정은 직원 목록 연결 후 사용할 수 있습니다.',true);return;}
  form(ctx,'회사에서 확인한 휴가 부여 일수',[
   {key:'uid',label:'직원',options:people.map(p=>[p.uid,p.displayName||'이름 확인 필요'])},{key:'granted',label:'부여 일수',type:'number',step:.5},{key:'carried',label:'이월 일수',type:'number',step:.5},{key:'adjustment',label:'조정 일수',type:'number',step:.5,min:-366},{key:'reason',label:'부여·조정 근거',multiline:true}
  ],(v,id)=>{const year=month.slice(0,4),prior=result.balances.find(b=>b.uid===v.uid&&String(b.year)===year);return save(ctx,'peopleBudgetSave',{...v,year,expectedVersion:prior?.version||0},id);});
 }
 function leaveTable(ctx,headers,rows,empty){
  const {el}=ctx,wrap=el('div','ce-table-scroll cl-table-scroll'),table=el('table','ce-table cl-table'),head=el('thead'),tr=el('tr'),tbody=el('tbody');
  for(const text of headers){const th=el('th','',text);th.scope='col';tr.append(th);}head.append(tr);table.append(head,tbody);
  for(const values of rows){const row=el('tr');values.forEach((value,i)=>{const td=el('td');td.dataset.label=headers[i];if(value?.nodeType)td.append(value);else td.textContent=String(value??'—');row.append(td);});tbody.append(row);}
  if(!rows.length){const tr=el('tr','cl-empty-row'),td=el('td','ce-empty',empty);td.colSpan=headers.length;tr.append(td);tbody.append(tr);}
  wrap.append(table);return wrap;
 }
 function leaves(body,ctx,result,admin){
  const {el,button}=ctx,uid=root.AiselAccess.session.uid,balances=(result.balances||[]).filter(b=>admin||b.uid===uid),allRows=(result.leaves||[]).filter(r=>admin||r.uid===uid);
  const monthRows=allRows.filter(r=>r.startDate.slice(0,7)<=month&&r.endDate.slice(0,7)>=month);
  const pending=allRows.filter(r=>['pending','cancellation_requested'].includes(r.status));
  const approved=monthRows.filter(r=>['approved','cancellation_requested'].includes(r.status));
  const byUid=new Map();
  if(admin)for(const p of ctx.staff())byUid.set(p.uid,{uid:p.uid,name:p.displayName||'이름 확인 필요'});
  for(const row of allRows)if(!byUid.has(row.uid))byUid.set(row.uid,{uid:row.uid,name:row.displayName||'이름 확인 필요'});
  for(const b of balances)if(!byUid.has(b.uid))byUid.set(b.uid,{uid:b.uid,name:b.uid===uid?(root.AiselAccess.session.displayName||'내 휴가'):'이름 확인 필요'});
  const people=[...byUid.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  const actions=el('div','ce-actions cl-actions');
  if(admin)actions.append(button('휴가 부여 설정',()=>leaveBudget(ctx,result)));
  else actions.append(button('휴가 신청',()=>leaveRequest(ctx,result),'ce-button cl-primary'));
  const toolbar=ctx.host.querySelector('.cl-toolbar');
  if(toolbar){toolbar.querySelector('.cl-actions')?.remove();toolbar.append(actions);}else body.append(actions);
  const stats=el('div','cl-stats'),addStat=(label,value,note)=>{const card=el('div','cl-stat');card.append(el('span','ce-muted',label),el('strong','',value));if(note)card.append(el('small','ce-muted',note));stats.append(card);};
  const days=v=>Number.isFinite(v)?v+'일':'확인 전';
  if(admin){
   addStat('승인 대기',pending.length+'건','다른 달의 대기 신청 포함');
   addStat('선택 월 신청',monthRows.length+'건',month+' 기간 포함');
   addStat('선택 월 승인',approved.length+'건','취소 승인 대기 포함');
   addStat('휴가 부여 확인',people.filter(p=>!balances.some(b=>b.uid===p.uid&&b.configured)).length+'명','등록 직원 기준');
  }else{
   const b=balances.find(b=>String(b.year)===month.slice(0,4));
   addStat('남은 휴가',b?.configured?days(b.remaining):'설정 전',month.slice(0,4)+'년 기준');
   addStat('부여·이월·조정',b?.configured?days(b.granted+b.carried+b.adjustment):'설정 전','회사에서 확인한 일수');
   addStat('승인 차감',b?days(b.used):'확인 전','사용 예정·취소 대기 포함');
   addStat('신청 대기',pending.length+'건','승인 결과를 기다리는 신청');
  }
  body.append(stats);
  const controls=el('div','cl-controls'),tabs=el('div','cl-tabs');tabs.setAttribute('aria-label','휴가 내역 보기');
  let current=admin?adminLeaveView:leaveView;
  const sections=admin?[['summary','직원별 현황'],['requests','신청·승인'],['usage','사용 내역']]:[['usage','사용 내역'],['requests','신청 내역']];
  const panel=el('div','cl-results');
  const setTab=value=>{current=value;if(admin)adminLeaveView=value;else leaveView=value;draw();};
  const tabButtons=sections.map(([key,label])=>{const b=button(label,()=>setTab(key));b.dataset.leaveView=key;tabs.append(b);return [key,b];});controls.append(tabs);
  let employeeSelect;
  if(admin){employeeSelect=el('select');employeeSelect.setAttribute('aria-label','휴가 직원 필터');const option=el('option','','전체 직원');option.value='';employeeSelect.append(option);for(const p of people){const o=el('option','',p.name);o.value=p.uid;employeeSelect.append(o);}if(!byUid.has(employeeFilter))employeeFilter='';employeeSelect.value=employeeFilter;employeeSelect.addEventListener('change',()=>{employeeFilter=employeeSelect.value;draw();});controls.append(employeeSelect);}
  const statusSelect=el('select');statusSelect.setAttribute('aria-label','휴가 상태 필터');for(const [v,t]of [['','전체 상태'],...Object.entries(states).filter(([k])=>['pending','approved','rejected','cancelled','cancellation_requested'].includes(k))]){const o=el('option','',t);o.value=v;statusSelect.append(o);}statusSelect.value=leaveStatus;statusSelect.addEventListener('change',()=>{leaveStatus=statusSelect.value;draw();});controls.append(statusSelect);
  body.append(controls,panel);
  function draw(){
   for(const [key,b]of tabButtons)b.setAttribute('aria-pressed',String(key===current));statusSelect.hidden=current==='summary';
   panel.replaceChildren();const matches=r=>!admin||!employeeFilter||r.uid===employeeFilter;
   if(current==='summary'){
    panel.append(el('h3','','직원별 휴가 신청 현황'));
    const rows=people.filter(p=>!employeeFilter||p.uid===employeeFilter).map(p=>{
     const b=balances.find(b=>b.uid===p.uid),monthRecords=monthRows.filter(r=>r.uid===p.uid),wait=pending.filter(r=>r.uid===p.uid);
     const name=button(p.name,()=>{employeeFilter=p.uid;employeeSelect.value=p.uid;setTab('requests');},'ce-button cl-name');
     return [name,monthRecords.length+'건',wait.length+'건',b?days(b.used):'확인 전',b?.configured?days(b.remaining):'설정 전',b?.configured?'설정 완료':'부여 확인 필요'];
    });
    panel.append(leaveTable(ctx,['직원','선택 월 신청','승인 대기','올해 승인 차감','남은 휴가','부여 상태'],rows,'등록된 직원과 신청 기록이 아직 없습니다.'));
    panel.append(el('p','ce-muted cl-footnote','직원 이름을 누르면 해당 직원의 신청을 확인할 수 있습니다. 승인 차감은 해당 연도의 사용 예정 휴가도 포함합니다.'));
    return;
   }
   let rows=(current==='usage'?approved:allRows.filter(r=>monthRows.includes(r)||pending.includes(r))).filter(matches).filter(r=>!leaveStatus||r.status===leaveStatus).sort((a,b)=>b.startDate.localeCompare(a.startDate)||(b.createdAt||0)-(a.createdAt||0));
   panel.append(el('h3','',current==='usage'?'휴가 사용 내역':'휴가 신청·승인 내역'));
   if(current==='usage')panel.append(el('p','ce-muted cl-footnote',month+' 승인된 휴가 · 미래 일정은 사용 예정으로 표시합니다.'));
   const output=rows.map(row=>{
    const actions=el('div','ce-actions cl-row-actions');
    if(admin&&['pending','cancellation_requested'].includes(row.status)){const choices=row.status==='pending'?[['approved','승인'],['rejected','반려']]:[['cancelled','취소 승인'],['approved','기존 승인 유지']];for(const [status,label]of choices)actions.append(button(label,()=>save(ctx,'peopleLeaveDecide',{id:row.id,expectedVersion:row.version,status}),status==='approved'?'ce-button cl-primary':'ce-button'));}
    if(!admin&&row.uid===uid&&['pending','approved'].includes(row.status))actions.append(button(row.status==='approved'?'취소 요청':'신청 취소',()=>save(ctx,'peopleLeaveCancel',{id:row.id,expectedVersion:row.version})));
    const state=current==='usage'&&row.status==='approved'?(row.startDate>result.today?'사용 예정':row.endDate<result.today?'사용 완료':'사용 중'):(states[row.status]||'상태 확인');
    const badge=el('span','cl-badge cl-'+row.status,state);
    const dates=row.startDate===row.endDate?row.startDate:row.startDate+' ~ '+row.endDate;
    const application=el('div','cl-application-details');for(const [label,value]of [['부서 / 직급',[row.department,row.position].filter(Boolean).join(' / ')],['연락처',row.contact],['사용사유',row.reason],['인수인계 내용',row.handover],['처리 메모',row.decisionNote]])if(value)application.append(detail(ctx,label,value));
    return [...(admin?[row.displayName||byUid.get(row.uid)?.name||'이름 확인 필요']:[]),kinds[row.kind]||'종류 확인',dates,days(row.days),badge,application.childElementCount?application:'—',actions];
   });
   panel.append(leaveTable(ctx,[...(admin?['직원']:[]),'종류','기간','일수','상태','신청 내용','처리'],output,current==='usage'?'이 달에 승인된 휴가 사용 내역이 없습니다.':'해당 조건의 휴가 신청이 없습니다.'));
  }
  draw();
 }
 root.AiselCompanyPeople={render,reset,resetManagement};
})(window);

