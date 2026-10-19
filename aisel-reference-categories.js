/* Reference top categories are separate from note classifications. Only server
 * acknowledged catalog changes become selectable; tombstones keep old labels. */
(function(root){
  'use strict';
  const VERSION=220,ADD='__add_reference_category__';
  const BUILTINS=[
    {id:'product',name:'제품',category:'product',contentType:''},
    {id:'content_video',name:'콘텐츠 (영상)',category:'content',contentType:'video'},
    {id:'content_image',name:'콘텐츠 (이미지)',category:'content',contentType:'image'},
    {id:'marketing',name:'마케팅',category:'marketing',contentType:''},
    {id:'idea',name:'아이디어',category:'idea',contentType:''}
  ];
  const failure=(code,message)=>Object.assign(Error(message),{code});
  function cleanName(value){const name=String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');if(!name||[...name].length>40||/[\u0000-\u001f\u007f]/.test(name))throw failure('category_name','카테고리 이름을 1~40자로 입력해주세요.');return name;}
  const normalizeName=value=>cleanName(value).toLocaleLowerCase('en-US');
  async function idForName(value,cryptoObject=root.crypto){const normalized=normalizeName(value),builtin=BUILTINS.find(entry=>normalizeName(entry.name)===normalized);if(builtin)return builtin.id;if(!cryptoObject?.subtle)throw failure('category_crypto','카테고리 연결을 확인해주세요.');const digest=await cryptoObject.subtle.digest('SHA-256',new TextEncoder().encode(normalized));return 'rcat_'+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');}
  function valueForRecord(record){return record?.category==='content'?(record.contentType==='video'?'content_video':'content_image'):record?.category||'';}
  function ordered(entries){const order=new Map(BUILTINS.map((entry,index)=>[entry.id,index]));return entries.sort((a,b)=>(order.get(a.id)??99)-(order.get(b.id)??99)||a.name.localeCompare(b.name,'ko'));}
  function createStore(options={}){
    let config={...options},uid='',generation,epoch=0,ready=false,canManage=false,entries=new Map(),flight=null,lastLoaded=0,revision=0,error=null;
    const listeners=new Set(),mutations=new Map();
    const user=()=>config.getUser?.()||root.AiselAuth?.currentUser?.()||null;
    const currentGeneration=()=>config.getGeneration?.()??root.AiselAuth?.generation??0;
    const request=(action,payload)=>config.request?config.request(action,payload):root.AiselCollectionWrites?.referenceCategoryRequest(action,payload);
    const snapshot=()=>({uid:uid||null,generation,workspace:config.workspace||'',ready,canManage,error,lastLoaded,entries:ordered([...entries.values()].map(entry=>({...entry})))});
    function emit(){const state=snapshot();for(const listener of listeners)try{listener(state);}catch(_){} }
    function sync(){const next=user()?.uid||'',nextGeneration=currentGeneration();if(next===uid&&nextGeneration===generation)return;uid=next;generation=nextGeneration;epoch++;ready=false;canManage=false;entries.clear();flight=null;lastLoaded=0;error=null;mutations.clear();emit();}
    const stamp=()=>({uid,epoch,generation});
    function check(value){if(value.epoch!==epoch||value.uid!==(user()?.uid||'')||value.generation!==currentGeneration())throw failure('auth_changed','로그인 계정이 변경되었습니다.');}
    function requireUser(){sync();if(!uid)throw failure('permission_denied','로그인한 뒤 카테고리를 확인해주세요.');}
    async function checked(raw){const name=cleanName(raw?.name),normalized=normalizeName(name),id=await idForName(name,config.crypto||root.crypto),builtin=BUILTINS.find(entry=>entry.id===id);if(raw?.id!==id||raw.normalized!==normalized||!Number.isSafeInteger(raw.revision)||raw.revision<0||raw.category!==(builtin?.category||id)||raw.contentType!==(builtin?.contentType||''))throw failure('category_response','저장된 카테고리를 확인하지 못했습니다.');return {...raw,name,normalized,deletedAt:raw.deletedAt||''};}
    async function accept(response,{merge=false}={}){if(response?.referenceCategoriesVersion!==VERSION||!Array.isArray(response.entries)||!Array.isArray(response.categories))throw failure('category_response','카테고리 연결을 확인해주세요.');const values=await Promise.all(response.entries.map(checked)),active=values.filter(entry=>!entry.deletedAt).map(entry=>entry.id).sort();if(JSON.stringify(response.categories.map(entry=>entry.id).sort())!==JSON.stringify(active))throw failure('category_response','카테고리 목록을 확인하지 못했습니다.');const next=new Map(values.map(entry=>[entry.id,entry]));if(merge)for(const [id,old]of entries)if(!next.has(id)||old.revision>next.get(id).revision)next.set(id,old);return {entries:next,canManage:response.canManage===true};}
    function adopt(value,{merge=false}={}){if(merge)for(const [id,old]of entries)if(!value.entries.has(id)||old.revision>value.entries.get(id).revision)value.entries.set(id,old);entries=value.entries;canManage=value.canManage;ready=true;lastLoaded=Date.now();error=null;}
    function list(){sync();return ordered((ready?[...entries.values()]:BUILTINS).filter(entry=>!entry.deletedAt).map(entry=>({...entry})));}
    function get(id){sync();const entry=entries.get(id)||(!ready&&BUILTINS.find(entry=>entry.id===id));return entry?{...entry}:null;}
    function state(){sync();return snapshot();}
    async function load({force=false}={}){requireUser();if(flight)return flight;if(ready&&!force&&Date.now()-lastLoaded<30000)return snapshot();const session=stamp(),atRevision=revision;const task=(async()=>{try{const response=await request('listReferenceCategories',{});check(session);const value=await accept(response);check(session);if(atRevision===revision){adopt(value);emit();}return snapshot();}catch(cause){check(session);error=cause;emit();throw cause;}})();flight=task;try{return await task;}finally{if(flight===task)flight=null;}}
    async function mutate(action,raw,{restore=false}={}){
      requireUser();const session=stamp(),id=action==='deleteReferenceCategory'?String(raw):await idForName(raw,config.crypto||root.crypto);check(session);
      if(mutations.has(id)){const active=mutations.get(id);if(active.action===action&&active.restore===restore)return active.promise;try{await active.promise;}catch(_){}check(session);return mutate(action,raw,{restore});}
      const task=(async()=>{try{await load();check(session);if(!canManage)throw failure('permission_denied','카테고리 추가·삭제는 대표자 계정에서 할 수 있습니다.');const old=entries.get(id);if(action==='upsertReferenceCategory'&&!restore&&old?.deletedAt)throw failure('category_deleted','삭제된 카테고리입니다. 복원을 눌러 다시 추가할 수 있습니다.');if(action==='upsertReferenceCategory'&&!restore&&old)return {...old};if(action==='deleteReferenceCategory'&&!old||restore&&!old?.deletedAt)throw failure('category_missing','카테고리 목록을 다시 확인해주세요.');revision++;const response=await request(action,{...(action==='deleteReferenceCategory'?{id}:{name:cleanName(raw)}),...(action==='deleteReferenceCategory'||restore?{expectedRevision:old?.revision??0}:{}),...(restore?{restore:true}:{})});check(session);const value=await accept(response,{merge:true}),row=await checked(response.category);check(session);if(row.id!==id||(action==='deleteReferenceCategory'?!row.deletedAt:!!row.deletedAt))throw failure('category_response','카테고리 저장 결과를 확인하지 못했습니다.');adopt(value,{merge:true});revision++;emit();const saved=entries.get(id);if(!saved||(action==='deleteReferenceCategory'?!saved.deletedAt:!!saved.deletedAt))throw failure('revision_conflict','카테고리 목록이 변경되었습니다. 다시 열어주세요.');return {...saved};}catch(cause){check(session);error=cause;emit();throw cause;}})();const operation={action,restore,promise:task};mutations.set(id,operation);try{return await task;}finally{if(mutations.get(id)===operation)mutations.delete(id);}
    }
    const add=(name,options)=>mutate('upsertReferenceCategory',name,options),remove=id=>mutate('deleteReferenceCategory',id),restore=name=>add(name,{restore:true});
    function subscribe(listener){sync();listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);}
    function configure(next){const oldWorkspace=config.workspace;config={...config,...next};if(oldWorkspace!==config.workspace){uid='';generation=undefined;}sync();return api;}
    const api={configure,list,get,state,load,add,remove,restore,subscribe,refreshSession:sync};return api;
  }
  const store=createStore();
  function mountPicker(select,options={}){
    const document=select.ownerDocument;let config={...options},selected=String(options.value??select.value??''),destroyed=false,manager=null,signature='',prior=select.onchange;
    function close(){manager?.close();manager=null;}
    function render(){if(destroyed)return;const entries=store.list(),values=[['','카테고리'],...entries.map(entry=>[entry.id,entry.name])];if(selected&&!entries.some(entry=>entry.id===selected)){const entry=store.get(selected);values.push([selected,(entry?.name||config.selectedLabel||'기존 카테고리')+(entry?.deletedAt?' (삭제됨)':'')]);}values.push([ADD,'＋ 추가']);const next=JSON.stringify(values);if(next!==signature&&(!signature||document.activeElement!==select)){const fragment=document.createDocumentFragment();for(const [value,label]of values){const option=document.createElement('option');option.value=value;option.textContent=label;if(!value)option.disabled=true;fragment.append(option);}select.replaceChildren(fragment);signature=next;}select.value=selected;select.disabled=!!config.disabled;if(config.disabled)close();}
    function openManager(){close();if(!root.AiselTaxonomyManager)throw failure('category_unavailable','카테고리 화면을 준비하고 있습니다.');const session=store.state();manager=root.AiselTaxonomyManager.open(config.managerHost||select.parentElement,{label:'카테고리',title:'카테고리',iconActions:true,maxLength:40,addOnly:true,closeOnSelect:true,list:()=>store.list(),load:()=>store.load({force:true}),subscribe:store.subscribe,session:()=>{const s=store.state();return [s.uid,s.generation,s.workspace];},permissions:()=>({canAdd:store.state().canManage,canRemove:store.state().canManage}),add:store.add,remove:entry=>store.remove(entry.id),restore:store.restore,onError:config.onError,onSelect:entry=>{const current=store.state();if(destroyed||config.disabled||session.uid!==current.uid||session.generation!==current.generation)return;selected=entry.id;render();config.onChange?.(entry);},onClose:()=>{manager=null;}});}
    select.onchange=()=>{if(destroyed||config.disabled)return;const value=select.value;if(value===ADD){select.value=selected;try{openManager();}catch(error){config.onError?.(error);}return;}close();const entry=store.get(value);if(!entry||entry.deletedAt&&value!==selected){select.value=selected;config.onError?.(failure('category_deleted','다른 카테고리를 선택해주세요.'));return;}selected=value;config.onChange?.(entry);};
    const onFocus=()=>store.load().catch(error=>{if(!destroyed)config.onError?.(error);}),onBlur=()=>setTimeout(render,0);select.addEventListener('focus',onFocus);select.addEventListener('blur',onBlur);const stop=store.subscribe(render);render();
    return {refresh(next={}){config={...config,...next};if(Object.hasOwn(next,'value')){const value=String(next.value||'');if(value!==selected)close();selected=value;}render();},flush:()=>manager?.flush?.()??Promise.resolve(true),hasDraft:()=>manager?.hasDraft?.()||false,isComposing:()=>manager?.isComposing?.()||false,close,destroy(){if(destroyed)return;destroyed=true;close();stop();select.removeEventListener('focus',onFocus);select.removeEventListener('blur',onBlur);select.onchange=prior;}};
  }
  const api={...store,VERSION,BUILTINS,cleanName,normalizeName,idForName,valueForRecord,createStore,mountPicker};
  if(typeof module==='object'&&module.exports)module.exports=api;else{root.AiselReferenceCategories=api;root.addEventListener('aisel-session-change',()=>store.refreshSession());root.addEventListener('online',()=>store.load({force:true}).catch(()=>{}));}
})(typeof window==='object'?window:globalThis);
