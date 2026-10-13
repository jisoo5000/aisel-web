(function(){
 'use strict';
 const C=window.AiselDesignMeetingCore,N=window.AiselDesignMeetingNotes, $dm=s=>document.querySelector(s);
 const ROOT=firebase.database().ref('moodboardRefs');
 const BRIDGE=window.AISEL_DESIGN_MEETING_BRIDGE||'';
 const OWNER='sooana1214@gmail.com';
 let cards={},results=[],active=null,filter='planned',limit=40,lastSig='',listening=false,busy=false,detailDirty=false,role=null,authEpoch=0;
 const pending=new Map(),dirtyFields=new Set();let savePromise=null,deleteFlight=null,deletePreview=null,undoDeletion=null;
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
 const detailKeys=['title','link','memo','development','meetingDate','decision','decisionReason','meetingMemo'];
 function textDraftPrefix(id){const owner=memberUser()?.uid;if(!owner)return null;return 'aisel-dm-text-v1:'+encodeURIComponent(owner)+':'+encodeURIComponent(id)+':';}
 function ensureTextDraftOwner(){const owner=memberUser()?.uid||null;if(textDraftOwner!==owner){noteDrafts.clear();noteConflicts.clear();detailBases.clear();textDraftSources.clear();textDraftFailures.clear();detailConflicts.clear();dirtyFields.clear();detailDirty=false;textDraftOwner=owner;}}
 function persistTextDraft(id=active){
   const prefix=id&&textDraftPrefix(id);if(!prefix||textDraftOwner!==memberUser()?.uid)return false;
   const notes=[...(noteDrafts.get(id)?.values()||[])].filter(n=>n.dirty).map(n=>({id:n.id,base:n.base,value:n.value,dirty:true,revision:n.revision,deleted:!!n.deleted}));
   const fields=id===active?Object.fromEntries([...dirtyFields].map(k=>[k,{base:detailBases.get(k)??current(id)?.[k]??'',value:$dm('[data-dm-field="'+k+'"]').value}])):{};
   try{
     if(notes.length||Object.keys(fields).length)localStorage.setItem(prefix+textDraftSession,JSON.stringify({schema:1,owner:memberUser().uid,id,savedAt:Date.now(),notes,fields}));
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
       textDraftSources.set(c.id,[[latest.key,latest.raw]]);$dm('#dmDetailSaveState').textContent='기기 초안 복원됨 · 저장을 확인해주세요.';$dm('#dmSaveDetail').hidden=!detailDirty;
     }
   }catch(e){$dm('#dmDetailSaveState').textContent='기기 초안을 읽지 못했습니다. 화면을 닫기 전에 내용을 확인해주세요.';}
 }
 function markDetailDraft(key){if(!dirtyFields.has(key))detailBases.set(key,current(active)?.[key]??'');dirtyFields.add(key);detailDirty=true;persistTextDraft();}
 function hasNoteChanges(id=active){return !!id&&[...(noteDrafts.get(id)?.values()||[])].some(note=>note.dirty);}
 function newNote(){return {id:'note_'+crypto.randomUUID().replace(/-/g,''),base:null,value:{date:N.today(),text:'',createdAt:Date.now()},dirty:false,revision:0,placeholder:true};}
 function noteState(id){let entries=noteDrafts.get(id);if(!entries){entries=new Map();noteDrafts.set(id,entries);}return entries;}
 function noteMessage(id,text,error=false){if(id!==active)return;if(textDraftFailures.has(id)){text='기기 초안 저장 실패 · 내용을 복사해주세요. '+text;error=true;}$dm('#dmReferenceSaveState').textContent=text;$dm('#dmReferenceSaveState').classList.toggle('dm-error',error);const retry=$dm('#dmReferenceRetry');retry.hidden=!error;retry.style.display=error?'inline-flex':'none';}
 function queueNoteSave(id){persistTextDraft(id);clearTimeout(noteSaveTimer);if(noteConflicts.has(id)){noteMessage(id,'다른 기기에서 같은 참고를 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.',true);return;}noteMessage(id,'미저장');noteSaveTimer=setTimeout(()=>{noteSaveTimer=null;saveNotes(id);},600);}
 function updateNote(id,note,key,value,composing=false){if(note.value[key]===value)return;note.value={...note.value,[key]:value};note.revision++;note.dirty=true;note.placeholder=false;noteMessage(id,'미저장');persistTextDraft(id);if(!composing)queueNoteSave(id);}
 function renderNotes(c){
   if(!c||active!==c.id)return;const entries=noteState(c.id),remote=N.notes(c);
   for(const [id,value] of Object.entries(remote)){const entry=entries.get(id);if(!entry)entries.set(id,{id,base:{...value},value:{...value},dirty:false,revision:0});else if(!entry.dirty){entry.base={...value};entry.value={...value};entry.placeholder=false;}}
   for(const [id,entry] of entries)if(!entry.dirty&&!entry.placeholder&&!remote[id])entries.delete(id);
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
       input.oninput=()=>{row.querySelector('.dm-reference-date-label').textContent=input.value.replaceAll('-','.')||'날짜 선택';updateNote(c.id,entry,'date',input.value);};
       input.onchange=input.oninput;
       textarea.addEventListener('compositionstart',()=>{entry.composing=true;clearTimeout(noteSaveTimer);});
       textarea.addEventListener('compositionend',()=>{entry.composing=false;queueNoteSave(c.id);});
       textarea.oninput=event=>updateNote(c.id,entry,'text',textarea.value,event.isComposing);
       for(const field of [input,textarea])field.addEventListener('blur',()=>{if(hasNoteChanges(c.id))saveNotes(c.id);});
       row.querySelector('.dm-reference-add').onclick=()=>{if(entries.size>=100){noteMessage(c.id,'참고는 최대 100개까지 저장할 수 있습니다.',true);return;}if(entry.placeholder){entry.dirty=true;entry.placeholder=false;entry.revision++;}const next=newNote();next.dirty=true;next.placeholder=false;entries.set(next.id,next);renderNotes(current(c.id));queueNoteSave(c.id);rows.querySelector('[data-note-id="'+next.id+'"] textarea')?.focus();};
       row.querySelector('.dm-reference-delete').onclick=()=>{if(entry.value.text&&!window.confirm('이 참고를 삭제할까요?'))return;if(entry.base||entry.saving){entry.deleted=true;entry.dirty=true;entry.revision++;}else entries.delete(entry.id);renderNotes(current(c.id));queueNoteSave(c.id);};
     }
     const input=row.querySelector('input'),textarea=row.querySelector('textarea');
     if(input.value!==entry.value.date)input.value=entry.value.date;
     row.querySelector('.dm-reference-date-label').textContent=String(entry.value.date||'').replaceAll('-','.')||'날짜 선택';
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
 function listSnapshot(){return {filter,query:$dm('#dmSearch').value,limit,scroll:Math.max(0,window.scrollY||0)};}
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
 async function canLeave(){if(deleteFlight)await deleteFlight;if(!active&&!pane.hidden)updateListRoute();return saveDetail();}
 function restoreList(value=galleryState){
   if(value){filter=value.filter||'planned';limit=Math.max(40,Number(value.limit)||40);$dm('#dmSearch').value=value.query||'';galleryState={...value};}
   $dm('#dmFilters').querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));
   active=null;stopActive();stopReviewPolling();$dm('#dmDetail').hidden=true;$dm('#dmList').hidden=false;$dm('.dm-toolbar').hidden=false;
   lastSig='';render();
   requestAnimationFrame(()=>{if(!active&&!pane.hidden)window.scrollTo(0,value?.scroll||0);});
 }
 async function back(){
   if(navigationBusy||!await saveDetail())return false;
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
 // Keep candidate creation beside search; a full-height empty card wastes the
 // first thumbnail slot and hides the existing camera/link collection options.
 const searchRow=document.createElement('div');searchRow.className='dm-search-row';
 const searchField=$dm('.dm-search');searchField.before(searchRow);searchRow.append(searchField);
 const addMeeting=document.createElement('button');addMeeting.id='dmAddMeeting';addMeeting.type='button';addMeeting.textContent='+ 회의 추가';addMeeting.onclick=()=>$dm('#dmTools').showModal();searchRow.append(addMeeting);
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
   pane.querySelectorAll('#dmAddMeeting,#dmGallery,#dmCamera,#dmAdopt,#dmAddLink,#dmAddPhotos,#dmDesigner,#dmNewLink,#dmLinks button:not([data-dm-readonly]),.dm-photo,#dmPending button,.dm-reference-control,#dmReferenceRetry').forEach(el=>el.disabled=!editable);
   $dm('#dmDetailTitle').contentEditable=String(editable);
   for(const el of $dm('#dmDetail').querySelectorAll('[data-dm-field]'))el.disabled=!editable||(['decision','decisionReason'].includes(el.dataset.dmField)&&role!=='owner');
   deleteButton.hidden=role!=='owner';deleteButton.disabled=!!deleteFlight||isDeleted(current(active));
   $dm('#dmDeleteConfirm').disabled=!!deleteFlight||role!=='owner';$dm('#dmDeleteCancel').disabled=!!deleteFlight;$dm('#dmUndoDelete').disabled=!!deleteFlight||role!=='owner';
   deleteNotice.hidden=!undoDeletion||role!=='owner';
   if(isDeleted(current(active))){$dm('#dmDrop').disabled=true;$dm('#dmWorkorder').disabled=true;$dm('#dmRequest').disabled=true;}else{$dm('#dmDrop').disabled=!!deleteFlight;$dm('#dmWorkorder').disabled=!!deleteFlight;$dm('#dmRequest').disabled=busy||!!deleteFlight;}
   checkResult.disabled=!memberUser()||!!deleteFlight;
 }
 function applyRole(){members.hidden=role!=='owner';login.textContent=role==='owner'?'대표자 · 디자인회의 연결됨':role==='designer'?'디자이너 · 디자인회의 연결됨':'디자인회의 로그인';login.hidden=!!role||!!window.AiselAuth;$dm('#dmDrop').hidden=role!=='owner';$dm('#dmWorkorder').hidden=role!=='owner';for(const k of ['decision','decisionReason'])$dm('[data-dm-field="'+k+'"]').disabled=role!=='owner';render();applyEditingState();}
 async function access(){const stamp=authStamp(),data=await bridge('access',[]);assertAuth(stamp);role=data.role;applyRole();window.dispatchEvent(new CustomEvent('aisel-role-verified',{detail:{role,uid:stamp.uid,generation:stamp.generation}}));return data;}
 function resetAuth(){authEpoch++;ensureTextDraftOwner();role=null;results=[];deletePreview=null;undoDeletion=null;deleteDialog.close();resultChecks.clear();resultFlights.clear();resultFailures.clear();stopReviewPolling();applyRole();}
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
 function isDeleted(c){return !!c?.designMeetingDeletedAt;}
 function deletionError(){return Error('삭제된 디자인회의입니다. 복원한 뒤 다시 시도해주세요.');}
 async function askDelete(){
   if(!active||deleteFlight||!await saveDetail())return;
   const id=active;
   try{
     await access();if(role!=='owner')throw Error('디자인회의 삭제는 대표자만 사용할 수 있습니다.');
     if(active!==id||pane.hidden)return;const c=current(id);if(!c||isDeleted(c))throw deletionError();
     if(pending.has(id)||c.conversion?.state==='running')throw Error('사진 저장 또는 작업지시서 전환이 끝난 뒤 삭제해주세요.');
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
         if(isDeleted(c)||pending.has(id)||c.conversion?.state==='running')return;
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
 async function local(action,item){const db=await drafts();return new Promise((resolve,reject)=>{const tx=db.transaction('files',action==='all'?'readonly':'readwrite'),store=tx.objectStore('files');let request;if(action==='put')request=store.put(item);else if(action==='delete')request=store.delete(item);else request=store.getAll();let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);});}
 async function digest(file){const bytes=await file.arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 async function thumbnail(file){
   const url=URL.createObjectURL(file);
   try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,480/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.78));if(!blob)throw Error('썸네일 생성 실패');return {blob,width:img.width,height:img.height};}finally{URL.revokeObjectURL(url);}
 }
 async function upload(item){
   pending.set(item.id,item);renderPending();
   try{
     await access();
     const existing=(await ROOT.child(item.id).once('value')).val();
     if(isDeleted(existing))throw deletionError();
     const uploaded=existing?C.photos(existing):[];
     const photos=item.replaceKey?[]:[...uploaded];
     for(let n=0;n<item.files.length;n++){
       const file=item.files[n],hash=await digest(file);
       if(photos.some(p=>p.hash===hash))continue;
       const reusable=Object.values(cards).flatMap(C.photos).find(p=>p.hash===hash&&p.original&&p.thumb);
       if(reusable){photos.push({...reusable});continue;}
       const thumb=await thumbnail(file);
       // Original bytes preserve tall screenshots and small lettering. No resizing of existing workorder photos.
       const encode=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
       const original=(await bridge('upload',[],{id:item.id,hash,kind:'original',mime:file.type,data:await encode(file)})).photo.url;
       const small=(await bridge('upload',[],{id:item.id,hash,kind:'thumb.jpg',mime:'image/jpeg',data:await encode(thumb.blob)})).photo.url;
       photos.push({hash,original,thumb:small,width:thumb.width,height:thumb.height,bytes:file.size,thumbBytes:thumb.blob.size});
     }
     const out=await ROOT.child(item.id).transaction(c=>{
       if(isDeleted(c))return;
       if(c&&item.replaceKey)return C.replacePhoto(c,item.replaceKey,photos[0]);
       if(!c&&item.replaceKey)return;
       if(c){const merged=[...C.photos(c)];photos.forEach(p=>{if(!merged.some(x=>(x.hash||x.original)===(p.hash||p.original)))merged.push(p);});return C.edit(c,{photos:merged,photo:merged[0]?.original||''});}
       return {id:item.id,designMeeting:true,inputVersion:1,photos,photo:photos[0]?.original||'',title:'',link:'',memo:'',development:'',createdAt:Date.now(),updatedAt:Date.now(),reviewState:'idle',decision:'unselected',meetingDate:'',convertedCode:''};
     },undefined,false);
     if(!out.committed)throw Error('카드 저장 확인 실패');
     cards[item.id]=out.snapshot.val();pending.delete(item.id);await local('delete',item.id);renderPending();render();if(active===item.id){renderDetailPhotos(cards[item.id]);renderReview(cards[item.id]);}message('사진과 후보를 저장했습니다.');await enqueueCandidate(item.id);
   }catch(e){item.error=e.message;pending.set(item.id,item);renderPending();message('사진을 보관했습니다. 실패한 항목을 다시 시도해주세요. '+e.message,true);}
 }
 function renderPending(){const box=$dm('#dmPending');box.replaceChildren();for(const item of pending.values()){const row=document.createElement('div');row.className='dm-pending';row.textContent=`${item.files.length}장 · ${item.error||'저장 중…'}`;if(item.error){const b=document.createElement('button');b.textContent='다시 시도';b.onclick=()=>upload(item);row.append(b);}box.append(row);}}
 async function receive(files,target=null,replaceKey=null){
   const images=[...files].filter(f=>f.type.startsWith('image/'));const usable=replaceKey?images.slice(0,1):images;if(!usable.length)return;
   if(target&&detailDirty){await saveDetail();if(detailDirty)return;}
   const grouped=target||$dm('#dmGroup').checked;
   const groups=grouped?[usable]:usable.map(f=>[f]);
   for(const group of groups){const item={id:target||uid(),files:group,...(replaceKey?{replaceKey}:{})};try{await local('put',item);}catch(e){message('이 기기는 임시 사진 보관을 지원하지 않습니다. 업로드가 끝날 때까지 화면을 유지해주세요.',true);}await upload(item);}
 }
 function render(){
   if(pane.hidden)return;
   if(pane.contains(document.activeElement)&&document.activeElement.matches('input:not([type=checkbox]):not([type=search]),textarea,select,[contenteditable=true]'))return;
   const q=$dm('#dmSearch').value.toLowerCase();
   const all=Object.values(cards).filter(c=>c.designMeeting===true&&!isDeleted(c));
   const shown=all.filter(c=>{
     if(filter==='planned'&&(c.decision==='excluded'||c.convertedCode))return false;
     if(filter==='drop'&&c.decision!=='excluded')return false;
     if(filter==='unselected'&&c.decision!=='unselected')return false;
     if(filter==='progress'&&c.decision!=='progress')return false;
     if(q&&!`${c.title||''} ${c.memo||''} ${c.link||''}`.toLowerCase().includes(q))return false;
     if(filter==='pending'&&state(c)==='done')return false;
     if(filter==='done'&&state(c)!=='done')return false;
     if(filter==='selected'&&c.decision!=='selected')return false;
     if(filter==='linked'&&!c.convertedCode)return false;return true;
   }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
   $dm('#dmCount').textContent=`불러온 ${all.length}개 · 표시 ${Math.min(limit,shown.length)}개`;
   $dm('#dmMore').hidden=shown.length<=limit&&!hasOlder;$dm('#dmMore').textContent=shown.length>limit?'더 보기':'이전 후보 더 보기';
   const sig=JSON.stringify([shown.slice(0,limit),results,filter,q,role]);if(sig===lastSig)return;lastSig=sig;
   const grid=$dm('#dmGrid');
   const keep=new Set(shown.slice(0,limit).map(c=>c.id));for(const node of grid.querySelectorAll('.dm-card'))if(!keep.has(node.dataset.id))node.remove();let previous=null;
   for(const c of shown.slice(0,limit)){
     const result=confirmedResult(c),photo=C.photos(c)[0];let card=[...grid.children].find(n=>n.dataset.id===c.id);if(!card){card=document.createElement('article');card.className='dm-card';card.dataset.id=c.id;
     card.innerHTML=`<button class="dm-open" type="button">${photo?.thumb?`<img loading="lazy" decoding="async" src="${safe(photo.thumb)}" alt="후보 사진">`:'<span class="dm-no-photo">사진 없음</span>'}<div class="dm-card-info"><strong>${esc(c.title||'사진 후보')}</strong><div class="dm-colors"></div><time>${esc(C.dateLabel(c.createdAt))}</time></div></button>`;
     }
     const opener=card.querySelector('.dm-open'),src=C.httpUrl(photo?.thumb),oldImg=opener.querySelector('img');
     if(src){if(oldImg){if(oldImg.getAttribute('src')!==src)oldImg.src=src;}else{opener.querySelector('.dm-no-photo')?.remove();const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.alt='후보 사진';img.src=src;opener.prepend(img);}}
     else if(oldImg){const empty=document.createElement('span');empty.className='dm-no-photo';empty.textContent='사진 없음';oldImg.replaceWith(empty);}
     card.querySelector('strong').textContent=c.title||'사진 후보';card.querySelector('time').textContent=C.dateLabel(c.createdAt);
     const colors=card.querySelector('.dm-colors');colors.replaceChildren();renderColors(colors,c,result);
     card.querySelector('.dm-open').onclick=()=>open(c.id);
     if(previous){if(previous.nextElementSibling!==card)previous.after(card);}else if(grid.firstElementChild!==card)grid.prepend(card);previous=card;
   }
   applyEditingState();
 }
 async function open(id,options={}){
   const epoch=showEpoch,stamp=authStamp(),stillVisible=()=>epoch===showEpoch&&!pane.hidden;
   if(!id||!await saveDetail()||!stillVisible())return false;
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
   ensureTextDraftOwner();active=id;detailBases.clear();$dm('#dmTools').close();message('');detailDirty=false;dirtyFields.clear();$dm('#dmList').hidden=true;$dm('.dm-toolbar').hidden=true;
   const detail=$dm('#dmDetail');detail.hidden=false;window.scrollTo(0,0);$dm('.dm-detail-body').scrollTop=0;$dm('#dmDetailTitle').textContent=c.title||'후보 상세';
   for(const k of ['title','link','memo','development','meetingDate','decision','decisionReason','meetingMemo'])$dm('[data-dm-field="'+k+'"]').value=c[k]||(['decision'].includes(k)?'unselected':'');
   $dm('#dmDetailSaveState').textContent='';$dm('#dmSaveDetail').hidden=true;noteMessage(id,'');renderLinks(c);renderDesigner(c);renderDetailPhotos(c);renderReview(c);restoreTextDraft(c);renderNotes(c);if(hasNoteChanges(id))noteMessage(id,'기기 초안 복원됨 · 다시 저장해주세요.',true);applyEditingState();watchActive();requestAnimationFrame(fitDetail);refresh(false,[id]);return true;
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
 function renderDesigner(c){const select=$dm('#dmDesigner');const names=[...new Set([...(window.AiselDesignMeetingAdapter.designers?.()||[]),c.designer].filter(Boolean))];const signature=JSON.stringify([names,c.designer||'']);if(select.dataset.signature===signature)return;select.dataset.signature=signature;select.replaceChildren(new Option('미지정',''));for(const name of names)select.add(new Option(name,name));select.value=c.designer||'';}
 function renderLinks(c){
   const box=$dm('#dmLinks'),links=Array.isArray(c.links)?c.links:(c.link?[c.link]:[]);
   const signature=JSON.stringify([c.id,links,role]);if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.replaceChildren();
   const button=document.createElement('button');button.type='button';button.className='dm-link-open';button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/></svg><span>링크</span>';
   if(links.length){button.dataset.dmReadonly='true';button.title='상품 링크 '+links.length+'개';button.onclick=manageLinks;}else{button.onclick=()=>editLink();}
   box.append(button);
   const add=document.createElement('button');add.type='button';add.className='dm-link-add';add.textContent='+';add.setAttribute('aria-label','링크 추가');add.onclick=()=>editLink();box.append(add);applyEditingState();
 }

 function manageLinks(){
   const c=current(active),links=Array.isArray(c.links)?c.links:(c.link?[c.link]:[]);
   let dlg=$dm('#dmLinkDialog');if(!dlg){dlg=document.createElement('dialog');dlg.id='dmLinkDialog';dlg.className='dm-dialog';pane.append(dlg);}dlg.replaceChildren();
   const title=document.createElement('h3');title.textContent='상품 링크';dlg.append(title);
   links.forEach((url,index)=>{const row=document.createElement('p'),a=document.createElement('a');a.href=C.httpUrl(url);a.target='_blank';a.rel='noopener';a.textContent='링크 '+(index+1);row.append(a);for(const [text,remove] of [['수정',false],['삭제',true]]){const b=document.createElement('button');b.textContent=text;b.disabled=role!=='owner'&&role!=='designer';b.onclick=async()=>{dlg.close();await editLink(index,remove);};row.append(b);}dlg.append(row);});
   const add=document.createElement('button');add.textContent='링크 추가';add.disabled=role!=='owner'&&role!=='designer';add.onclick=()=>{dlg.close();editLink();};const close=document.createElement('button');close.textContent='닫기';close.onclick=()=>dlg.close();dlg.append(add,close);dlg.showModal();
 }
 async function editLink(index,remove=false){if(!active||!await saveDetail())return;const c=current(active),links=Array.isArray(c.links)?[...c.links]:(c.link?[c.link]:[]);if(remove){links.splice(index,1);}else{const value=window.prompt('상품 링크',index===undefined?'':links[index]);if(value===null)return;if(!C.httpUrl(value)){message('http 또는 https 상품 링크를 입력해주세요.',true);return;}if(index===undefined)links.unshift(C.httpUrl(value));else links[index]=C.httpUrl(value);}try{await access();await mutate(c.id,{links,link:links[0]||''},true);$dm('[data-dm-field="link"]').value=links[0]||'';renderLinks(current(c.id));renderReview(current(c.id));await enqueueCandidate(c.id);}catch(e){message(e.message,true);}}
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
 function renderReview(c){if(!c)return;const result=confirmedResult(c),status=state(c),box=$dm('#dmReview');scheduleReviewPoll();updateResultButton();const signature=JSON.stringify([c.id,c.createdAt,c.decision,c.inputVersion,c.convertedCode,result,status,C.reviewRow(c,results)]);if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.replaceChildren();$dm('#dmDates').textContent=C.dateLabel(c.createdAt)||'—';$dm('#dmDates').title=['등록 '+(C.dateLabel(c.createdAt)||'—'),result?'검토 '+C.dateLabel(result.reviewedAt):''].filter(Boolean).join(' · ');$dm('#dmDrop').textContent=c.decision==='excluded'?'복원':'드롭';$dm('#dmWorkorder').textContent='작업지시서';
   {const summary=result?C.reviewSummary(result):{demand:'—',supply:'—',differentiation:'—',additional:''},table=document.createElement('table');table.className='dm-evidence';for(const [label,key] of [['수요','demand'],['공급','supply'],['차별성','differentiation']]){const tr=table.insertRow();const th=document.createElement('th');th.scope='row';th.textContent=label;const td=document.createElement('td');td.textContent=summary[key];tr.append(th,td);}box.append(table);if(summary.additional){const p=document.createElement('p');p.className='dm-additional';const strong=document.createElement('strong');strong.textContent='추가 고려사항';p.append(strong,document.createTextNode(summary.additional));box.append(p);}}
   $dm('#dmReviewState').textContent=result?'':(C.states[status]||'확인 필요');const row=C.reviewRow(c,results);if(row?.error)$dm('#dmReviewState').textContent=row.error;$dm('#dmRequest').hidden=!!result||['running','queued'].includes(status);$dm('#dmOpenWorkorder').hidden=true;requestAnimationFrame(fitDetail);
 }
 async function saveDetail(){
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
   const response=await fetch(BRIDGE,{signal:AbortSignal.timeout(15000),method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...extra,action,ids,token}),redirect:'follow'});
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
 const resultChecks=new Map(),resultFlights=new Map(),resultFailures=new Set();
 function updateResultButton(){const c=current(active),key=c?C.rowKey(c.id,Number(c.inputVersion)||1):'';checkResult.hidden=!c||!!confirmedResult(c)||!(resultFailures.has(key)||(reviewPollKey===key&&reviewPollCount>=10));}
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
   const need=visible.filter(id=>cards[id]?.designMeeting&&!isDeleted(cards[id])&&(force||Date.now()-(resultChecks.get(C.rowKey(id,Number(cards[id].inputVersion)||1))||0)>60000));
   const waits=[];for(let n=0;n<need.length;n+=40){
     const group=need.slice(n,n+40),keys=group.map(id=>C.rowKey(id,Number(cards[id].inputVersion)||1)),key=keys.slice().sort().join('|');
     if(resultFlights.has(key)){waits.push(resultFlights.get(key));continue;}
     const flight=bridge('results',group,{versions:Object.fromEntries(group.map(id=>[id,cards[id].inputVersion||1]))}).then(()=>keys.forEach(k=>{resultChecks.set(k,Date.now());resultFailures.delete(k);})).catch(e=>{if(e.code!=='auth_changed'){keys.forEach(k=>resultFailures.add(k));message('검토 결과를 불러오지 못했습니다. 저장된 자료는 유지됩니다. '+e.message,true);}}).finally(()=>{if(resultFlights.get(key)===flight)resultFlights.delete(key);scheduleReviewPoll();updateResultButton();});resultFlights.set(key,flight);waits.push(flight);
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
   const chosen=Object.values(cards).filter(c=>c.designMeeting&&!isDeleted(c)&&['selected','progress'].includes(c.decision)&&!c.convertedCode&&(!Array.isArray(ids)||ids.includes(c.id)));if(!chosen.length)return;
   const dlg=$dm('#dmConversionDialog'),list=$dm('#dmConversionList');list.replaceChildren();
   for(const c of chosen){const row=document.createElement('div');row.dataset.id=c.id;row.className='dm-conversion-row';row.innerHTML=`<strong>${esc(c.title||'사진 후보')}</strong><label>시즌<select class="dm-season"><option value="">선택</option>${document.getElementById('season').innerHTML}</select></label><label>카테고리<select class="dm-category"><option value="">선택</option>${catSel.innerHTML}</select></label>`;row.querySelector('.dm-season').value='';row.querySelector('.dm-category').value='';list.append(row);}
   dlg.showModal();
 }
 async function convertOne(id,season,category){
   await access();if(role!=='owner')throw Error('작업지시서 전환은 대표자만 사용할 수 있습니다.');
   const token=uid(),now=Date.now();
   const reserved=await ROOT.child(id).transaction(c=>{
     if(!c||isDeleted(c)||!['selected','progress'].includes(c.decision)||c.convertedCode)return;
     if(c.conversion?.leaseUntil>now&&c.conversion?.owner!==token)return;
     return {...c,conversion:{...c.conversion,state:'running',owner:token,leaseUntil:now+120000}};
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
       if(existing){code=null;continue;}
       st=window.AiselDesignMeetingAdapter.blank(season,category);
       const pics=C.photos(c),result=confirmedResult(c);
       st={...st,designer:c.designer||'',selectedColors:c.selectedColors||C.evidence(result).colors||[],season,cat:String(category),seq:code.split('-').at(-1),pumMyeong:c.title||'',pumAuto:'0',p1:pics[0]?.original||'',p1Thumb:pics[0]?.thumb||'',photoStage:'reference',refLink:c.link||'',refLinks:Array.isArray(c.links)?c.links:(c.link?[c.link]:[]),sizeSpec:(st.sizeSpec||[]).map(row=>({...row,values:(row.values||[]).map(()=> '')})),predNote:[c.memo,c.development,result?'[판단 근거] '+JSON.stringify(C.reviewSummary(result)):'[판단 근거] '+C.states[state(c)]].filter(Boolean).join('\n'),meetingNotes:c.meetingMemo||'',designMeetingCandidateId:id,designMeetingInputVersion:c.inputVersion,designMeetingPhotos:pics,designMeetingReview:result||null,designMeetingSourceLink:routeUrl(id),status:'sampling',createdAt:Date.now(),updatedAt:Date.now()};
       const created=await woRoot.child(code).transaction(value=>value===null?st:undefined,undefined,false);
       if(created.committed)break;
       const read=created.snapshot.val();if(read?.designMeetingCandidateId===id){st=read;break;}code=null;
     }
     if(!code||!st)throw Error('품번 예약 실패');
     const check=(await woRoot.child(code).once('value')).val();if(check?.designMeetingCandidateId!==id)throw Error('작업지시서 저장 확인 실패');
     if(await writeIndexIfChanged_(code,check)===false)throw Error('작업지시서는 저장됐습니다. 목록 연결을 다시 시도해주세요.');
     const final=await ROOT.child(id).transaction(value=>!isDeleted(value)&&value?.conversion?.code===code?{...value,convertedCode:code,conversion:{...value.conversion,state:'done',leaseUntil:0,confirmedAt:Date.now()}}:undefined,undefined,false);
     if(!final.committed)throw Error('작업지시서 연결 저장 확인 실패');cards[id]=final.snapshot.val();return code;
   }catch(e){await ROOT.child(id).transaction(value=>!isDeleted(value)&&value?.conversion?.owner===token?{...value,conversion:{...value.conversion,state:'error',leaseUntil:0,error:e.message}}:undefined,undefined,false).catch(()=>{});throw e;}
 }
 async function convertSelected(){const rows=[...$dm('#dmConversionList').children];if(rows.some(r=>!r.querySelector('.dm-season').value||r.querySelector('.dm-category').value==='')){$dm('#dmConversionStatus').textContent='각 후보의 시즌·카테고리를 선택해주세요.';return;}
   busy=true;$dm('#dmConversionConfirm').disabled=true;let ok=0;const errors=[];
   for(const row of rows){try{await convertOne(row.dataset.id,row.querySelector('.dm-season').value,row.querySelector('.dm-category').value);ok++;}catch(e){errors.push(e.message);}}
   busy=false;$dm('#dmConversionConfirm').disabled=false;window.AiselDesignMeetingAdapter.restore();lastSig='';render();if(active)renderReview(current(active));
   $dm('#dmConversionStatus').textContent=`${ok}/${rows.length}개 저장 확인${errors.length?' · '+errors.join(' / '):''}`;
   if(!errors.length)$dm('#dmConversionDialog').close();message(`${ok}개 작업지시서 연결을 확인했습니다.${errors.length?' 실패 후보만 다시 시도해주세요.':''}`,!!errors.length);
 }
 // Indexed chronological windows; key breaks equal timestamp ties.
 const PAGE=40;let latestQuery=null,latestCallback=null,olderCursor=null,hasOlder=false,loadingOlder=false,latestIds=new Set(),olderIds=new Set(),activeRef=null,activeCallback=null,activeWatchId=null,draftsLoaded=false;
 function entries(snap){return Object.entries(snap.val()||{}).map(([id,c])=>({...c,id})).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||(a.id<b.id?-1:a.id>b.id?1:0));}
 function accept(values){for(const c of values){if(c.designMeeting===true)cards[c.id]=c;else delete cards[c.id];}}
 function repaintActive(){if(!active||!cards[active])return;const c=cards[active];
   if(isDeleted(c)){
     undoDeletion={id:active,deletedAt:c.designMeetingDeletedAt,deletedBy:c.designMeetingDeletedBy};applyEditingState();
     if(detailDirty||hasNoteChanges()){message('다른 화면에서 삭제된 항목입니다. 입력한 내용은 화면에 유지했습니다. 복원한 뒤 저장해주세요.',true);return;}
     if(!pane.hidden){restoreList();putRoute('list',null,{replace:true});message('');}return;
   }
   renderNotes(c);if(detailDirty)return;if(!pane.contains(document.activeElement)||!document.activeElement.matches('input,textarea,select,[contenteditable=true]')){renderDetailPhotos(c);renderLinks(c);renderDesigner(c);$dm('#dmDetailTitle').textContent=c.title||'후보 상세';}renderReview(c);}
 function stopActive(){if(activeRef)activeRef.off('value',activeCallback);activeRef=null;activeCallback=null;activeWatchId=null;}
 function watchActive(){const id=active&&!pane.hidden&&!document.hidden&&!latestIds.has(active)?active:null;if(id===activeWatchId)return;stopActive();if(!id)return;activeWatchId=id;activeRef=ROOT.child(id);activeCallback=snap=>{const c=snap.val();if(c){cards[id]={...c,id};repaintActive();}else message('이 후보를 찾을 수 없습니다.',true);};activeRef.on('value',activeCallback,e=>message(e.message,true));}
 function stopListening(){if(latestQuery)latestQuery.off('value',latestCallback);latestQuery=null;latestCallback=null;listening=false;stopActive();stopReviewPolling();}
 function startListening(){
   if(listening||pane.hidden||document.hidden)return;listening=true;
   latestQuery=ROOT.orderByChild('createdAt').limitToLast(PAGE);
   latestCallback=snap=>{const values=entries(snap),next=new Set(values.map(c=>c.id));for(const id of latestIds)if(!next.has(id)&&!olderIds.has(id)&&id!==active)delete cards[id];latestIds=next;accept(values);
     if(!olderIds.size){olderCursor=values[0]?{value:values[0].createdAt??null,id:values[0].id}:null;hasOlder=values.length===PAGE;}
     watchActive();render();repaintActive();refresh();
   };latestQuery.on('value',latestCallback,e=>{message(e.message,true);stopListening();});
 }
 async function more(){
   if(hasOlder&&!loadingOlder&&olderCursor){loadingOlder=true;$dm('#dmMore').disabled=true;try{
     const cursor=olderCursor,snap=await ROOT.orderByChild('createdAt').endAt(cursor.value,cursor.id).limitToLast(PAGE+1).once('value');
     const values=entries(snap).filter(c=>c.id!==cursor.id);accept(values);values.forEach(c=>olderIds.add(c.id));hasOlder=values.length===PAGE;
     if(values.length)olderCursor={value:values[0].createdAt??null,id:values[0].id};
   }catch(e){message(e.message,true);}finally{loadingOlder=false;$dm('#dmMore').disabled=false;}}
   limit+=PAGE;updateListRoute();lastSig='';render();await refresh();
 }
 async function show(options={}){
   if(!await saveDetail()||await window.AiselDesignMeetingAdapter.leave()===false)return false;
   if(!active&&!pane.hidden)galleryState=listSnapshot();
   ['editorView','galleryView','salesView','moodboardView','quickOrderView','sampleMgmtView'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
   pane.hidden=false;setMainTabActive_('designmeeting');startListening();watchActive();
   if(!options.preserveDetail)restoreList();
   if(options.history!==false){galleryState=galleryState||listSnapshot();putRoute('list',null,{replace:ownRoute(history.state)&&history.state.view==='list'});}
   window.dispatchEvent(new CustomEvent('aisel-view-change',{detail:{view:'designmeeting'}}));
   if(!draftsLoaded){draftsLoaded=true;try{for(const item of await local('all')){item.error='이전에 전송하지 못한 사진 · 다시 시도해주세요.';pending.set(item.id,item);}renderPending();}catch(e){}}
   render();const epoch=++showEpoch;
   const hydrate=async()=>{
     await refresh();
     if(epoch!==showEpoch||pane.hidden)return;
     if(memberUser())try{await access();}catch(e){if(epoch===showEpoch&&!pane.hidden&&e.code!=='auth_changed'){role=null;applyRole();message(e.message,true);}}else applyRole();
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
     if(!await saveDetail()){undoPop(previous,target);return;}
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
 $dm('#dmAddLink').onclick=async()=>{const link=$dm('#dmNewLink').value.trim();if(!C.httpUrl(link)){message('상품 링크를 입력해주세요.',true);return;}const id=uid();try{await access();const c={id,designMeeting:true,inputVersion:1,link,title:'',memo:'',createdAt:Date.now(),updatedAt:Date.now(),reviewState:'idle',decision:'unselected'};await ROOT.child(id).update(c);cards[id]=c;$dm('#dmNewLink').value='';await open(id);await enqueueCandidate(id);}catch(e){message(e.message,true);}};
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
 $dm('#dmConversionCancel').onclick=()=>{if(!busy)$dm('#dmConversionDialog').close();};
 $dm('#dmOpenWorkorder').onclick=async()=>{if(!await saveDetail())return;const code=current(active)?.convertedCode;if(code)window.AiselDesignMeetingAdapter.open(code);};
 $dm('#dmAdopt').onclick=adopt;$dm('#dmAdoptConfirm').onclick=()=>adoptSelected().catch(e=>message(e.message,true));$dm('#dmAdoptCancel').onclick=()=>$dm('#dmAdoptDialog').close();
 function target(e){return e.target.closest('#dmPhotos')?active:null;}
 pane.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});
 pane.addEventListener('drop',e=>{if(e.dataTransfer?.files.length){e.preventDefault();receive(e.dataTransfer.files,target(e),e.target.closest('.dm-photo')?.dataset.photoKey||null);}});
 document.addEventListener('paste',e=>{if(pane.hidden||e.target.closest('input,textarea,[contenteditable="true"]'))return;const files=[...(e.clipboardData?.items||[])].filter(x=>x.type.startsWith('image/')).map(x=>x.getAsFile());if(files.length){e.preventDefault();receive(files,target(e),e.target.closest('.dm-photo')?.dataset.photoKey||null);}});
 document.addEventListener('focusout',()=>setTimeout(render,60));
 window.addEventListener('beforeunload',e=>{if(detailDirty||pending.size||[...noteDrafts.keys()].some(hasNoteChanges)){e.preventDefault();e.returnValue='';}});
 $dm('#dmDesigner').onchange=async e=>{const id=active;if(!id)return;const value=e.target.value;try{await access();await mutate(id,{designer:value});message('담당자를 저장했습니다.');}catch(err){e.target.value=current(id)?.designer||'';message(err.message,true);}};
 $dm('#dmDetailTitle').oninput=e=>{$dm('[data-dm-field="title"]').value=e.target.textContent.trim();markDetailDraft('title');};$dm('#dmDetailTitle').onblur=saveDetail;
 $dm('#dmDrop').onclick=async()=>{if(!active||!await saveDetail())return;try{await access();if(role!=='owner')throw Error('대표자만 변경할 수 있습니다.');await mutate(active,{decision:current(active).decision==='excluded'?'unselected':'excluded'});renderReview(current(active));lastSig='';render();}catch(e){message(e.message,true);}};
 $dm('#dmWorkorder').onclick=async()=>{if(!active||!await saveDetail())return;try{await access();if(role!=='owner')throw Error('대표자만 사용할 수 있습니다.');const c=current(active);if(c.convertedCode){window.AiselDesignMeetingAdapter.open(c.convertedCode);return;}await mutate(active,{decision:'selected'});await conversionDialog([active]);}catch(e){message(e.message,true);}};
 applyEditingState();
 window.AiselDesignMeeting={show,open,back,canLeave,snapshot,login:signIn,verifyAccess:access,resetAuth,getRole:()=>role,mutate,receive,convertOne,refresh,bridge,core:C};
})();
