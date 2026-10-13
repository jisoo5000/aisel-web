(function(){
 'use strict';
 const C=window.AiselDesignMeetingCore,N=window.AiselDesignMeetingNotes, $dm=s=>document.querySelector(s);
 const ROOT=firebase.database().ref('moodboardRefs');
 const BRIDGE=window.AISEL_DESIGN_MEETING_BRIDGE||'';
 const OWNER='sooana1214@gmail.com';
 let cards={},results=[],active=null,filter='planned',dateFilter='',designerFilter='',limit=40,lastSig='',listening=false,busy=false,detailDirty=false,role=null,authEpoch=0;
 const pending=new Map(),dirtyFields=new Set(),uploadFlights=new Map(),uploadItemFlights=new Map(),conversionFlights=new Map();let linkEditor=null,editIntent=0;
 const compactDate=value=>N.validDate(String(value||''))?String(value).slice(2).replaceAll('-','. '):'미정';
 const meetingDate=c=>N.validDate(String(c?.meetingDate||''))?c.meetingDate:'';
 function openCalendar(input){try{input.showPicker?.();}catch(_){input.focus();}}
 function hardAccessFailure(e){return /permission|forbidden|unauthorized|auth_changed|auth\/|access_denied/i.test(String(e?.code||''))||/권한이 없|접근 권한|허용되지|대표자가 등록한 참여자|중지된|비활성|등록되지 않은|로그인.*필요|다시 로그인/.test(String(e?.message||''));}
 function sameAuth(stamp){const current=authStamp();return stamp.uid===current.uid&&stamp.generation===current.generation&&stamp.epoch===current.epoch;}
 function deadline(promise,label,ms=15000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' 확인이 늦어지고 있습니다. 기기 초안은 유지했습니다. 다시 시도해주세요.')),ms);})]).finally(()=>clearTimeout(timer));}
let savePromise=null,deleteFlight=null,deletePreview=null,undoDeletion=null,externalNavigation=false,externalNavigationBusy=false;
 let viewStartedAt=0,listRequestedAt=0;const measuredViewPhases=new Set();
 function measurePhase(name,start){if(!start)return;try{performance.clearMeasures('aisel:meeting:'+name);performance.measure('aisel:meeting:'+name,{start,end:performance.now()});}catch(_){}}
 function measureViewPhase(name,start=viewStartedAt){if(!start||start!==viewStartedAt||measuredViewPhases.has(name)||pane.hidden)return;measuredViewPhases.add(name);measurePhase(name,start);}
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const safe=v=>esc(C.httpUrl(v));
 const uid=()=> 'dm_'+crypto.randomUUID().replace(/-/g,'');
 const pane=$dm('#designMeetingView');
 const noteDrafts=new Map(),noteConflicts=new Set();let noteSavePromise=null,noteSaveTimer=null;
 let reviewPollTimer=null,reviewPollKey='',reviewPollCount=0;
 const reviewActions=document.createElement('div');reviewActions.className='dm-review-actions';
 const checkResult=document.createElement('button');checkResult.id='dmCheckResult';checkResult.type='button';checkResult.textContent='결과 확인';checkResult.hidden=true;
 $dm('#dmReviewState').after(reviewActions);reviewActions.append($dm('#dmRequest'),checkResult);
 const notesSection=document.createElement('section');notesSection.id='dmReferenceNotes';notesSection.setAttribute('aria-label','참고');
 notesSection.innerHTML='<div id="dmReferenceRows"></div><div class="dm-reference-save"><small id="dmReferenceSaveState" role="status" aria-live="polite"></small><button id="dmReferenceRetry" type="button" hidden>다시 저장</button></div>';
 reviewActions.after(notesSection);
 // Text drafts are written synchronously before network saves, separately from photo uploads.
 // Per-account and per-tab keys keep another editor's unsent draft intact.
 const textDraftSession=crypto.randomUUID(),textDraftSources=new Map(),detailBases=new Map(),textDraftFailures=new Set(),detailConflicts=new Set();
 let textDraftOwner=null;
 const detailKeys=['title','link','memo','development','meetingDate','designer','decision','decisionReason','meetingMemo'];
 const designerDraftField=document.createElement('input');designerDraftField.dataset.dmField='designer';$dm('#dmLegacyFields').append(designerDraftField);
 function textDraftPrefix(id){const owner=memberUser()?.uid;if(!owner)return null;return 'aisel-dm-text-v1:'+encodeURIComponent(owner)+':'+encodeURIComponent(id)+':';}
 function ensureTextDraftOwner(){const owner=memberUser()?.uid||null;if(textDraftOwner!==owner){noteDrafts.clear();noteConflicts.clear();detailBases.clear();textDraftSources.clear();textDraftFailures.clear();detailConflicts.clear();dirtyFields.clear();detailDirty=false;textDraftOwner=owner;}}
 function persistTextDraft(id=active){
   const prefix=id&&textDraftPrefix(id);if(!prefix||textDraftOwner!==memberUser()?.uid)return false;
   const notes=[...(noteDrafts.get(id)?.values()||[])].filter(n=>n.dirty).map(n=>({id:n.id,base:n.base,value:n.value,dirty:true,revision:n.revision,deleted:!!n.deleted}));
   const linkDraft=id===active?linkDraftValue():null;
   const fields=id===active?Object.fromEntries([...dirtyFields].map(k=>[k,{base:detailBases.get(k)??current(id)?.[k]??'',value:$dm('[data-dm-field="'+k+'"]').value}])):{};
   try{
     if(notes.length||Object.keys(fields).length||linkDraft)localStorage.setItem(prefix+textDraftSession,JSON.stringify({schema:1,owner:memberUser().uid,id,savedAt:Date.now(),notes,fields,linkDraft}));
     else{localStorage.removeItem(prefix+textDraftSession);for(const [key,raw]of textDraftSources.get(id)||[])if(localStorage.getItem(key)===raw)localStorage.removeItem(key);textDraftSources.delete(id);}
     textDraftFailures.delete(id);return true;
   }catch(e){textDraftFailures.add(id);noteMessage(id,'기기 초안 저장 실패 · 화면을 닫기 전에 내용을 복사해주세요.',true);if(id===active)$dm('#dmDetailSaveState').textContent='기기 초안 저장 실패 · 내용을 복사해주세요.';return false;}
 }
 function restoreTextDraft(c){
   ensureTextDraftOwner();const prefix=textDraftPrefix(c.id);if(!prefix)return;
   try{
     const saved=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;const raw=localStorage.getItem(key);try{const record=JSON.parse(raw);if(record.schema===1&&record.owner===memberUser()?.uid&&record.id===c.id)saved.push({key,raw,record});}catch(_){}}
     // Keep other sessions until their values are acknowledged. Never delete unseen edits.
     saved.sort((a,b)=>a.record.savedAt-b.record.savedAt);const entries=noteState(c.id);
     for(const {record}of saved.slice(-1)){for(const n of record.notes||[])if(/^note_[a-zA-Z0-9_-]{8,100}$/.test(n.id)&&typeof n.value?.text==='string'&&!entries.get(n.id)?.dirty)entries.set(n.id,{...n,dirty:true,saving:false,composing:false});}
     const latest=saved.at(-1);if(latest){for(const [k,v]of Object.entries(latest.record.fields||{}))if(detailKeys.includes(k)&&typeof v.value==='string'){detailBases.set(k,v.base??'');$dm('[data-dm-field="'+k+'"]').value=v.value;dirtyFields.add(k);}detailDirty=dirtyFields.size>0;if(dirtyFields.has('title'))$dm('#dmDetailTitle').textContent=$dm('[data-dm-field="title"]').value;
       if(latest.record.linkDraft?.id===c.id&&Array.isArray(latest.record.linkDraft.values))beginLinkEdit(latest.record.linkDraft);
       textDraftSources.set(c.id,[[latest.key,latest.raw]]);$dm('#dmDetailSaveState').textContent='기기 초안 복원됨 · 저장을 확인해주세요.';$dm('#dmSaveDetail').hidden=!detailDirty;
     }
   }catch(e){$dm('#dmDetailSaveState').textContent='기기 초안을 읽지 못했습니다. 화면을 닫기 전에 내용을 확인해주세요.';}
 }
 function markDetailDraft(key){editIntent++;if(!dirtyFields.has(key))detailBases.set(key,current(active)?.[key]??'');dirtyFields.add(key);detailDirty=true;persistTextDraft();}
 function hasNoteChanges(id=active){return !!id&&[...(noteDrafts.get(id)?.values()||[])].some(note=>note.dirty);}
 function newNote(){return {id:'note_'+crypto.randomUUID().replace(/-/g,''),base:null,value:{date:N.today(),text:'',createdAt:Date.now()},dirty:false,revision:0,placeholder:true};}
 function noteState(id){let entries=noteDrafts.get(id);if(!entries){entries=new Map();noteDrafts.set(id,entries);}return entries;}
 function noteMessage(id,text,error=false){if(id!==active)return;if(textDraftFailures.has(id)){text='기기 초안 저장 실패 · 내용을 복사해주세요. '+text;error=true;}$dm('#dmReferenceSaveState').textContent=text;$dm('#dmReferenceSaveState').classList.toggle('dm-error',error);const retry=$dm('#dmReferenceRetry');retry.hidden=!error;retry.style.display=error?'inline-flex':'none';}
 function queueNoteSave(id){persistTextDraft(id);clearTimeout(noteSaveTimer);if(noteConflicts.has(id)){noteMessage(id,'다른 기기에서 같은 참고를 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.',true);return;}noteMessage(id,'미저장');noteSaveTimer=setTimeout(()=>{noteSaveTimer=null;saveNotes(id);},600);}
 function updateNote(id,note,key,value,composing=false){if(note.value[key]===value)return;editIntent++;note.value={...note.value,[key]:value};note.revision++;note.dirty=true;note.placeholder=false;noteMessage(id,'미저장');persistTextDraft(id);if(!composing)queueNoteSave(id);}
 function renderNotes(c){
   if(!c||active!==c.id)return;const entries=noteState(c.id),remote=N.notes(c);
   for(const [id,value] of Object.entries(remote)){const entry=entries.get(id);if(!entry)entries.set(id,{id,base:{...value},value:{...value},dirty:false,revision:0});else if(!entry.dirty&&!entry.focused){entry.base={...value};entry.value={...value};entry.placeholder=false;}}
   for(const [id,entry] of entries)if(!entry.dirty&&!entry.focused&&!entry.placeholder&&!remote[id])entries.delete(id);
   if(![...entries.values()].some(entry=>!entry.deleted)){const entry=newNote();entries.set(entry.id,entry);}
   const rows=$dm('#dmReferenceRows'),visible=[...entries.values()].filter(entry=>!entry.deleted).sort((a,b)=>(a.value.createdAt||0)-(b.value.createdAt||0)||a.id.localeCompare(b.id)),keep=new Set(visible.map(entry=>entry.id));
   for(const row of [...rows.children])if(row.dataset.candidate!==c.id||!keep.has(row.dataset.noteId))row.remove();
   let previous=null;
   for(const entry of visible){
     let row=[...rows.children].find(el=>el.dataset.noteId===entry.id);
     if(!row){
       row=document.createElement('div');row.className='dm-reference-note';row.dataset.noteId=entry.id;row.dataset.candidate=c.id;
       row.innerHTML='<div class="dm-reference-header"><h3>참고</h3><span class="dm-reference-date-field"><span class="dm-reference-date-label" aria-hidden="true"></span><input class="dm-reference-date dm-reference-control" type="date" aria-label="참고 날짜"></span><button class="dm-reference-delete dm-reference-control" type="button" aria-label="이 참고 삭제"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7"/></svg></button><button class="dm-reference-add dm-reference-control" type="button" aria-label="참고 추가">+</button></div><textarea class="dm-reference-text dm-reference-control" aria-label="참고 내용" placeholder="참고 내용을 입력해주세요." maxlength="20000"></textarea>';
       const input=row.querySelector('input'),textarea=row.querySelector('textarea');
       input.oninput=()=>{row.querySelector('.dm-reference-date-label').textContent=compactDate(input.value);updateNote(c.id,entry,'date',input.value);};
       input.onchange=input.oninput;
       textarea.addEventListener('compositionstart',()=>{entry.composing=true;clearTimeout(noteSaveTimer);});
       textarea.addEventListener('compositionend',()=>{entry.composing=false;queueNoteSave(c.id);});
       textarea.oninput=event=>updateNote(c.id,entry,'text',textarea.value,event.isComposing);
       input.onclick=()=>openCalendar(input);
       for(const field of [input,textarea]){field.addEventListener('focus',()=>{entry.focused=true;});field.addEventListener('blur',()=>{entry.focused=false;if(hasNoteChanges(c.id))saveNotes(c.id);else renderNotes(current(c.id));});}
       row.querySelector('.dm-reference-add').onclick=()=>{if(entries.size>=100){noteMessage(c.id,'참고는 최대 100개까지 저장할 수 있습니다.',true);return;}if(entry.placeholder){entry.dirty=true;entry.placeholder=false;entry.revision++;}const next=newNote();next.dirty=true;next.placeholder=false;entries.set(next.id,next);renderNotes(current(c.id));queueNoteSave(c.id);rows.querySelector('[data-note-id="'+next.id+'"] textarea')?.focus();};
       row.querySelector('.dm-reference-delete').onclick=()=>{if(entry.value.text&&!window.confirm('이 참고를 삭제할까요?'))return;if(entry.base||entry.saving){entry.deleted=true;entry.dirty=true;entry.revision++;}else entries.delete(entry.id);renderNotes(current(c.id));queueNoteSave(c.id);};
     }
     const input=row.querySelector('input'),textarea=row.querySelector('textarea');
     if(input.value!==entry.value.date)input.value=entry.value.date;
     row.querySelector('.dm-reference-date-label').textContent=compactDate(entry.value.date);
     if(textarea.value!==entry.value.text)textarea.value=entry.value.text;
     if(previous){if(previous.nextElementSibling!==row)previous.after(row);}else if(rows.firstElementChild!==row)rows.prepend(row);previous=row;
   }
   applyEditingState();
 }
 async function saveNotes(id=active){
   clearTimeout(noteSaveTimer);noteSaveTimer=null;
   if(noteSavePromise)return noteSavePromise;
   if(!hasNoteChanges(id))return true;
   const ownerStamp=authStamp();persistTextDraft(id);
   if(noteConflicts.has(id)){noteMessage(id,'다른 기기에서 같은 참고를 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.',true);return false;}
   // Complete auth normalization before installing a flight: the shared auth
   // guard can call canLeave(), which must never wait on its own save promise.
   try{await window.AiselAuth?.ready?.({allowGuardRequest:true});}catch(e){noteMessage(id,e.message,true);return false;}
   if(noteSavePromise)return noteSavePromise;
   const noteWait=setTimeout(()=>{if(hasNoteChanges(id))noteMessage(id,textDraftFailures.has(id)?'서버 저장 확인 중':'서버 저장 확인 중 · 기기 초안을 보관했습니다.');},12000);
   noteSavePromise=(async()=>{
     while(hasNoteChanges(id)){
       const entries=noteState(id),changes=[...entries.values()].filter(note=>note.dirty&&!note.composing).map(note=>({id:note.id,base:note.base?{...note.base}:null,next:note.deleted?null:{...note.value},revision:note.revision}));
       if(!changes.length)return false;
       for(const change of changes)entries.get(change.id).saving=true;
       noteMessage(id,'저장 중…');
       try{
         await access();assertAuth(ownerStamp);if(!['owner','designer'].includes(role))throw Error('로그인 권한을 확인해주세요. 입력한 참고는 유지했습니다.');
         const stamp=authStamp(),out=await ROOT.child(id).transaction(c=>{assertAuth(stamp);return N.apply(c,changes);},undefined,false);
         assertAuth(stamp);if(!out.committed)throw Error('참고 저장을 확인하지 못했습니다. 입력을 유지했습니다.');
         const saved={...out.snapshot.val(),id};cards[id]=saved;
         for(const change of changes){const entry=entries.get(change.id);if(!entry)continue;entry.saving=false;entry.base=saved.referenceNotes?.[change.id]||null;if(entry.revision===change.revision){if(change.next===null)entries.delete(change.id);else{entry.value={...entry.base};entry.dirty=false;entry.placeholder=false;}}}
         persistTextDraft(id);if(active===id)renderNotes(saved);noteMessage(id,hasNoteChanges(id)?'미저장':'저장됨');
       }catch(e){for(const change of changes){const entry=entries.get(change.id);if(entry)entry.saving=false;}if(e.code==='note_conflict')noteConflicts.add(id);noteMessage(id,e.message,true);return false;}
     }
     return true;
   })().finally(()=>{clearTimeout(noteWait);noteSavePromise=null;});return noteSavePromise;
 }
 $dm('#dmReferenceRetry').onclick=async()=>{
   const id=active;if(!id)return;
   if(noteConflicts.has(id))try{
     await access();const latest=(await ROOT.child(id).once('value')).val(),entries=noteState(id),remote=N.notes(latest);
     const changed=[...entries.values()].filter(note=>note.dirty),details=changed.map(note=>'최신 참고 ('+(remote[note.id]?.date||'삭제됨')+')\n'+(remote[note.id]?.text||'(내용 없음)')+'\n\n현재 입력 ('+note.value.date+')\n'+(note.deleted?'(삭제 요청)':note.value.text||'(내용 없음)')).join('\n\n────────\n\n');
     if(!window.confirm(details+'\n\n확인: 현재 입력으로 저장\n취소: 입력을 유지하고 돌아가기'))return;
     for(const note of changed)note.base=remote[note.id]?{...remote[note.id]}:null;
     noteConflicts.delete(id);
   }catch(e){noteMessage(id,e.message,true);return;}
   saveNotes(id);
 };
 // Keep navigation metadata separate from the workorder router's `aisel` state.
 // The gallery's loaded windows stay in memory while a candidate is open.
 const navSession=crypto.randomUUID();
 let galleryState=null,lastRoute=null,navStep=0,navigationBusy=false,skipPop=false,showEpoch=0;
 function listSnapshot(){return {filter,dateFilter,designerFilter,query:$dm('#dmSearch').value,limit,scroll:Math.max(0,window.scrollY||0)};}
 function snapshot(){return {view:active?'detail':'list',activeId:active,list:active?(galleryState||listSnapshot()):listSnapshot(),loadedCount:Object.keys(cards).length};}
 function routeUrl(id){const url=new URL(location.href);url.hash=id?'design-meeting='+encodeURIComponent(id):'design-meeting';return url.href;}
 function ownRoute(value){return value?.aiselDesignMeeting===true;}
 function putRoute(view,id=null,{replace=false,parentStep=null}={}){
   const previous=history.state;
   const step=replace&&ownRoute(previous)&&previous.session===navSession?previous.step:++navStep;
   const route={aiselDesignMeeting:true,session:navSession,step,view,id,list:galleryState||listSnapshot(),parentStep};
   history[replace?'replaceState':'pushState'](route,'',routeUrl(id));lastRoute=route;return route;
 }
 function updateListRoute(){
   if(active)return;galleryState=listSnapshot();
   if(ownRoute(history.state)&&history.state.view==='list'){
     const route={...history.state,list:galleryState};history.replaceState(route,'',routeUrl());lastRoute=route;
   }
 }
 async function canLeave(){const intent=editIntent,id=active;try{if(deleteFlight)await deadline(deleteFlight,'삭제');if(!active&&!pane.hidden)updateListRoute();const ok=await deadline(saveDetail(),'저장');return !!ok&&intent===editIntent&&id===active;}catch(e){message(e.message,true);return false;}}
 function restoreList(value=galleryState){
   if(value){filter=value.filter||'planned';dateFilter=value.dateFilter||'';designerFilter=value.designerFilter||'';limit=Math.max(40,Number(value.limit)||40);$dm('#dmSearch').value=value.query||'';galleryState={...value};}
   $dm('#dmFilters').querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));
   designerDialog.close();closeLinkEditor();active=null;stopActive();stopReviewPolling();$dm('#dmDetail').hidden=true;$dm('#dmList').hidden=false;$dm('.dm-toolbar').hidden=false;
   lastSig='';render();
   requestAnimationFrame(()=>{if(!active&&!pane.hidden)window.scrollTo(0,value?.scroll||0);});
 }
 async function back(){
   if(navigationBusy||!await canLeave())return false;
   const route=history.state;
   if(active&&ownRoute(route)&&route.session===navSession&&Number.isInteger(route.parentStep)&&route.parentStep<route.step){history.go(route.parentStep-route.step);return true;}
   restoreList();putRoute('list',null,{replace:true});return true;
 }
 // Browser/phone Back owns navigation; the retained internal control stays hidden.
 const backButton=$dm('#dmCloseDetail');backButton.hidden=true;
 // Reuse the existing fields so only the header layout changes.
 const detailControls=$dm('.dm-detail-controls');
 detailControls.classList.add('dm-detail-meta');
 detailControls.replaceChildren($dm('#dmDates'),$dm('.dm-assignee'),$dm('#dmLinks'));
 const designerTrigger=document.createElement('button');designerTrigger.id='dmDesignerTrigger';designerTrigger.type='button';designerTrigger.setAttribute('aria-label','담당자 선택');designerTrigger.setAttribute('aria-haspopup','dialog');
 const designerDialog=document.createElement('dialog');designerDialog.id='dmDesignerDialog';designerDialog.className='dm-dialog';designerDialog.setAttribute('aria-labelledby','dmDesignerHeading');designerDialog.innerHTML='<div class="dm-dialog-heading"><h3 id="dmDesignerHeading">담당자 선택</h3></div>';
 const designerSelect=$dm('#dmDesigner');designerSelect.before(designerTrigger);designerDialog.append(designerSelect);
 const designerClose=document.createElement('button');designerClose.type='button';designerClose.textContent='닫기';designerClose.onclick=()=>designerDialog.close();designerDialog.querySelector('.dm-dialog-heading').append(designerClose);pane.append(designerDialog);
 $dm('.dm-assignee label').htmlFor='dmDesignerTrigger';designerTrigger.onclick=()=>{renderDesigner(current(active));designerDialog.showModal();};
 const meetingDateBox=$dm('#dmDates');meetingDateBox.innerHTML='<span id="dmMeetingDateLabel">미정</span><input id="dmMeetingDate" type="date" aria-label="회의 날짜 (등록일과 별도)">';
 const meetingDateInput=$dm('#dmMeetingDate');meetingDateInput.onclick=()=>openCalendar(meetingDateInput);
 meetingDateInput.onchange=()=>{if(!active)return;$dm('[data-dm-field="meetingDate"]').value=meetingDateInput.value;markDetailDraft('meetingDate');renderMeetingDate(current(active));saveDetail();};
 function renderMeetingDate(c){if(!c)return;const value=active===c.id&&dirtyFields.has('meetingDate')?$dm('[data-dm-field="meetingDate"]').value:meetingDate(c);if(document.activeElement!==meetingDateInput)meetingDateInput.value=value;$dm('#dmMeetingDateLabel').textContent=compactDate(value);meetingDateBox.title='회의 날짜 · '+compactDate(value)+' / 등록 '+(C.dateLabel(c.createdAt)||'미정');}


 // Creation stays visible as the first grid cell, including an empty list.
 // The existing role check still owns its action and collection dialog.
 const searchRow=document.createElement('div');searchRow.className='dm-search-row';
 const searchField=$dm('.dm-search');searchField.before(searchRow);searchRow.append(searchField);
 const addMeeting=document.createElement('button');addMeeting.id='dmAddMeeting';addMeeting.type='button';addMeeting.className='dm-add-card';addMeeting.textContent='＋ 추가';addMeeting.setAttribute('aria-label','디자인회의 추가');addMeeting.onclick=()=>$dm('#dmTools').showModal();$dm('#dmGrid').prepend(addMeeting);
 const filterRow=document.createElement('div');filterRow.className='dm-organize-filters';filterRow.innerHTML='<select id="dmDateFilter" aria-label="회의 날짜 필터"><option value="">날짜 전체</option><option value="__missing__">날짜 미정</option></select><select id="dmDesignerFilter" aria-label="담당자 필터"><option value="">담당자 전체</option><option value="__missing__">담당자 미지정</option></select><span id="dmCoverageState" role="status" aria-live="polite"></span>';searchRow.after(filterRow);
 const dateHeading=document.createElement('h3');dateHeading.id='dmDateHeading';dateHeading.className='dm-date-heading';dateHeading.hidden=true;$dm('#dmGrid').before(dateHeading);
 for(const [selector,key]of [['#dmDateFilter','date'],['#dmDesignerFilter','designer']])$dm(selector).onchange=event=>{if(key==='date')dateFilter=event.target.value;else designerFilter=event.target.value;limit=40;lastSig='';updateListRoute();render();ensureCoverage();refresh();};
 function renderOrganizationFilters(all){
   const dates=[...new Set(all.map(meetingDate).filter(Boolean))].sort().reverse(),designers=[...new Set(all.map(c=>c.designer||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
   for(const [selector,values,value,label,missing,format]of [['#dmDateFilter',dates,dateFilter,'날짜 전체','날짜 미정',compactDate],['#dmDesignerFilter',designers,designerFilter,'담당자 전체','담당자 미지정',v=>v]]){const select=$dm(selector),signature=JSON.stringify(values);if(select.dataset.signature!==signature){select.dataset.signature=signature;select.replaceChildren(new Option(label,''),new Option(missing,'__missing__'),...values.map(v=>new Option(format(v),v)));}if(value&&!values.includes(value)&&value!=='__missing__'&&![...select.options].some(o=>o.value===value))select.add(new Option(format(value),value));select.value=value;}
 }
 const newLinkError=document.createElement('small');newLinkError.id='dmNewLinkError';newLinkError.className='dm-link-error';newLinkError.setAttribute('role','status');$dm('#dmNewLink').after(newLinkError);$dm('#dmNewLink').addEventListener('input',()=>{newLinkError.textContent='';});
 const galleryButton=document.createElement('button');galleryButton.type='button';galleryButton.id='dmGallery';galleryButton.textContent='사진 선택';galleryButton.onclick=()=>{$dm('#dmTools').close();$dm('#dmFileInput').dataset.target='';$dm('#dmFileInput').click();};$dm('#dmToolsClose').after(galleryButton);
 const deleteButton=document.createElement('button');deleteButton.id='dmDelete';deleteButton.type='button';deleteButton.textContent='삭제';deleteButton.hidden=true;deleteButton.onclick=askDelete;$dm('.dm-heading').append(deleteButton);
 const deleteDialog=document.createElement('dialog');deleteDialog.id='dmDeleteDialog';deleteDialog.className='dm-dialog';deleteDialog.innerHTML='<h3>이 항목을 삭제할까요?</h3><p id="dmDeleteDescription"></p><p id="dmDeleteError" class="dm-error" role="status"></p><div class="dm-delete-actions"><button type="button" id="dmDeleteCancel">취소</button><button type="button" id="dmDeleteConfirm">삭제</button></div>';pane.append(deleteDialog);
 const deleteNotice=document.createElement('div');deleteNotice.id='dmDeleteNotice';deleteNotice.hidden=true;deleteNotice.setAttribute('role','status');deleteNotice.innerHTML='<span>디자인회의 항목을 삭제했습니다.</span><button type="button" id="dmUndoDelete">되돌리기</button>';$dm('#dmStatus').after(deleteNotice);
 $dm('#dmDeleteCancel').onclick=()=>{if(!deleteFlight){deletePreview=null;deleteDialog.close();}};
 deleteDialog.addEventListener('cancel',event=>{if(deleteFlight)event.preventDefault();else deletePreview=null;});
 $dm('#dmDeleteConfirm').onclick=()=>runDeletion(false);$dm('#dmUndoDelete').onclick=()=>runDeletion(true);
 const login=document.createElement('button');login.type='button';login.textContent='디자인회의 로그인';login.id='dmLogin';pane.querySelector('#dmSession').append(login);
 const members=document.createElement('details');members.id='dmMembers';members.hidden=true;members.innerHTML='<summary>참여자 관리</summary><p>Google 로그인 이메일을 등록하면 사진 등록·검토 요청·결과 확인을 사용할 수 있습니다. 등록·중지 시 메시지는 보내지 않습니다.</p><label>참여자 Google 이메일 <input type="email" id="dmMemberEmail" autocomplete="off"></label><button type="button" id="dmMemberAdd">참여자 등록</button><div id="dmMemberList"></div>';pane.querySelector('#dmTools').append(members);
 function memberUser(){if(window.AiselAuth)return window.AiselAuth.currentUser();return (firebase.apps||[]).map(a=>{try{return a.auth().currentUser;}catch(e){return null;}}).find(u=>u?.emailVerified&&String(u.email||'').toLowerCase()===OWNER)||(firebase.apps||[]).find(a=>a.name==='aiselDesignMeeting')?.auth().currentUser;}
 function authStamp(){return {uid:memberUser()?.uid||null,generation:window.AiselAuth?.generation,epoch:authEpoch};}
 function assertAuth(stamp){const current=authStamp();if(stamp.uid!==current.uid||stamp.generation!==current.generation||stamp.epoch!==current.epoch)throw Object.assign(Error('로그인 상태가 변경되었습니다. 다시 확인해주세요.'),{code:'auth_changed'});}
 function applyEditingState(){
   const editable=(role==='owner'||role==='designer')&&!isDeleted(current(active))&&!deleteFlight;
   pane.querySelectorAll('#dmAddMeeting,#dmGallery,#dmCamera,#dmAdopt,#dmAddLink,#dmAddPhotos,#dmDesigner,#dmDesignerTrigger,#dmNewLink,#dmMeetingDate,#dmLinks input,#dmLinks button:not([data-dm-readonly]),.dm-photo,#dmPending button,.dm-reference-control,#dmReferenceRetry').forEach(el=>el.disabled=!editable);
   if($dm('#dmDetailTitle').contentEditable!==String(editable))$dm('#dmDetailTitle').contentEditable=String(editable);
   for(const el of $dm('#dmDetail').querySelectorAll('[data-dm-field]'))el.disabled=!editable||(['decision','decisionReason'].includes(el.dataset.dmField)&&role!=='owner');
   deleteButton.hidden=role!=='owner';deleteButton.disabled=!!deleteFlight||isDeleted(current(active));
   $dm('#dmDeleteConfirm').disabled=!!deleteFlight||role!=='owner';$dm('#dmDeleteCancel').disabled=!!deleteFlight;$dm('#dmUndoDelete').disabled=!!deleteFlight||role!=='owner';
   deleteNotice.hidden=!undoDeletion||role!=='owner';
   if(isDeleted(current(active))){$dm('#dmDrop').disabled=true;$dm('#dmWorkorder').disabled=true;$dm('#dmRequest').disabled=true;}else{$dm('#dmDrop').disabled=!!deleteFlight;$dm('#dmWorkorder').disabled=busy||!!deleteFlight;$dm('#dmRequest').disabled=busy||!!deleteFlight;}
   pane.querySelectorAll('#dmLinks [data-link-required]').forEach(el=>{el.disabled=!editable||!(current(active)?.links?.length||current(active)?.link);});
   pane.querySelectorAll('.dm-link-primary').forEach(el=>{el.disabled=!editable||el.parentElement===el.parentElement.parentElement.firstElementChild;});
   if(!editable)designerDialog.close();
   checkResult.disabled=!memberUser()||!!deleteFlight;
 }
 function applyRole(){members.hidden=role!=='owner';login.textContent=role==='owner'?'대표자 · 디자인회의 연결됨':role==='designer'?'디자이너 · 디자인회의 연결됨':'디자인회의 로그인';login.hidden=!!role||!!window.AiselAuth;$dm('#dmDrop').hidden=role!=='owner';$dm('#dmWorkorder').hidden=role!=='owner';for(const k of ['decision','decisionReason'])$dm('[data-dm-field="'+k+'"]').disabled=role!=='owner';render();applyEditingState();}
 async function access(){const started=performance.now(),stamp=authStamp();try{const data=await bridge('access',[]);measurePhase('access',started);assertAuth(stamp);role=data.role;applyRole();window.dispatchEvent(new CustomEvent('aisel-role-verified',{detail:{role,uid:stamp.uid,generation:stamp.generation}}));return data;}catch(e){if(sameAuth(stamp)&&hardAccessFailure(e)){role=null;applyRole();}throw e;}}
 function resetAuth(){authEpoch++;coverageEpoch++;if(textDraftOwner!==(memberUser()?.uid||null))closeLinkEditor();ensureTextDraftOwner();role=null;results=[];deletePreview=null;undoDeletion=null;deleteDialog.close();designerDialog.close();historyChecks.clear();resultChecks.clear();resultFlights.clear();resultFailures.clear();stopReviewPolling();applyRole();}
 function showMembers(items){const box=$dm('#dmMemberList');box.replaceChildren();for(const m of items){const row=document.createElement('p');row.textContent=m.email+' · '+(m.active?'사용 중':'사용 중지');const b=document.createElement('button');b.type='button';b.textContent=m.active?'사용 중지':'다시 허용';b.onclick=async()=>{try{const data=await bridge('setMember',[],{email:m.email,active:!m.active});showMembers(data.members);message('참여자 권한을 저장했습니다.');}catch(e){message(e.message,true);}};row.append(b);box.append(row);}}
 members.addEventListener('toggle',async()=>{if(members.open)try{showMembers((await bridge('members',[])).members);}catch(e){message(e.message,true);}});
 $dm('#dmMemberAdd').onclick=async()=>{try{const data=await bridge('setMember',[],{email:$dm('#dmMemberEmail').value,active:true});showMembers(data.members);$dm('#dmMemberEmail').value='';message('참여자를 등록했습니다. 해당 계정으로 Google 로그인하면 사용할 수 있습니다.');}catch(e){message(e.message,true);}};
 async function signIn(options={}){
   const referenceScope=options.scope==='reference';
   try{
     if(window.AiselAuth)await window.AiselAuth.login();
     else if(!memberUser()){const app=(firebase.apps||[]).find(a=>a.name==='aiselDesignMeeting')||firebase.initializeApp(firebase.app().options,'aiselDesignMeeting');const provider=new firebase.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await app.auth().signInWithPopup(provider);}
     // A reference MD session does not confer design-meeting permissions.
     return referenceScope?await bridge('refAccess',[]):await access();
   }catch(e){if(!referenceScope&&e.code!=='auth_changed'){role=null;applyRole();message(e.message,true);}throw e;}
 }
 login.onclick=()=>signIn().catch(()=>{});
 window.addEventListener('aisel-owner-auth-change',()=>{if(!window.AiselAuth&&!memberUser())resetAuth();});
 window.addEventListener('aisel-session-change',resetAuth);
 function message(text,error=false){$dm('#dmStatus').textContent=text;$dm('#dmStatus').classList.toggle('dm-error',error);if(active)requestAnimationFrame(fitDetail);}
 function current(id){return cards[id];}
 function pendingForCandidate(id){return [...pending.values()].filter(item=>(item.candidateId||item.id)===id);}
 function hasPending(id){return pendingForCandidate(id).length>0;}
 function isDeleted(c){return !!c?.designMeetingDeletedAt;}
 function deletionError(){return Error('삭제된 디자인회의입니다. 복원한 뒤 다시 시도해주세요.');}
 async function askDelete(){
   if(!active||deleteFlight||!await saveDetail())return;
   const id=active;
   try{
     await access();if(role!=='owner')throw Error('디자인회의 삭제는 대표자만 사용할 수 있습니다.');
     if(active!==id||pane.hidden)return;const c=current(id);if(!c||isDeleted(c))throw deletionError();
     if(hasPending(id)||c.conversion?.state==='running')throw Error('사진 저장 또는 작업지시서 전환이 끝난 뒤 삭제해주세요.');
     deletePreview={id,updatedAt:c.updatedAt||0,inputVersion:c.inputVersion||1,signature:C.signature(c),stamp:authStamp()};
     $dm('#dmDeleteDescription').textContent='‘'+(c.title||'사진 후보')+'’을 디자인회의 목록에서 삭제합니다. 사진과 기존 작업지시서는 보존되며 삭제 후 되돌릴 수 있습니다.';
     $dm('#dmDeleteError').textContent='';deleteDialog.showModal();
   }catch(e){message(e.message,true);}
 }
 async function runDeletion(restore){
   if(deleteFlight)return;
   // Authentication normalization can settle this view through canLeave().
   // Finish that guard before publishing the deletion flight it would await.
   try{await window.AiselAuth?.ready?.({allowGuardRequest:true});}
   catch(e){if(!restore&&deleteDialog.open)$dm('#dmDeleteError').textContent=e.message;else message(e.message,true);return;}
   if(deleteFlight)return;
   const requested=restore?undoDeletion:deletePreview;if(!requested)return;
   const task=(async()=>{
     try{
       await access();if(role!=='owner')throw Error('디자인회의 삭제와 복원은 대표자만 사용할 수 있습니다.');
       const stamp=authStamp();if(!restore)assertAuth(requested.stamp);
       const now=Date.now(),id=requested.id;
       const out=await ROOT.child(id).transaction(c=>{
         assertAuth(stamp);
         if(!c||c.designMeeting!==true)return;
         if(restore){
           if(!isDeleted(c)||c.designMeetingDeletedAt!==requested.deletedAt||c.designMeetingDeletedBy!==requested.deletedBy)return;
           const next={...c,updatedAt:now};delete next.designMeetingDeletedAt;delete next.designMeetingDeletedBy;return next;
         }
         if(isDeleted(c)||hasPending(id)||c.conversion?.state==='running')return;
         if((c.updatedAt||0)!==requested.updatedAt||(c.inputVersion||1)!==requested.inputVersion||C.signature(c)!==requested.signature)return;
         return {...c,designMeetingDeletedAt:now,designMeetingDeletedBy:stamp.uid,updatedAt:now};
       },undefined,false);
       assertAuth(stamp);
       if(!out.committed)throw Error(restore?'삭제 상태가 변경되어 복원하지 않았습니다. 현재 항목을 다시 확인해주세요.':'다른 기기에서 항목이 변경되었거나 저장 중입니다. 현재 내용을 확인한 뒤 다시 삭제해주세요.');
       const saved=out.snapshot.val();cards[id]={...saved,id};lastSig='';
       if(restore){undoDeletion=null;deleteNotice.hidden=true;render();if(active===id)repaintActive();message('디자인회의 항목을 복원했습니다.');}
       else{
         undoDeletion={id,deletedAt:saved.designMeetingDeletedAt,deletedBy:saved.designMeetingDeletedBy};deletePreview=null;deleteDialog.close();
         if(active===id&&!pane.hidden){restoreList();putRoute('list',null,{replace:true});}
         render();message('');deleteNotice.hidden=false;
       }
     }catch(e){if(!restore&&deleteDialog.open)$dm('#dmDeleteError').textContent=e.message;else message(e.message,true);}
   })();
   deleteFlight=task;applyEditingState();
   try{await task;}finally{deleteFlight=null;applyEditingState();}
 }
 function state(c){return C.status(c,results);}
 function confirmedResult(c){return C.confirmedResult(c,results);}
 async function mutate(id,patch,material=false,expected=null){
   const stamp=authStamp();
   const out=await ROOT.child(id).transaction(c=>{
     assertAuth(stamp);if(!c||isDeleted(c))return;
     if(expected)for(const key of Object.keys(patch))if((c[key]??'')!==(expected[key]??'')&&(c[key]??'')!==patch[key])throw Object.assign(Error('같은 내용을 다른 곳에서 수정했습니다. 기기 초안은 유지했습니다. 최신 내용을 확인해주세요.'),{code:'detail_conflict'});
     return material?C.edit(c,patch):{...c,...patch,updatedAt:Date.now()};
   },undefined,false);
   assertAuth(stamp);
   if(isDeleted(out.snapshot.val()))throw deletionError();
   if(!out.committed)throw Error('후보 저장을 확인하지 못했습니다. 입력을 유지했습니다.');
   cards[id]=out.snapshot.val();return cards[id];
 }
 let draftDb;
 function drafts(){if(!draftDb)draftDb=new Promise((resolve,reject)=>{const r=indexedDB.open('aisel-design-meeting-drafts',1);r.onupgradeneeded=()=>r.result.createObjectStore('files',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return draftDb;}
 async function local(action,item){
   // Safari can abort IndexedDB File writes without a useful error. Persist
   // bytes plus metadata, and retain support for already-stored File drafts.
   let stored=item;
   if(action==='put')stored={...item,mediaFormat:'arraybuffer-v1',files:await Promise.all(item.files.map(async file=>({name:file.name||'photo.jpg',type:file.type||'image/jpeg',lastModified:file.lastModified||Date.now(),bytes:await file.arrayBuffer()})))};
   const db=await drafts();return new Promise((resolve,reject)=>{
     const tx=db.transaction('files',action==='all'?'readonly':'readwrite'),store=tx.objectStore('files');let request;
     if(action==='put')request=store.put(stored);else if(action==='delete')request=store.delete(item);else request=store.getAll();
     let result;request.onsuccess=()=>result=request.result;
     tx.oncomplete=()=>{try{resolve(action==='all'?(result||[]).map(record=>record.mediaFormat==='arraybuffer-v1'?{...record,files:record.files.map(file=>new File([file.bytes],file.name,{type:file.type,lastModified:file.lastModified}))}:record):result);}catch(e){reject(e);}};
     const failed=()=>reject(tx.error||Error('기기 사진 초안을 보관하지 못했습니다. 화면을 유지하고 다시 시도해주세요.'));tx.onerror=failed;tx.onabort=failed;
   });
 }
 async function digest(file){const bytes=await file.arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 async function thumbnail(file){
   const url=URL.createObjectURL(file);
   try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,480/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.78));if(!blob)throw Error('썸네일 생성 실패');return {blob,width:img.width,height:img.height};}finally{URL.revokeObjectURL(url);}
 }
 function upload(item){if(uploadItemFlights.has(item.id))return uploadItemFlights.get(item.id);const candidateId=item.candidateId||item.id,previous=uploadFlights.get(candidateId);const flight=(async()=>{if(previous)await previous;return uploadNow(item);})().finally(()=>{uploadItemFlights.delete(item.id);if(uploadFlights.get(candidateId)===flight)uploadFlights.delete(candidateId);});uploadItemFlights.set(item.id,flight);uploadFlights.set(candidateId,flight);return flight;}
 async function uploadNow(item){
   const candidateId=item.candidateId||item.id;
   pending.set(item.id,item);renderPending();
   try{
     await access();
     const existing=(await ROOT.child(candidateId).once('value')).val();
     if(isDeleted(existing))throw deletionError();
     const uploaded=existing?C.photos(existing):[];
     const photos=item.replaceKey?[]:[...uploaded];
     for(let n=0;n<item.files.length;n++){
       const file=item.files[n],hash=await digest(file);
       if(photos.some(p=>p.hash===hash))continue;
       const reusable=Object.values(cards).flatMap(C.photos).find(p=>p.hash===hash&&p.original&&p.thumb);
       if(reusable){photos.push({...reusable});continue;}
       const prepared=await AiselPhoto.prepare(file,'collection');
       const thumb=await thumbnail(prepared.blob);
       // Automatic bounds retain tall screenshots; existing stored originals are not rewritten.
       const encode=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
       const original=(await bridge('upload',[],{id:candidateId,hash,kind:'original',mime:prepared.blob.type,data:await encode(prepared.blob)})).photo.url;
       const small=(await bridge('upload',[],{id:candidateId,hash,kind:'thumb.jpg',mime:'image/jpeg',data:await encode(thumb.blob)})).photo.url;
       photos.push({hash,original,thumb:small,width:thumb.width,height:thumb.height,bytes:prepared.bytes,sourceBytes:file.size,sourceWidth:prepared.sourceWidth,sourceHeight:prepared.sourceHeight,thumbBytes:thumb.blob.size});
     }
     const out=await ROOT.child(candidateId).transaction(c=>{
       if(isDeleted(c))return;
       if(c&&item.replaceKey)return C.replacePhoto(c,item.replaceKey,photos[0]);
       if(!c&&item.replaceKey)return;
       if(c){const merged=[...C.photos(c)];photos.forEach(p=>{if(!merged.some(x=>(x.hash||x.original)===(p.hash||p.original)))merged.push(p);});return C.edit(c,{photos:merged,photo:merged[0]?.original||''});}
       return {id:candidateId,designMeeting:true,inputVersion:1,photos,photo:photos[0]?.original||'',title:'',link:'',memo:'',development:'',createdAt:Date.now(),updatedAt:Date.now(),reviewState:'idle',decision:'unselected',meetingDate:'',convertedCode:''};
     },undefined,false);
     if(!out.committed)throw Error('카드 저장 확인 실패');
     cards[candidateId]=out.snapshot.val();pending.delete(item.id);await local('delete',item.id);renderPending();render();if(active===candidateId){renderDetailPhotos(cards[candidateId]);renderReview(cards[candidateId]);}message('사진과 후보를 저장했습니다.');enqueueCandidate(candidateId);
   }catch(e){item.error=e.message;pending.set(item.id,item);renderPending();message('사진을 보관했습니다. 실패한 항목을 다시 시도해주세요. '+e.message,true);}
 }
 function renderPending(){const box=$dm('#dmPending');box.replaceChildren();for(const item of pending.values()){const row=document.createElement('div');row.className='dm-pending';row.textContent=`${item.files.length}장 · ${item.error||'저장 중…'}`;if(item.error){const b=document.createElement('button');b.textContent='다시 시도';b.onclick=()=>upload(item);row.append(b);}box.append(row);}}
 async function receive(files,target=null,replaceKey=null){
   editIntent++;
   const images=[...files].filter(f=>f.type.startsWith('image/'));const usable=replaceKey?images.slice(0,1):images;if(!usable.length)return;
   const grouped=target||$dm('#dmGroup').checked;
   const groups=grouped?[usable]:usable.map(f=>[f]);
   // Register every selected photo before the first asynchronous upload. A
   // link navigation can then retain the whole selection, not only photo one.
   const items=groups.map(group=>({id:uid(),...(target?{candidateId:target}:{}),files:group,...(replaceKey?{replaceKey}:{})}));
   for(const item of items)pending.set(item.id,item);renderPending();
   for(const item of items){try{await local('put',item);}catch(e){message('이 기기는 임시 사진 보관을 지원하지 않습니다. 업로드가 끝날 때까지 화면을 유지해주세요.',true);}}
   if(target&&detailDirty&&!await saveDetail()){for(const item of items)item.error='입력한 내용 저장을 확인한 뒤 사진을 다시 시도해주세요.';renderPending();return;}
   for(const item of items)await upload(item);
 }
 function render(){
   if(pane.hidden)return;
   if(active&&pane.contains(document.activeElement)&&document.activeElement.matches('input:not([type=checkbox]):not([type=search]),textarea,select,[contenteditable=true]'))return;
   const q=$dm('#dmSearch').value.toLowerCase();
   const all=Object.values(cards).filter(c=>c.designMeeting===true&&!isDeleted(c));
   renderOrganizationFilters(all);
   const shown=all.filter(c=>{
     if(dateFilter&&(dateFilter==='__missing__'?!!meetingDate(c):meetingDate(c)!==dateFilter))return false;
     if(designerFilter&&(designerFilter==='__missing__'?!!c.designer:c.designer!==designerFilter))return false;
     if(filter==='planned'&&(c.decision==='excluded'||c.convertedCode))return false;
     if(filter==='drop'&&c.decision!=='excluded')return false;
     if(filter==='unselected'&&c.decision!=='unselected')return false;
     if(filter==='progress'&&c.decision!=='progress')return false;
     if(q&&!`${c.title||''} ${c.memo||''} ${c.link||''}`.toLowerCase().includes(q))return false;
     if(filter==='pending'&&state(c)==='done')return false;
     if(filter==='done'&&state(c)!=='done')return false;
     if(filter==='selected'&&c.decision!=='selected')return false;
     if(filter==='linked'&&!c.convertedCode)return false;return true;
   }).sort((a,b)=>meetingDate(b).localeCompare(meetingDate(a))||(b.createdAt||0)-(a.createdAt||0)||a.id.localeCompare(b.id));
   $dm('#dmCount').textContent=`불러온 ${all.length}개 · 표시 ${Math.min(limit,shown.length)}개`;
   $dm('#dmMore').hidden=shown.length<=limit&&!hasOlder;$dm('#dmMore').textContent=shown.length>limit?'더 보기':'이전 후보 더 보기';
   const sig=JSON.stringify([shown.slice(0,limit),results,filter,dateFilter,designerFilter,q,role]);if(sig===lastSig)return;lastSig=sig;
   const grid=$dm('#dmGrid');dateHeading.hidden=!shown.length;dateHeading.textContent=shown.length?compactDate(meetingDate(shown[0])):'';grid.querySelectorAll('.dm-date-group').forEach(el=>el.remove());let previousDate=shown.length?meetingDate(shown[0]):null;
   const keep=new Set(shown.slice(0,limit).map(c=>c.id));for(const node of grid.querySelectorAll('.dm-card'))if(!keep.has(node.dataset.id))node.remove();if(grid.firstElementChild!==addMeeting)grid.prepend(addMeeting);let previous=addMeeting;
   for(const [position,c] of shown.slice(0,limit).entries()){
     const result=confirmedResult(c),photo=C.photos(c)[0];let card=[...grid.children].find(n=>n.dataset.id===c.id);if(!card){card=document.createElement('article');card.className='dm-card';card.dataset.id=c.id;
     card.innerHTML=`<button class="dm-open" type="button">${photo?.thumb?`<img loading="lazy" decoding="async" src="${safe(photo.thumb)}" alt="후보 사진">`:'<span class="dm-no-photo">사진 없음</span>'}<div class="dm-card-info"><strong>${esc(c.title||'사진 후보')}</strong><div class="dm-colors"></div><span class="dm-card-designer"></span><time>${esc(C.dateLabel(c.createdAt))}</time></div></button>`;
     }
     const opener=card.querySelector('.dm-open'),src=C.httpUrl(photo?.thumb),oldImg=opener.querySelector('img');
     if(src){if(oldImg){if(oldImg.getAttribute('src')!==src)oldImg.src=src;}else{opener.querySelector('.dm-no-photo')?.remove();const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.alt='후보 사진';img.src=src;opener.prepend(img);}}
     else if(oldImg){const empty=document.createElement('span');empty.className='dm-no-photo';empty.textContent='사진 없음';oldImg.replaceWith(empty);}
     const preview=opener.querySelector('img');if(preview){preview.loading=position<3?'eager':'lazy';preview.fetchPriority=position===0?'high':'auto';if(position===0){const started=viewStartedAt;if(preview.complete&&preview.naturalWidth)measureViewPhase('first-preview',started);else if(preview.dataset.timed!==String(started)){preview.dataset.timed=String(started);preview.addEventListener('load',()=>measureViewPhase('first-preview',started),{once:true});}}}
     card.querySelector('strong').textContent=c.title||'사진 후보';card.querySelector('time').textContent=compactDate(meetingDate(c));card.querySelector('.dm-card-designer').textContent=c.designer||'미지정';
     const colors=card.querySelector('.dm-colors');colors.replaceChildren();renderColors(colors,c,result);
     card.querySelector('.dm-open').onclick=()=>open(c.id);
     if(meetingDate(c)!==previousDate){const heading=document.createElement('h3');heading.className='dm-date-group';heading.textContent=compactDate(meetingDate(c));previous.after(heading);previous=heading;previousDate=meetingDate(c);}
     if(previous){if(previous.nextElementSibling!==card)previous.after(card);}else if(grid.firstElementChild!==card)grid.prepend(card);previous=card;
   }
   applyEditingState();if(shown.length)measureViewPhase('first-cards');
 }
 async function open(id,options={}){
   designerDialog.close();
   const epoch=showEpoch,stamp=authStamp(),stillVisible=()=>epoch===showEpoch&&!pane.hidden;
   if(!id||!await canLeave()||!stillVisible())return false;
   let c=current(id);
   if(!c)try{const value=(await ROOT.child(id).once('value')).val();assertAuth(stamp);if(!stillVisible())return false;if(value?.designMeeting)c=cards[id]={...value,id};}catch(e){if(stillVisible()&&e.code!=='auth_changed')message(e.message,true);return false;}
   if(!c){message('이 후보를 찾을 수 없습니다.',true);return false;}
   if(isDeleted(c)){message('삭제된 디자인회의입니다.',true);return false;}
   if(!active){galleryState=options.list||listSnapshot();if(!options.list)updateListRoute();}
   if(options.history!==false){
     let route=history.state;
     if(!ownRoute(route)||route.view!=='list'&&!active)route=putRoute('list');
     const parentStep=route.view==='list'?route.step:route.parentStep;
     putRoute('detail',id,{replace:!!active&&ownRoute(route)&&route.view==='detail',parentStep});
   }else if(!ownRoute(history.state)||history.state.view!=='detail'||history.state.id!==id)putRoute('detail',id,{replace:true});
   closeLinkEditor();ensureTextDraftOwner();active=id;detailBases.clear();$dm('#dmTools').close();message('');detailDirty=false;dirtyFields.clear();$dm('#dmList').hidden=true;$dm('.dm-toolbar').hidden=true;
   const detail=$dm('#dmDetail');detail.hidden=false;window.scrollTo(0,0);$dm('.dm-detail-body').scrollTop=0;$dm('#dmDetailTitle').textContent=c.title||'후보 상세';
   for(const k of detailKeys)$dm('[data-dm-field="'+k+'"]').value=c[k]||(['decision'].includes(k)?'unselected':'');
   $dm('#dmDetailSaveState').textContent='';$dm('#dmSaveDetail').hidden=true;noteMessage(id,'');renderLinks(c);renderDesigner(c);renderDetailPhotos(c);renderReview(c);restoreTextDraft(c);renderDesigner(c);renderMeetingDate(c);renderNotes(c);if(hasNoteChanges(id))noteMessage(id,'기기 초안 복원됨 · 다시 저장해주세요.',true);applyEditingState();watchActive();requestAnimationFrame(fitDetail);restoreExternalPosition();refresh(false,[id]);return true;
 }
 let layoutFrame=0,photoSizingKey='';
 function fitDetail(){
   if(layoutFrame)return;
   layoutFrame=requestAnimationFrame(()=>{
     layoutFrame=0;
     if(pane.hidden||$dm('#dmDetail').hidden)return;
     const detail=$dm('#dmDetail'),viewport=window.visualViewport;
     const bottom=(viewport?.height||innerHeight)+(viewport?.offsetTop||0);
     const height=Math.max(240,Math.floor(bottom-detail.getBoundingClientRect().top-4));
     if(Math.abs(parseFloat(detail.style.getPropertyValue('--dm-height'))-height)>=2||!detail.style.getPropertyValue('--dm-height'))detail.style.setProperty('--dm-height',height+'px');
     // Same-width browser toolbar or keyboard changes resize the scroll area, not the photo.
     const key=active+':'+Math.round(detail.clientWidth);
     if(photoSizingKey!==key){
       // Detail photos use the approved taller composition; list photos stay 160px.
       // Long evidence scrolls in the existing body without resizing the photo.
       detail.style.setProperty('--dm-photo-height','240px');
       photoSizingKey=key;
     }
   });
 }
 window.addEventListener('resize',fitDetail);window.visualViewport?.addEventListener('resize',fitDetail);
 function renderColors(box,c,result){const source=c.selectedColors||C.evidence(result).colors||[];const raw=Array.isArray(source)?source:[];const names=window.colorNames_?window.colorNames_(raw):raw.filter(x=>typeof x==='string');for(const name of names){const chip=document.createElement('span');chip.className='gcard-color-chip';chip.textContent=name;const info=window.colorHex_?.(name);if(info&&/^#[0-9a-f]{3,8}$/i.test(info.hex)){chip.style.backgroundColor=info.hex;if(/^#[0-9a-f]{3,8}$/i.test(info.text))chip.style.color=info.text;}box.append(chip);}}
 function renderDesigner(c){if(!c)return;const selected=active===c.id&&dirtyFields.has('designer')?designerDraftField.value:(c.designer||'');c={...c,designer:selected};designerTrigger.textContent=(c.designer||'미지정')+' ⌄';designerTrigger.title=c.designer||'미지정';const select=$dm('#dmDesigner');const names=[...new Set([...(window.AiselDesignMeetingAdapter.designers?.()||[]),c.designer].filter(Boolean))];const signature=JSON.stringify([names,c.designer||'']);if(select.dataset.signature===signature)return;select.dataset.signature=signature;select.replaceChildren(new Option('미지정',''));for(const name of names)select.add(new Option(name,name));select.value=c.designer||'';}
 function candidateLinks(c){return (Array.isArray(c?.links)?c.links:(c?.link?[c.link]:[])).filter(url=>typeof url==='string');}
 function renderLinks(c){
   if(!c||linkEditor?.id===c.id)return;
   const box=$dm('#dmLinks'),links=candidateLinks(c),signature=JSON.stringify([c.id,links,role]);if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.classList.remove('is-editing');box.replaceChildren();
   const button=document.createElement('button');button.type='button';button.className='dm-link-open';button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/></svg><span>링크</span>';
   if(links.some(url=>C.httpUrl(url))){button.dataset.dmReadonly='true';button.title='대표 링크 새 탭에서 열기';button.onclick=()=>openSourceLink(links.find(url=>C.httpUrl(url)));}else button.onclick=()=>beginLinkEdit();box.append(button);
   const icon=(label,path,action)=>{const item=document.createElement('button');item.type='button';item.className='dm-icon';item.setAttribute('aria-label',label);item.title=label;item.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+path+'</svg>';item.onclick=action;box.append(item);return item;};
   icon('링크 수정','<path d="m4 16 12-12 4 4-12 12-5 1Z M13 7l4 4"/>',()=>beginLinkEdit());
   const remove=icon('링크 삭제','<path d="M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7"/>',()=>{if(links.length>1)beginLinkEdit();else removeSingleLink();});remove.dataset.linkRequired='true';applyEditingState();
 }
 function openSourceLink(value){
   const url=C.httpUrl(value);if(!url||!active)return;
   if((detailDirty||hasNoteChanges(active))&&!persistTextDraft(active)){message('기기 초안을 보관하지 못했습니다. 입력한 내용을 유지했습니다.',true);return;}
   // Open synchronously inside the user's click so Safari does not block it.
   // The editor and any in-flight photo backups remain alive in this tab.
   window.open(url,'_blank','noopener,noreferrer');
 }
 function closeLinkEditor(){if(!linkEditor)return;linkEditor=null;const box=$dm('#dmLinks');box.classList.remove('is-editing');delete box.dataset.signature;if(active)renderLinks(current(active));}
 function linkDraftValue(){return linkEditor?.dirty?{id:linkEditor.id,baseLinks:linkEditor.baseLinks,values:linkEditor.values}:null;}
 function beginLinkEdit(draft=null){
   const c=current(active);if(!c||(!draft&&!['owner','designer'].includes(role)))return;if(linkEditor?.id===c.id){$dm('#dmLinks input')?.focus();return;}
   const links=candidateLinks(c),editor=linkEditor={id:c.id,baseLinks:draft?.baseLinks||[...links],values:draft?.values?.length?[...draft.values]:(links.length?[...links]:['']),dirty:!!draft,revision:0,flight:null};
   const box=$dm('#dmLinks');box.classList.add('is-editing');box.replaceChildren();const form=document.createElement('form');form.className='dm-link-editor';form.noValidate=true;
   const fields=document.createElement('div');fields.className='dm-link-fields';const status=document.createElement('span');status.className='dm-link-error';status.setAttribute('role','status');editor.status=status;
   const syncPrimary=()=>{[...fields.children].forEach((row,index)=>{const button=row.querySelector('.dm-link-primary');button.hidden=fields.children.length<2;button.textContent=index===0?'대표':'대표로';button.disabled=index===0||!['owner','designer'].includes(role);});};
   const update=()=>{editIntent++;syncPrimary();editor.values=[...fields.querySelectorAll('input')].map(input=>input.value);editor.dirty=true;editor.revision++;status.textContent='';persistTextDraft(c.id);};
   const addField=value=>{const row=document.createElement('div');row.className='dm-link-field';const primary=document.createElement('button');primary.type='button';primary.className='dm-link-primary';primary.setAttribute('aria-label','대표 링크 선택');primary.onclick=()=>{fields.prepend(row);update();};const input=document.createElement('input');input.type='url';input.autocomplete='url';input.inputMode='url';input.enterKeyHint='done';input.placeholder='https://';input.setAttribute('aria-label','상품 링크 주소');input.value=value;input.oninput=update;input.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();saveLinkEditor();}};const remove=document.createElement('button');remove.type='button';remove.className='dm-inline-remove';remove.textContent='삭제';remove.setAttribute('aria-label','이 링크만 삭제');remove.onclick=()=>{row.remove();update();if(!fields.children.length){addField('');editor.values=[''];}};row.append(primary,input,remove);fields.append(row);syncPrimary();};
   editor.values.forEach(addField);const actions=document.createElement('div');actions.className='dm-link-editor-actions';const add=document.createElement('button');add.type='button';add.textContent='링크 추가';add.onclick=()=>{addField('');update();fields.lastElementChild.querySelector('input').focus();};const done=document.createElement('button');done.type='submit';done.textContent='완료';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='취소';cancel.onclick=()=>{if(editor.flight){status.textContent='저장 확인 중입니다. 입력은 보관했습니다.';return;}closeLinkEditor();persistTextDraft(c.id);};actions.append(add,done,cancel);form.append(fields,status,actions);form.onsubmit=event=>{event.preventDefault();saveLinkEditor();};box.append(form);applyEditingState();fields.querySelector('input')?.focus();
 }
 async function saveLinkEditor(){
   const editor=linkEditor;if(!editor)return true;if(editor.flight)return editor.flight;
   const values=editor.values.map(value=>value.trim()).filter(Boolean);if(values.some(value=>!C.httpUrl(value))){editor.status.textContent='http 또는 https 주소를 입력해주세요.';return false;}
   if(!editor.dirty){closeLinkEditor();return true;}
   const links=[...new Set(values.map(value=>C.httpUrl(value)))],id=editor.id,revision=editor.revision,base=[...editor.baseLinks],stamp=authStamp();persistTextDraft(id);
   // Auth normalization may call canLeave; settle it before publishing a flight.
   try{await window.AiselAuth?.ready?.({allowGuardRequest:true});}catch(e){editor.status.textContent=e.message;return false;}
   if(editor.flight)return editor.flight;
   editor.flight=(async()=>{
     try{await access();assertAuth(stamp);if(!['owner','designer'].includes(role))throw Error('링크를 저장할 권한이 없습니다.');editor.status.textContent='저장 중…';
       const out=await ROOT.child(id).transaction(c=>{assertAuth(stamp);if(!c||isDeleted(c))return;const currentLinks=candidateLinks(c);if(JSON.stringify(currentLinks)!==JSON.stringify(base)&&JSON.stringify(currentLinks)!==JSON.stringify(links))throw Error('다른 곳에서 링크를 수정했습니다. 입력을 보관했습니다. 최신 링크를 확인해주세요.');return C.edit(c,{links,link:links[0]||''});},undefined,false);
       assertAuth(stamp);if(!out.committed)throw Error('링크 저장을 확인하지 못했습니다.');cards[id]={...out.snapshot.val(),id};editor.baseLinks=[...links];
       if(active===id){$dm('[data-dm-field="link"]').value=links[0]||'';if(editor.revision===revision){editor.dirty=false;closeLinkEditor();}else editor.status.textContent='추가 입력 미저장';persistTextDraft(id);renderReview(current(id));}enqueueCandidate(id);return !editor.dirty;
     }catch(e){editor.status.textContent=e.message||'링크 저장 실패 · 입력을 보관했습니다.';return false;}
   })().finally(()=>{editor.flight=null;});return editor.flight;
 }
 function removeSingleLink(){const c=current(active);if(!c)return;beginLinkEdit({baseLinks:candidateLinks(c),values:['']});if(linkEditor)saveLinkEditor();}
 function restoreExternalPosition(){
   let saved=history.state?.externalReturn;
   if(!saved)try{saved=JSON.parse(sessionStorage.getItem('aisel-dm-return-v1')||'null');}catch(_){}
   if(!saved||saved.id!==active||saved.owner!==authStamp().uid)return;
   galleryState=saved.list||galleryState;
   requestAnimationFrame(()=>requestAnimationFrame(()=>{
     if(saved.id!==active||pane.hidden)return;
     window.scrollTo(0,saved.windowScroll||0);$dm('.dm-detail-body').scrollTop=saved.bodyScroll||0;$dm('#dmPhotos').scrollLeft=saved.photoScroll||0;
     try{const stored=JSON.parse(sessionStorage.getItem('aisel-dm-return-v1')||'null');if(stored?.id===saved.id&&stored?.owner===saved.owner)sessionStorage.removeItem('aisel-dm-return-v1');}catch(_){}
     if(history.state?.externalReturn?.id===saved.id&&history.state?.externalReturn?.owner===saved.owner){const route={...history.state};delete route.externalReturn;history.replaceState(route,'',location.href);lastRoute=route;}
   }));
 }
 window.addEventListener('pageshow',()=>{externalNavigation=false;restoreExternalPosition();});
 function setDetailPhotoSource(img,photo){
   // Show the existing lightweight preview in this 240px frame. Keep the
   // original for source/AI use and fetch it here only if the preview fails.
   const thumb=C.httpUrl(photo?.thumb),original=C.httpUrl(photo?.original),src=thumb||original;
   img.onerror=null;
   if(!src)return;
   if(thumb&&original&&thumb!==original)img.onerror=()=>{img.onerror=null;img.src=original;};
   img.src=src;
 }
 function renderDetailPhotos(c){const box=$dm('#dmPhotos');const photos=C.photos(c),signature=JSON.stringify([c.id,photos.map(p=>[p.hash,p.original,p.thumb])]);if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.replaceChildren();$dm('#dmAddPhotos').hidden=photos.length>0;photos.forEach((p,i)=>{const button=document.createElement('button');button.type='button';button.className='dm-photo';button.dataset.photoKey=p.hash||p.original;button.setAttribute('aria-label','참고 사진 '+(i+1)+' 변경');button.onclick=()=>{const input=$dm('#dmReplaceInput');input.dataset.target=c.id;input.dataset.key=p.hash||p.original;input.click();};const img=document.createElement('img');img.loading=i===0?'eager':'lazy';img.fetchPriority=i===0?'high':'auto';img.decoding='async';img.alt='참고 사진 '+(i+1);setDetailPhotoSource(img,p);button.append(img);box.append(button);});}
 function renderReview(c){if(!c)return;const result=confirmedResult(c),previous=result?null:C.previousResult(c,results),shown=result||previous,status=state(c),box=$dm('#dmReview');scheduleReviewPoll();updateResultButton();const signature=JSON.stringify([c.id,c.createdAt,c.decision,c.inputVersion,c.convertedCode,result,previous,status,C.reviewRow(c,results),resultFailures.has(C.rowKey(c.id,Number(c.inputVersion)||1))]);if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.replaceChildren();renderMeetingDate(c);$dm('#dmDrop').textContent=c.decision==='excluded'?'복원':'드롭';$dm('#dmWorkorder').textContent='작업지시서';
   if(previous){const label=document.createElement('p');label.className='dm-previous-review';const d=new Date(previous.reviewedAt);const stamp=Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d):C.dateLabel(previous.reviewedAt);label.textContent='이전 검토 · '+stamp;box.append(label);}
   {const summary=shown?C.reviewSummary(shown):{demand:'—',supply:'—',differentiation:'—',additional:''},table=document.createElement('table');table.className='dm-evidence';for(const [label,key] of [['수요','demand'],['공급','supply'],['차별성','differentiation']]){const tr=table.insertRow();const th=document.createElement('th');th.scope='row';th.textContent=label;const td=document.createElement('td');td.textContent=summary[key];tr.append(th,td);}box.append(table);if(summary.additional){const p=document.createElement('p');p.className='dm-additional';const strong=document.createElement('strong');strong.textContent='추가 고려사항';p.append(strong,document.createTextNode(summary.additional));box.append(p);}}
   $dm('#dmReviewState').textContent=result?'':previous?(['queued','stale','idle'].includes(status)?'내용 변경 · 재검토 대기':status==='running'?'내용 변경 · 재검토 중':C.states[status]||'확인 필요'):(C.states[status]||'확인 필요');const row=C.reviewRow(c,results);if(row?.error)$dm('#dmReviewState').textContent=row.error;if(resultFailures.has(C.rowKey(c.id,Number(c.inputVersion)||1)))$dm('#dmReviewState').textContent='결과 불러오기 실패 · '+(shown?'저장된 검토 표시 중':'다시 확인해주세요.');$dm('#dmRequest').hidden=!!result||['running','queued'].includes(status);$dm('#dmOpenWorkorder').hidden=true;requestAnimationFrame(fitDetail);
 }
 async function saveDetail(){
   if(linkEditor?.dirty&&!await saveLinkEditor())return false;
   if(!await saveNotes())return false;
   if(savePromise)return savePromise;
   // Normalize before installing the save flight. The normalization guard may
   // itself save this detail; it must not end up waiting on its own parent.
   if(active&&detailDirty)try{await window.AiselAuth?.ready?.({allowGuardRequest:true});}catch(e){$dm('#dmDetailSaveState').textContent=e.message;return false;}
   if(savePromise)return savePromise;
   savePromise=(async()=>{let ok;do{ok=await saveDetailNow();}while(ok&&detailDirty);return ok;})().finally(()=>savePromise=null);return savePromise;
 }
 async function saveDetailNow(){if(!active||!detailDirty)return true;const id=active,ownerStamp=authStamp();persistTextDraft(id);const expected=Object.fromEntries(detailBases);const patch={};for(const k of dirtyFields)patch[k]=$dm('[data-dm-field="'+k+'"]').value;try{await access();assertAuth(ownerStamp);}catch(e){$dm('#dmDetailSaveState').textContent=e.message;return false;}
   if(role!=='owner'){delete patch.decision;delete patch.decisionReason;dirtyFields.delete('decision');dirtyFields.delete('decisionReason');}
   if(patch.meetingDate&&!N.validDate(patch.meetingDate)){$dm('#dmDetailSaveState').textContent='회의 날짜를 확인해주세요.';return false;}
   if(patch.link&&!C.httpUrl(patch.link)){$dm('#dmDetailSaveState').textContent='상품 링크는 http 또는 https 주소를 입력해주세요.';return false;}
   $dm('#dmDetailSaveState').textContent='저장 중…';try{await mutate(id,patch,true,expected);for(const [k,v] of Object.entries(patch)){if($dm('[data-dm-field="'+k+'"]').value===v){dirtyFields.delete(k);detailBases.delete(k);}else detailBases.set(k,v);}detailDirty=dirtyFields.size>0;persistTextDraft(id);$dm('#dmDetailSaveState').textContent=detailDirty?'미저장':'';$dm('#dmSaveDetail').hidden=true;renderReview(current(id));lastSig='';render();if(Object.keys(patch).some(k=>C.material.includes(k)))enqueueCandidate(id);return true;}catch(e){if(e.code==='detail_conflict')detailConflicts.add(id);$dm('#dmDetailSaveState').textContent=e.message;$dm('#dmSaveDetail').hidden=false;return false;}
 }
 async function memberToken(){
   const user=memberUser();if(!user?.emailVerified)throw Error('디자인회의 로그인 후 사용해주세요.');return user.getIdToken();
 }
 async function bridge(action,ids,extra={}){
   if(action==='enqueue'&&ids.some(id=>isDeleted(current(id))))throw deletionError();
   if(!BRIDGE)throw Error('시트 연결 배포 대기입니다. 후보와 사진은 앱에 보존됩니다.');
   await window.AiselAuth?.ready?.({allowGuardRequest:true});
   const stamp=authStamp(),token=await memberToken();assertAuth(stamp);
   if(action==='enqueue'&&ids.some(id=>isDeleted(current(id))))throw deletionError();
   // Reference requests include Apps Script cold starts, photo storage and verified Sheet readback.
   const timeoutMs=['refAccess','refEnsure','refList','refGet','refSave','refUpload','refArchive'].includes(action)?60000:15000;
   const response=await fetch(BRIDGE,{signal:AbortSignal.timeout(timeoutMs),method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...extra,action,ids,token}),redirect:'follow'});
   if(!response.ok)throw Error('시트 응답 확인 실패');const data=await response.json();assertAuth(stamp);if(!data.ok)throw Object.assign(Error(data.error||'시트 저장 확인 실패'),{code:data.code});
   if(Array.isArray(data.results)&&data.results.length){
     const merged=new Map(results.map(row=>[C.rowKey(row.id,row.version),row]));
     for(const row of data.results){const key=C.rowKey(row.id,row.version),previous=merged.get(key),verified=value=>value?.state==='done'&&value.receipt&&value.reviewedAt;
       // A slower list request may return an older pending row after the
       // detail already received its verified result. Keep that result.
       if(verified(previous)&&(!verified(row)||Date.parse(previous.reviewedAt)>Date.parse(row.reviewedAt)))continue;
       merged.set(key,row);
     }
     results=[...merged.values()];
   }
   if(action==='results'||action==='enqueue'){render();if(active&&!detailDirty)renderReview(current(active));}return data;
 }
 async function enqueueCandidate(id){try{const data=await bridge('enqueue',[id]);const saved=data.saved?.find(r=>r.id===id);if(!saved)throw Error('검토 대기 저장 확인 필요');await mutate(id,{reviewRequestedVersion:saved.version,reviewState:saved.state||'queued',sheetConfirmedAt:data.checkedAt});if(active===id)renderReview(current(id));}catch(e){message('사진/내용은 저장됐습니다. 검토 요청을 다시 시도해주세요. '+e.message,true);if(active===id)$dm('#dmRequest').hidden=false;}}
 async function requestReview(){if(!active||busy)return;if(!await saveDetail())return;busy=true;$dm('#dmRequest').disabled=true;const id=active;
   try{message('검토 대기 목록에 저장 중…');const data=await bridge('enqueue',[id]);const saved=data.saved.find(r=>r.id===id);if(!saved)throw Error('후보 저장 확인 없음');await mutate(id,{reviewRequestedVersion:saved.version,reviewState:saved.state||'queued',sheetConfirmedAt:data.checkedAt});message(saved.state==='done'?'저장된 검토 결과를 확인합니다.':'시트에 검토 요청을 저장했습니다.');renderReview(current(id));await refresh(true,[id]);}catch(e){message(e.message,true);}finally{busy=false;$dm('#dmRequest').disabled=false;render();}
 }
 const resultChecks=new Map(),resultFlights=new Map(),resultFailures=new Set(),historyChecks=new Set();let resultNoticeText='';
 function updateResultButton(){const c=current(active),key=c?C.rowKey(c.id,Number(c.inputVersion)||1):'';checkResult.hidden=!c||(!resultFailures.has(key)&&(!!confirmedResult(c)||!(reviewPollKey===key&&reviewPollCount>=10)));}
 function stopReviewPolling(){clearTimeout(reviewPollTimer);reviewPollTimer=null;reviewPollKey='';reviewPollCount=0;}
 function scheduleReviewPoll(){
   const c=current(active),eligible=!pane.hidden&&!document.hidden&&!!memberUser()&&c&&!isDeleted(c)&&['queued','running'].includes(state(c));
   if(!eligible){stopReviewPolling();return;}
   const key=C.rowKey(c.id,Number(c.inputVersion)||1);
   if(reviewPollKey!==key){stopReviewPolling();reviewPollKey=key;}
   // Only the open, pending candidate is checked. Stop after ten checks; a
   // user can explicitly check again without leaving a background poll alive.
   updateResultButton();if(reviewPollTimer||reviewPollCount>=10)return;
   reviewPollTimer=setTimeout(async()=>{reviewPollTimer=null;if(reviewPollKey!==key||pane.hidden||document.hidden)return;reviewPollCount++;await refresh(false,[c.id]);scheduleReviewPoll();},60000);
 }
 async function refresh(force=false,onlyIds=null){
   if(pane.hidden||document.hidden||!memberUser())return;
   const visible=onlyIds||(active?[active]:[...$dm('#dmGrid').querySelectorAll('.dm-card')].map(n=>n.dataset.id));
   const need=visible.filter(id=>cards[id]?.designMeeting&&!isDeleted(cards[id])&&(force||(id===active&&Number(cards[id].inputVersion)>1&&!confirmedResult(cards[id])&&!historyChecks.has(C.rowKey(id,Number(cards[id].inputVersion)||1)))||Date.now()-(resultChecks.get(C.rowKey(id,Number(cards[id].inputVersion)||1))||0)>60000));
   const waits=[];for(let n=0;n<need.length;n+=40){
     const group=need.slice(n,n+40),keys=group.map(id=>C.rowKey(id,Number(cards[id].inputVersion)||1));
     const historyId=group.length===1&&group[0]===active&&Number(cards[active]?.inputVersion)>1&&!confirmedResult(cards[active])&&!historyChecks.has(keys[0])?active:null;
     const key=keys.slice().sort().join('|')+(historyId?':history':'');
     if(resultFlights.has(key)){waits.push(resultFlights.get(key));continue;}
     // Only the open candidate needs history, once per input version. List requests remain version-filtered.

     const flight=bridge('results',group,historyId?{}:{versions:Object.fromEntries(group.map(id=>[id,cards[id].inputVersion||1]))}).then(()=>{if(historyId)historyChecks.add(keys[0]);keys.forEach(k=>{resultChecks.set(k,Date.now());resultFailures.delete(k);});if(!resultFailures.size&&resultNoticeText&&$dm('#dmStatus').textContent===resultNoticeText){message('');resultNoticeText='';}}).catch(e=>{if(e.code!=='auth_changed'){keys.forEach(k=>resultFailures.add(k));resultNoticeText='검토 결과를 불러오지 못했습니다. 저장된 자료는 유지됩니다. '+e.message;message(resultNoticeText,true);}}).finally(()=>{if(resultFlights.get(key)===flight)resultFlights.delete(key);if(active&&!pane.hidden)renderReview(current(active));scheduleReviewPoll();updateResultButton();});resultFlights.set(key,flight);waits.push(flight);
   }await Promise.all(waits);
 }
 async function adopt(){
   await access();
   const dlg=$dm('#dmAdoptDialog'),list=$dm('#dmAdoptList');list.replaceChildren();
   const snapshot=await ROOT.once('value');
   for(const [id,c] of Object.entries(snapshot.val()||{})){if(c.designMeeting||isDeleted(c))continue;const row=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.value=id;row.append(input,document.createTextNode(c.memo||c.link||new Date(c.createdAt||0).toLocaleDateString('ko-KR')));list.append(row);}
   dlg.showModal();
 }
 async function adoptSelected(){const ids=[...$dm('#dmAdoptList').querySelectorAll('input:checked')].map(e=>e.value);
   await access();
   for(const id of ids){const out=await ROOT.child(id).transaction(c=>c&&!isDeleted(c)?{...c,id,designMeeting:true,sourceRefId:c.sourceRefId||id,inputVersion:c.inputVersion||1,reviewState:c.reviewState||'idle',decision:c.decision||'unselected'}:undefined,undefined,false);if(!out.committed)throw Error('레퍼런스 연결 저장을 확인하지 못했습니다.');cards[id]=out.snapshot.val();}
   $dm('#dmAdoptDialog').close();render();message(ids.length+'개 레퍼런스를 같은 사진 주소로 연결했습니다.');
 }
 async function conversionDialog(ids=null){if(busy)return;if(detailDirty&&!await saveDetail())return;
   const chosen=Object.values(cards).filter(c=>c.designMeeting&&!isDeleted(c)&&!c.convertedCode&&(Array.isArray(ids)?ids.includes(c.id):['selected','progress'].includes(c.decision)));if(!chosen.length)return;
   const dlg=$dm('#dmConversionDialog'),list=$dm('#dmConversionList');list.replaceChildren();
   for(const c of chosen){const row=document.createElement('div');row.dataset.id=c.id;row.className='dm-conversion-row';row.innerHTML=`<strong>${esc(c.title||'사진 후보')}</strong><label>시즌<select class="dm-season"><option value="">선택</option>${document.getElementById('season').innerHTML}</select></label><label>카테고리<select class="dm-category"><option value="">선택</option>${catSel.innerHTML}</select></label>`;row.querySelector('.dm-season').value='';row.querySelector('.dm-category').value='';list.append(row);}
   dlg.showModal();
 }
 function convertOne(id,season,category){if(conversionFlights.has(id))return conversionFlights.get(id);const flight=convertOneNow(id,season,category).finally(()=>conversionFlights.delete(id));conversionFlights.set(id,flight);return flight;}
 async function prepareTransfer(id){
   if(active===id&&!await canLeave())throw Error('입력한 내용 저장을 확인한 뒤 다시 눌러주세요.');
   for(const item of pendingForCandidate(id))await deadline(upload(item),'사진 저장',30000);
   if(hasPending(id))throw Error('사진 저장이 끝나지 않았습니다. 사진의 다시 시도를 확인해주세요.');
   if(active===id&&!await canLeave())throw Error('추가 입력을 유지했습니다. 저장을 확인한 뒤 다시 눌러주세요.');
 }
 async function openConverted(code){const started={id:active,epoch:showEpoch,intent:editIntent,stamp:authStamp()},record=(await deadline(woRoot.child(code).once('value'),'연결된 작업지시서')).val();assertAuth(started.stamp);if(!record)throw Error('연결된 작업지시서를 확인하지 못했습니다. 새 품번을 만들지 않았습니다.');if(pane.hidden||active!==started.id||showEpoch!==started.epoch||editIntent!==started.intent)return false;if(await window.AiselDesignMeetingAdapter.open(code)===false)throw Error('작업지시서는 저장됐습니다. 열기를 다시 시도해주세요.');return code;}
 async function convertOneNow(id,season,category){
   await prepareTransfer(id);
   await access();if(role!=='owner')throw Error('작업지시서 전환은 대표자만 사용할 수 있습니다.');
   const token=uid(),now=Date.now();
   const reserved=await ROOT.child(id).transaction(c=>{
     if(!c||isDeleted(c)||c.convertedCode)return;
     if(c.conversion?.leaseUntil>now&&c.conversion?.owner!==token)return;
     return {...c,decision:'selected',conversion:{...c.conversion,state:'running',owner:token,leaseUntil:now+120000}};
   },undefined,false);
   if(!reserved.committed){const c=(await ROOT.child(id).once('value')).val();if(isDeleted(c))throw deletionError();if(c?.convertedCode)return c.convertedCode;throw Error('다른 기기에서 전환 중이거나 선택이 해제됐습니다.');}
   let c=reserved.snapshot.val(),code=c.conversion?.code;
   try{
     // The reservation remains on the candidate after any partial failure. Retries always recover that workorder first.
     let st;
     for(let attempt=0;attempt<12;attempt++){
       if(!code){
         const prefix=`AS-${season}-${CATS[Number(category)].code}-`;
         const index=(await woIndexRoot.once('value')).val()||{};
         const max=Math.max(0,...Object.keys(index).filter(k=>k.startsWith(prefix)).map(k=>Number(k.slice(prefix.length))||0));
         const next=await firebase.database().ref('designMeetingCodeCounters/'+season+'_'+CATS[Number(category)].code).transaction(v=>Math.max(Number(v)||0,max)+1,undefined,false);
         code=prefix+String(next.snapshot.val()).padStart(3,'0');
         const assigned=await ROOT.child(id).transaction(value=>!isDeleted(value)&&value?.conversion?.owner===token?{...value,conversion:{...value.conversion,code:value.conversion.code||code,state:'running',leaseUntil:Date.now()+120000}}:undefined,undefined,false);
         if(!assigned.committed)throw Error('다른 기기에서 이어서 전환 중입니다. 연결 결과를 새로 확인해주세요.');
         c=assigned.snapshot.val();code=c.conversion.code;
       }
       const existing=(await woRoot.child(code).once('value')).val();
       if(existing?.designMeetingCandidateId===id){st=existing;break;}
       if(existing){const occupied=code;await ROOT.child(id).transaction(value=>value?.conversion?.owner===token&&value.conversion.code===occupied?{...value,conversion:{...value.conversion,code:null}}:undefined,undefined,false);code=null;continue;}
       st=window.AiselDesignMeetingAdapter.blank(season,category);
       const pics=C.photos(c),result=confirmedResult(c);
       st={...st,designer:c.designer||'',selectedColors:c.selectedColors||C.evidence(result).colors||[],season,cat:String(category),seq:code.split('-').at(-1),pumMyeong:c.title||'',pumAuto:'0',p1:pics[0]?.original||'',p1Thumb:pics[0]?.thumb||'',photoStage:'reference',refLink:c.link||'',refLinks:Array.isArray(c.links)?c.links:(c.link?[c.link]:[]),sizeSpec:(st.sizeSpec||[]).map(row=>({...row,values:(row.values||[]).map(()=> '')})),predNote:[c.memo,c.development,result?'[판단 근거] '+JSON.stringify(C.reviewSummary(result)):'[판단 근거] '+C.states[state(c)]].filter(Boolean).join('\n'),meetingNotes:c.meetingMemo||'',designMeetingCandidateId:id,designMeetingInputVersion:c.inputVersion,designMeetingPhotos:pics,designMeetingReview:result||null,designMeetingSourceLink:routeUrl(id),status:'sampling',createdAt:Date.now(),updatedAt:Date.now()};
       const created=await woRoot.child(code).transaction(value=>value===null?st:undefined,undefined,false);
       if(created.committed)break;
       const read=created.snapshot.val();if(read?.designMeetingCandidateId===id){st=read;break;}const occupied=code;await ROOT.child(id).transaction(value=>value?.conversion?.owner===token&&value.conversion.code===occupied?{...value,conversion:{...value.conversion,code:null}}:undefined,undefined,false);code=null;
     }
     if(!code||!st)throw Error('품번 예약 실패');
     const check=(await woRoot.child(code).once('value')).val();if(check?.designMeetingCandidateId!==id)throw Error('작업지시서 저장 확인 실패');
     if(await writeIndexIfChanged_(code,check)===false)throw Error('작업지시서는 저장됐습니다. 목록 연결을 다시 시도해주세요.');
     const final=await ROOT.child(id).transaction(value=>!isDeleted(value)&&value?.conversion?.code===code?{...value,convertedCode:code,conversion:{...value.conversion,state:'done',leaseUntil:0,confirmedAt:Date.now()}}:undefined,undefined,false);
     if(!final.committed)throw Error('작업지시서 연결 저장 확인 실패');cards[id]=final.snapshot.val();return code;
   }catch(e){await ROOT.child(id).transaction(value=>!isDeleted(value)&&value?.conversion?.owner===token?{...value,conversion:{...value.conversion,state:'error',leaseUntil:0,error:e.message}}:undefined,undefined,false).catch(()=>{});throw e;}
 }
 async function convertSelected(){if(busy)return;const rows=[...$dm('#dmConversionList').children];if(rows.some(r=>!r.querySelector('.dm-season').value||r.querySelector('.dm-category').value==='')){$dm('#dmConversionStatus').textContent='각 후보의 시즌·카테고리를 선택해주세요.';return;}
   const started={active,epoch:showEpoch,intent:editIntent};busy=true;$dm('#dmConversionConfirm').disabled=true;applyEditingState();const codes=[],errors=[];
   try{for(const row of rows)try{codes.push(await deadline(convertOne(row.dataset.id,row.querySelector('.dm-season').value,row.querySelector('.dm-category').value),'작업지시서 저장',30000));}catch(e){errors.push(e.message);}
     if(pane.hidden||active!==started.active||showEpoch!==started.epoch||editIntent!==started.intent)return;
     window.AiselDesignMeetingAdapter.restore();lastSig='';render();if(active)renderReview(current(active));$dm('#dmConversionStatus').textContent=`${codes.length}/${rows.length}개 저장 확인${errors.length?' · '+errors.join(' / '):''}`;
     if(!errors.length){$dm('#dmConversionDialog').close();if(codes.length===1)await openConverted(codes[0]);}else message('실패한 항목을 다시 시도해주세요. '+errors.join(' / '),true);
   }catch(e){message(e.message,true);}finally{busy=false;$dm('#dmConversionConfirm').disabled=false;applyEditingState();}
 }
 // Indexed chronological windows; key breaks equal timestamp ties.
 const PAGE=40;let latestQuery=null,latestCallback=null,olderCursor=null,hasOlder=false,loadingOlder=false,latestIds=new Set(),olderIds=new Set(),activeRef=null,activeCallback=null,activeWatchId=null,draftsLoaded=false,coverageEpoch=0,coverageFlight=null,olderFlight=null;
 function entries(snap){return Object.entries(snap.val()||{}).map(([id,c])=>({...c,id})).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||(a.id<b.id?-1:a.id>b.id?1:0));}
 function accept(values){for(const c of values){if(c.designMeeting===true)cards[c.id]=c;else delete cards[c.id];}}
 function repaintActive(){if(!active||!cards[active])return;const c=cards[active];
   if(isDeleted(c)){
     undoDeletion={id:active,deletedAt:c.designMeetingDeletedAt,deletedBy:c.designMeetingDeletedBy};applyEditingState();
     if(detailDirty||linkEditor?.dirty||hasNoteChanges()){message('다른 화면에서 삭제된 항목입니다. 입력한 내용은 화면에 유지했습니다. 복원한 뒤 저장해주세요.',true);return;}
     if(!pane.hidden){restoreList();putRoute('list',null,{replace:true});message('');}return;
   }
   renderMeetingDate(c);renderNotes(c);if(detailDirty)return;if(!pane.contains(document.activeElement)||!document.activeElement.matches('input,textarea,select,[contenteditable=true]')){renderDetailPhotos(c);renderLinks(c);renderDesigner(c);$dm('#dmDetailTitle').textContent=c.title||'후보 상세';}renderReview(c);}
 function stopActive(){if(activeRef)activeRef.off('value',activeCallback);activeRef=null;activeCallback=null;activeWatchId=null;}
 function watchActive(){const id=active&&!pane.hidden&&!document.hidden&&!latestIds.has(active)?active:null;if(id===activeWatchId)return;stopActive();if(!id)return;activeWatchId=id;activeRef=ROOT.child(id);activeCallback=snap=>{const c=snap.val();if(c){cards[id]={...c,id};repaintActive();}else message('이 후보를 찾을 수 없습니다.',true);};activeRef.on('value',activeCallback,e=>message(e.message,true));}
 function stopListening(){coverageEpoch++;if(latestQuery)latestQuery.off('value',latestCallback);latestQuery=null;latestCallback=null;listening=false;stopActive();stopReviewPolling();}
 function startListening(){
   if(listening||pane.hidden||document.hidden)return;listening=true;
   listRequestedAt=performance.now();latestQuery=ROOT.orderByChild('createdAt').limitToLast(PAGE);
   latestCallback=snap=>{measurePhase('candidate-query',listRequestedAt);listRequestedAt=0;const values=entries(snap),next=new Set(values.map(c=>c.id));for(const id of latestIds)if(!next.has(id)&&!olderIds.has(id)&&id!==active)delete cards[id];latestIds=next;accept(values);
     if(!olderIds.size){olderCursor=values[0]?{value:values[0].createdAt??null,id:values[0].id}:null;hasOlder=values.length===PAGE;}
     watchActive();render();repaintActive();refresh();ensureCoverage();
   };latestQuery.on('value',latestCallback,e=>{message(e.message,true);stopListening();});
 }
 async function loadOlderPage(){
   if(olderFlight)return olderFlight;if(!hasOlder||!olderCursor)return false;
   const epoch=coverageEpoch,stamp=authStamp(),cursor={...olderCursor};loadingOlder=true;
   olderFlight=(async()=>{const snap=await ROOT.orderByChild('createdAt').endAt(cursor.value,cursor.id).limitToLast(PAGE+1).once('value');assertAuth(stamp);if(epoch!==coverageEpoch)return false;
     const values=entries(snap).filter(c=>c.id!==cursor.id);accept(values);values.forEach(c=>olderIds.add(c.id));hasOlder=values.length===PAGE;
     if(values.length){const next={value:values[0].createdAt??null,id:values[0].id};if(next.id===cursor.id&&next.value===cursor.value)throw Error('이전 회의 조회가 진행되지 않았습니다. 다시 시도해주세요.');olderCursor=next;}
     lastSig='';render();return values.length>0;
   })().finally(()=>{loadingOlder=false;olderFlight=null;});return olderFlight;
 }
 async function ensureCoverage(){
   if(coverageFlight||pane.hidden||document.hidden||!hasOlder)return coverageFlight;
   const epoch=coverageEpoch,state=$dm('#dmCoverageState');state.textContent='날짜·담당자 확인 중…';
   coverageFlight=(async()=>{try{while(hasOlder&&epoch===coverageEpoch&&!pane.hidden&&!document.hidden){if(!await loadOlderPage())break;}if(epoch===coverageEpoch)state.textContent='';}
     catch(e){if(epoch===coverageEpoch&&e.code!=='auth_changed')state.textContent='이전 자료 확인 실패 · 더 보기로 다시 시도해주세요.';}
   })().finally(()=>{coverageFlight=null;if(epoch!==coverageEpoch&&hasOlder&&!pane.hidden&&!document.hidden)queueMicrotask(ensureCoverage);});return coverageFlight;
 }
 async function more(){
   $dm('#dmMore').disabled=true;try{if(hasOlder)await loadOlderPage();limit+=PAGE;updateListRoute();lastSig='';render();ensureCoverage();refresh();}
   catch(e){message(e.message,true);}finally{$dm('#dmMore').disabled=false;}
 }
 async function show(options={}){
   viewStartedAt=performance.now();measuredViewPhases.clear();
   const intent=editIntent;if(!await canLeave()||await window.AiselDesignMeetingAdapter.leave()===false||intent!==editIntent)return false;
   if(!active&&!pane.hidden)galleryState=listSnapshot();
   ['editorView','galleryView','salesView','moodboardView','quickOrderView','sampleMgmtView'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
   pane.hidden=false;setMainTabActive_('designmeeting');startListening();watchActive();
   if(!options.preserveDetail)restoreList();
   if(options.history!==false){galleryState=galleryState||listSnapshot();putRoute('list',null,{replace:ownRoute(history.state)&&history.state.view==='list'});}
   window.dispatchEvent(new CustomEvent('aisel-view-change',{detail:{view:'designmeeting'}}));
   if(!draftsLoaded){draftsLoaded=true;try{for(const item of await local('all')){item.error='이전에 전송하지 못한 사진 · 다시 시도해주세요.';pending.set(item.id,item);}renderPending();}catch(e){}}
   render();ensureCoverage();const epoch=++showEpoch;
   const hydrate=async()=>{
     // AI results do not gate the authenticated add/edit controls or photos.
     const permissions=(async()=>{if(epoch!==showEpoch||pane.hidden)return;const stamp=authStamp();if(memberUser())try{await access();}catch(e){if(epoch===showEpoch&&!pane.hidden&&e.code!=='auth_changed'){if(!sameAuth(stamp)||hardAccessFailure(e)){role=null;applyRole();}message(e.message,true);}}else applyRole();})();
     const review=refresh().catch(e=>{if(epoch===showEpoch&&!pane.hidden)message(e.message,true);});await permissions;
     // Opening a detail route can proceed after authorization while its review
     // request continues independently and keeps the last confirmed result.
     void review;
   };
   // Top-level menu clicks show the cached list immediately. Server checks do
   // not own the shell's navigation lock; saves and explicit routes still do.
   if(options.background)hydrate().catch(e=>{if(epoch===showEpoch&&!pane.hidden)message(e.message,true);});
   else await hydrate();
   return true;
 }
 function undoPop(previous,target){
   if(ownRoute(previous)&&ownRoute(target)&&previous.session===target.session&&previous.step!==target.step){skipPop=true;history.go(previous.step-target.step);}
   else if(previous){history.replaceState(previous,'',routeUrl(previous.id));lastRoute=previous;}
 }
 window.addEventListener('popstate',async event=>{
   if(skipPop){skipPop=false;lastRoute=event.state;return;}
   const target=event.state;if(!ownRoute(target))return;
   const previous=lastRoute;
   if(navigationBusy){undoPop(previous,target);return;}
   navigationBusy=true;
   try{
     if(!await canLeave()){undoPop(previous,target);return;}
     if(!await show({history:false,preserveDetail:true})){undoPop(previous,target);return;}
     if(target.view==='detail'&&target.id){
       if(!await open(target.id,{history:false,list:target.list})){restoreList(target.list);putRoute('list',null,{replace:true});return;}
       galleryState=target.list||galleryState;
     }else restoreList(target.list);
     lastRoute=target;
   }finally{navigationBusy=false;}
 });
 new MutationObserver(()=>{if(pane.hidden)stopListening();else startListening();}).observe(pane,{attributes:true,attributeFilter:['hidden']});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopListening();else if(!pane.hidden){startListening();watchActive();refresh();}});
 $dm('#dmMainTab').onclick=()=>show();

 $dm('#dmToolsClose').onclick=()=>$dm('#dmTools').close();
 $dm('#dmReplaceInput').onchange=e=>{receive(e.target.files,e.target.dataset.target,e.target.dataset.key);e.target.value='';};
 $dm('#dmCamera').onclick=()=>{$dm('#dmTools').close();$dm('#dmCameraInput').click();};
 $dm('#dmFileInput').onchange=e=>{receive(e.target.files,e.target.dataset.target||null);e.target.value='';};
 $dm('#dmCameraInput').onchange=e=>{receive(e.target.files);e.target.value='';};
 $dm('#dmAddPhotos').onclick=()=>{$dm('#dmFileInput').dataset.target=active;$dm('#dmFileInput').click();};
 $dm('#dmAddLink').onclick=async()=>{const link=$dm('#dmNewLink').value.trim();if(!C.httpUrl(link)){newLinkError.textContent='http 또는 https 주소를 입력해주세요.';return;}newLinkError.textContent='';const id=uid();try{await access();const c={id,designMeeting:true,inputVersion:1,link,title:'',memo:'',createdAt:Date.now(),updatedAt:Date.now(),reviewState:'idle',decision:'unselected'};await ROOT.child(id).update(c);cards[id]=c;$dm('#dmNewLink').value='';await open(id);await enqueueCandidate(id);}catch(e){message(e.message,true);}};
 $dm('#dmSearch').oninput=()=>{limit=40;updateListRoute();render();refresh();};
 $dm('#dmFilters').onclick=e=>{if(!e.target.dataset.filter)return;filter=e.target.dataset.filter;$dm('#dmFilters').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===e.target));limit=40;updateListRoute();render();refresh();};
 $dm('#dmMore').onclick=more;
 $dm('#dmDetail').querySelectorAll('[data-dm-field]').forEach(el=>el.addEventListener('input',()=>{markDetailDraft(el.dataset.dmField);$dm('#dmDetailSaveState').textContent='미저장';}));
 $dm('#dmSaveDetail').onclick=async()=>{
   const id=active;if(!id)return;
   if(detailConflicts.has(id))try{
     await access();const stamp=authStamp(),latest=(await ROOT.child(id).once('value')).val();assertAuth(stamp);if(active!==id)return;
     const comparison=[...dirtyFields].map(k=>'저장된 내용: '+(latest?.[k]||'(비어 있음)')+'\n내 입력: '+$dm('[data-dm-field="'+k+'"]').value).join('\n\n');
     if(!confirm(comparison+'\n\n확인: 내 입력으로 저장\n취소: 입력을 유지하고 돌아가기'))return;
     for(const k of dirtyFields)detailBases.set(k,latest?.[k]??'');detailConflicts.delete(id);persistTextDraft(id);
   }catch(e){$dm('#dmDetailSaveState').textContent=e.message;return;}
   saveDetail();
 };
 $dm('#dmCloseDetail').onclick=back;
 $dm('#dmRequest').onclick=requestReview;$dm('#dmRefresh').onclick=()=>refresh(true);
 checkResult.onclick=async()=>{stopReviewPolling();checkResult.disabled=true;try{await refresh(true,[active]);}finally{checkResult.disabled=!memberUser();scheduleReviewPoll();}};
 $dm('#dmConversionConfirm').onclick=convertSelected;
 $dm('#dmConversionDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 $dm('#dmConversionCancel').onclick=()=>{if(!busy)$dm('#dmConversionDialog').close();};
 $dm('#dmOpenWorkorder').onclick=async()=>{try{const id=active;if(!id)return;await prepareTransfer(id);const code=current(id)?.convertedCode;if(code)await openConverted(code);}catch(e){message(e.message,true);}};
 $dm('#dmAdopt').onclick=adopt;$dm('#dmAdoptConfirm').onclick=()=>adoptSelected().catch(e=>message(e.message,true));$dm('#dmAdoptCancel').onclick=()=>$dm('#dmAdoptDialog').close();
 function target(e){return e.target.closest('#dmPhotos')?active:null;}
 pane.addEventListener('focusin',event=>{if(event.target.matches('input:not([type=search]),textarea,select,[contenteditable=true]'))editIntent++;});
 pane.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});
 pane.addEventListener('drop',e=>{if(e.dataTransfer?.files.length){e.preventDefault();receive(e.dataTransfer.files,target(e),e.target.closest('.dm-photo')?.dataset.photoKey||null);}});
 document.addEventListener('paste',e=>{if(pane.hidden||e.target.closest('input,textarea,[contenteditable="true"]'))return;const files=[...(e.clipboardData?.items||[])].filter(x=>x.type.startsWith('image/')).map(x=>x.getAsFile());if(files.length){e.preventDefault();receive(files,target(e),e.target.closest('.dm-photo')?.dataset.photoKey||null);}});
 document.addEventListener('focusout',()=>setTimeout(render,60));
 window.addEventListener('beforeunload',e=>{if(!externalNavigation&&(detailDirty||linkEditor?.dirty||pending.size||[...noteDrafts.keys()].some(hasNoteChanges))){e.preventDefault();e.returnValue='';}});
 $dm('#dmDesigner').onchange=async e=>{const id=active;if(!id)return;designerDraftField.value=e.target.value;markDetailDraft('designer');renderDesigner(current(id));designerDialog.close();await saveDetail();};
 $dm('#dmDetailTitle').oninput=e=>{$dm('[data-dm-field="title"]').value=e.target.textContent.trim();markDetailDraft('title');};$dm('#dmDetailTitle').onblur=saveDetail;
 $dm('#dmDrop').onclick=async()=>{if(!active||!await saveDetail())return;try{await access();if(role!=='owner')throw Error('대표자만 변경할 수 있습니다.');await mutate(active,{decision:current(active).decision==='excluded'?'unselected':'excluded'});renderReview(current(active));lastSig='';render();}catch(e){message(e.message,true);}};
 $dm('#dmWorkorder').onclick=async()=>{const id=active;if(!id||busy)return;busy=true;applyEditingState();try{await prepareTransfer(id);await access();if(role!=='owner')throw Error('대표자만 사용할 수 있습니다.');if(active!==id)return;const c=current(id);if(c.convertedCode){await openConverted(c.convertedCode);return;}busy=false;await conversionDialog([id]);}catch(e){message(e.message,true);}finally{busy=false;applyEditingState();}};
 applyEditingState();
 window.AiselDesignMeeting={show,open,back,canLeave,snapshot,login:signIn,verifyAccess:access,resetAuth,getRole:()=>role,mutate,receive,convertOne,refresh,bridge,core:C};
})();
