/* Reference usage is independent of content and deletion. No polling or AI calls. */
(function(root){
 'use strict';
 const PATH='aiselGallery/v1/referenceLifecycle',labels={active:'사용 전',used:'활용 완료',stored:'보관'};
 let rows={},ready=false,scope='',epoch=0,ref=null,listener=null,flight=null,onChange=()=>{},onError=()=>{};
 const pending=new Map(),clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
 const user=()=>root.AiselAuth?.currentUser?.();
 const identity=()=>[user()?.uid,root.AiselAuth?.generation].join('|');
 const fail=message=>Object.assign(Error(message),{code:'lifecycle_conflict'});
 async function context(){
  const stamp=identity(),person=user();
  if(!person?.uid||!person.emailVerified)throw fail('로그인 후 자료를 정리해주세요.');
  const grant=await root.AiselGalleryIndex.authorize('references');
  if(identity()!==stamp||grant.uid!==person.uid)throw fail('로그인 계정이 변경되었습니다.');
  const app=(root.firebase?.apps||[]).find(a=>a.name!=='[DEFAULT]'&&a.options.projectId==='aisel-workorder'&&a.auth().currentUser?.uid===person.uid);
  if(!app)throw fail('저장 연결을 확인해주세요.');
  return {stamp,person,grant,app};
 }
 function stop(){epoch++;if(ref&&listener)ref.off('value',listener);ref=null;listener=null;flight=null;}
 function reset(){stop();rows={};ready=false;scope='';pending.clear();onChange();}
 async function start(changed,error){
  onChange=changed||onChange;onError=error||onError;
  if(scope!==identity()){stop();rows={};ready=false;scope=identity();}
  if(flight)return flight;if(listener)return Promise.resolve();
  const selection=++epoch;
  flight=(async()=>{
   const ctx=await context();if(selection!==epoch)return;
   ref=ctx.app.database().ref(PATH);
   await new Promise((resolve,reject)=>{
    listener=snapshot=>{if(selection!==epoch||ctx.stamp!==identity())return;const incoming=snapshot.val()||{};for(const id of pending.keys()){if(rows[id])incoming[id]=rows[id];else delete incoming[id];}rows=incoming;ready=true;resolve();onChange();};
    ref.on('value',listener,e=>{if(selection!==epoch)return;stop();ready=false;onError(Error('활용 기록을 불러오지 못했습니다. 다시 연결해주세요.'));reject(e);});
   });
  })();
  try{await flight;}catch(e){if(selection===epoch){stop();ready=false;throw e;}}finally{if(selection===epoch)flight=null;}
 }
 function get(id){return clone(rows[id]||{version:0,status:'active',note:'',resultUrl:'',history:{}});}
 function status(id){return get(id).status||'active';}
 function canEdit(record){const p=user();return ready&&!record?false:ready&&!!p&&(root.AiselAccess?.isOwner===true||record?.permissions?.canEdit===true||String(record?.creator||'').toLowerCase()===String(p.email||'').toLowerCase());}
 async function change(id,next,options={}){
  if(!/^ref_[-\w]{8,96}$/.test(id)||!Object.hasOwn(labels,next))throw fail('자료를 확인해주세요.');
  if(pending.has(id))throw fail('저장 중입니다. 잠시 기다려주세요.');
  if(!ready)throw fail('활용 기록을 불러온 뒤 다시 시도해주세요.');
  const expected=options.expectedVersion??get(id).version;
  const note=options.note===undefined?get(id).note:String(options.note).trim();
  const resultUrl=options.resultUrl===undefined?get(id).resultUrl:String(options.resultUrl).trim();
  if(note.length>2000||resultUrl.length>2048||resultUrl&&!/^https?:\/\/\S+$/i.test(resultUrl))throw fail('결과물 링크는 http 또는 https 주소로 입력해주세요.');
  const request=Symbol(id);pending.set(id,request);onChange();
  try{
   const ctx=await context();if(ctx.stamp!==scope)throw fail('로그인 계정이 변경되었습니다.');
   const now=root.firebase.database.ServerValue.TIMESTAMP;
   if(ctx.stamp!==identity()||get(id).version!==expected)throw fail('다른 곳에서 기록이 바뀌었습니다. 최신 기록을 확인한 뒤 다시 시도해주세요.');
   const version=expected+1,from=get(id).status||'active',target=ctx.app.database().ref(PATH+'/'+id);
   // Atomic leaf update: existing history is never sent back or overwritten.
   // Parent validation rejects stale versions, including concurrent devices.
   await target.update({version,status:next,updatedAt:now,updatedBy:ctx.person.uid,updatedByEmail:ctx.person.email,note:note||'',resultUrl:resultUrl||'',['history/e'+version]:{from,to:next,at:now,uid:ctx.person.uid,email:ctx.person.email}});
   if(ctx.stamp!==identity())throw fail('로그인 계정이 변경되었습니다.');
   const saved=(await target.once('value')).val();
   if(ctx.stamp!==identity())throw fail('로그인 계정이 변경되었습니다.');
   if(!saved||saved.version<version)throw fail('저장된 기록을 다시 확인해주세요.');
   rows[id]=saved;onChange();return clone(saved);
  }catch(e){if(e.code==='lifecycle_conflict')throw e;throw Error('기록 저장을 확인하지 못했습니다. 자료를 그대로 두었습니다. 다시 시도해주세요.');}
  finally{if(pending.get(id)===request)pending.delete(id);onChange();}
 }
 root.addEventListener('aisel-session-change',reset);
 root.AiselReferenceLifecycle=Object.freeze({start,stop,reset,get,status,change,canEdit,labels,isPending:id=>pending.has(id),get ready(){return ready;}});
})(window);

/* AISEL reference collection: compact content/product library; existing server authorization and saves are preserved. */
(function(){
  'use strict';
  const fields=['title'];
  let draftWrites=Promise.resolve();const draftRecordWrites=new Map();const draftFileKeys=new WeakMap(),draftPreviews=new WeakMap();
  let draftRows=new Map(),draftRead=0,accessAt=0,accessFlight=null,listFlight=null,createFlight=false,openEpoch=0,listReadAt=0,detailLoading=null;
  const detailCache=new Map(),detailFlights=new Map(),LIST_TTL=30000,DETAIL_TTL=60000;
  let galleryModule=null,galleryUnsubscribe=null,galleryState=null,galleryEpoch=0,galleryOwned=false,preloadFlight=null;
  let designerUnsubscribe=null,designerPicker=null,designerFilterPicker=null,designerPickerIdentity='',workorderFlight=null,dateFilterPicker=null;
  let categoryUnsubscribe=null,categoryFilterPicker=null,categoryCoverageFlight=null,summaryPhotoPreview=null;const categoryCoverageErrors=new Set(),notePickers=new Map(),reviewSourceKeys=new Map(),productReviews=new Map();
  const timings={},composing=new Set(),previewUrls=new Map(),uploadedPreviews=new Map();let linkEditor=null,noteRenderId='',suppressPhotoClickUntil=0;
  let viewStartedAt=0;const measuredViewPhases=new Set();
  function measureListPhase(name,start=viewStartedAt){if(!start||start!==viewStartedAt||measuredViewPhases.has(name)||!visible||pane.hidden||$('#rcList').hidden)return;measuredViewPhases.add(name);timings[name==='first-cards'?'firstCardsMs':'firstPreviewMs']=Math.round(performance.now()-start);try{performance.clearMeasures('aisel:reference:'+name);performance.measure('aisel:reference:'+name,{start,end:performance.now()});}catch(_){}}
  async function timed(name,task){const start=performance.now();try{return await task();}finally{timings[name]=Math.round(performance.now()-start);}}
  let photoSignature='',autoSaveTimer=null,localOnly=false,selectedPhoto=0,photoMode='append',replaceHash=null;
  const AI=window.AiselReferenceAnalysis,SaveCore=window.AiselReferenceSave;
  let activeBase=null,pendingSave=null,saveConflict=null;
  const saveStatuses=new Map();
  const categories={content:'콘텐츠',product:'제품',marketing:'마케팅',idea:'아이디어'};
  let referenceCategoryUnsubscribe=null,referenceCategoryPicker=null,referenceCategoryIdentity='',topCategory='content',topCategorySignature='',referenceCategoriesSignature='';
  const clone=v=>JSON.parse(JSON.stringify(v));
  const http=v=>{try{const u=new URL(String(v||''));return /^https?:$/.test(u.protocol)?u.href:'';}catch(_){return '';}};
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let config={},pane,role=null,permissions={},account='',active=null,dirty=false,revision=0,visible=false,authEpoch=0,authorizedStamp=null,showEpoch=0;
  let records=new Map(),cursor=null,checkedAt='',initialized=false,loading=false,saveFlight=null,photoFlight=null;
  let draftStored=true;
  let galleryScroll=0,gallerySignature='',pendingFiles=[],objectUrls=[],draftDb=null,draftTimer=null;
  const $=s=>pane.querySelector(s);

  // SOURCING_NAV_START: navigation metadata only; Google controls document access.
  const sourcingLatest='https://docs.google.com/presentation/d/1sfjYP5JImXIxGhDv8sPzvIRWhP1MsniXv8QSq3qvOB0/edit';
  const sourcingSheet='https://docs.google.com/spreadsheets/d/1T0ZMTgXfY4mnqVL7yJBDxPZWHJ9B-bBfl_f_xMYj2Xc/edit';
  const sourcingCacheKey='aisel:sourcing-navigation:daily:v1';
  let sourcingFlight=null,sourcingMemory=null,sourcingSignature='';
  let sourcingTargets=new Map([['latest',sourcingLatest],['sheet',sourcingSheet]]);
  function sourcingDay(){return new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);}
  function sourcingGoogleUrl(value,kind='presentation'){
    try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='docs.google.com'&&!u.username&&!u.password&&new RegExp('^/'+kind+'/d/[A-Za-z0-9_-]+/(?:edit|view|preview)(?:/)?$').test(u.pathname)?u.href:'';}catch(_){return '';}
  }
  function sourcingDates(data){
    if(data?.version!==1||!Array.isArray(data.dates))throw Error('날짜 목록 형식 오류');
    const seen=new Set(),rows=[];
    for(const row of data.dates){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(row?.date||'')||!sourcingGoogleUrl(row.url)||seen.has(row.date))continue;
      seen.add(row.date);rows.push({date:row.date,url:sourcingGoogleUrl(row.url)});
    }
    if(!rows.length)throw Error('확인된 소싱 날짜 없음');
    return rows.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,90);
  }
  function readSourcingCache(){
    try{
      const raw=localStorage.getItem(sourcingCacheKey);
      if(raw&&raw.length<=65536){
        const data=JSON.parse(raw);
        if(data.version===1&&/^\d{4}-\d{2}-\d{2}$/.test(data.attempt_day)&&Array.isArray(data.rows)){
          data.rows=data.rows.length?sourcingDates({version:1,dates:data.rows}):[];return data;
        }
      }
    }catch(_){}
    return sourcingMemory;
  }
  function writeSourcingCache(data){
    sourcingMemory=data;
    try{localStorage.setItem(sourcingCacheKey,JSON.stringify(data));}catch(_){}
  }
  function renderSourcingDates(rows){
    const day=sourcingDay(),signature=JSON.stringify([day,rows]);
    if(signature===sourcingSignature)return;
    const select=$('#rcSourcingDate'),options=[],targets=new Map([['latest',sourcingLatest],['sheet',sourcingSheet]]);
    const placeholder=document.createElement('option');placeholder.value='';placeholder.disabled=true;placeholder.textContent='소싱 날짜 선택';options.push(placeholder);
    let hasLatest=false;
    for(const row of rows){
      const option=document.createElement('option');
      // A stale cached fixed link must never claim it still contains an older date.
      const staleLatest=row.url===sourcingLatest&&row.date!==day;
      option.value=staleLatest?'latest':row.date;
      option.textContent=staleLatest?'최신 사진':row.date.slice(2).replaceAll('-','.')+(row.url===sourcingLatest?' · 최신':'');
      hasLatest=hasLatest||row.url===sourcingLatest;targets.set(option.value,row.url);options.push(option);
    }
    if(!hasLatest){const latest=document.createElement('option');latest.value='latest';latest.textContent='최신 사진';options.splice(1,0,latest);}
    const sheet=document.createElement('option');sheet.value='sheet';sheet.textContent='시트 · 지난 자료';options.push(sheet);
    select.replaceChildren(...options);select.value='';sourcingTargets=targets;sourcingSignature=signature;
  }
  async function loadSourcingLinks(){
    if(sourcingFlight)return sourcingFlight;
    const readOnce=async()=>{
      const day=sourcingDay(),cached=readSourcingCache();
      if(cached?.rows.length)renderSourcingDates(cached.rows);
      if(cached?.attempt_day===day)return;
      const pending={version:1,attempt_day:day,rows:cached?.rows||[],state:'pending'};
      writeSourcingCache(pending); // Mark before I/O; reloads and failures do not start a retry loop.
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
      try{
        const response=await fetch(new URL('sourcing-links.json',location.href).href,{cache:'no-cache',credentials:'omit',signal:controller.signal});
        if(!response.ok)throw Error('HTTP '+response.status);
        const body=await response.text();if(body.length>65536)throw Error('날짜 목록 크기 초과');
        const rows=sourcingDates(JSON.parse(body));
        writeSourcingCache({...pending,rows,state:'success'});renderSourcingDates(rows);
        $('#rcSourcingStatus').hidden=true;
      }catch(error){
        writeSourcingCache({...pending,state:'failed'});
        $('#rcSourcingStatus').textContent='오늘 날짜 목록을 갱신하지 못했습니다. 저장된 자료·최신 사진·시트는 열 수 있습니다.';
        $('#rcSourcingStatus').hidden=false;
      }finally{clearTimeout(timer);}
    };
    const run=navigator.locks?.request?navigator.locks.request(sourcingCacheKey,readOnce):readOnce();
    sourcingFlight=run.finally(()=>{sourcingFlight=null;});return sourcingFlight;
  }
  function openSourcingSelection(){
    const select=$('#rcSourcingDate'),target=sourcingTargets.get(select.value);
    if(!target)return;
    window.open(target,'_blank','noopener,noreferrer');
    select.value=''; // The same date can be chosen again without another request.
  }
  // SOURCING_NAV_END

  function ensure(){
    if(pane)return pane;
    pane=document.createElement('section');pane.id='referenceCollectionView';pane.className='noprint';pane.hidden=true;pane.setAttribute('aria-label','레퍼런스 수집');
    pane.innerHTML=`<div id="rcList"><div class="rc-filters" role="group" aria-label="레퍼런스 분류"><button type="button" data-category="content" aria-pressed="true">콘텐츠</button><button type="button" data-category="product" aria-pressed="false">제품</button></div>
      <div class="rc-list-tools"><label class="rc-search"><span class="rc-sr-only">검색</span><svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input id="rcSearch" type="search" placeholder="검색" autocomplete="off"></label><select id="rcSourcingDate" aria-label="소싱 날짜 선택하면 새 탭에서 열기"><option value="" selected disabled>소싱 날짜 선택</option><option value="latest">최신 사진</option><option value="sheet">시트 · 지난 자료</option></select><button type="button" id="rcRestore" hidden>삭제 복원</button></div><p id="rcSourcingStatus" class="rc-filter-status" role="status" hidden></p>
      <div class="rc-collection-filters"><div class="rc-date-filter"></div><select id="rcNoteCategoryFilter" aria-label="참고 카테고리 선택"><option value="" aria-label="전체 참고 카테고리">카테고리</option></select><select id="rcDesignerFilter" aria-label="레퍼런스 담당자 필터"><option value="">담당자</option></select></div>
      <div class="rc-lifecycle-filter-row"><select id="rcLifeFilter" aria-label="활용 상태"><option value="active">사용 전</option><option value="used">활용 완료</option><option value="stored">보관</option><option value="all">전체 기록</option></select></div>
      <div id="rcListTaxonomyManager"></div><p id="rcCategoryCoverage" class="rc-filter-status" role="status" hidden></p>
      <div id="rcNotices"><p id="rcStatus" role="status" aria-live="polite"></p><div class="rc-notice-actions"><button type="button" id="rcLogin">로그인</button><button type="button" id="rcRetry" hidden>연결 다시 확인</button><button type="button" id="rcLatest" hidden>저장된 내용 보기</button><button type="button" id="rcSaveCopy" hidden>내 입력 별도 저장</button><button type="button" id="rcSetup" hidden>시트 연결 준비</button></div></div>
      <div id="rcGrid" class="rc-grid"><button type="button" id="rcCreate" class="rc-card rc-create-card" aria-label="레퍼런스 추가">＋ 추가</button></div><p id="rcEmpty" hidden>등록된 콘텐츠 레퍼런스가 없습니다.</p><button type="button" id="rcMore" hidden>더 보기</button></div>
      <div id="rcDetail" hidden>
      <div class="rc-title-row"><label class="rc-field rc-title"><span class="rc-sr-only">제목</span><input data-rc-field="title" type="text" maxlength="160" placeholder="레퍼런스 제목" aria-label="레퍼런스 제목"></label><div class="rc-title-actions"><button type="button" id="rcWorkorder" hidden>작업지시서</button><button type="button" id="rcSave">저장</button><button type="button" id="rcDelete">삭제</button></div></div>
      <div class="rc-metadata"><label class="rc-date"><span id="rcDateText"></span><input id="rcDate" type="date" aria-label="레퍼런스 날짜"></label><select id="rcCategory" aria-label="카테고리"><option value="">카테고리</option></select><label class="rc-designer-field"><span id="rcDesignerText" aria-hidden="true">담당자</span><select id="rcDesigner" aria-label="담당자"><option value="">담당자</option></select></label><div id="rcCategoryManager"></div><div id="rcDesignerManager"></div><div class="rc-link-tools"><button type="button" id="rcSourceOpen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/></svg><span>링크</span></button><button type="button" id="rcLinkEdit" aria-label="링크 수정"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16 12-12 4 4-12 12-5 1Z M13 7l4 4"/></svg></button><button type="button" id="rcLinkDelete" aria-label="링크 삭제"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg></button><div id="rcLinkEditor" hidden><input id="rcLinkInput" type="url" inputmode="url" enterkeyhint="done" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="참고 링크" placeholder="https://"></div><p id="rcLinkError" role="alert" hidden></p></div></div>
      <div id="rcPhotos" class="rc-photos" aria-label="참고 사진"></div>
      <input id="rcCameraInput" type="file" accept="image/*" capture="environment" hidden><input id="rcPhotoInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>
      <section id="rcNotes" class="rc-notes" aria-label="참고"><div id="rcNoteEntries"></div></section>
      <div class="rc-detail-actions"><span id="rcAuthor" hidden></span></div>
      <section id="rcAIExtra" class="rc-review" aria-label="판별 결과" hidden><section id="rcAnalysis" class="rc-analysis" aria-live="polite"></section></section>
      <dialog id="rcDialog"><form method="dialog"><div id="rcDialogBody"></div><div class="rc-dialog-actions"><button type="button" id="rcDialogCancel">취소</button><button type="button" id="rcDialogConfirm">확인</button></div></form></dialog></div>`;
    document.body.append(pane);pane.append($('#rcDialog'));
    const detailWait=document.createElement('div');detailWait.id='rcDetailLoading';detailWait.className='rc-detail-loading';detailWait.hidden=true;detailWait.innerHTML='<p id="rcDetailProgress" role="status" aria-live="polite">자료를 불러오는 중…</p><section id="rcReadPreview" aria-label="레퍼런스 미리보기" hidden></section><button type="button" id="rcDetailCancel">목록으로</button>';pane.append(detailWait);$('#rcDetailCancel').onclick=cancelDetailLoad;
    dateFilterPicker=window.AiselDateFilter.mount($('.rc-date-filter'),{inputId:'rcDateFilter',labelId:'rcDateFilterText',label:'레퍼런스 날짜 필터',format:shortDate,onChange:()=>{gallerySignature='';renderList();rememberList();}});
    bindGalleryIndex();bindNoteCategories();bindDesigners();bindReferenceCategories();
    $('#rcLogin').onclick=async()=>{try{if(config.login)await config.login();else if(window.AiselDesignMeeting?.login)await window.AiselDesignMeeting.login({scope:'reference'});else throw Error('상단 디자인회의에서 로그인한 뒤 다시 열어주세요.');await access();await refresh();}catch(e){message(errorText(e),true);}};
    $('#rcSetup').onclick=async()=>{if(role!=='owner')return;try{await call('refEnsure');$('#rcSetup').hidden=true;await refresh();}catch(e){message(errorText(e),true);}};
    $('#rcRetry').onclick=()=>{accessAt=0;return show({history:false,forceRefresh:true});};
    $('#rcLatest').onclick=async()=>{
      if(!active||saveFlight)return;const id=active.id,stamp=authStamp(),selection=openEpoch,editRevision=revision;
      const stillHere=()=>active?.id===id&&selection===openEpoch&&editRevision===revision;
      try{
        const record=await remoteDetail(id,null,true);assertAuth(stamp);if(!stillHere())return;
        // Keep the local input under its own recovery ID. Reopening the original
        // must not restore the same stale version and enter another conflict loop.
        if(!await copyRecoveryDraft()||!stillHere())return;
        await removeDraft(id,{revision:editRevision});assertAuth(stamp);if(!stillHere())return;
        active=normalizeDetail(clone(record));activeBase=clone(active);pendingSave=null;saveConflict=null;linkEditor=null;selectedPhoto=0;pendingFiles=[];dirty=false;revision++;
        renderDetail();message('저장된 내용입니다. 이전 입력은 목록에 별도로 보관했습니다.');
      }catch(e){if(stillHere())message(errorText(e),true);}
    };
    $('#rcSaveCopy').onclick=async()=>{
      if(!active||saveFlight||!permissions.canCreate)return;const id=active.id,stamp=authStamp(),editRevision=revision;
      try{const recovery=await copyRecoveryDraft();assertAuth(stamp);if(!recovery||active?.id!==id||revision!==editRevision)return;
        await removeDraft(id,{revision:editRevision});assertAuth(stamp);if(active?.id!==id||revision!==editRevision)return;
        active=normalizeDetail(clone(recovery.record));activeBase=null;pendingSave=null;saveConflict=null;
        linkEditor=restoredLinkEditor(recovery.linkEditor,active.id);revision++;dirty=true;renderDetail();setRoute(active.id,true);await save();
      }catch(e){if(active?.id===id)message(errorText(e),true);}
    };
    $('#rcLifeFilter').onchange=()=>{lifeFilter=$('#rcLifeFilter').value;gallerySignature='';renderList();rememberList();};$('#rcMore').onclick=async()=>{listLimit+=24;gallerySignature='';if(cursor)await refresh(true);renderList();rememberList();};$('#rcCreate').onclick=createEntry;$('#rcRestore').onclick=restoreDialog;$('#rcSave').onclick=()=>save();$('#rcLinkEdit').onclick=chooseLinkEditor;$('#rcLinkDelete').onclick=deleteLink;$('#rcSourceOpen').onclick=openSource;$('#rcLinkInput').oninput=captureLinkDraft;$('#rcLinkInput').onblur=()=>{const editor=linkEditor;queueMicrotask(()=>{if(editor&&linkEditor===editor&&active?.id===editor.id&&!isComposing())finishLinkEditor();});};$('#rcLinkInput').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&!isComposing()){e.preventDefault();finishLinkEditor();}else if(e.key==='Escape'&&!e.isComposing){e.preventDefault();cancelLinkEditor();}};$('#rcDelete').onclick=()=>archiveRecord();$('#rcWorkorder').onclick=openProductWorkorder;$('#rcDate').oninput=()=>{if(!active||!canEdit()||$('#rcDate').value&&!/^\d{4}-\d{2}-\d{2}$/.test($('#rcDate').value))return;active.date=$('#rcDate').value;$('#rcDateText').textContent=shortDate(active.date);markDirty();};$('#rcDialogCancel').onclick=()=>$('#rcDialog').close();$('#rcDialog form').onsubmit=e=>{e.preventDefault();$('#rcDialogConfirm').click();};
    if(!categoryFilterPicker)$('#rcNoteCategoryFilter').onchange=()=>{gallerySignature='';renderList();rememberList();};$('#rcNoteCategoryFilter').onfocus=()=>window.AiselNoteCategories?.load().catch(()=>{});
    $('#rcDesignerFilter').onchange=()=>{if(window.AiselDesigners)return;gallerySignature='';renderList();rememberList();};
    $('#rcDesigner').onchange=()=>{if(window.AiselDesigners||!active||!canEdit()||permissions.referenceDesignerVersion!==212)return;active.designer=$('#rcDesigner').value;renderDesigner();markDirty();};
    $('#rcSourcingDate').onchange=openSourcingSelection;
    $('#rcSearch').oninput=()=>{gallerySignature='';renderList();rememberList();};
    $('.rc-filters').onclick=e=>{const b=e.target.closest('[data-category]');if(!b)return;topCategory=b.dataset.category;$('.rc-filters').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));gallerySignature='';renderList();rememberList();};
    fields.forEach(k=>$('[data-rc-field="'+k+'"]').addEventListener('input',()=>{if(!active)return;active[k]=$('[data-rc-field="'+k+'"]').value;markDirty();}));
    $('#rcPhotoInput').onchange=async e=>{await receive(e.target.files);e.target.value='';await save();};$('#rcCameraInput').onchange=async e=>{await receive(e.target.files);e.target.value='';await save();};
    pane.addEventListener('compositionstart',e=>{if(e.target.matches('input,textarea')){composing.add(e.target);clearTimeout(autoSaveTimer);}});pane.addEventListener('compositionend',e=>{composing.delete(e.target);if(e.target.id==='rcLinkInput'&&document.activeElement!==e.target){const editor=linkEditor;setTimeout(()=>{if(editor&&linkEditor===editor&&active?.id===editor.id&&!isComposing())finishLinkEditor();},0);}if(dirty)scheduleSave();});
    pane.addEventListener('dragover',e=>{if(active&&!$('#rcDetail').hidden&&e.dataTransfer?.types.includes('Files'))e.preventDefault();});pane.addEventListener('drop',e=>{if(active&&!$('#rcDetail').hidden&&e.dataTransfer?.files.length){e.preventDefault();receive(e.dataTransfer.files);}});
    document.addEventListener('paste',e=>{if(!visible||!active||$('#rcDetail').hidden||e.target.closest('input,textarea'))return;const files=[...(e.clipboardData?.items||[])].filter(x=>x.type.startsWith('image/')).map(x=>x.getAsFile());if(files.length){e.preventDefault();receive(files);}});
    window.addEventListener('beforeunload',e=>{if(dirty||pendingFiles.length){persistDraft().catch(()=>{});e.preventDefault();e.returnValue='';}});
    return pane;
  }
  function bindReferenceCategories(){
    if(referenceCategoryUnsubscribe||!window.AiselReferenceCategories)return;
    referenceCategoryUnsubscribe=window.AiselReferenceCategories.subscribe(state=>{if(!pane)return;const signature=JSON.stringify([state.ready,state.entries]);if(signature===referenceCategoriesSignature)return;referenceCategoriesSignature=signature;renderReferenceCategory();renderReferenceCategoryTabs();gallerySignature='';renderList();});
    window.AiselReferenceCategories.load().catch(()=>{});
  }
  function referenceCategoryEntries(){return window.AiselReferenceCategories?.list()||[];}
  function renderReferenceCategoryTabs(){
    const selected=topCategory,rows=[...records.values(),...[...draftRows.values()].map(draft=>draft.record)],values=new Map([['content','콘텐츠'],['product','제품']]);
    for(const entry of referenceCategoryEntries())if(!values.has(entry.category))values.set(entry.category,entry.name);
    for(const record of rows){if(record.archivedAt||!record.category||values.has(record.category))continue;values.set(record.category,categoryLabel(record));}
    if(!values.has(selected))values.set(selected,window.AiselReferenceCategories?.get(selected)?.name||categories[selected]||'기존 카테고리');
    const signature=JSON.stringify([...values]);if(signature!==topCategorySignature){const fragment=document.createDocumentFragment();for(const [value,label]of values){const button=document.createElement('button');button.type='button';button.dataset.category=value;button.textContent=label;button.setAttribute('aria-pressed',String(value===selected));fragment.append(button);}$('.rc-filters').replaceChildren(fragment);topCategorySignature=signature;}
    else $('.rc-filters').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category===selected)));
  }
  function initialReferenceCategory(){const entries=referenceCategoryEntries(),category=selectedCategory();return entries.find(entry=>entry.category===category&&(category!=='content'||entry.contentType==='image'))||entries.find(entry=>entry.category===category)||entries[0]||null;}
  function renderReferenceCategory(){
    if(!active||!window.AiselReferenceCategories)return;const identity=authEpoch+'|'+active.id,value=window.AiselReferenceCategories.valueForRecord(active);
    if(referenceCategoryIdentity!==identity){referenceCategoryPicker?.destroy();referenceCategoryPicker=null;referenceCategoryIdentity=identity;}
    if(!referenceCategoryPicker){const id=active.id,stamp=authStamp();referenceCategoryPicker=window.AiselReferenceCategories.mountPicker($('#rcCategory'),{value,selectedLabel:categoryLabel(active),disabled:!canEdit(),managerHost:$('#rcCategoryManager'),onChange:entry=>{try{assertAuth(stamp);}catch(_){return;}if(active?.id!==id||!canEdit())return;active.category=entry.category;active.contentType=entry.contentType;active.categoryMode='manual';markDirty();renderAnalysis();},onError:error=>{if(active?.id===id)message(error?.message||String(error),true);}});}
    else referenceCategoryPicker.refresh({value,selectedLabel:categoryLabel(active),disabled:!canEdit()});
  }
  function designerNames(){try{return [...new Set((window.AiselDesigners?.list?.()||window.AiselDesignMeetingAdapter?.designers?.()||[]).map(name=>String(name).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));}catch(_){return [];}}
  function bindDesigners(){
    if(designerUnsubscribe||!window.AiselDesigners)return;
    designerUnsubscribe=window.AiselDesigners.subscribe(()=>{if(!pane)return;renderDesigner();gallerySignature='';renderList();});
  }
  function selectOptions(select,options,value){
    if(!select)return;value=String(value||'');
    if(value&&!options.some(option=>option[0]===value))options.push([value,value]);
    const signature=JSON.stringify(options);
    if(select.dataset.options!==signature){const fragment=document.createDocumentFragment();for(const [key,label]of options){const option=document.createElement('option');option.value=key;option.textContent=label;fragment.append(option);}select.replaceChildren(fragment);select.dataset.options=signature;}
    if(select.value!==value)select.value=value;
  }
  function renderDesigner(){
    const select=$('#rcDesigner');if(!select)return;
    const value=active?.designer||'',names=designerNames(),disabled=!canEdit()||permissions.referenceDesignerVersion!==212;
    if(window.AiselDesigners&&active){
      const identity=authEpoch+'|'+active.id;
      if(designerPickerIdentity!==identity){designerPicker?.destroy();designerPicker=null;designerPickerIdentity=identity;}
      if(!designerPicker){
        const id=active.id,stamp=authStamp();
        designerPicker=window.AiselDesigners.mountPicker(select,{value,placeholder:'담당자',managerHost:$('#rcDesignerManager'),includeNames:names,disabled,onChange:name=>{
          try{assertAuth(stamp);}catch(_){return;}
          if(active?.id!==id||!canEdit()||permissions.referenceDesignerVersion!==212)return;
          active.designer=name;$('#rcDesignerText').textContent=name||'담당자';markDirty();
        },onError:error=>{if(active?.id===id&&designerPickerIdentity===identity)message(error?.message||String(error),true);}});
      }else designerPicker.refresh({value,includeNames:names,disabled});
    }else if(!window.AiselDesigners){selectOptions(select,[['','담당자'],...names.map(name=>[name,name])],value);}
    $('#rcDesignerText').textContent=value||'담당자';select.disabled=disabled;
  }
  function referenceDateKey(record){const value=String(record.date||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:'';}
  function renderDateFilter(value=$('#rcDateFilter').value){
    dateFilterPicker.setValue(value);
  }
  function renderCollectionFilters(rows){
    const names=[...new Set([...designerNames(),...rows.map(row=>row.designer||'').filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'ko'));
    const designer=$('#rcDesignerFilter');renderDateFilter();
    if(window.AiselDesigners){
      const options={mode:'filter',value:designer.value,placeholder:'담당자',managerHost:$('#rcListTaxonomyManager'),emptyOptions:[['__unassigned__','미지정']],includeNames:names,onChange:()=>{gallerySignature='';renderList();rememberList();},onError:error=>message(error?.message||String(error),true)};
      if(!designerFilterPicker)designerFilterPicker=window.AiselDesigners.mountPicker(designer,options);else designerFilterPicker.refresh({value:designer.value,includeNames:names});
    }else selectOptions(designer,[['','담당자'],...names.map(value=>[value,value]),['__unassigned__','미지정']],designer.value);
  }
  function bindNoteCategories(){
    if(categoryUnsubscribe||!window.AiselNoteCategories)return;
    categoryUnsubscribe=window.AiselNoteCategories.subscribe(()=>{if(!pane)return;renderCategoryFilter();gallerySignature='';renderList();});
    renderCategoryFilter();
  }
  function renderCategoryFilter(value=$('#rcNoteCategoryFilter').value){
    const filter=$('#rcNoteCategoryFilter');if(!filter)return;
    if(window.AiselNoteCategories?.mountFilter){
      if(!categoryFilterPicker)categoryFilterPicker=window.AiselNoteCategories.mountFilter(filter,{value,placeholder:'카테고리',managerHost:$('#rcListTaxonomyManager'),onChange:()=>{gallerySignature='';renderList();rememberList();},onError:error=>message(error?.message||String(error),true)});
      else categoryFilterPicker.refresh({value});
      return;
    }
    const items=window.AiselNoteCategories?.list()||[];
    const fragment=document.createDocumentFragment(),all=document.createElement('option');all.value='';all.textContent='카테고리';all.setAttribute('aria-label','전체 참고 카테고리');fragment.append(all);
    for(const category of items){const option=document.createElement('option');option.value=category.id;option.textContent=category.name;fragment.append(option);}
    if(value&&!items.some(item=>item.id===value)){const option=document.createElement('option');option.value=value;option.textContent='선택한 분류';fragment.append(option);}
    filter.replaceChildren(fragment);filter.value=value;
  }
  function noteCategorySummary(record){
    if(Array.isArray(record.noteEntries))return {noteCategoryIds:[...new Set(record.noteEntries.map(note=>note.categoryId).filter(Boolean))],noteCategoryCoverage:true};
    const ids=Array.isArray(record.noteCategoryIds)?record.noteCategoryIds:record.categoryIds;if(record.noteCategoryCoverage===false||!Array.isArray(ids)&&record.noteCategoryCoverage!==true)return {noteCategoryCoverage:false};return {noteCategoryIds:Array.isArray(ids)?[...new Set(ids.filter(id=>typeof id==='string'&&id))]:[],noteCategoryCoverage:true};
  }
  async function hydrateCategoryCoverage(rows){
    if(categoryCoverageFlight||!authorizedStamp)return;const epoch=authEpoch,filter=$('#rcNoteCategoryFilter').value;
    const queue=rows.filter(row=>!row._draft&&!categoryCoverageErrors.has(row.id));if(!queue.length)return;
    const task=(async()=>{await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{while(queue.length&&epoch===authEpoch&&filter===$('#rcNoteCategoryFilter').value){const row=queue.shift();try{await remoteDetail(row.id);}catch(_){if(epoch===authEpoch)categoryCoverageErrors.add(row.id);}}}));})();
    categoryCoverageFlight=task;try{await task;}finally{if(categoryCoverageFlight===task)categoryCoverageFlight=null;if(epoch===authEpoch){gallerySignature='';renderList();}}
  }
  function sourceKey(record){return JSON.stringify([record?.sourceLinks||[record?.sourceUrl||''],(record?.photos||[]).map(photo=>photo.hash||photo.original||photo.thumb||'')]);}
  function sourceConfirmed(){return !!active?.version&&!pendingFiles.length&&reviewSourceKeys.get(active.id)===sourceKey(active)&&(!linkEditor||JSON.stringify(linkEditor.values.map(value=>String(value).trim()).filter(Boolean))===JSON.stringify(active.sourceLinks||[]));}
  function galleryISO(value){if(!value)return '';if(typeof value!=='number')return String(value);const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():'';}
  function gallerySummary(record){const row=summary(record);for(const field of ['createdAt','updatedAt','archivedAt'])row[field]=typeof row[field]==='number'?row[field]:Date.parse(row[field]||'')||0;return row;}
  function galleryEnabled(){return window.AiselGalleryIndex?.enabled===true;}
  function galleryReady(){return galleryEnabled()&&galleryState?.available===true&&galleryState.authorized===true&&galleryState.complete===true&&galleryState.uid===window.AiselAuth?.currentUser()?.uid;}
  function bindGalleryIndex(){
    const module=window.AiselGalleryIndex;if(!module)return;if(galleryModule===module){galleryState=module.snapshot('references');void acceptGalleryState(galleryState);return;}
    galleryUnsubscribe?.();galleryModule=module;
    galleryUnsubscribe=module.subscribe('references',state=>{galleryState=state;void acceptGalleryState(state);});
  }
  async function acceptGalleryState(state){
    if(!pane||!galleryEnabled())return;
    const user=window.AiselAuth?.currentUser?.(),epoch=++galleryEpoch,stamp=authStamp();
    if(summaryPhotoPreview&&(!summaryPhotoPreview.isCurrent()||state.authorized!==true||state.available!==true||state.uid!==user?.uid))clearReadPreview();
    if(!user?.uid||state.uid!==user.uid)return;
    if(state.authorized===false){
      galleryOwned=false;
      await invalidateAccess(Object.assign(Error('레퍼런스 열람 권한을 다시 확인해주세요.'),{code:'permission_denied'}),stamp);
      if(epoch===galleryEpoch&&visible)message('레퍼런스 열람 권한을 다시 확인해주세요.',true);return;
    }
    if(!galleryReady()||!user.email){
      // Index summaries require a current online lease. Remove only the list
      // derived from that lease; preserve the open canonical form and drafts.
      if(galleryOwned){galleryOwned=false;records.clear();detailCache.clear();initialized=false;checkedAt='';cursor=null;listReadAt=0;gallerySignature='';renderList();}
      return;
    }
    const next=String(user.email).toLowerCase();
    if(account&&account!==next){if(!await resetAuth())return;if(window.AiselAuth?.currentUser()?.uid!==state.uid)return;galleryState=state;return acceptGalleryState(state);}
    try{assertAuth(stamp);}catch(_){return;}
    account=next;const incoming=new Set((state.records||[]).map(record=>record.id));
    // The shared index owns confirmed-write overlays. A complete snapshot may
    // remove archived rows, but local input drafts remain independent.
    for(const id of records.keys())if(!incoming.has(id)){records.delete(id);detailCache.delete(id);}
    for(const record of state.records||[])rememberRecord({...record,createdAt:galleryISO(record.createdAt),updatedAt:galleryISO(record.updatedAt),archivedAt:galleryISO(record.archivedAt)});
    galleryOwned=true;initialized=true;cursor=null;listReadAt=performance.now();
    if(visible)void startLifecycle();if(state.role){permissions={...permissions,canCreate:['owner','md','designer'].includes(state.role),canManage:state.role==='owner'};$('#rcRestore').hidden=state.role!=='owner';}
    // Lease and metadata checks also emit unchanged rows. Keep existing cards
    // and pointer/focus targets when the rendered data signature still matches.
    renderList();await renderDrafts();
    if(epoch===galleryEpoch&&visible&&$('#rcDetail').hidden&&!dirty)message('');
  }
  async function preloadGallery(){
    ensure();bindGalleryIndex();if(preloadFlight)return preloadFlight;
    if(visible||accessFlight||listFlight)return false;
    if(!window.AiselAuth?.currentUser?.()?.uid||/^#reference=/.test(location.hash))return false;
    const stamp=authStamp();
    if(authorizedStamp){try{assertAuth(authorizedStamp);}catch(_){return false;}}
    const task=(async()=>{
      if(galleryEnabled()){await window.AiselGalleryIndex.warm('references',{preferCache:true});assertAuth(stamp);if(galleryReady())return true;if(galleryState?.authorized===false)return false;}
      const prefetch=!authorizedStamp?{action:'refList',promise:timed('listMs',()=>referenceRequest('refList',{limit:24})).then(data=>({data}),error=>({error}))}:null;
      await access();assertAuth(stamp);if(galleryReady())return true;
      if(!initialized||performance.now()-listReadAt>LIST_TTL)await refresh(false,prefetch,{repair:false});
      return initialized;
    })();preloadFlight=task;
    try{return await task;}catch(_){return false;}finally{if(preloadFlight===task)preloadFlight=null;}
  }
  function authStamp(){return {uid:window.AiselAuth?.currentUser()?.uid||null,generation:window.AiselAuth?.generation,epoch:authEpoch};}
  function assertAuth(stamp){const current=authStamp();if(stamp.uid!==current.uid||stamp.generation!==current.generation||stamp.epoch!==current.epoch)throw Object.assign(Error('로그인 상태가 변경되었습니다. 다시 확인해주세요.'),{code:'auth_changed'});}
  async function call(action,payload={}){const bridge=config.bridge||((a,p)=>window.AiselDesignMeeting.bridge(a,[],p));const stamp=authStamp(),result=await bridge(action,payload);assertAuth(stamp);if(result?.ok===false)throw Object.assign(Error(result.error||'연결을 확인해주세요.'),{code:result.code});return result;}
  function collectionWriter(){
    const writer=window.AiselCollectionWrites;
    if(writer?.enabled===false)return null;
    if(writer?.enabled!==true)throw Object.assign(Error('레퍼런스 저장 연결을 확인해주세요. 입력은 유지됩니다.'),{code:'connection_pending'});
    return writer;
  }
  async function referenceRequest(action,payload={}){
    const writer=collectionWriter();if(!writer)return call(action,payload);
    const method={refSave:'saveReference',refArchive:'archiveReference',refList:'listReferences'}[action];
    if(!method||typeof writer[method]!=='function')throw Object.assign(Error('레퍼런스 저장 연결을 확인해주세요. 입력은 유지됩니다.'),{code:'connection_pending'});
    const stamp=authStamp(),result=await writer[method](payload);assertAuth(stamp);
    if(result?.ok===false)throw Object.assign(Error(result.error||'저장을 확인하지 못했습니다. 입력을 유지했습니다.'),{code:result.code});
    return result;
  }
  function message(text,error=false){ensure();if($('#rcDetail').hidden)$('.rc-list-tools').after($('#rcNotices'));else $('.rc-detail-actions').before($('#rcNotices'));$('#rcStatus').textContent=text;$('#rcStatus').classList.toggle('rc-error',error);}
  function errorText(e){if(e?.code==='connection_pending'){$('#rcRetry').hidden=false;$('#rcLogin').hidden=true;return '레퍼런스 저장 서버 업데이트가 필요합니다. 관리자에게 연결을 요청해주세요.';}if(e?.code==='conflict'){$('#rcLatest').hidden=$('#rcDetail').hidden;$('#rcSaveCopy').hidden=$('#rcDetail').hidden||!permissions.canCreate;return draftStored?'저장된 내용과 입력이 겹칩니다. 입력은 보관했으니 저장할 내용을 선택해주세요.':'입력은 화면에 남아 있습니다. 창을 닫기 전에 내용을 복사해주세요.';}if(e?.code==='setup_required'){$('#rcSetup').hidden=role!=='owner';return '레퍼런스 시트 연결을 준비해주세요.';}return e?.message||'저장을 확인하지 못했습니다. 입력을 유지했습니다.';}
  function sharedDetailEnabled(){return galleryEnabled()&&typeof window.AiselGalleryIndex?.detail==='function'&&typeof window.AiselGalleryIndex?.authorize==='function';}
  function mirrorFallback(error){return ['detail_unavailable','detail_stale','network'].includes(error?.code);}
  function adoptAccess(data,stamp){
    assertAuth(stamp);const next=String(data.accountKey||data.email||config.account?.()||'');if(!next)throw Error('로그인 계정 확인이 필요합니다.');
    if(account&&account!==next)throw Object.assign(Error('로그인 상태가 변경되었습니다. 다시 확인해주세요.'),{code:'auth_changed'});
    if(![196,203].includes(data.permissions?.referenceDetailVersion))throw Object.assign(Error('레퍼런스 저장 서버 연결이 필요합니다.'),{code:'connection_pending'});
    if(role!==data.role)detailCache.clear();account=next;role=data.role;permissions=data.permissions;localOnly=false;
    $('#rcRestore').hidden=!permissions.canManage;authorizedStamp=stamp;accessAt=performance.now();$('#rcRetry').hidden=true;$('#rcLogin').hidden=true;
    if(visible)void startLifecycle();renderList();void renderDrafts();window.AiselReferenceCategories?.load().catch(()=>{});if(permissions.noteCategoriesVersion===203)window.AiselNoteCategories?.load().catch(()=>{});return data;
  }
  async function access(){
    if(galleryEnabled()&&galleryState?.authorized===false&&galleryState.uid===window.AiselAuth?.currentUser()?.uid)throw Object.assign(Error('레퍼런스 열람 권한을 다시 확인해주세요.'),{code:'forbidden'});
    const stamp=authStamp();
    if(authorizedStamp&&account&&!localOnly&&performance.now()-accessAt<60000){try{assertAuth(authorizedStamp);return {role,permissions,accountKey:account};}catch(_){}}
    if(accessFlight&&SaveCore.equal(accessFlight.stamp,stamp))return accessFlight.promise;
    const task=(async()=>{
      let data;
      if(window.AiselCollectionWrites?.enabled===true){const writer=collectionWriter();if(typeof writer.authorize!=='function')throw Object.assign(Error('레퍼런스 저장 연결을 확인해주세요.'),{code:'connection_pending'});data=await timed('accessMs',()=>writer.authorize('references'));if(!data)throw Object.assign(Error('레퍼런스 권한을 확인하지 못했습니다.'),{code:'connection_pending'});}
      else if(sharedDetailEnabled())try{data=await timed('accessMs',()=>window.AiselGalleryIndex.authorize('references'));}
      catch(error){if(!mirrorFallback(error))throw error;assertAuth(stamp);}
      if(!data)data=await timed('accessMs',()=>call('refAccess'));
      return adoptAccess(data,stamp);
    })();accessFlight={epoch:stamp.epoch,stamp,promise:task};
    try{return await task;}catch(e){if(stamp.epoch===authEpoch&&!['auth_changed','session_changed'].includes(e.code))await invalidateAccess(e,stamp);throw e;}finally{if(accessFlight?.promise===task)accessFlight=null;}
  }
  function accessDenied(error){return ['forbidden','unauthorized','unauthenticated','permission_denied','access_denied','connection_pending'].includes(error.code)||error.code==='request_failed'&&/Google 로그인 확인|대표자가 등록한 참여자|허용되지 않은 요청/.test(error.message||'');}
  async function invalidateAccess(error,stamp){
    if(accessDenied(error)){clearReadPreview();$('#rcDetail').hidden=true;}
    const retained=await persistDraft();try{assertAuth(stamp);}catch(_){return;}
    const denied=accessDenied(error);
    if(!denied){accessAt=-Infinity;$('#rcRetry').hidden=false;message(retained?'연결을 확인하지 못했습니다. 입력은 이 기기에 보관됩니다.':'연결과 임시 보관을 확인하지 못했습니다. 현재 화면을 유지해주세요.',true);return;}
    authorizedStamp=null;accessAt=0;role=null;permissions={};authEpoch++;openEpoch++;detailCache.clear();detailFlights.clear();listFlight=null;listReadAt=0;
    if(denied){records.clear();initialized=false;checkedAt='';cursor=null;}
    // An explicit denial removes trusted server data; local inputs stay recoverable.
    gallerySignature='';$('#rcRestore').hidden=true;$('#rcSetup').hidden=true;$('#rcLatest').hidden=true;
    renderList();if(active)renderDetail();
    if(!retained)message('입력을 보관하지 못했습니다. 현재 화면의 내용을 유지해주세요.',true);
  }
  function rememberRecord(record,full=false){
    const known=records.get(record.id);if(known&&(Number(known.version)>Number(record.version)||Number(known.version)===Number(record.version)&&String(known.updatedAt||'')>String(record.updatedAt||'')))return;
    const cached=detailCache.get(record.id);
    if(cached&&(cached.record.version!==record.version||cached.record.updatedAt!==record.updatedAt))detailCache.delete(record.id);
    records.set(record.id,summary(record));if(full)reviewSourceKeys.set(record.id,sourceKey(record));
    if(full&&!record.archivedAt){detailCache.delete(record.id);detailCache.set(record.id,{account,record:clone(record),at:performance.now()});while(detailCache.size>40)detailCache.delete(detailCache.keys().next().value);}
    if(record.archivedAt)detailCache.delete(record.id);
    if(full&&galleryEnabled())try{window.AiselGalleryIndex.remember('references',gallerySummary(record),{archived:!!record.archivedAt});}catch(_){/* A confirmed source save remains authoritative if the optional mirror is unavailable. */}
  }
  function cachedDetail(id){
    const entry=detailCache.get(id),listed=records.get(id);
    if(!entry||entry.account!==account||performance.now()-entry.at>DETAIL_TTL||entry.record.archivedAt||listed&&(listed.version!==entry.record.version||listed.updatedAt!==entry.record.updatedAt))return null;
    return entry.record;
  }
  async function readResult(action,payload,prefetch){
    if(prefetch?.action===action){const result=await prefetch.promise;if(result.error)throw result.error;return result.data;}
    return timed(action==='refGet'?'detailMs':'listMs',()=>action==='refList'?referenceRequest(action,payload):call(action,payload));
  }
  async function readWithRepair(action,payload,prefetch){
    try{return await readResult(action,payload,prefetch);}catch(e){
      // Setup is an explicit repair path only. Normal reads never acquire the
      // server's sheet-setup lock or alter scheduled-review configuration.
      if(e.code!=='setup_required'||role!=='owner')throw e;
      await timed('setupMs',()=>call('refEnsure'));return readResult(action,payload);
    }
  }
  async function remoteDetail(id,prefetch,force=false){
    const shared=sharedDetailEnabled(),canonical=window.AiselCollectionWrites?.enabled===true;
    if(canonical&&!shared)throw Object.assign(Error('레퍼런스 조회 연결을 확인해주세요.'),{code:'connection_pending'});
    // The Firebase reader validates live ACL and the canonical snapshot revision;
    // an old process-local cache must not bypass those checks.
    if(!shared&&!force){const cached=cachedDetail(id);if(cached)return clone(cached);}
    if(!force&&detailFlights.has(id))return detailFlights.get(id);
    const stamp=authStamp(),scope=account;
    const task=(async()=>{
      let data;
      if(shared)try{
        data=await timed('detailMs',()=>window.AiselGalleryIndex.detail('references',id,{force}));assertAuth(stamp);
        const known=records.get(id);if(!data?.record?.id||data.record.id!==id||known&&Number(known.version)>Number(data.record.version))throw Object.assign(Error('최신 레퍼런스를 확인하고 있습니다.'),{code:'detail_stale'});
        adoptAccess(data,stamp);timings.detailSource='firebase';
      }catch(error){
        if(canonical||!mirrorFallback(error))throw error;assertAuth(stamp);data=null;timings.detailFallback=error.code;
        if(!force&&['detail_stale','detail_unavailable'].includes(error.code)){
          const known=records.get(id);if(known?.archivedAt)throw Object.assign(Error('보관된 레퍼런스입니다.'),{code:'not_found'});
          const cached=cachedDetail(id);
          if(cached&&known&&Number(cached.version)===Number(known.version)&&cached.updatedAt===known.updatedAt){
            // A source save/get already confirmed this complete record. Its mirror
            // may still be catching up, but a fresh ACL must approve every reuse.
            const grant=await window.AiselGalleryIndex.authorize('references');assertAuth(stamp);
            const confirmed=cachedDetail(id),listed=records.get(id);
            if(confirmed&&listed&&!listed.archivedAt&&Number(confirmed.version)===Number(listed.version)&&confirmed.updatedAt===listed.updatedAt){
              const record=clone(confirmed),owner=grant.role==='owner',email=String(grant.email||grant.accountKey||'').toLowerCase();
              record.permissions={canEdit:owner||!!email&&record.creator===email,canArchive:owner};
              adoptAccess(grant,stamp);data={...grant,record,source:'confirmed-cache'};timings.detailSource='confirmed-cache';
            }
          }
        }
      }
      if(!data){await access();assertAuth(stamp);data=await readWithRepair('refGet',{id},prefetch);timings.detailSource='apps-script';}
      assertAuth(stamp);if(scope&&scope!==account)throw Object.assign(Error('로그인 상태가 변경되었습니다.'),{code:'auth_changed'});
      if(!data.record?.id||data.record.id!==id)throw Error('레퍼런스를 찾지 못했습니다.');
      const known=records.get(id);if(known&&Number(known.version)>Number(data.record.version)){const newer=cachedDetail(id);if(newer)return clone(newer);throw Object.assign(Error('더 최신 내용이 있습니다. 레퍼런스를 다시 열어주세요.'),{code:'stale_read'});}
      // Reusing a receipt never extends its original server-confirmed age.
      if(data.source!=='confirmed-cache')rememberRecord(data.record,true);return data.record;
    })();
    detailFlights.set(id,task);try{return await task;}catch(error){if(accessDenied(error))await invalidateAccess(error,stamp);throw error;}finally{if(detailFlights.get(id)===task)detailFlights.delete(id);}
  }
  function stampForLocal(){return authStamp();}
  async function enableLocalDrafts(stamp){const user=window.AiselAuth?.currentUser?.();if(!user?.email||!user?.uid)return false;assertAuth(stamp);account=String(user.email).toLowerCase();localOnly=true;$('#rcRestore').hidden=true;role=null;permissions={canCreate:true};authorizedStamp=stamp;$('#rcCreate').hidden=false;$('#rcCreate').disabled=false;$('#rcLogin').hidden=true;$('#rcRetry').hidden=false;renderList();await renderDrafts();message('시트 연결 대기 · 새 자료는 이 기기에 임시 보관됩니다.');return true;}
  function canEdit(){if(!authorizedStamp||galleryEnabled()&&galleryState?.authorized===false)return false;try{assertAuth(authorizedStamp);}catch(_){return false;}return !!active&&(active.version===0?permissions.canCreate===true:active.permissions?.canEdit===true);}
  function setRoute(id,replace=false){const hash=id?'#reference='+encodeURIComponent(id):'#references';history[replace?'replaceState':'pushState']({aiselReference:{id:id||null,scroll:galleryScroll,search:$('#rcSearch').value,category:selectedCategory(),noteCategory:$('#rcNoteCategoryFilter').value,dateFilter:$('#rcDateFilter').value,designerFilter:$('#rcDesignerFilter').value,lifeFilter,listLimit}},'',hash);}
  function selectedCategory(){return topCategory;}
  function rememberList(){if($('#rcDetail').hidden&&location.hash==='#references')history.replaceState({aiselReference:{id:null,scroll:window.scrollY,search:$('#rcSearch').value,category:selectedCategory(),noteCategory:$('#rcNoteCategoryFilter').value,dateFilter:$('#rcDateFilter').value,designerFilter:$('#rcDesignerFilter').value}},'',location.href);}
  function restoreList(state){if(!state)return;lifeFilter=['active','used','stored','all'].includes(state.lifeFilter)?state.lifeFilter:'active';$('#rcLifeFilter').value=lifeFilter;listLimit=Math.max(24,Number(state.listLimit)||24);restoredLimit=listLimit;galleryScroll=window.AiselReloadStartup?.skipRestore?0:state.scroll||0;$('#rcSearch').value=state.search||'';renderCategoryFilter(state.noteCategory||'');renderDateFilter(state.dateFilter||'');if(designerFilterPicker)designerFilterPicker.refresh({value:state.designerFilter||''});else selectOptions($('#rcDesignerFilter'),[['','담당자']],state.designerFilter||'');topCategory=/^(?:content|product|marketing|idea|rcat_[a-f0-9]{64})$/.test(state.category||'')?state.category:'content';renderReferenceCategoryTabs();gallerySignature='';}
  async function show(options={}){
    viewStartedAt=performance.now();measuredViewPhases.clear();delete timings.firstCardsMs;delete timings.firstPreviewMs;
    ensure();bindGalleryIndex();bindDesigners();window.AiselReferenceCategories?.load().catch(()=>{});if(authorizedStamp){try{assertAuth(authorizedStamp);}catch(_){if(!await resetAuth())return false;}}
    if(config.beforeShow&&await config.beforeShow()===false)return false;
    const epoch=++showEpoch,stillVisible=()=>epoch===showEpoch&&visible&&!pane.hidden;
    const gallery=!options.id&&(options.preserveDetail===false||!active||$('#rcDetail').hidden);
    if(gallery&&active&&(isComposing()||!await flushNotePickers()))return false;
    if(gallery&&active&&(dirty||pendingFiles.length)){
      // A gallery switch waits for durable local bytes, never a remote save.
      // Keep the hidden active object while saveFlight owns it so late uploads
      // and saves cannot write into a different reference.
      if(!await persistDraft()){message('입력을 이 기기에 보관하지 못했습니다. 현재 화면을 유지해주세요.',true);return false;}
      if(epoch!==showEpoch)return false;
    }
    pane.hidden=false;visible=true;void loadSourcingLinks();window.dispatchEvent(new CustomEvent('aisel-view-change',{detail:{view:'references'}}));
    if(gallery){$('#rcDialog').close();showList();if(options.history!==false&&location.hash!=='#references')setRoute(null);message(dirty?'입력을 이 기기에 보관했습니다.':initialized?'':'불러오는 중…');}
    else if(!active){showList();message('불러오는 중…');}
    // Both read actions authorize on the server. Hold the read result until the
    // fresh access/version check succeeds; no data is rendered on its own.
    const action=options.id?'refGet':'refList';
    const prefetch=window.AiselCollectionWrites?.enabled!==true&&!sharedDetailEnabled()&&!preloadFlight&&!authorizedStamp&&!localOnly&&(options.id||gallery&&!galleryEnabled())?{action,promise:timed(action==='refGet'?'detailMs':'listMs',()=>call(action,options.id?{id:options.id}:{limit:24})).then(data=>({data}),error=>({error}))}:null;
    const hydrate=async()=>{try{
      if(gallery&&galleryEnabled()){await window.AiselGalleryIndex.warm('references',{preferCache:!options.forceRefresh});if(!stillVisible())return;if(galleryReady())return;if(galleryState?.authorized===false){message('레퍼런스 열람 권한을 다시 확인해주세요.',true);return;}}
      if(options.id){await open(options.id,{history:options.history!==false,prefetch});return;}
      await access();if(!stillVisible())return;
      if(gallery){if(options.forceRefresh||!initialized||performance.now()-listReadAt>LIST_TTL)await refresh(false,prefetch);return;}
      // Keeping an already open form must not reread and overwrite its content.
    }catch(e){if(stillVisible()&&e.code==='connection_pending'&&await enableLocalDrafts(stampForLocal())){if(options.id)await open(options.id,{history:options.history!==false});return;}if(stillVisible()&&!['auth_changed','session_changed'].includes(e.code)){$('#rcLogin').hidden=!!window.AiselAuth;$('#rcCreate').disabled=false;message(errorText(e),true);}}};
    if(options.background)hydrate();else await hydrate();return true;
  }
  function isComposing(){return referenceCategoryPicker?.isComposing?.()||[...composing].some(node=>node.isConnected);}
  async function flushNotePickers(){if(!active)return true;const id=active.id;if(referenceCategoryPicker?.flush&&await referenceCategoryPicker.flush()===false)return false;if(active?.id!==id)return false;if(noteRenderId!==id)return true;for(const picker of notePickers.values()){if(picker.flush&&await picker.flush()===false)return false;if(active?.id!==id)return false;}return true;}
  async function canLeave(options={}){
    if(options.isCurrent&&!options.isCurrent())return false;
    if(isComposing()){await persistDraft();return false;}
    if(!await flushNotePickers()||options.isCurrent&&!options.isCurrent())return false;
    const linkReady=linkEditor?.id!==active?.id||finishLinkEditor();
    if(options.allowLocal){
      // Menu navigation needs durable local input, not a slow remote receipt.
      // Keep this record as the owner of any running upload/save until it ends.
      // Account switches and workorder handoffs use the strict default below.
      const id=active?.id,stamp=authStamp(),epoch=showEpoch;
      for(let attempt=0;attempt<3;attempt++){
        if(options.isCurrent&&!options.isCurrent())return false;
        const editRevision=revision,retained=await persistDraft();
        try{assertAuth(stamp);}catch(_){return false;}
        if(active?.id!==id||epoch!==showEpoch||options.isCurrent&&!options.isCurrent())return false;
        if(!retained){message('입력을 이 기기에 보관하지 못했습니다. 현재 화면에서 저장을 확인해주세요.',true);return false;}
        if(editRevision!==revision)continue;
        if(linkReady&&dirty&&!saveConflict&&!saveFlight)void save().catch(()=>{});
        return true;
      }
      return false;
    }
    if(!linkReady)return false;
    const id=active?.id,editRevision=revision;let timeout;
    const finished=await Promise.race([save(),new Promise(resolve=>{timeout=setTimeout(()=>resolve(false),15000);})]);clearTimeout(timeout);
    if(!finished||active?.id!==id||editRevision!==revision){if(!finished&&saveFlight)message('저장 확인이 늦어지고 있습니다. 입력은 유지됩니다. 잠시 후 다시 이동해주세요.',true);return false;}return !options.isCurrent||options.isCurrent();
  }
  async function leave(options={}){if(!await canLeave(options)||options.isCurrent&&!options.isCurrent())return false;showEpoch++;finishDetailLoad();referenceCategoryPicker?.close();designerPicker?.close();designerFilterPicker?.close();categoryFilterPicker?.close();dateFilterPicker?.close();pane.hidden=true;visible=false;lifecycle?.stop();return true;}
  const lifecycle=window.AiselReferenceLifecycle;let lifeFilter='active',listLimit=24,listFilterKey='',restoredLimit=null,lifeUndoTimer;
  function summary(record){const {id,version,title,date,designer,category,contentType,creator,createdAt,updatedAt,archivedAt,permissions:recordPermissions,analysis,analysisSignature,analysisState,analysisReceipt,reviewedAt,categoryMode}=record;return {id,version,title,date,designer,category,contentType,creator,createdAt,updatedAt,archivedAt,analysis,analysisSignature,analysisState,analysisReceipt,reviewedAt,categoryMode,permissions:recordPermissions,...noteCategorySummary(record),thumbnail:record.thumbnail||record.photos?.[0]?.thumb||''};}
  async function refresh(more=false,prefetch=null,options={}){
    ensure();categoryCoverageErrors.clear();if(galleryReady()){await acceptGalleryState(galleryState);return;}if(listFlight)return listFlight;const epoch=authEpoch;loading=true;$('#rcMore').disabled=true;
    const task=(async()=>{try{
      if(!account)await access();const payload={limit:24};if(more&&cursor)payload.cursor=cursor;else if(initialized&&checkedAt)payload.updatedSince=checkedAt;
      const data=await (options.repair===false?readResult('refList',payload,prefetch):readWithRepair('refList',payload,prefetch));
      for(const item of data.items||[])rememberRecord(item);
      if(more||!initialized)cursor=data.nextCursor||null;
      // Show the first available page before draining a large delta. Only advance
      // checkedAt after the full delta succeeds, so a retry cannot skip changes.
      const delta=initialized&&!more;galleryOwned=false;initialized=true;renderList();if($('#rcDetail').hidden&&!dirty)message('');
      if(delta&&data.nextCursor){let next=data.nextCursor;while(next){const page=await referenceRequest('refList',{...payload,cursor:next});for(const item of page.items||[])rememberRecord(item);renderList();next=page.nextCursor||null;}}
      checkedAt=data.checkedAt||checkedAt;listReadAt=performance.now();
    }catch(e){if(epoch===authEpoch)message(errorText(e),true);}finally{if(epoch===authEpoch){loading=false;$('#rcMore').disabled=false;}}})();
    listFlight=task;try{return await task;}finally{if(listFlight===task)listFlight=null;}
  }
  function renderList(){
    if(!visible||pane.hidden||$('#rcList').hidden){gallerySignature='';return;}
    if(account&&!lifecycle?.ready){const add=$('#rcCreate');if(add){add.hidden=true;$('#rcGrid').replaceChildren(add);}else $('#rcGrid').replaceChildren();gallerySignature='';$('#rcEmpty').hidden=false;$('#rcEmpty').textContent='활용 기록을 확인하고 있습니다.';$('#rcMore').hidden=true;return;}
    renderReferenceCategoryTabs();const category=selectedCategory(),search=$('#rcSearch').value.trim().toLocaleLowerCase(),noteCategory=$('#rcNoteCategoryFilter').value,dateFilter=$('#rcDateFilter').value,designerFilter=$('#rcDesignerFilter').value;
    const merged=new Map(records);for(const [id,draft]of draftRows)merged.set(id,{...draft.record,id,_draft:true,thumbnail:draft.record.thumbnail||draft.record.photos?.[0]?.thumb||draft.preview||''});
    const filterKey=JSON.stringify([category,search,noteCategory,dateFilter,designerFilter,lifeFilter]);if(filterKey!==listFilterKey){listFilterKey=filterKey;listLimit=restoredLimit||24;restoredLimit=null;}
    const available=[...merged.values()].filter(r=>!r.archivedAt&&r.category===category&&(lifeFilter==='all'||(lifecycle?.status(r.id)||'active')===lifeFilter));renderCollectionFilters(available);
    const candidates=available.filter(r=>(!search||[r.title,r.sourceUrl,lifecycle?.get(r.id).note,lifecycle?.get(r.id).resultUrl].filter(Boolean).join(' ').toLocaleLowerCase().includes(search))&&(!dateFilter||(dateFilter==='__undated__'?!referenceDateKey(r):referenceDateKey(r)===dateFilter))&&(!designerFilter||(designerFilter==='__unassigned__'?!r.designer:r.designer===designerFilter)));
    const unknown=noteCategory?candidates.filter(r=>!noteCategorySummary(r).noteCategoryCoverage):[];
    const list=candidates.filter(r=>!noteCategory||!noteCategorySummary(r).noteCategoryCoverage||noteCategorySummary(r).noteCategoryIds.includes(noteCategory)).sort((a,b)=>referenceDateKey(b).localeCompare(referenceDateKey(a))||String(b.createdAt||'').localeCompare(String(a.createdAt||''))||b.id.localeCompare(a.id));
    const shown=list.slice(0,listLimit);const sig=JSON.stringify([shown.map(r=>[r,lifecycle?.get(r.id),lifecycle?.isPending(r.id)]),lifeFilter,listLimit,lifecycle?.ready,noteCategory,dateFilter,designerFilter,permissions.canCreate,!!authorizedStamp]);
    if(sig!==gallerySignature){
      gallerySignature=sig;const frag=document.createDocumentFragment(),add=$('#rcCreate');
      add.hidden=false;add.disabled=createFlight||!!authorizedStamp&&permissions.canCreate!==true;
      let group;const heading=value=>{const label=document.createElement('p');label.className='rc-date-group';label.textContent=value?shortDate(value):'날짜 없음';frag.append(label);};
      if(list.length){group=referenceDateKey(list[0]);heading(group);}frag.append(add);
      for(const [index,r]of shown.entries()){
        const dateGroup=referenceDateKey(r);if(dateGroup!==group){group=dateGroup;heading(group);}
        const button=document.createElement('button');button.type='button';button.className='rc-card';button.dataset.id=r.id;button.setAttribute('aria-label',(r.title||'제목 없음')+(r._draft?' 이어서 작성':' 상세 보기'));button.onclick=()=>open(r.id);
        const src=http(r.thumbnail)||(r._draft&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(r.thumbnail||'')?r.thumbnail:'');
        if(src){const img=document.createElement('img');bindUploadedPreview(img,src,r.id);img.alt='';img.width=185;img.height=160;img.loading=index<3?'eager':'lazy';img.fetchPriority=index===0?'high':'auto';img.decoding='async';button.append(img);}
        else{const space=document.createElement('span');space.className='rc-no-photo';space.textContent=r._draft?'작성 중':'';button.append(space);}
        const info=document.createElement('span');info.className='rc-card-info';
        const title=document.createElement('strong');title.textContent=AI.title(r);
        const meta=document.createElement('span');meta.className='rc-card-meta';
        const tag=document.createElement('span');tag.className='rc-category';tag.textContent=r._draft?'작성 중':categoryLabel(r);
        const date=document.createElement('time');date.dateTime=r.date||'';date.textContent=shortDate(r.date);
        const designer=document.createElement('span');designer.className='rc-card-designer';designer.textContent=r.designer||'미지정';meta.append(date,tag);info.append(title,designer,meta);button.append(info);const card=document.createElement('article');card.className='rc-lifecycle-card';card.dataset.id=r.id;card.append(button);if(!r._draft)renderLifeActions(card,r);frag.append(card);
      }
      $('#rcGrid').replaceChildren(frag);
    }
    // Measure server-backed cards separately from local drafts so an instant
    // draft cannot hide a slow list request. Reused DOM still counts on revisit.
    if(list.some(record=>!record._draft))measureListPhase('first-cards');
    const previewRecord=list.find(record=>!record._draft&&http(record.thumbnail));
    const preview=previewRecord&&[...$('#rcGrid').children].find(node=>node.dataset.id===previewRecord.id)?.querySelector('img');
    if(preview){const started=viewStartedAt;if(preview.complete&&preview.naturalWidth)measureListPhase('first-preview',started);else if(preview.dataset.timed!==String(started)){preview.dataset.timed=String(started);preview.addEventListener('load',()=>measureListPhase('first-preview',started),{once:true});}}
    $('#rcEmpty').hidden=!!list.length;$('#rcEmpty').textContent=lifeFilter==='active'?'사용 전 자료가 없습니다.':'선택한 기록이 없습니다.';
    $('#rcMore').hidden=list.length<=listLimit&&!cursor;$('#rcMore').textContent='더 보기 · '+Math.min(24,Math.max(list.length-listLimit,cursor?24:0))+'개';let count=$('#rcListCount');if(!count){count=document.createElement('p');count.id='rcListCount';count.className='rc-filter-status';$('#rcMore').before(count);}count.textContent='표시 '+Math.min(listLimit,list.length)+' / '+list.length+'개'+(cursor?' · 이전 자료 더 보기':'');
    const coverage=$('#rcCategoryCoverage');coverage.hidden=!noteCategory||!unknown.length&&!cursor;coverage.textContent=unknown.length?(unknown.some(r=>categoryCoverageErrors.has(r.id))?'일부 자료의 분류를 확인하지 못했습니다. 다시 연결하면 이어서 확인합니다.':'참고 분류 확인 중…'):cursor?'현재 불러온 자료에서 찾고 있습니다. 더 보기로 나머지 자료를 확인하세요.':'';
    if(noteCategory&&unknown.some(r=>!categoryCoverageErrors.has(r.id)))void hydrateCategoryCoverage(unknown);
  }

  async function startLifecycle(){if(!lifecycle)return;try{await lifecycle.start(()=>{$('#rcLifeRetry')?.remove();gallerySignature='';renderList();},e=>message(e.message,true));}catch(e){message('활용 기록 연결을 확인해주세요. 자료는 그대로 유지됩니다.',true);if(!$('#rcLifeRetry')){const retry=document.createElement('button');retry.id='rcLifeRetry';retry.type='button';retry.textContent='활용 기록 다시 연결';retry.onclick=()=>startLifecycle();$('#rcNotices').append(retry);}}}
  function lifeCanEdit(r){return lifecycle?.ready&&!lifecycle.isPending(r.id)&&(role==='owner'||galleryState?.role==='owner'||r.permissions?.canEdit===true||r.creator===account);}
  function lifeTime(at){return at?new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';}
  function renderLifeActions(card,r){
    const value=lifecycle?.get(r.id)||{status:'active'},editable=lifeCanEdit(r);
    const check=document.createElement('label');check.className='rc-usage-check';const input=document.createElement('input');input.type='checkbox';input.checked=value.status==='used';input.disabled=!editable;input.setAttribute('aria-label',(r.title||'자료')+' 활용 완료');input.onchange=()=>{input.checked=value.status==='used';void changeLife(r,input.checked?'active':'used');};check.append(input);card.append(check);
    const actions=document.createElement('div');actions.className='rc-usage-actions';
    const archive=document.createElement('button');archive.type='button';archive.textContent=value.status==='active'?'보관':'복원';archive.disabled=!editable;archive.onclick=()=>changeLife(r,value.status==='active'?'stored':'active');
    const history=document.createElement('button');history.type='button';history.textContent='기록';history.disabled=!lifecycle?.ready;history.onclick=()=>lifeDialog(r);actions.append(archive,history);card.append(actions);
    if(value.status!=='active'){const stamp=document.createElement('p');stamp.className='rc-usage-stamp';stamp.textContent=(lifecycle.labels[value.status]||'')+' · '+lifeTime(value.updatedAt)+' · '+(value.updatedByEmail||'');card.append(stamp);}
  }
  async function changeLife(r,next,options={}){
    if(!lifeCanEdit(r))return;
    const stamp=authStamp(),before=lifecycle.get(r.id);
    try{
      if(active?.id===r.id&&!await save())return;assertAuth(stamp);
      const saved=await lifecycle.change(r.id,next,options);assertAuth(stamp);gallerySignature='';renderList();
      if(options.quiet)return;
      let toast=$('#rcLifeToast');if(!toast){toast=document.createElement('div');toast.id='rcLifeToast';toast.className='rc-life-toast';toast.setAttribute('role','status');pane.append(toast);}clearTimeout(lifeUndoTimer);toast.replaceChildren();toast.hidden=false;
      const text=document.createElement('span');text.textContent=next==='used'?'활용 완료로 옮겼어요':next==='stored'?'보관으로 옮겼어요':'사용 전으로 복원했어요';const undo=document.createElement('button');undo.type='button';undo.textContent='실행 취소';undo.onclick=async()=>{undo.disabled=true;await changeLife(r,before.status,{expectedVersion:saved.version,note:before.note,resultUrl:before.resultUrl,quiet:true});toast.hidden=true;};toast.append(text,undo);lifeUndoTimer=setTimeout(()=>{toast.hidden=true;},12000);
    }catch(e){try{assertAuth(stamp);message(e.message,true);}catch(_){} }
  }
  function lifeDialog(r){
    const value=lifecycle.get(r.id),stamp=authStamp();
    dialog('활용 기록',box=>{
      const heading=document.createElement('p');heading.textContent=r.title||'제목 없음';box.append(heading);
      const link=http(r.sourceUrl);if(link){const a=document.createElement('a');a.href=link;a.target='_blank';a.rel='noopener';a.textContent='원본 링크';box.append(a);}
      const list=document.createElement('ol');list.className='rc-usage-history';const events=Object.values(value.history||{}).sort((a,b)=>b.at-a.at);for(const event of events){const item=document.createElement('li');item.textContent=lifeTime(event.at)+' · '+(event.from===event.to?'메모 수정':lifecycle.labels[event.to])+' · '+event.email;list.append(item);}if(!events.length){const empty=document.createElement('p');empty.textContent='아직 활용 이력이 없습니다.';box.append(empty);}else box.append(list);
      for(const [id,labelText,kind,val] of [['rcUsageNote','활용 메모 (선택)','textarea',value.note||''],['rcUsageLink','결과물 링크 (선택)','input',value.resultUrl||'']]){const label=document.createElement('label');label.textContent=labelText;const field=document.createElement(kind);field.id=id;field.value=val;field.disabled=!lifeCanEdit(r);field.maxLength=kind==='input'?2048:2000;if(kind==='input')field.type='url';label.append(field);box.append(label);}
    },lifeCanEdit(r)?async()=>{assertAuth(stamp);await lifecycle.change(r.id,value.status,{expectedVersion:value.version,note:$('#rcUsageNote').value,resultUrl:$('#rcUsageLink').value});gallerySignature='';renderList();}:null);
  }

  function shortDate(value){const date=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(date)?date.slice(2).replaceAll('-','. '):date;}
  function categoryLabel(record){const entry=window.AiselReferenceCategories?.get(window.AiselReferenceCategories.valueForRecord(record));return entry?.name||(record?.category==='product'?'제품':record?.category==='content'?(record?.contentType==='video'?'콘텐츠 (영상)':record?.contentType==='image'?'콘텐츠 (이미지)':'콘텐츠'):categories[record?.category]||'기존 카테고리');}
  function normalizeDetail(record){record.photos||=[];record.sourceLinks=Array.isArray(record.sourceLinks)&&record.sourceLinks.length?[...record.sourceLinks]:record.sourceUrl?[record.sourceUrl]:[];record.noteEntries=Array.isArray(record.noteEntries)&&record.noteEntries.length?record.noteEntries:[{id:'note_legacy',date:record.date||String(record.createdAt||'').slice(0,10)||today(),text:record.notes||''}];record.contentType||='';return record;}
  function syncLegacy(){active.sourceUrl=active.sourceLinks[0]||'';active.notes=active.noteEntries.map(n=>'['+n.date+'] '+n.text).join('\n\n');}
  function dialog(title,build,confirm){$('#rcDialog').classList.toggle('rc-category-dialog',title==='카테고리');const box=$('#rcDialogBody');box.replaceChildren();const heading=document.createElement('h3');heading.textContent=title;box.append(heading);build(box);$('#rcDialogConfirm').hidden=!confirm;$('#rcDialogConfirm').onclick=async()=>{try{await confirm?.();$('#rcDialog').close();}catch(e){let error=box.querySelector('.rc-dialog-error');if(!error){error=document.createElement('p');error.className='rc-dialog-error';box.append(error);}error.textContent=e.message;}};$('#rcDialog').showModal();}

  function restoredLinkEditor(saved,id){
    if(!saved||saved.id!==id)return null;
    // v201 drafts kept all raw lines in text. Keep every line in the draft,
    // while the v202 one-line control edits a single selected URL.
    const values=Array.isArray(saved.values)?saved.values.map(String):String(saved.text||'').split(/\r?\n/);
    const index=Math.max(0,Math.min(Number(saved.index)||0,Math.max(0,values.length-1)));
    return {id,index,values,text:values[index]||''};
  }
  function chooseLinkEditor(){
    if(!active||!canEdit())return;const id=active.id,values=linkEditor?.id===id?linkEditor.values:active.sourceLinks||[];
    if(values.length<2){startLinkEditor(0);return;}
    dialog('수정할 링크',box=>values.forEach((url,index)=>{const button=document.createElement('button');button.type='button';button.className='rc-link-delete-item';button.textContent=url||'빈 링크';button.onclick=()=>{if(active?.id!==id||!canEdit())return;$('#rcDialog').close();startLinkEditor(index);};box.append(button);}));
  }
  function startLinkEditor(index=0){
    if(!active||!canEdit())return;
    const values=linkEditor?.id===active.id?[...linkEditor.values]:[...(active.sourceLinks||[])];
    index=Math.max(0,Math.min(index,Math.max(0,values.length-1)));
    linkEditor={id:active.id,index,values,text:values[index]||''};clearTimeout(autoSaveTimer);updateSource();
    const input=$('#rcLinkInput');input.focus();try{input.setSelectionRange(input.value.length,input.value.length);}catch(_){}
  }
  function captureLinkDraft(){
    if(!active||!canEdit()||linkEditor?.id!==active.id)return;linkEditor.text=$('#rcLinkInput').value;linkEditor.values[linkEditor.index]=linkEditor.text;$('#rcLinkError').hidden=true;markDirty();
  }
  function finishLinkEditor(){
    if(!linkEditor||linkEditor.id!==active?.id)return true;if(!canEdit()||isComposing())return false;
    const values=linkEditor.values.map(x=>String(x).trim());let invalid=values.findIndex(url=>url&&(!http(url)||url.length>2048||/\s/.test(url)));
    if(values.filter(Boolean).length>12||invalid>=0||new Set(values.filter(Boolean)).size!==values.filter(Boolean).length){
      $('#rcLinkError').textContent=invalid>=0?'http 또는 https 주소를 입력해주세요.':values.filter(Boolean).length>12?'링크는 12개까지 입력해주세요.':'이미 등록된 링크입니다.';$('#rcLinkError').hidden=false;
      if(invalid>=0&&invalid!==linkEditor.index){linkEditor.index=invalid;linkEditor.text=linkEditor.values[invalid];$('#rcLinkInput').value=linkEditor.text;}
      persistDraft();return false;
    }
    const links=values.filter(Boolean),changed=JSON.stringify(active.sourceLinks||[])!==JSON.stringify(links);active.sourceLinks=links;linkEditor=null;syncLegacy();if(changed)markDirty();else{persistDraft();if(dirty)scheduleSave();}updateSource();return true;
  }
  function cancelLinkEditor(){if(!active)return;linkEditor=null;$('#rcLinkError').hidden=true;updateSource();markDirty();}
  function openSource(){
    if(!active)return;const url=http(active.sourceLinks?.[0]);if(!url){startLinkEditor();return;}
    // A new tab keeps this live form and its local draft in place.
    persistDraft();window.open(url,'_blank','noopener,noreferrer');
  }

  function renderNotes(){
    const box=$('#rcNoteEntries'),recordId=active.id,edit=canEdit();
    if(noteRenderId!==recordId){for(const picker of notePickers.values())picker.destroy();notePickers.clear();box.replaceChildren();noteRenderId=recordId;}
    const wanted=new Set(active.noteEntries.map(n=>n.id));for(const child of [...box.children])if(!wanted.has(child.dataset.noteId)){notePickers.get(child.dataset.noteId)?.destroy();notePickers.delete(child.dataset.noteId);child.remove();}
    for(const [index,note]of active.noteEntries.entries()){
      let section=[...box.children].find(el=>el.dataset.noteId===note.id);
      if(!section){
        section=document.createElement('div');section.className='rc-note-entry';section.dataset.noteId=note.id;
        section.innerHTML='<div class="rc-note-head"><strong></strong><div class="rc-note-category"></div><label class="rc-note-date"><span></span><input type="date" aria-label="참고 날짜"></label><button type="button" aria-label="참고 삭제"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg></button><button type="button" aria-label="참고 추가"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div><div class="rc-note-category-manager"></div><textarea placeholder="참고 내용을 입력해주세요." maxlength="12000" aria-label="참고 내용"></textarea>';
        const live=()=>active?.id===recordId?active.noteEntries.find(n=>n.id===note.id):null,date=section.querySelector('input[type=date]'),text=section.querySelector('textarea');
        date.oninput=()=>{const current=live();if(!current||!canEdit())return;if(!date.value){date.value=current.date||'';return;}current.date=date.value;section.querySelector('.rc-note-date span').textContent=shortDate(current.date);syncLegacy();markDirty();};
        // The shared date handler opens the picker from the whole field.
        section.querySelector('[aria-label="참고 삭제"]').onclick=()=>{if(!live()||!canEdit()||!confirm('이 참고 메모를 삭제할까요?'))return;active.noteEntries=active.noteEntries.filter(n=>n.id!==note.id);if(!active.noteEntries.length)active.noteEntries.push({id:'note_'+crypto.randomUUID(),date:today(),text:''});syncLegacy();markDirty();renderNotes();};
        section.querySelector('[aria-label="참고 추가"]').onclick=()=>{if(!live()||!canEdit())return;if(active.noteEntries.length>=30){message('참고는 30개까지 추가할 수 있습니다.',true);return;}active.noteEntries.push({id:'note_'+crypto.randomUUID(),date:today(),text:''});syncLegacy();markDirty();renderNotes();box.lastElementChild.querySelector('textarea').focus();};
        text.oninput=()=>{const current=live();if(!current||!canEdit())return;current.text=text.value;syncLegacy();markDirty();};box.append(section);
        if(window.AiselNoteCategories){const picker=window.AiselNoteCategories.mountPicker(section.querySelector('.rc-note-category'),{value:note.categoryId||'',disabled:!edit,managerHost:section.querySelector('.rc-note-category-manager'),onChange:id=>{const current=live();if(!current||!canEdit())return;current.categoryId=id;syncLegacy();markDirty();},onError:e=>message(e?.message||String(e),true)});notePickers.set(note.id,picker);}
      }
      section.querySelector('strong').textContent='참고';section.setAttribute('aria-label','참고 '+(index+1));notePickers.get(note.id)?.setValue(note.categoryId||'');notePickers.get(note.id)?.setDisabled(!edit);section.querySelector('.rc-note-date span').textContent=shortDate(note.date);
      const date=section.querySelector('input[type=date]'),text=section.querySelector('textarea');if(document.activeElement!==date)date.value=note.date||'';date.disabled=!edit;
      if(document.activeElement!==text&&!composing.has(text)&&text.value!==note.text)text.value=note.text||'';text.disabled=!edit;section.querySelectorAll('.rc-note-head>button').forEach(button=>button.disabled=!edit);
    }
  }
  async function restoreDialog(){if(!permissions.canManage||localOnly)return;try{const data=await referenceRequest('refList',{archived:true,limit:40});dialog('복원',box=>{if(!data.items?.length){const p=document.createElement('p');p.textContent='삭제한 자료가 없습니다.';box.append(p);}for(const record of data.items||[]){const button=document.createElement('button');button.type='button';button.textContent=(record.title||'제목 없음')+' · 복원';button.onclick=async()=>{button.disabled=true;try{const result=await referenceRequest('refArchive',{id:record.id,version:record.version,archived:false});if(!result.record||result.record.archivedAt)throw Error('복원을 확인하지 못했습니다.');rememberRecord(result.record,true);gallerySignature='';renderList();button.remove();}catch(e){button.disabled=false;message(errorText(e),true);}};box.append(button);}});}catch(e){message(errorText(e),true);}}
  function confirmArchive(completed){
    const modal=$('#rcDialog');
    return new Promise(resolve=>{
      let accepted=false;
      modal.addEventListener('close',()=>resolve(accepted),{once:true});
      dialog(completed?'참고 완료':'레퍼런스 삭제',box=>{
        const title=document.createElement('p');title.textContent=active?.title||'제목 없음';box.append(title);
        const notice=document.createElement('p');notice.textContent=completed?'참고를 완료한 레퍼런스를 보관할까요? 복원에서 다시 볼 수 있습니다.':'이 레퍼런스를 삭제할까요? 저장된 자료는 보관함에서 복원할 수 있습니다.';box.append(notice);
      },()=>{accepted=true;});
      $('#rcDialogCancel').focus();
    });
  }
  async function archiveRecord(completed=false){
    if(!active||isComposing())return;if(linkEditor?.id===active.id&&!finishLinkEditor())return;
    const id=active.id,epoch=showEpoch,selection=openEpoch,startRevision=revision,stamp=authStamp();
    const sameIntent=()=>active?.id===id&&epoch===showEpoch&&selection===openEpoch&&revision===startRevision;
    if(!await confirmArchive(completed)||!sameIntent())return;
    try{assertAuth(stamp);}catch(e){message(errorText(e),true);return;}
    clearTimeout(autoSaveTimer);
    if(localOnly||!active.version){await removeDraft(id);if(sameIntent()){active=null;dirty=false;pendingFiles=[];showList();setRoute(null,true);}else renderList();return;}
    if(active.permissions?.canArchive!==true||!canEdit())return;if(!await save()||!sameIntent())return;
    const version=active.version;
    try{
      const data=await referenceRequest('refArchive',{id,version,archived:true});if(!data.record?.archivedAt)throw Error('삭제 저장을 확인하지 못했습니다.');rememberRecord(data.record,true);
      if(active?.id!==id||revision===startRevision)await removeDraft(id);
      gallerySignature='';
      if(sameIntent()){active=null;dirty=false;pendingFiles=[];showList();setRoute(null,true);message(completed?'참고 완료로 보관했습니다. 복원에서 다시 볼 수 있습니다.':'삭제한 자료를 시트에 보관했습니다.');}
      else renderList();
    }catch(e){if(active?.id===id&&epoch===showEpoch)message(errorText(e),true);}
  }
  function captureList(){if($('#rcList').hidden)return;galleryScroll=window.scrollY;rememberList();}
  function showList(){if(account)void startLifecycle();referenceCategoryPicker?.close();finishDetailLoad();releasePreviews();$('#rcDetail').hidden=true;$('#rcList').hidden=false;$('#rcLatest').hidden=true;$('#rcSaveCopy').hidden=true;$('.rc-list-tools').after($('#rcNotices'));renderList();renderDrafts();const epoch=showEpoch;requestAnimationFrame(()=>{if(epoch===showEpoch&&visible&&!pane.hidden&&!$('#rcList').hidden){if(!window.AiselReloadStartup?.skipRestore)window.scrollTo(0,galleryScroll);}});}
  function beginDetailLoad(selection){
    referenceCategoryPicker?.close();designerPicker?.close();designerFilterPicker?.close();categoryFilterPicker?.close();dateFilterPicker?.close();clearReadPreview();$('#rcDetailProgress').textContent='자료를 불러오는 중…';detailLoading=selection;$('#rcList').hidden=true;$('#rcDetail').hidden=true;$('#rcDetailLoading').hidden=false;pane.setAttribute('aria-busy','true');
    // The old editable record stays hidden while its own save owns the state.
    // Never put a new record ID on that form before its data is confirmed.
    $('#rcDialog').close();window.scrollTo(0,0);
  }
  function finishDetailLoad(selection){
    if(selection!==undefined&&detailLoading!==selection)return;
    detailLoading=null;clearReadPreview();$('#rcDetailLoading').hidden=true;pane.removeAttribute('aria-busy');
  }
  function clearReadPreview(){summaryPhotoPreview=null;const box=$('#rcReadPreview');if(box){box.replaceChildren();box.hidden=true;}}
  function showSummaryPhotoPreview(id,selection,started){
    const receipt=window.AiselGalleryIndex?.preview?.('references',id);
    if(!receipt||receipt.id!==id||typeof receipt.isCurrent!=='function'||!receipt.isCurrent()||detailLoading!==selection||!visible||pane.hidden)return;
    const url=receipt.source||http(receipt.thumbnail);if(!url)return;
    const box=$('#rcReadPreview'),frame=document.createElement('div'),img=document.createElement('img');
    clearReadPreview();summaryPhotoPreview=receipt;frame.className='rc-photos';img.alt='참고 사진 미리보기';img.decoding='async';img.fetchPriority='high';
    img.onload=()=>{if(summaryPhotoPreview===receipt&&(!receipt.isCurrent()||detailLoading!==selection||!visible||pane.hidden))clearReadPreview();};
    img.onerror=()=>{if(summaryPhotoPreview===receipt)clearReadPreview();};
    img.src=url;frame.append(img);box.append(frame);box.hidden=false;timings.detailPhotoPreviewMs=Math.round(performance.now()-started);
  }
  function showReadPreview(record,selection,started){
    if(detailLoading!==selection||!visible||pane.hidden||!record)return;
    summaryPhotoPreview=null;const box=$('#rcReadPreview');box.replaceChildren();const title=document.createElement('h3');title.textContent=AI.title(record);box.append(title);
    const photo=record.photos?.[0],url=http(photo?.thumb||photo?.original);
    if(url){const frame=document.createElement('div');frame.className='rc-photos';const img=document.createElement('img');bindUploadedPreview(img,url,record.id);img.alt='참고 사진';img.decoding='async';img.fetchPriority='high';if(photo.original&&photo.original!==url)img.onerror=()=>{img.onerror=null;img.src=http(photo.original);};frame.append(img);box.append(frame);}
    for(const note of record.noteEntries||[]){if(!note.text)continue;const paragraph=document.createElement('p');paragraph.textContent=note.text;box.append(paragraph);}
    box.hidden=false;$('#rcDetailProgress').textContent=active&&active.id!==record.id&&(dirty||saveFlight||pendingFiles.length)?'이전 자료 저장 중 · 먼저 확인할 수 있습니다.':'입력 준비 중…';
    timings.detailPreviewMs=Math.round(performance.now()-started);
  }
  function cancelDetailLoad(){
    if(detailLoading===null)return false;
    ++openEpoch;finishDetailLoad();showList();setRoute(null,true);message('');return true;
  }
  async function open(id,options={}){
    ensure();const started=performance.now(),selection=++openEpoch,epoch=showEpoch,stamp=authStamp(),stillVisible=()=>selection===openEpoch&&epoch===showEpoch&&visible&&!pane.hidden&&SaveCore.equal(stamp,authStamp());
    if(!visible||pane.hidden)return false;
    if(isComposing()){void persistDraft();message('입력을 마친 뒤 자료를 선택해주세요.');return false;}
    captureList();beginDetailLoad(selection);showSummaryPhotoPreview(id,selection,started);timings.detailFeedbackMs=Math.round(performance.now()-started);
    const failed=e=>{if(stillVisible()){finishDetailLoad(selection);showList();message(e?errorText(e):saveStatuses.get(account+'|'+active?.id)?.text||'입력을 보관했습니다. 저장 상태를 확인해주세요.',true);}return false;};
    try{
      if(active?.id===id&&(dirty||pendingFiles.length||saveFlight)){
        await access();if(!stillVisible())return false;assertAuth(stamp);if(!authorizedStamp)return failed();assertAuth(authorizedStamp);
        finishDetailLoad(selection);$('#rcList').hidden=true;$('#rcDetail').hidden=false;renderDetail();showSaveStatus();if(options.history!==false)setRoute(id);timings.detailReadyMs=Math.round(performance.now()-started);return true;
      }
      const priorPhoto=active?.id===id?selectedPhoto:0;
      const target=(async()=>{
        // The target only waits for its own durable writes, never another
        // reference's thumbnail encoding or pending photo bytes.
        const scope=account||String(window.AiselAuth?.currentUser()?.email||'').toLowerCase();
        let local=scope?await getDraft(id,scope):null;assertAuth(stamp);
        if(local&&local.record.version===0&&!local.pendingSave){await access();assertAuth(stamp);return {local};}
        try{
          const remote=await remoteDetail(id,options.prefetch,!!local);assertAuth(stamp);
          if(stillVisible())showReadPreview(remote,selection,started);
          if(!local&&scope!==account)local=await getDraft(id);assertAuth(stamp);
          return {local,remote};
        }catch(error){if(!local&&scope!==account&&account){local=await getDraft(id);assertAuth(stamp);}if(local&&error.code==='not_found'&&local.record.version===0&&!local.baseRecord){local.pendingSave=null;return {local};}throw error;}
      })().then(value=>({value}),error=>({error}));
      // The confirmed target can already be viewed while the previous save
      // retains its editor/upload ownership. Editing changes only after its ack.
      const [saved,targetResult]=await Promise.all([save(),target]);
      assertAuth(stamp);if(!stillVisible())return false;
      if(!saved)return failed();if(targetResult.error)throw targetResult.error;
      const {local,remote}=targetResult.value;let record,base=null,conflict=null;
      if(local){
        record=normalizeDetail(clone(local.record));base=local.baseRecord?normalizeDetail(clone(local.baseRecord)):null;
        if(remote){
          const latest=normalizeDetail(clone(remote));if(!base&&record.version===latest.version)base=clone(latest);
          const merged=SaveCore.merge(base,record,latest,local.pendingSave);
          if(merged.ok){record=normalizeDetail(merged.record);base=clone(latest);}else conflict={record:latest,conflicts:merged.conflicts};
        }
      }else{record=normalizeDetail(clone(remote));base=clone(record);}
      if(!record?.id)throw Error('레퍼런스를 찾지 못했습니다.');
      active=record;activeBase=base;pendingSave=local?.pendingSave||null;saveConflict=conflict;
      linkEditor=restoredLinkEditor(local?.linkEditor,record.id);selectedPhoto=priorPhoto;pendingFiles=local?.files||[];replaceHash=local?.replaceHash||null;
      dirty=!!local&&(!base||Object.keys(SaveCore.patch(base,active)).length>0||pendingFiles.length>0||!!linkEditor);revision++;
      finishDetailLoad(selection);$('#rcList').hidden=true;$('#rcDetail').hidden=false;renderDetail();if(options.history!==false)setRoute(id);window.scrollTo(0,0);timings.detailReadyMs=Math.round(performance.now()-started);
      if(conflict)message(errorText({code:'conflict'}),true);
      else{if(local&&!dirty)await removeDraft(id,{revision});assertAuth(stamp);if(!stillVisible())return false;message(local&&dirty?'이 기기에 보관한 입력을 이어서 작성할 수 있습니다.':'');}
      return true;
    }catch(e){if(['auth_changed','session_changed'].includes(e.code)){if(detailLoading===selection&&epoch===showEpoch){await resetAuth();if(visible&&!pane.hidden)showList();}return false;}if(stillVisible())return failed(e);return false;}
    finally{if(detailLoading===selection&&!stillVisible()){finishDetailLoad(selection);if(epoch===showEpoch&&visible&&!pane.hidden)showList();}}
  }
  async function createEntry(){
    if(createFlight||!visible||pane.hidden)return;const epoch=showEpoch,selection=++openEpoch,stillHere=()=>selection===openEpoch&&epoch===showEpoch&&visible&&!pane.hidden;
    if(isComposing()){void persistDraft();return;}
    captureList();beginDetailLoad(selection);createFlight=true;$('#rcCreate').disabled=true;
    try{
      if(!authorizedStamp){if(!window.AiselAuth?.currentUser?.()&&config.login)await config.login();if(!stillHere())return;await access();}
      if(!stillHere())return;
      if(!permissions.canCreate){message('레퍼런스 등록 권한이 필요합니다.',true);return;}
      if(!await create(epoch,selection)||!stillHere())return;
    }catch(e){if(stillHere()&&!['auth_changed','session_changed'].includes(e.code))message(errorText(e),true);}
    finally{createFlight=false;$('#rcCreate').disabled=!!authorizedStamp&&permissions.canCreate!==true;if(detailLoading===selection){finishDetailLoad(selection);if(epoch===showEpoch&&visible&&!pane.hidden)showList();}}
  }
  function deleteLink(){
    if(!canEdit())return;const links=active.sourceLinks||[];if(!links.length)return;
    const remove=index=>{if(!confirm('이 링크를 삭제할까요? 사진과 참고는 유지됩니다.'))return;active.sourceLinks.splice(index,1);syncLegacy();markDirty();updateSource();$('#rcDialog').close();};
    if(links.length===1){remove(0);return;}
    dialog('삭제할 링크',box=>links.forEach((url,index)=>{const button=document.createElement('button');button.type='button';button.className='rc-link-delete-item';button.textContent=url;button.onclick=()=>remove(index);box.append(button);}));
  }
  async function create(epoch=showEpoch,selection=openEpoch){const stamp=authStamp();if(!permissions.canCreate||!await save())return;assertAuth(stamp);if(selection!==openEpoch||epoch!==showEpoch||!visible||pane.hidden)return;captureList();const choice=initialReferenceCategory();active={id:'ref_'+crypto.randomUUID().replace(/-/g,''),version:0,title:'',date:today(),designer:'',category:choice?.category||'',contentType:choice?.contentType||'',noteEntries:[{id:'note_'+crypto.randomUUID(),date:today(),text:''}],sourceLinks:[],notes:'',sourceUrl:'',categoryMode:'manual',photos:[],permissions:{canEdit:true,canArchive:false}};activeBase=null;pendingSave=null;saveConflict=null;pendingFiles=[];linkEditor=null;dirty=true;revision++;finishDetailLoad(selection);$('#rcList').hidden=true;$('#rcDetail').hidden=false;renderDetail();setRoute(active.id);await persistDraft();message('');return true;}
  function renderDetail(){normalizeDetail(active);$('.rc-detail-actions').before($('#rcNotices'));$('#rcLatest').hidden=!saveConflict;$('#rcSaveCopy').hidden=!saveConflict||!permissions.canCreate;$('#rcSave').disabled=!!saveFlight||!canEdit();fields.forEach(k=>{const input=$('[data-rc-field="'+k+'"]');if(input.dataset.recordId!==active.id||document.activeElement!==input&&!composing.has(input)&&input.value!==(active[k]||''))input.value=active[k]||'';input.dataset.recordId=active.id;input.disabled=!canEdit();});$('#rcSave').hidden=!canEdit();$('#rcDelete').hidden=!canEdit()||!(active.version===0||active.permissions?.canArchive);$('#rcDelete').disabled=!!saveFlight;$('#rcCategory').disabled=!canEdit();$('#rcDate').value=active.date||'';$('#rcDate').disabled=!canEdit();$('#rcDateText').textContent=shortDate(active.date);renderReferenceCategory();renderDesigner();updateSource();renderPhotos();renderNotes();renderAnalysis();$('[data-rc-field="title"]').placeholder=AI.title(active);}
  function updateSource(){
    const editing=linkEditor?.id===active?.id,tools=$('.rc-link-tools');tools.classList.toggle('is-editing',editing);$('#rcLinkEditor').hidden=!editing;
    for(const id of ['rcSourceOpen','rcLinkEdit','rcLinkDelete'])$('#'+id).hidden=editing;
    if(editing){const input=$('#rcLinkInput');if(document.activeElement!==input&&!composing.has(input))input.value=linkEditor.text;input.disabled=!canEdit();return;}
    $('#rcLinkError').hidden=true;$('#rcLinkEdit').disabled=!canEdit();$('#rcLinkDelete').disabled=!canEdit()||!active?.sourceLinks?.length;$('#rcSourceOpen').title=active?.sourceLinks?.[0]||'링크 입력';
  }
  function productReviewKey(record){return record.id+'|'+record.version+'|'+(record.analysisSignature||'')+'|'+sourceKey(record);}
  function loadProductReview(){
    if(!sourceConfirmed()||active.category!=='product'||permissions.referenceJudgmentVersion!==203)return;
    const key=productReviewKey(active),cached=productReviews.get(key);if(cached&&Date.now()-cached.at<60000)return;
    const id=active.id,version=active.version,hash=active.analysisSignature,epoch=authEpoch,entry={state:'loading',at:Date.now()};productReviews.set(key,entry);
    call('refJudgment',{id}).then(data=>{if(epoch!==authEpoch||productReviews.get(key)!==entry)return;if(data.referenceJudgmentVersion!==203||data.referenceId!==id||(!Number.isInteger(data.referenceVersion)||data.referenceVersion<version)||!data.inputHash||data.currentInputHash!==data.inputHash||(hash&&data.inputHash!==hash))throw Error('현재 자료의 판별 결과를 확인하지 못했습니다.');
      const review=data.review,done=data.state==='done'&&review?.id===data.candidateId&&Number(review.version)===Number(data.candidateVersion)&&review.receipt&&review.runId&&review.reviewedAt&&review.basis;
      if(data.state==='done'&&!done)throw Error('판별 결과 저장 확인이 필요합니다.');productReviews.set(key,{...data,state:done?'done':data.state,at:Date.now()});
    }).catch(error=>{if(epoch===authEpoch&&productReviews.get(key)===entry)productReviews.set(key,{state:'error',error:error.message,at:Date.now()});}).finally(()=>{if(epoch===authEpoch&&active?.id===id&&productReviewKey(active)===key)renderAnalysis();});
  }
  function prepareProductJudgment(record){
    if(permissions.referenceJudgmentVersion!==203||record?.category!=='product'||!record.version||!(record.photos?.length||record.sourceLinks?.length))return Promise.resolve(false);
    const key=productReviewKey(record),existing=productReviews.get(key);if(existing?.request)return existing.request;
    const epoch=authEpoch,entry={state:'submitting',at:Date.now()},id=record.id;productReviews.set(key,entry);
    const task=(async()=>{try{const data=await call('refPrepareJudgment',{id,version:record.version,inputHash:record.analysisSignature});if(epoch!==authEpoch||productReviews.get(key)!==entry)return false;
      if(data.referenceJudgmentVersion!==203||data.referenceId!==id||(!Number.isInteger(data.referenceVersion)||data.referenceVersion<record.version)||!data.inputHash||data.currentInputHash!==data.inputHash||(record.analysisSignature&&data.inputHash!==record.analysisSignature)||!data.candidateId||data.queuedAcknowledged!==true||!['queued','running','blocked','error','done'].includes(data.state))throw Error('제품 판별 접수를 확인하지 못했습니다.');
      productReviews.delete(key);if(active?.id===id&&productReviewKey(active)===key)loadProductReview();return true;
    }catch(error){if(epoch===authEpoch&&productReviews.get(key)===entry)productReviews.set(key,{state:'request-error',error:error.message,at:Date.now()});return false;}finally{if(epoch===authEpoch&&active?.id===id&&productReviewKey(active)===key)renderAnalysis();}})();entry.request=task;return task;
  }
  function appendProductRequest(box,state){
    if(!active?.version||active.category!=='product'||permissions.referenceJudgmentVersion!==203||!canEdit()||!(active.photos?.length||active.sourceLinks?.length)||!['unlinked','pending','stale','error','blocked','request-error'].includes(state))return;
    const button=document.createElement('button');button.type='button';button.className='rc-review-request';button.textContent=['unlinked','pending'].includes(state)?'판별 요청':'판별 요청 다시 확인';button.onclick=async()=>{const id=active.id,epoch=showEpoch;button.disabled=true;try{if(!await save()||active?.id!==id||epoch!==showEpoch||!visible)return;await prepareProductJudgment(clone(active));}finally{button.disabled=false;}};box.append(button);
  }
  function canOpenProductWorkorder(){return !!active?.version&&active.category==='product'&&permissions.referenceJudgmentVersion===203&&typeof window.AiselDesignMeeting?.openReferenceWorkorder==='function'&&canEdit();}
  function renderWorkorderAction(){
    const button=$('#rcWorkorder');if(!button)return;button.hidden=!canOpenProductWorkorder();button.disabled=workorderFlight?.id===active?.id;
  }
  async function openProductWorkorder(){
    if(!canOpenProductWorkorder()||workorderFlight||isComposing())return;
    const id=active.id,epoch=showEpoch,selection=openEpoch,stamp=authStamp(),flight={id};workorderFlight=flight;renderWorkorderAction();
    try{if(!await save())return;assertAuth(stamp);if(active?.id!==id||epoch!==showEpoch||selection!==openEpoch||!visible||!canOpenProductWorkorder())return;await window.AiselDesignMeeting.openReferenceWorkorder(clone(active));}
    catch(error){if(active?.id===id&&epoch===showEpoch)message(error.message,true);}
    finally{if(workorderFlight===flight)workorderFlight=null;renderWorkorderAction();}
  }
  function renderAnalysis(){
    if(!active||!pane)return;
    // v216 hides the judgment panel without modifying stored results or its
    // background request/receipt flow. Workorder conversion retains that flow.
    $('#rcAIExtra').hidden=true;renderWorkorderAction();
    if(active.category==='product'&&sourceConfirmed())loadProductReview();
  }
  function releasePreviews(all=false){photoSignature='';for(const [src,entry]of uploadedPreviews)if(all||entry.ready)uploadedPreviews.delete(src);for(const [file,url]of previewUrls)if(![...uploadedPreviews.values()].some(entry=>entry.url===url)){URL.revokeObjectURL(url);previewUrls.delete(file);}objectUrls=[];}
  // Upload acknowledgement does not mean the returned Storage URL is decoded
  // in this browser. Keep the selected image until that independent read is ready.
  function rememberUploadedPreview(id,src,file){
    if(!http(src)||!file)return;if(!previewUrls.has(file))previewUrls.set(file,URL.createObjectURL(file));
    for(const [key,entry]of uploadedPreviews)if(entry.ready)uploadedPreviews.delete(key);
    uploadedPreviews.set(src,{id,url:previewUrls.get(file),bytes:file.size||0,stamp:authStamp(),ready:false,flight:null});
    while(uploadedPreviews.size>1&&(uploadedPreviews.size>8||[...uploadedPreviews.values()].reduce((sum,entry)=>sum+entry.bytes,0)>32*1024*1024)){const key=uploadedPreviews.keys().next().value;uploadedPreviews.delete(key);}
  }
  function bindUploadedPreview(img,src,id){
    const entry=uploadedPreviews.get(src),binding={src,id,source:window.AiselGalleryIndex?.imageSource?.('references',id,src)||src};img._aiselPhotoBinding=binding;
    let current=false;try{if(entry){assertAuth(entry.stamp);current=entry.id===id;}}catch(_){}
    if(!current||entry.ready){const fallback=img.onerror;img.onerror=()=>{if(img.src!==src){img.src=src;img.onerror=fallback;}else fallback?.();};img.src=binding.source;return;}
    img.src=entry.url;
    // A failed remote read leaves the local image visible. A later render may retry.
    if(!entry.flight)entry.flight=(window.AiselGalleryImages?.preload?.(src,'references')||Promise.resolve(false)).then(ok=>{if(ok)entry.ready=true;return ok;}).catch(()=>false).finally(()=>entry.flight=null);
    entry.flight.then(ok=>{if(!ok||uploadedPreviews.get(src)!==entry||img._aiselPhotoBinding!==binding||img.isConnected===false)return;try{assertAuth(entry.stamp);}catch(_){return;}img.src=src;});
  }
  function choosePhoto(index){if(!canEdit()||photoFlight)return;dialog('사진',box=>{for(const[label,mode,source]of [['사진 촬영','append','rcCameraInput'],['앨범에서 추가','append','rcPhotoInput'],...(active.photos?.[index]?[['이 사진 교체','replace','rcPhotoInput']]:[])]){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{photoMode=mode;replaceHash=mode==='replace'?active.photos[index].hash:null;$('#rcPhotoInput').multiple=mode!=='replace';$('#rcDialog').close();$('#'+source).click();};box.append(b);}if(index>=0){const remove=document.createElement('button');remove.type='button';remove.textContent='이 사진 삭제';remove.onclick=()=>{if(!confirm('이 사진을 레퍼런스에서 삭제할까요?'))return;if(index<active.photos.length)active.photos.splice(index,1);else pendingFiles.splice(index-active.photos.length,1);markDirty();renderPhotos();$('#rcDialog').close();};box.append(remove);}});}
  function renderPhotos(){
    const signature=JSON.stringify([active?.id,active?.photos,pendingFiles.map(f=>[f.name,f.size,f.lastModified]),selectedPhoto,canEdit()]);const busy=!canEdit()||!!photoFlight;
    if(signature===photoSignature){$('#rcPhotos').querySelectorAll('.rc-photo-open,.rc-empty-photo-actions button').forEach(button=>button.disabled=busy);return;}
    photoSignature=signature;for(const [file,url]of previewUrls)if(!pendingFiles.includes(file)&&![...uploadedPreviews.values()].some(entry=>entry.url===url)){URL.revokeObjectURL(url);previewUrls.delete(file);}
    const box=$('#rcPhotos');box.replaceChildren();const all=[...(active?.photos||[]).map(p=>({url:http(p.thumb||p.original),original:http(p.original),saved:true})),...pendingFiles.map(file=>({file,saved:false}))];selectedPhoto=Math.max(0,Math.min(selectedPhoto,all.length-1));
    if(!all.length){box.onpointerdown=box.onpointerup=box.onpointercancel=null;const empty=document.createElement('div');empty.className='rc-photo-empty';const actions=document.createElement('div');actions.className='rc-empty-photo-actions';for(const[label,source]of [['사진 촬영','rcCameraInput'],['앨범 선택','rcPhotoInput']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=busy;button.onclick=()=>{if(!canEdit()||photoFlight)return;photoMode='append';replaceHash=null;$('#rcPhotoInput').multiple=true;$('#'+source).click();};actions.append(button);}empty.append(actions);box.append(empty);return;}
    const photo=all[selectedPhoto];if(photo.file){if(!previewUrls.has(photo.file))previewUrls.set(photo.file,URL.createObjectURL(photo.file));photo.url=previewUrls.get(photo.file);}
    const frame=document.createElement('figure'),open=document.createElement('button');open.type='button';open.className='rc-photo-open';open.setAttribute('aria-label','사진 '+(selectedPhoto+1)+' 촬영·추가·교체');open.disabled=busy;open.onclick=()=>{if(Date.now()>=suppressPhotoClickUntil)choosePhoto(selectedPhoto);};
    const img=document.createElement('img');if(photo.saved&&photo.original&&photo.original!==photo.url)img.onerror=()=>{img.onerror=null;img.src=photo.original;};if(photo.saved)bindUploadedPreview(img,photo.url,active.id);else img.src=photo.url;img.alt='참고 사진 '+(selectedPhoto+1);img.decoding='async';img.loading='eager';img.fetchPriority='high';open.append(img);frame.append(open);box.append(frame);
    if(all.length>1){
      const controls=document.createElement('div');controls.className='rc-photo-nav';const counter=document.createElement('span');counter.id='rcPhotoCounter';counter.textContent=(selectedPhoto+1)+' / '+all.length;counter.setAttribute('aria-live','polite');
      const turn=step=>{selectedPhoto=Math.max(0,Math.min(selectedPhoto+step,all.length-1));renderPhotos();};
      for(const [step,label,glyph]of [[-1,'이전 사진','‹'],[1,'다음 사진','›']]){const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',label);button.textContent=glyph;button.disabled=step<0?selectedPhoto===0:selectedPhoto===all.length-1;button.onclick=()=>turn(step);controls.append(button);if(step<0)controls.append(counter);}frame.append(controls);
      let touch=null;box.onpointerdown=e=>{touch=e.target.closest('.rc-photo-nav')?null:{x:e.clientX,y:e.clientY};};box.onpointerup=e=>{if(!touch)return;const dx=e.clientX-touch.x,dy=e.clientY-touch.y;touch=null;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.5){suppressPhotoClickUntil=Date.now()+350;turn(dx<0?1:-1);}};box.onpointercancel=()=>{touch=null;};
    }else{box.onpointerdown=box.onpointerup=box.onpointercancel=null;}
  }
  function scheduleSave(){clearTimeout(autoSaveTimer);if(saveConflict)return;autoSaveTimer=setTimeout(()=>{if(linkEditor?.id===active?.id||[...composing].some(node=>node.isConnected)||referenceCategoryPicker?.hasDraft?.()||[...notePickers.values()].some(picker=>picker.hasDraft?.()))return;save();},600);}
  function markDirty(){dirty=true;revision++;saveStatuses.delete(account+'|'+active?.id);renderAnalysis();message(localOnly?'입력 중 · 시트 연결 대기':'입력 중');clearTimeout(draftTimer);draftTimer=setTimeout(()=>persistDraft().catch(()=>message('이 기기에 입력을 보관하지 못했습니다. 창을 닫기 전에 저장해주세요.',true)),250);scheduleSave();}
  async function receive(files){if(!active||!canEdit())return;if(photoFlight){message('사진을 저장하고 있습니다. 완료 후 추가해주세요.');return;}let valid=[...files].filter(f=>/^image\/(jpeg|png|webp|gif)$/.test(f.type));if(!valid.length){message('JPG, PNG, WebP, GIF 사진을 선택해주세요.',true);return;}if(photoMode==='replace')valid=valid.slice(0,1);if((active.photos?.length||0)+pendingFiles.length+valid.length-(replaceHash?1:0)>12){message('사진은 한 레퍼런스에12장까지 등록할 수 있습니다.',true);return;}if(valid.some(f=>f.size>26214400)){message('사진 한 장은25MB 이하로 선택해주세요.',true);return;}pendingFiles.push(...valid);selectedPhoto=(active.photos?.length||0)+pendingFiles.length-1;markDirty();renderPhotos();await persistDraft();}
  async function digest(file){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');}
  async function thumbnail(file){const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');const scale=Math.min(1,480/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);let blob;for(const quality of [.8,.65,.5,.35,.2]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=102400)break;}if(!blob||blob.size>102400)throw Error('사진 미리보기 생성에 실패했습니다. 다른 사진으로 다시 시도해주세요.');return {blob,width:image.naturalWidth,height:image.naturalHeight};}finally{URL.revokeObjectURL(url);}}
  function encode(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
  async function uploadPhotos(expectedId=active?.id,stamp=authStamp()){
    const check=()=>{assertAuth(stamp);if(active?.id!==expectedId)throw Object.assign(Error('열린 자료가 변경되었습니다.'),{code:'session_changed'});};
    while(pendingFiles.length){
      check();const file=pendingFiles[0],pair=typeof AiselPhoto.preparePair==='function'?await AiselPhoto.preparePair(file,'collection'):null;check();
      const prepared=pair?.prepared||await AiselPhoto.prepare(file,'collection');check();const hash=await digest(prepared.blob);check();active.photos||=[];
      if(!active.photos.some(photo=>photo.hash===hash)){
        const thumb=pair?.thumb||await thumbnail(prepared.blob);check();const writer=collectionWriter();let uploaded;
        if(writer){
          if(typeof writer.uploadPhotos!=='function')throw Object.assign(Error('사진 저장 연결을 확인해주세요. 입력은 유지됩니다.'),{code:'connection_pending'});
          uploaded=await writer.uploadPhotos('references',{id:expectedId,hash,original:prepared.blob,thumb:thumb.blob});check();
          if(![uploaded?.original,uploaded?.thumb].every(url=>typeof url==='string'&&url.startsWith('https://')&&http(url)))throw Error('사진 저장을 확인하지 못했습니다.');
        }else{
          const originalData=await encode(prepared.blob),thumbData=await encode(thumb.blob);check();
          const original=(await call('refUpload',{id:expectedId,hash,kind:'original',mime:prepared.blob.type,data:originalData})).photo;check();
          const small=(await call('refUpload',{id:expectedId,hash,kind:'thumb.jpg',mime:'image/jpeg',data:thumbData})).photo;check();
          uploaded={original:original?.url,thumb:small?.url};
          if(!http(uploaded.original)||!http(uploaded.thumb))throw Error('사진 저장을 확인하지 못했습니다.');
        }
        active.photos.push({hash,original:uploaded.original,thumb:uploaded.thumb,width:thumb.width,height:thumb.height,bytes:prepared.bytes,sourceBytes:file.size,sourceWidth:prepared.sourceWidth,sourceHeight:prepared.sourceHeight,thumbBytes:thumb.blob.size});
      }
      rememberUploadedPreview(expectedId,active.photos.find(photo=>photo.hash===hash)?.thumb,file);
      if(replaceHash){active.photos=active.photos.filter(photo=>photo.hash!==replaceHash||photo.hash===hash);replaceHash=null;photoMode='append';}
      pendingFiles.shift();await persistDraft();check();
    }
    renderPhotos();
  }
  function detailVisible(){return visible&&!pane.hidden&&!$('#rcDetail').hidden;}
  function saveMessage(id,text,error=false){
    if(active?.id!==id)return;
    saveStatuses.set(account+'|'+id,{text,error});
    if(detailVisible())message(text,error);
    else if(visible&&!pane.hidden&&!$('#rcList').hidden&&!dirty&&!error)message('');
  }
  function showSaveStatus(){const status=saveStatuses.get(account+'|'+active?.id);if(status&&detailVisible())message(status.text,status.error);}
  function clearConflict(){saveConflict=null;$('#rcLatest').hidden=true;$('#rcSaveCopy').hidden=true;}
  async function saveSnapshot(snapshot,base,assertCurrent){
    let current=clone(snapshot),confirmed=base?clone(base):null,attempt=pendingSave;
    // Older drafts did not record their confirmed base. Read before writing;
    // identical data is already saved, but differing unknown input is not safe to overwrite.
    if(current.version>0&&!confirmed){
      const remote=normalizeDetail(clone(await remoteDetail(current.id,null,true)));assertCurrent();
      if(current.version===remote.version)confirmed=clone(remote);
      const merged=SaveCore.merge(confirmed,current,remote,attempt);
      if(!merged.ok){saveConflict={record:remote,conflicts:merged.conflicts};throw Object.assign(Error('저장 내용을 선택해주세요.'),{code:'conflict'});}
      current=merged.record;confirmed=remote;
    }
    for(let tries=0;tries<3;tries++){
      assertCurrent();const patch=SaveCore.patch(confirmed,current);
      if(!Object.keys(patch).length&&confirmed)return {record:confirmed,snapshot:current};
      pendingSave={base:confirmed,snapshot:clone(current),patch:clone(patch)};
      await persistDraft();assertCurrent();
      try{
        const data=await referenceRequest('refSave',{id:current.id,version:current.version,patch});assertCurrent();
        if(!data.record||data.record.id!==current.id||!(data.record.version>current.version))throw Error('저장을 확인하지 못했습니다. 입력을 유지했습니다.');
        return {record:data.record,snapshot:current};
      }catch(e){
        if(e.code!=='conflict'||tries===2)throw e;
        const remote=normalizeDetail(clone(await remoteDetail(current.id,null,true)));assertCurrent();
        const merged=SaveCore.merge(confirmed,current,remote,attempt);
        if(!merged.ok){saveConflict={record:remote,conflicts:merged.conflicts};throw e;}
        current=merged.record;confirmed=remote;attempt=null;
      }
    }
  }
  async function save(){
    clearTimeout(autoSaveTimer);
    if(isComposing()){await persistDraft();return false;}
    if(!await flushNotePickers())return false;
    if(linkEditor?.id===active?.id&&!finishLinkEditor())return false;clearTimeout(autoSaveTimer);
    if(localOnly&&active){if(!canEdit()){message('로그인 상태를 확인해주세요.',true);return false;}const ok=await persistDraft();message(ok?'이 기기에 임시 보관됨 · 시트 연결 대기':'임시 보관에 실패했습니다. 창을 닫기 전에 내용을 복사해주세요.',!ok);return ok;}
    if(saveFlight)return saveFlight;
    if(!active||!dirty&&!pendingFiles.length)return true;
    try{await window.AiselAuth?.ready?.({allowGuardRequest:true});}catch(e){message(e.message,true);return false;}
    if(saveFlight)return saveFlight;if(!active||!dirty&&!pendingFiles.length)return true;
    if(active.version===0&&!String(active.title||'').trim()&&!(active.noteEntries||[]).some(n=>n.text.trim()||n.categoryId)&&!active.sourceUrl&&!(active.photos||[]).length&&!pendingFiles.length){const emptyId=active.id,emptyRevision=revision;await removeDraft(emptyId,{revision:emptyRevision});if(active?.id!==emptyId||revision!==emptyRevision)return false;dirty=false;return true;}
    if(!canEdit()){message('이 레퍼런스는 조회만 가능합니다.',true);return false;}
    if(!active.category){message('카테고리를 선택해주세요.',true);await persistDraft();return false;}
    if(active.sourceUrl&&!http(active.sourceUrl)){message('출처 링크는 http 또는 https 주소로 입력해주세요.',true);await persistDraft();return false;}
    const id=active.id,stamp=authStamp(),scope=account,priorSource=reviewSourceKeys.get(id);
    const assertCurrent=()=>{assertAuth(stamp);if(active?.id!==id||account!==scope)throw Object.assign(Error('열린 자료가 변경되었습니다.'),{code:'session_changed'});};
    const task=async()=>{
      $('#rcSave').disabled=true;$('#rcDelete').disabled=true;
      try{
        await persistDraft();assertCurrent();saveMessage(id,'저장 중…');
        if(active.noteEntries?.some(note=>note.categoryId)&&permissions.noteCategoriesVersion!==203)throw Object.assign(Error('참고 분류 저장 연결 준비 중입니다. 입력은 이 기기에 보관됩니다.'),{code:'category_backend_pending'});
        for(const categoryId of new Set((active.noteEntries||[]).map(note=>note.categoryId).filter(Boolean))){if(!window.AiselNoteCategories)throw Error('참고 분류 저장 연결을 확인해주세요. 입력은 이 기기에 보관됩니다.');await window.AiselNoteCategories.ensure(categoryId);assertCurrent();}
        photoFlight=uploadPhotos(id,stamp);await photoFlight;photoFlight=null;assertCurrent();
        const snapshot=clone(active),sentRevision=revision,base=activeBase?clone(activeBase):null;
        const data=await saveSnapshot(snapshot,base,assertCurrent);assertCurrent();rememberRecord(data.record,true);
        if(data.snapshot.categoryMode==='manual'&&(data.snapshot.category!==data.record.category||String(data.snapshot.contentType||'')!==String(data.record.contentType||''))){active.version=data.record.version;active.permissions=data.record.permissions;throw Object.assign(Error('카테고리의 서버 저장을 확인하지 못했습니다. 입력은 이 기기에 보관했습니다.'),{code:'category_not_retained'});}
        const returnedNotes=new Map((data.record.noteEntries||[]).map(note=>[note.id,note]));
        if((data.snapshot.noteEntries||[]).some(note=>(note.categoryId||'')!==(returnedNotes.get(note.id)?.categoryId||''))){active.version=data.record.version;active.permissions=data.record.permissions;throw Object.assign(Error('참고 분류의 서버 저장을 확인하지 못했습니다. 입력은 이 기기에 보관했습니다. 다시 저장해주세요.'),{code:'category_not_retained'});}
        // Type-ahead belongs to the next save. Merge it onto the acknowledged
        // record instead of replacing the form or keeping its stale version.
        const after=sentRevision===revision?{ok:true,record:data.record}:SaveCore.merge(snapshot,active,data.record);
        if(!after.ok){activeBase=clone(snapshot);saveConflict={record:data.record,conflicts:after.conflicts};await persistDraft();throw Object.assign(Error('저장 내용을 선택해주세요.'),{code:'conflict'});}
        active=normalizeDetail(clone(after.record));activeBase=normalizeDetail(clone(data.record));pendingSave=null;clearConflict();
        dirty=Object.keys(SaveCore.patch(activeBase,active)).length>0||pendingFiles.length>0||!!linkEditor;
        if(dirty)await persistDraft();else await removeDraft(id,{revision});assertCurrent();
        gallerySignature='';renderList();if(detailVisible())renderDetail();
        if(window.AISEL_NATIVE_ENABLED!==true&&data.record.category==='product'&&(data.record.photos?.length||data.record.sourceLinks?.length)&&(snapshot.version===0||sourceKey(data.record)!==priorSource)&&permissions.referenceJudgmentVersion===203)void prepareProductJudgment(data.record);
        saveMessage(id,dirty?'입력 중':'저장됨');return !dirty;
      }catch(e){
        try{assertCurrent();}catch(_){return false;}
        await persistDraft().catch(()=>{});if(e.code==='conflict')saveConflict||={};saveMessage(id,errorText(e),true);return false;
      }finally{photoFlight=null;if(active?.id===id&&account===scope){$('#rcSave').disabled=!canEdit();$('#rcDelete').disabled=false;}}
    };
    saveFlight=task();const ownFlight=saveFlight;
    try{return await ownFlight;}finally{if(saveFlight===ownFlight)saveFlight=null;if(active?.id===id&&account===scope){$('#rcDelete').hidden=!canEdit()||!(active.version===0||active.permissions?.canArchive);renderPhotos();if(dirty&&!saveStatuses.get(scope+'|'+id)?.error)scheduleSave();}}
  }
  async function back(){if(cancelDetailLoad())return true;if(!await canLeave())return false;active=null;linkEditor=null;dirty=false;pendingFiles=[];showList();if(history.state?.aiselReference?.id)history.back();else setRoute(null,true);return true;}
  function db(){if(!draftDb)draftDb=new Promise((resolve,reject)=>{const r=indexedDB.open('aisel-reference-inputs',2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('inputs'))r.result.createObjectStore('inputs',{keyPath:'key'});if(!r.result.objectStoreNames.contains('media'))r.result.createObjectStore('media',{keyPath:'key'});};r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();draftDb=null;};resolve(r.result);};r.onerror=()=>{draftDb=null;reject(r.error);};});return draftDb;}
  async function storage(mode,value,table='inputs'){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction(table,mode==='all'||mode==='get'?'readonly':'readwrite'),store=tx.objectStore(table);const request=mode==='put'?store.put(value):mode==='delete'?store.delete(value):mode==='get'?store.get(value):store.getAll();let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
  async function preserveFile(file,scope){let byScope=draftFileKeys.get(file);if(!byScope){byScope=new Map();draftFileKeys.set(file,byScope);}if(!byScope.has(scope)){const task=(async()=>{const data=await file.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('');const key=scope+'|'+hash;if(!await storage('get',key,'media'))await storage('put',{key,data,name:file.name,type:file.type,lastModified:file.lastModified},'media');return key;})();byScope.set(scope,task);task.catch(()=>byScope.delete(scope));}return byScope.get(scope);}
  function trackDraftWrite(key,task){draftRecordWrites.set(key,task);const done=()=>{if(draftRecordWrites.get(key)===task)draftRecordWrites.delete(key);};task.then(done,done);return task;}
  async function persistDraft(){if(!account||!active||!dirty&&!pendingFiles.length&&!linkEditor)return true;const item={key:account+'|'+active.id,account,id:active.id,record:clone(active),baseRecord:activeBase?clone(activeBase):null,pendingSave:pendingSave?clone(pendingSave):null,at:Date.now(),replaceHash,linkEditor:linkEditor?.id===active.id?clone(linkEditor):null},files=[...pendingFiles];const task=draftWrites.catch(()=>{}).then(async()=>{item.fileKeys=await Promise.all(files.map(f=>preserveFile(f,item.key)));if(files.length&&!item.record.photos?.length){const first=files[0];if(!draftPreviews.has(first))draftPreviews.set(first,thumbnail(first).then(async({blob})=>'data:image/jpeg;base64,'+await encode(blob)).catch(()=>''));item.preview=await draftPreviews.get(first);}await storage('put',item);return true;});draftWrites=task;trackDraftWrite(item.key,task);try{await task;draftStored=true;if(item.account===account){draftRows.set(item.id,item);gallerySignature='';if($('#rcDetail').hidden)renderList();}return true;}catch(_){draftStored=false;if(!saveFlight)message('이 기기에 입력을 보관하지 못했습니다. 창을 닫기 전에 저장해주세요.',true);return false;}}
  async function getDraft(id,owner=account){const key=owner+'|'+id;await draftRecordWrites.get(key)?.catch(()=>{});const item=await storage('get',key);if(!item)return item;if(item.fileKeys){item.files=await Promise.all(item.fileKeys.map(async key=>{const media=await storage('get',key,'media');if(!media)throw Error('보관한 사진을 읽지 못했습니다. 현재 화면을 유지해주세요.');return new File([media.data],media.name,{type:media.type,lastModified:media.lastModified});}));}return item;}
  async function removeDraft(id,options={}){
    const scope=account+'|'+id,owner=account;
    const task=draftWrites.catch(()=>{}).then(async()=>{
      if(options.revision!==undefined&&(account!==owner||active?.id!==id||revision!==options.revision))return false;
      await storage('delete',scope);if(account===owner){draftRows.delete(id);gallerySignature='';}
      const database=await db();await new Promise((resolve,reject)=>{const tx=database.transaction('media','readwrite'),cursor=tx.objectStore('media').openCursor(IDBKeyRange.bound(scope+'|',scope+'|\uffff'));cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue();}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});return true;
    });draftWrites=task;trackDraftWrite(scope,task);try{return await task;}catch(_){return false;}
  }
  async function copyRecoveryDraft(){
    const stamp=authStamp(),owner=account,sourceId=active?.id;
    if(!sourceId||!await persistDraft())return null;assertAuth(stamp);
    const source=await getDraft(sourceId);assertAuth(stamp);if(!source||source.account!==owner||account!==owner)return null;
    const id='ref_'+crypto.randomUUID().replace(/-/g,''),scope=owner+'|'+id;
    const record={...clone(source.record),id,version:0,title:(source.record.title||AI.title(source.record)).slice(0,140)+' · 보관한 입력',archivedAt:'',createdAt:new Date().toISOString(),updatedAt:'',permissions:{canEdit:true,canArchive:false},analysis:null,analysisSignature:'',analysisState:'idle',reviewedAt:'',analysisReceipt:''};
    const item={...source,key:scope,id,record,baseRecord:null,pendingSave:null,recoveryOf:source.id,at:Date.now(),linkEditor:source.linkEditor?{...source.linkEditor,id}:null};delete item.files;
    const task=draftWrites.catch(()=>{}).then(async()=>{item.fileKeys=await Promise.all((source.files||[]).map(file=>preserveFile(file,scope)));await storage('put',item);});draftWrites=task;trackDraftWrite(scope,task);await task;
    if(item.account===account){draftRows.set(id,item);gallerySignature='';}return item;
  }


  async function renderDrafts(){
    const scope=account,epoch=authEpoch,read=++draftRead;if(!scope)return;
    try{const list=(await storage('all')).filter(d=>d.account===scope);if(scope!==account||epoch!==authEpoch||read!==draftRead)return;draftRows=new Map(list.map(d=>[d.id,d]));renderList();}catch(_){/* Keep cards already rendered when local storage is unavailable. */}
  }
  window.addEventListener('popstate',async e=>{if(!pane||!visible)return;const match=location.hash.match(/^#reference=(.+)$/);if(match){await open(decodeURIComponent(match[1]),{history:false});return;}if(location.hash==='#references'){if(!await canLeave()){setRoute(active?.id,true);return;}active=null;dirty=false;pendingFiles=[];restoreList(e.state?.aiselReference);showList();return;}if(!await leave()){setRoute(active?.id,true);return;}config.onExit?.();});
  async function resetAuth(){
    clearTimeout(lifeUndoTimer);$('#rcLifeToast')?.remove();lifecycle?.reset();lifeFilter='active';listLimit=24;listFilterKey='';if(pane)$('#rcLifeFilter').value='active';const epoch=++authEpoch;referenceCategoryPicker?.destroy();referenceCategoryPicker=null;referenceCategoryIdentity='';dateFilterPicker?.close();designerPicker?.destroy();designerPicker=null;designerPickerIdentity='';designerFilterPicker?.destroy();designerFilterPicker=null;categoryFilterPicker?.destroy();categoryFilterPicker=null;for(const picker of notePickers.values())picker.destroy();notePickers.clear();noteRenderId='';saveStatuses.clear();galleryEpoch++;galleryState=null;galleryOwned=false;preloadFlight=null;categoryCoverageErrors.clear();categoryCoverageFlight=null;reviewSourceKeys.clear();productReviews.clear();openEpoch++;authorizedStamp=null;accessAt=0;accessFlight=null;listFlight=null;detailCache.clear();detailFlights.clear();listReadAt=0;draftRead++;role=null;permissions={};loading=false;if(!pane)return true;finishDetailLoad();$('#rcCreate').disabled=true;$('#rcSave').disabled=true;$('#rcDelete').disabled=true;$('#rcWorkorder').disabled=true;$('#rcWorkorder').hidden=true;$('#rcCategory').disabled=true;$('#rcDesigner').disabled=true;fields.forEach(k=>$('[data-rc-field="'+k+'"]').disabled=true);$('#rcPhotos').querySelectorAll('button').forEach(button=>button.disabled=true);
    // The common shell saves before a user-driven identity change. Preserve any
    // remaining input locally before clearing the previous account's view.
    if((dirty||pendingFiles.length)&&!await persistDraft())return false;
    if(epoch!==authEpoch)return false;
    localOnly=false;clearTimeout(autoSaveTimer);renderCategoryFilter('');renderDateFilter('');selectOptions($('#rcDesignerFilter'),[['','담당자']],'');role=null;permissions={};account='';active=null;activeBase=null;pendingSave=null;saveConflict=null;linkEditor=null;dirty=false;pendingFiles=[];records.clear();draftRows.clear();detailCache.clear();detailFlights.clear();listReadAt=0;initialized=false;checkedAt='';cursor=null;gallerySignature='';releasePreviews(true);$('#rcLogin').hidden=!!window.AiselAuth;$('#rcCreate').disabled=true;$('#rcDetail').hidden=true;$('#rcList').hidden=false;draftRows.clear();renderList();if(visible)message('로그인 후 레퍼런스를 확인해주세요.');return true;
  }
  window.addEventListener('aisel-owner-auth-change',()=>{if(!window.AiselAuth)resetAuth();});
  window.addEventListener('aisel-session-change',async()=>{if(!await resetAuth())return;if(visible&&window.AiselAuth?.currentUser()?.uid){const match=location.hash.match(/^#reference=(.+)$/);await show({id:match?decodeURIComponent(match[1]):undefined,history:false});}});
  window.AiselReferenceCollection={configure(options){config={...config,...options};ensure();return this;},show,open,leave,canLeave,back,refresh,preloadGallery,save,receive,verifyAccess:access,resetAuth,get active(){return active?.id||null;},get visible(){return visible;},get timings(){return {...timings};}};
})();
