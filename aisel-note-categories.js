/* Shared note classifications. The existing authenticated bridge owns the
 * workspace list. Local storage contains only the current account's pending
 * additions; a local draft is never presented as a confirmed server save. */
(function(root){
  'use strict';
  const VERSION=203,ID=/^cat_[a-f0-9]{64}$/,ADD='__add_note_category__',MANAGE='__manage_note_categories__';
  function failure(code,message){return Object.assign(Error(message),{code});}
  function cleanName(raw){
    const name=String(raw??'').normalize('NFKC').trim().replace(/\s+/g,' ');
    if(!name||[...name].length>40||/[\u0000-\u001f\u007f]/.test(name))throw failure('category_name','분류 이름을 1~40자로 입력해주세요.');
    return name;
  }
  function normalizeName(raw){const value=cleanName(raw).toLocaleLowerCase('en-US');if([...value].length>40)throw failure('category_name','분류 이름을 1~40자로 입력해주세요.');return value;}
  async function idForName(raw,cryptoObject=root.crypto){
    if(!cryptoObject?.subtle)throw failure('category_crypto','분류를 안전하게 연결하지 못했습니다. 다시 열어주세요.');
    const digest=await cryptoObject.subtle.digest('SHA-256',new TextEncoder().encode(normalizeName(raw)));
    return 'cat_'+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  }
  function idsFromNotes(notes){return [...new Set((Array.isArray(notes)?notes:Object.values(notes||{})).map(note=>note?.categoryId).filter(id=>ID.test(id)))].sort();}
  function matches(notes,id){return !id||idsFromNotes(notes).includes(id);}
  function createStore(options={}){
    let config={...options},scope='',uid='',sessionGeneration,epoch=0,ready=false,error=null,flight=null,lastLoaded=0,canManage=false,mutationRevision=0;
    let canonical=new Map(),pending=new Map();const listeners=new Set(),upserts=new Map(),removals=new Map();
    const storage=()=>config.storage||root.localStorage;
    const user=()=>config.getUser?.()||null;
    const generation=()=>config.getGeneration?.()??root.AiselAuth?.generation??0;
    const keyFor=(workspace,owner)=>'aisel.note-categories.v1:'+encodeURIComponent(workspace)+':'+encodeURIComponent(owner);
    const stamp=()=>({epoch,uid,generation:generation(),workspace:config.workspace});
    function assertSession(expected){if(expected.epoch!==epoch||expected.uid!==user()?.uid||expected.generation!==generation()||expected.workspace!==config.workspace)throw failure('auth_changed','로그인 계정이 변경되었습니다. 입력한 분류는 해당 계정의 기기 초안에 유지했습니다.');}
    function state(){syncSession();return {ready,uid:uid||null,generation:sessionGeneration,workspace:config.workspace||'',pending:pending.size,error,lastLoaded,canManage,categories:list(false)};}
    function list(sync=true){if(sync)syncSession();return [...new Map([...canonical,...pending]).values()].filter(entry=>!entry.deletedAt).map(entry=>({...entry})).sort((a,b)=>a.name.localeCompare(b.name,'ko'));}
    function emit(){const snapshot={ready,uid:uid||null,generation:sessionGeneration,workspace:config.workspace||'',pending:pending.size,error,lastLoaded,canManage,categories:list(false)};for(const listener of listeners)try{listener(snapshot);}catch(_){} }
    function persistedPending(){if(!scope)return [];try{const saved=JSON.parse(storage().getItem(scope)||'null');if(saved?.schema===1&&saved.uid===uid&&saved.workspace===config.workspace)return Array.isArray(saved.pending)?saved.pending:[];}catch(_){}return [];}
    function validDraft(entry){return entry&&ID.test(entry.id)&&typeof entry.name==='string'&&entry.normalized===normalizeName(entry.name);}
    function syncSession(){
      const nextUid=String(user()?.uid||''),nextScope=nextUid&&config.workspace?keyFor(config.workspace,nextUid):'',nextGeneration=generation();
      if(nextScope===scope&&nextUid===uid&&sessionGeneration===nextGeneration)return false;
      uid=nextUid;scope=nextScope;sessionGeneration=nextGeneration;epoch++;ready=false;error=null;flight=null;lastLoaded=0;canonical=new Map();pending=new Map();upserts.clear();removals.clear();canManage=false;mutationRevision++;
      for(const entry of persistedPending())try{if(validDraft(entry))pending.set(entry.id,{...entry,pending:true});}catch(_){}
      emit();return true;
    }
    function persist(){
      if(!scope)throw failure('category_auth','로그인한 뒤 분류를 추가해주세요.');
      // Merge unacknowledged additions from another tab before writing.
      for(const entry of persistedPending())try{if(validDraft(entry)&&!canonical.has(entry.id)&&!pending.has(entry.id))pending.set(entry.id,{...entry,pending:true});}catch(_){}
      try{storage().setItem(scope,JSON.stringify({schema:1,workspace:config.workspace,uid,pending:[...pending.values()]}));}
      catch(_){throw failure('category_storage','분류를 기기에 보관하지 못했습니다. 이름을 복사한 뒤 다시 시도해주세요.');}
    }
    function requireConfigured(){syncSession();if(!uid||!config.workspace)throw failure('category_auth','로그인한 뒤 참고 분류를 확인해주세요.');if(typeof config.request!=='function')throw failure('category_unavailable','분류 연결을 준비하고 있습니다. 입력은 기기에 보관됩니다.');}
    function checkCapability(response){if(!(Number(response?.noteCategoriesVersion)>=VERSION))throw failure('category_server_version','분류 서버 연결을 확인하지 못했습니다. 입력한 분류는 기기에 보관했습니다.');}
    async function checkedEntry(raw){
      const name=cleanName(raw?.name),normalized=normalizeName(name),id=await idForName(name,config.crypto||root.crypto);
      if(raw?.id!==id||raw?.normalized!==normalized)throw failure('category_response','저장된 분류를 확인하지 못했습니다. 기기 초안은 유지했습니다.');
      if(!Number.isSafeInteger(raw.revision??0)||(raw.revision??0)<0)throw failure('category_response','분류 변경 내용을 확인하지 못했습니다.');
      return {id,name,normalized,createdAt:raw.createdAt||0,revision:raw.revision??0,deletedAt:raw.deletedAt||'',pending:false};
    }
    async function load({force=false}={}){
      requireConfigured();if(flight)return flight;if(ready&&!force&&Date.now()-lastLoaded<30000)return state();const expected=stamp(),atRevision=mutationRevision;
      const task=(async()=>{
        try{
          const response=await config.request('noteCategories',{});assertSession(expected);checkCapability(response);
          if(!Array.isArray(response.categories))throw failure('category_response','참고 분류 목록을 확인하지 못했습니다.');
          const entries=await Promise.all(response.categories.map(checkedEntry));assertSession(expected);if(atRevision!==mutationRevision)return state();canonical=new Map(entries.map(entry=>[entry.id,entry]));canManage=response.canManage===true;
          for(const id of canonical.keys())pending.delete(id);ready=true;error=null;lastLoaded=Date.now();persist();emit();return state();
        }catch(cause){if(expected.epoch===epoch&&expected.uid===user()?.uid){error={code:cause.code||'category_network',message:cause.message};ready=false;emit();}throw cause;}
      })();flight=task;try{return await task;}finally{if(flight===task)flight=null;}
    }
    async function add(raw){
      syncSession();if(!uid||!config.workspace)throw failure('category_auth','로그인한 뒤 분류를 추가해주세요.');
      const expected=stamp(),name=cleanName(raw),normalized=normalizeName(name),id=await idForName(name,config.crypto||root.crypto);assertSession(expected);
      if(canonical.get(id)?.deletedAt)throw failure('category_deleted','삭제된 분류입니다. 분류 관리에서 복원할 수 있습니다.');if(canonical.has(id))return {...canonical.get(id)};if(pending.has(id))return {...pending.get(id)};
      const entry={id,name,normalized,createdAt:Date.now(),pending:true};pending.set(id,entry);
      try{persist();}catch(cause){pending.delete(id);throw cause;}emit();return {...entry};
    }
    async function ensure(id){
      if(!id)return null;requireConfigured();if(!ID.test(id))throw failure('category_id','참고 분류를 다시 선택해주세요.');
      if(ready&&canonical.has(id))return {...canonical.get(id)};if(upserts.has(id))return upserts.get(id);
      const expected=stamp();
      const task=(async()=>{
        try{
          if(!pending.has(id)){await load();assertSession(expected);if(canonical.has(id))return {...canonical.get(id)};throw failure('category_missing','참고 분류를 찾지 못했습니다. 선택한 분류와 입력은 유지했습니다.');}
          mutationRevision++;const response=await config.request('noteCategoryUpsert',{name:pending.get(id).name});assertSession(expected);checkCapability(response);
          const entry=await checkedEntry(response.category);assertSession(expected);if(entry.id!==id)throw failure('category_response','분류 연결을 확인하지 못했습니다. 기기 초안은 유지했습니다.');
          if(entry.deletedAt)throw failure('category_deleted','삭제된 분류입니다. 분류 관리에서 복원할 수 있습니다.');canonical.set(id,entry);pending.delete(id);mutationRevision++;error=null;persist();emit();return {...entry};
        }catch(cause){if(expected.epoch===epoch&&expected.uid===user()?.uid){error={code:cause.code||'category_network',message:cause.message};emit();}throw cause;}
      })();upserts.set(id,task);try{return await task;}finally{if(upserts.get(id)===task)upserts.delete(id);}
    }
    function get(id){syncSession();const entry=canonical.get(id)||pending.get(id);return entry?{...entry}:null;}
    async function remove(id){
      requireConfigured();if(removals.has(id))return removals.get(id);const expected=stamp();
      const task=(async()=>{if(upserts.has(id))await upserts.get(id);await load();assertSession(expected);if(!canManage)throw failure('permission_denied','분류 삭제는 대표자 계정에서 할 수 있습니다.');const old=canonical.get(id);if(!old)throw failure('category_missing','저장된 분류를 다시 선택해주세요.');if(old.deletedAt)return {...old};mutationRevision++;
        try{const response=await config.request('noteCategoryDelete',{id,expectedRevision:old.revision});assertSession(expected);checkCapability(response);const entry=await checkedEntry(response.category);assertSession(expected);if(response.taxonomyVersion!==216||entry.id!==id||!entry.deletedAt)throw failure('category_response','분류 삭제 결과를 확인하지 못했습니다.');canonical.set(id,entry);pending.delete(id);mutationRevision++;error=null;persist();emit();return {...entry};}
        catch(cause){assertSession(expected);error=cause;emit();throw cause;}
      })();removals.set(id,task);try{return await task;}finally{if(removals.get(id)===task)removals.delete(id);}
    }
    async function restore(raw){
      requireConfigured();const expected=stamp();await load({force:true});assertSession(expected);if(!canManage)throw failure('permission_denied','분류 복원은 대표자 계정에서 할 수 있습니다.');const id=await idForName(raw,config.crypto||root.crypto);assertSession(expected);const old=canonical.get(id);if(!old?.deletedAt)throw failure('category_missing','삭제된 분류를 다시 확인해주세요.');mutationRevision++;
      const response=await config.request('noteCategoryUpsert',{name:old.name,restore:true,expectedRevision:old.revision});assertSession(expected);checkCapability(response);const entry=await checkedEntry(response.category);assertSession(expected);if(response.taxonomyVersion!==216||entry.id!==id||entry.deletedAt)throw failure('category_response','분류 복원 결과를 확인하지 못했습니다.');canonical.set(id,entry);pending.delete(id);mutationRevision++;error=null;persist();emit();return {...entry};
    }
    async function flush(){requireConfigured();const expected=stamp();for(const id of [...pending.keys()]){assertSession(expected);await ensure(id);}return state();}
    function configure(next){config={...config,...next};syncSession();return api;}
    function subscribe(listener){syncSession();listeners.add(listener);listener(state());return ()=>listeners.delete(listener);}
    function refreshSession(){const changed=syncSession();if(!changed&&uid){for(const entry of persistedPending())try{if(validDraft(entry)&&!canonical.has(entry.id))pending.set(entry.id,{...entry,pending:true});}catch(_){}emit();}}
    const api={configure,list,get,state,subscribe,load,add,remove,restore,ensure,flush,refreshSession,idsFromNotes,matches};return api;
  }
  const store=createStore();
  function manage(host,options={}){
    if(!root.AiselTaxonomyManager)throw failure('category_unavailable','분류 관리 화면을 준비하고 있습니다.');
    return root.AiselTaxonomyManager.open(host,{label:'분류',load:()=>store.load({force:true}),subscribe:store.subscribe,session:()=>{const s=store.state();return [s.uid,s.generation,s.workspace];},list:()=>store.list().filter(entry=>!entry.pending),permissions:()=>({canAdd:!!store.state().uid,canRemove:store.state().canManage}),add:async(name,{restore=false}={})=>{if(restore)return store.restore(name);await store.load({force:true});const draft=await store.add(name),entry=await store.ensure(draft.id);if(entry.deletedAt)throw failure('category_deleted','삭제된 분류입니다. 복원을 눌러 다시 추가할 수 있습니다.');return entry;},remove:entry=>store.remove(entry.id),...options});
  }
  function mountFilter(select,options={}){
    const document=select.ownerDocument;let config={...options},selected=String(options.value??select.value??''),destroyed=false,manager=null,signature='',prior=select.onchange;
    function close(){manager?.close();manager=null;}
    function render(){if(destroyed)return;const entries=store.list(),values=[['',config.placeholder||'카테고리 전체'],...entries.map(entry=>[entry.id,entry.name])];if(selected&&!entries.some(entry=>entry.id===selected))values.push([selected,(store.get(selected)?.name||'선택한 분류')+(store.get(selected)?.deletedAt?' (삭제됨)':'')]);values.push([ADD,'＋ 분류 추가'],[MANAGE,'분류 관리']);const next=JSON.stringify(values);if(signature!==next&&(!signature||document.activeElement!==select)){const fragment=document.createDocumentFragment();for(const [value,label]of values){const option=document.createElement('option');option.value=value;option.textContent=label;fragment.append(option);}select.replaceChildren(fragment);signature=next;}select.value=selected;select.disabled=!!config.disabled;if(config.disabled)close();}
    select.onchange=()=>{if(destroyed||config.disabled)return;const value=select.value;close();if(value===ADD||value===MANAGE){select.value=selected;manager=manage(config.managerHost||select.parentElement,{addOnly:value===ADD,closeOnSelect:value===ADD,onError:config.onError,onSelect:entry=>{if(destroyed||config.disabled)return;selected=entry.id;render();config.onChange?.(selected);}});return;}if(value!==selected&&store.get(value)?.deletedAt){select.value=selected;config.onError?.(failure('category_deleted','삭제된 분류입니다. 다른 분류를 선택해주세요.'));return;}selected=value;config.onChange?.(value);};
    const focus=()=>store.load().catch(error=>{if(!destroyed)config.onError?.(error);}),blur=()=>setTimeout(render,0);select.addEventListener('focus',focus);select.addEventListener('blur',blur);const stop=store.subscribe(render);render();return {refresh(next={}){config={...config,...next};if(Object.hasOwn(next,'value')){const value=String(next.value||'');if(value!==selected)close();selected=value;}render();},setValue(value){if(String(value||'')!==selected)close();selected=String(value||'');render();},setDisabled(value){config.disabled=!!value;render();},close,destroy(){if(destroyed)return;destroyed=true;close();stop();select.removeEventListener('focus',focus);select.removeEventListener('blur',blur);select.onchange=prior;}};
  }
  function mountPicker(host,options={}){
    const document=host.ownerDocument,select=document.createElement('select'),input=document.createElement('input'),status=document.createElement('span');
    let selected=String(options.value||''),disabled=!!options.disabled,editing=false,composing=false,commitFlight=null,editRevision=0,destroyed=false,optionSignature='',manager=null;
    host.classList.add('aisel-note-category');select.className='aisel-note-category-select '+(options.controlClass||'');select.setAttribute('aria-label',options.label||'참고 분류');
    input.type='text';input.className='aisel-note-category-name '+(options.controlClass||'');input.maxLength=80;input.placeholder='새 분류 이름';input.setAttribute('aria-label','새 참고 분류 이름');input.setAttribute('enterkeyhint','done');input.autocomplete='off';input.hidden=true;
    status.className='aisel-note-category-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');host.append(select,input,status);
    function report(error){status.textContent=error?.message||'';host.title=error?.message||'';if(error)options.onError?.(error);}
    function render(){
      const entries=store.list(),fragment=document.createDocumentFragment();
      const option=(value,name)=>{const item=document.createElement('option');item.value=value;item.textContent=name;fragment.append(item);};
      option('','분류 선택');for(const entry of entries)option(entry.id,entry.name+(entry.pending?' · 기기 보관':''));
      if(selected&&!entries.some(entry=>entry.id===selected))option(selected,(store.get(selected)?.name||'선택한 분류')+(store.get(selected)?.deletedAt?' (삭제됨)':''));option(ADD,'＋ 분류 추가');option(MANAGE,'분류 관리');
      const signature=JSON.stringify([...fragment.children].map(entry=>[entry.value,entry.textContent]));
      // Background auth/catalog updates must not close an open native picker.
      // Apply changed options when focus leaves; keep IME input untouched.
      if(signature!==optionSignature&&(!optionSignature||document.activeElement!==select)){select.replaceChildren(fragment);optionSignature=signature;}
      if(select.value!==(editing?ADD:selected))select.value=editing?ADD:selected;
      select.disabled=disabled;input.disabled=disabled;select.hidden=editing;input.hidden=!editing;
    }
    function cancel(){editRevision++;editing=false;input.value='';status.textContent='';render();}
    function commit(){
      if(destroyed||composing)return Promise.resolve(false);if(commitFlight)return commitFlight;if(!editing)return Promise.resolve(true);if(disabled)return Promise.resolve(false);if(!input.value.trim()){cancel();return Promise.resolve(true);}
      const raw=input.value,revision=editRevision,session=store.state();
      const task=(async()=>{
        try{
          const draft=await store.add(raw),entry=await store.ensure(draft.id),current=store.state();if(entry.deletedAt)throw failure('category_deleted','삭제된 분류입니다. 분류 관리에서 복원할 수 있습니다.');
          if(destroyed||disabled||!editing||composing||revision!==editRevision||input.value!==raw||session.uid!==current.uid||session.workspace!==current.workspace||session.generation!==current.generation)return false;
          selected=entry.id;editing=false;input.value='';report(null);render();options.onChange?.(selected);
          return true;
        }catch(cause){if(!destroyed){report(cause);input.focus({preventScroll:true});}return false;}
      })();commitFlight=task;task.finally(()=>{if(commitFlight===task)commitFlight=null;});return task;
    }
    select.onchange=()=>{editRevision++;manager?.close();if(select.value===MANAGE){select.value=selected;manager=manage(options.managerHost||host.closest('.rc-note-entry,.dm-reference-note')||host,{onError:report,onSelect:entry=>{if(destroyed||disabled)return;selected=entry.id;render();options.onChange?.(selected);}});return;}if(select.value===ADD){editing=true;render();input.focus();return;}if(select.value!==selected&&store.get(select.value)?.deletedAt){select.value=selected;report(failure('category_deleted','삭제된 분류입니다. 다른 분류를 선택해주세요.'));return;}selected=select.value;report(null);options.onChange?.(selected);};
    select.addEventListener('focus',()=>store.load().catch(cause=>{if(!destroyed)report(cause);}));
    select.addEventListener('blur',()=>setTimeout(()=>{if(!destroyed)render();},0));
    input.addEventListener('input',()=>{editRevision++;});
    input.addEventListener('compositionstart',()=>{composing=true;editRevision++;});input.addEventListener('compositionend',()=>{composing=false;if(document.activeElement!==input)commit();});
    input.addEventListener('keydown',event=>{if(event.isComposing||composing||event.keyCode===229)return;if(event.key==='Enter'){event.preventDefault();commit();}else if(event.key==='Escape'){event.preventDefault();cancel();select.focus();}});
    input.addEventListener('blur',commit);
    const stop=store.subscribe(render);render();return {flush:commit,hasDraft(){return !!commitFlight||composing||editing&&!!input.value;},isComposing(){return composing;},setValue(id){id=String(id||'');if(id===selected)return;selected=id;render();},setDisabled(value){value=!!value;if(value===disabled)return;disabled=value;if(disabled)manager?.close();select.disabled=disabled;input.disabled=disabled;},close(){manager?.close();cancel();},destroy(){destroyed=true;manager?.close();stop();host.replaceChildren();}};
  }
  const api={...store,VERSION,normalizeName,cleanName,idForName,idsFromNotes,matches,mountPicker,mountFilter,createStore};
  if(typeof module==='object'&&module.exports)module.exports=api;else{
    root.AiselNoteCategories=api;
    root.addEventListener('aisel-session-change',()=>{store.refreshSession();});
    root.addEventListener('storage',event=>{if(event.key?.startsWith('aisel.note-categories.v1:'))store.refreshSession();});
    root.addEventListener('online',()=>store.load({force:true}).then(()=>store.flush()).catch(()=>{}));
  }
})(typeof window==='object'?window:globalThis);
