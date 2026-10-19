/* Outfit choices are independent of material types and reference-note categories. */
(function(root){
 'use strict';
 const ADD='__add_look_category__',fail=(code,message)=>Object.assign(Error(message),{code});
 function clean(raw){const name=String(raw??'').normalize('NFKC').trim().replace(/\s+/g,' ');if(!name||name.length>80||/[\u0000-\u001f\u007f]/.test(name))throw fail('invalid','카테고리를 1~80자로 입력해주세요.');return name;}
 async function idForName(raw){return 'look_'+[...new Uint8Array(await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(clean(raw).toLowerCase())))].map(n=>n.toString(16).padStart(2,'0')).join('');}
 function createStore(options={}){
   let session='',epoch=0,entries={},canManage=false,loaded=0,flight=null,busy=false;const listeners=new Set();
   const key=()=>JSON.stringify(options.session?.()??[root.AiselAuth?.currentUser?.()?.uid||'',root.AiselAuth?.generation||0]);
   const request=change=>options.request?options.request(change):root.AiselCollectionWrites.lookCategoryRequest(change);
   const order=options.order||root.AiselCatalogOrder;
   function emit(){for(const fn of listeners)try{fn();}catch(_){} }
   function sync(){const next=key();if(next!==session){session=next;epoch++;entries={};canManage=false;loaded=0;flight=null;busy=false;emit();}}
   function guard(e){sync();if(e!==epoch)throw fail('auth_changed','로그인 계정이 변경되었습니다.');}
   function valid(entry){return entry&&/^look_[0-9a-f]{64}$/.test(entry.id)&&clean(entry.name)===entry.name&&Number.isSafeInteger(entry.revision)&&entry.revision>0;}
   async function load({force=false}={}){sync();if(flight)return flight;if(loaded&&!force&&Date.now()-loaded<30000)return;const e=epoch;
     const task=(async()=>{const [data]=await Promise.all([request(),order.load('lookCategories',{force})]);guard(e);if(!data?.entries||typeof data.entries!=='object'||Object.entries(data.entries).some(([id,v])=>id!==v.id||!valid(v)))throw fail('invalid','카테고리 목록을 확인하지 못했습니다.');entries=data.entries;canManage=data.canManage===true;loaded=Date.now();emit();})();flight=task;try{await task;}finally{if(flight===task)flight=null;}}
   function list(){sync();return order.sort('lookCategories',Object.values(entries).filter(e=>!e.deletedAt)).map(e=>({...e}));}
   function get(id){sync();return entries[id]?{...entries[id]}:null;}
   async function mutate(raw,action){sync();if(busy)throw fail('busy','저장 중입니다. 잠시 후 다시 시도해주세요.');const e=epoch;busy=true;
     try{await load({force:true});guard(e);if(!canManage)throw fail('permission_denied','카테고리 편집은 대표자 계정에서 할 수 있습니다.');const name=clean(raw),id=await idForName(name);guard(e);const old=entries[id];if(action==='add'&&old&&!old.deletedAt)return {...old};if(action==='add'&&old?.deletedAt)throw fail('category_deleted','삭제된 분류입니다. 복원을 눌러 다시 추가할 수 있습니다.');if(action!=='add'&&!old)throw fail('missing','분류를 다시 확인해주세요.');const now=new Date().toISOString(),entry={id,name:old?.name||name,createdAt:old?.createdAt||now,updatedAt:now,revision:(old?.revision||0)+1,deletedAt:action==='delete'?now:''};const saved=await request({entry,expectedRevision:old?.revision||0});guard(e);if(!valid(saved)||saved.id!==id||saved.revision!==entry.revision||saved.deletedAt!==entry.deletedAt)throw fail('invalid','분류 저장 결과를 확인하지 못했습니다.');entries[id]=saved;loaded=Date.now();emit();return {...saved};}
     catch(error){guard(e);loaded=0;throw error;}finally{if(e===epoch)busy=false;}}
   function subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}
   order.subscribe(emit);
   return {load,list,get,subscribe,reset:sync,session:()=>{sync();return session;},canManage:()=>canManage,add:name=>mutate(name,'add'),remove:entry=>mutate(entry.name,'delete'),restore:name=>mutate(name,'restore'),reorder:items=>order.save('lookCategories',items.map(e=>e.id))};
 }
 const store=typeof module==='object'&&module.exports?null:createStore();
 function mountPicker(select,options={}){
   let selected='',disabled=false,manager=null,destroyed=false,signature='';
   const close=()=>{manager?.close();manager=null;};
   function render(){if(destroyed)return;const items=store.list(),values=[['','카테고리'],...items.map(e=>[e.id,e.name])];if(selected&&!items.some(e=>e.id===selected)){const old=store.get(selected);values.push([selected,(old?.name||'선택한 룩')+(old?.deletedAt?' (삭제됨)':'')]);}values.push([ADD,'＋ 추가']);const next=JSON.stringify(values);if(signature!==next&&(!signature||select.ownerDocument.activeElement!==select)){select.replaceChildren(...values.map(([value,name])=>{const option=select.ownerDocument.createElement('option');option.value=value;option.textContent=name;return option;}));signature=next;}select.value=selected;select.disabled=disabled;}
   select.onchange=()=>{if(disabled)return;const value=select.value;close();if(value===ADD){select.value=selected;manager=root.AiselTaxonomyManager.open(options.managerHost,{label:'카테고리',title:'카테고리',iconActions:true,addOnly:true,closeOnSelect:true,session:store.session,load:()=>store.load({force:true}),subscribe:store.subscribe,list:store.list,permissions:()=>({canAdd:store.canManage(),canRemove:store.canManage()}),add:(name,{restore=false}={})=>restore?store.restore(name):store.add(name),remove:store.remove,restore:store.restore,reorder:store.reorder,onSelect:entry=>{if(destroyed||disabled)return;selected=entry.id;render();options.onChange?.(selected);},onError:options.onError});return;}if(value&&store.get(value)?.deletedAt){select.value=selected;return;}selected=value;options.onChange?.(value);};
   const focus=()=>store.load().catch(options.onError),blur=()=>setTimeout(render,0);select.addEventListener('focus',focus);select.addEventListener('blur',blur);const stop=store.subscribe(render);render();
   return {setValue(value){value=String(value||'');if(value!==selected)close();selected=value;render();},setDisabled(value){disabled=!!value;if(disabled)close();render();},close,destroy(){destroyed=true;close();stop();select.removeEventListener('focus',focus);select.removeEventListener('blur',blur);}};
 }
 if(typeof module==='object'&&module.exports)module.exports={createStore,clean,idForName};else{root.AiselLookCategories={...store,mountPicker};root.addEventListener('aisel-session-change',store.reset);}
})(typeof window==='object'?window:globalThis);
