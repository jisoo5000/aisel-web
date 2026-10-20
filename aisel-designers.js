/* Shared designer choices. Catalog mutations are adopted only after a server
 * acknowledgement; deleting a choice never rewrites an assigned record. */
(function(root){
  'use strict';
  const VERSION=216,ADD='__add_designer__';
  const failure=(code,message)=>Object.assign(Error(message),{code});
  function cleanName(value){
    const name=String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
    if(!name||['__proto__','prototype','constructor'].includes(name)||[...name].length>80||/[.#$\[\]\/\u0000-\u001f\u007f]/.test(name))throw failure('designer_name','담당자 이름을 1~80자로 입력해주세요.');
    return name;
  }
  function createStore(options={}){
    let config={...options},uid='',generation,epoch=0,ready=false,canManage=false,entries=new Map(),flight=null,lastLoaded=0,revision=0,error=null;
    const listeners=new Set(),mutations=new Map();
    const user=()=>config.getUser?.()||root.AiselAuth?.currentUser?.()||null;
    const currentGeneration=()=>config.getGeneration?.()??root.AiselAuth?.generation??0;
    const request=(action,payload)=>config.request?config.request(action,payload):root.AiselCollectionWrites?.designerRequest(action,payload);
    function snapshot(){return {uid:uid||null,generation,ready,canManage,error,lastLoaded,designers:list(false),entries:[...entries.values()].map(v=>({...v}))};}
    function emit(){for(const listener of listeners)try{listener(snapshot());}catch(_){} }
    function sync(){const next=user()?.uid||'',nextGeneration=currentGeneration();if(next===uid&&nextGeneration===generation)return;uid=next;generation=nextGeneration;epoch++;ready=false;canManage=false;entries.clear();flight=null;lastLoaded=0;error=null;mutations.clear();emit();}
    const stamp=()=>({uid,epoch,generation});
    function check(s){if(s.epoch!==epoch||s.uid!==(user()?.uid||'')||s.generation!==currentGeneration())throw failure('auth_changed','로그인 계정이 변경되었습니다.');}
    function requireUser(){sync();if(!uid)throw failure('permission_denied','로그인한 뒤 담당자 목록을 확인해주세요.');}
    function checked(raw){const name=cleanName(raw?.name);if(name!==raw.name||!Number.isSafeInteger(raw.revision??0)||(raw.revision??0)<0)throw failure('designer_response','저장된 담당자 목록을 확인하지 못했습니다.');return {...raw,name,revision:raw.revision??0,deletedAt:raw.deletedAt||''};}
    function accept(response,{merge=false}={}){if(response?.taxonomyVersion!==VERSION||!Array.isArray(response.entries)||!Array.isArray(response.designers))throw failure('designer_response','담당자 관리 연결을 확인해주세요.');const values=response.entries.map(checked),active=values.filter(v=>!v.deletedAt).map(v=>v.name).sort();if(JSON.stringify([...response.designers].sort())!==JSON.stringify(active))throw failure('designer_response','담당자 목록을 확인하지 못했습니다.');const next=new Map(values.map(v=>[v.name,v]));if(merge)for(const [name,old]of entries)if(!next.has(name)||old.revision>next.get(name).revision)next.set(name,old);entries=next;canManage=response.canManage===true;ready=true;lastLoaded=Date.now();error=null;}
    function list(refresh=true){if(refresh)sync();const rows=[...entries.values()].filter(v=>!v.deletedAt);return (root.AiselCatalogOrder?.sort('designers',rows,'name')||rows.sort((a,b)=>a.name.localeCompare(b.name,'ko'))).map(v=>v.name);}
    function get(name){sync();const entry=entries.get(name);return entry?{...entry}:null;}
    function isRemoved(name){return !!get(name)?.deletedAt;}
    function state(){sync();return snapshot();}
    async function load({force=false}={}){requireUser();if(flight)return flight;if(ready&&!force&&Date.now()-lastLoaded<30000)return snapshot();const s=stamp(),atRevision=revision;const task=(async()=>{try{const [response]=await Promise.all([request('listDesigners',{}),root.AiselCatalogOrder?.load('designers',{force})]);check(s);if(atRevision===revision){accept(response);emit();}return snapshot();}catch(cause){check(s);error=cause;emit();throw cause;}})();flight=task;try{return await task;}finally{if(flight===task)flight=null;}}
    async function mutate(action,raw,{restore=false}={}){requireUser();const name=cleanName(raw);if(mutations.has(name)){const active=mutations.get(name);if(active.action===action&&active.restore===restore)return active.promise;try{await active.promise;}catch(_){}if(mutations.get(name)===active)mutations.delete(name);return mutate(action,name,{restore});}const s=stamp();const task=(async()=>{try{await load();check(s);if(!canManage)throw failure('permission_denied','담당자 추가·삭제는 대표자 계정에서 할 수 있습니다.');const old=entries.get(name);if(action==='upsertDesigner'&&!restore&&old?.deletedAt)throw failure('designer_deleted','삭제된 담당자입니다. 복원을 눌러 다시 추가할 수 있습니다.');if(action==='upsertDesigner'&&!restore&&old)return {...old};if(action==='deleteDesigner'&&!old)throw failure('designer_missing','담당자를 다시 선택해주세요.');revision++;const response=await request(action,{name,...(action==='deleteDesigner'||restore?{expectedRevision:old?.revision??0}:{}),...(restore?{restore:true}:{})});check(s);const row=checked(response?.designer);if(row.name!==name||(action==='deleteDesigner'?!row.deletedAt:!!row.deletedAt))throw failure('designer_response','담당자 저장 결과를 확인하지 못했습니다.');accept(response,{merge:true});revision++;emit();const confirmed=entries.get(name);if(!confirmed||(action==='deleteDesigner'?!confirmed.deletedAt:!!confirmed.deletedAt))throw failure('revision_conflict','목록이 변경되었습니다. 관리 화면을 다시 열어주세요.');return {...confirmed};}catch(cause){check(s);error=cause;emit();throw cause;}})();const operation={action,restore,promise:task};mutations.set(name,operation);try{return await task;}finally{if(mutations.get(name)===operation)mutations.delete(name);}}
    const add=(name,options)=>mutate('upsertDesigner',name,options),remove=name=>mutate('deleteDesigner',name);
    function subscribe(listener){sync();listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);}
    function configure(next){config={...config,...next};sync();return api;}
    root.AiselCatalogOrder?.subscribe(emit);
    const api={configure,state,list,get,isRemoved,load,add,remove,subscribe,refreshSession:sync};return api;
  }

  // One inline add/delete panel. Catalog changes remain server-acknowledged,
  // and undo restores the catalog entry without changing an assigned record.
  function openManager(host,options){
    const document=host.ownerDocument,panel=document.createElement('section'),panelTitle=options.title||options.label+' 관리';
    panel.className='aisel-taxonomy-manager';panel.setAttribute('aria-label',panelTitle);
    const heading=document.createElement('div'),title=document.createElement('strong'),closeButton=document.createElement('button'),form=document.createElement('form'),input=document.createElement('input'),addButton=document.createElement('button'),restoreButton=document.createElement('button'),status=document.createElement('p'),undoButton=document.createElement('button'),rows=document.createElement('div'),hint=document.createElement('p');
    heading.className='aisel-taxonomy-heading';title.textContent=panelTitle;closeButton.type='button';closeButton.textContent='닫기';closeButton.setAttribute('aria-label',panelTitle+' 닫기');heading.append(title,closeButton);
    input.type='text';input.maxLength=options.maxLength||80;input.placeholder='새 '+options.label+' 이름';input.setAttribute('aria-label',input.placeholder);input.autocomplete='off';input.setAttribute('enterkeyhint','done');
    addButton.type='submit';addButton.textContent='추가';restoreButton.type='button';restoreButton.textContent='복원';restoreButton.className='aisel-taxonomy-restore';restoreButton.hidden=true;form.append(input,addButton,restoreButton);
    status.className='aisel-taxonomy-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');undoButton.type='button';undoButton.textContent='되돌리기';undoButton.className='aisel-taxonomy-undo';undoButton.hidden=true;
    hint.className='aisel-taxonomy-hint';hint.textContent=options.hint||'목록에서 삭제해도 기존 자료의 내용은 유지됩니다.';rows.className='aisel-taxonomy-rows';panel.append(heading,form,status,undoButton,rows,hint);host.append(panel);
    let closed=false,busy=false,composing=false,restoreName='',lastDeleted=null,listSignature='',editRevision=0,operationFlight=null,stop=()=>{},preview=null,drag=null,dragFrame=0;
    const initialSession=JSON.stringify(options.session?.()??null),canUndo=typeof options.restore==='function'||options.undo===true;
    const sameSession=()=>initialSession===JSON.stringify(options.session?.()??null),alive=()=>!closed&&panel.isConnected;
    function report(error){if(!alive())return;status.textContent=error?.message||'';if(error)options.onError?.(error);}
    const restoreItem=name=>options.restore?options.restore(name):options.add(name,{restore:true});
    function render(){
      if(!alive())return;if(!sameSession()){close();return;}
      const permissions=options.permissions?.()||{canAdd:true,canRemove:true},items=preview||options.list(),signature=JSON.stringify([items,busy,permissions]);
      hint.textContent=permissions.canRemove?(options.hint||'목록에서 삭제해도 기존 자료의 내용은 유지됩니다.'):(permissions.canAdd?'삭제·복원은 대표자 계정에서 할 수 있습니다.':'추가·삭제는 대표자 계정에서 할 수 있습니다.');
      input.disabled=busy||!permissions.canAdd;addButton.disabled=busy||!permissions.canAdd;restoreButton.disabled=busy||!permissions.canRemove;undoButton.disabled=busy||!permissions.canRemove;undoButton.hidden=!canUndo||!lastDeleted;
      if(drag)return;if(signature===listSignature)return;listSignature=signature;rows.replaceChildren();
      for(const [index,item] of items.entries()){
        const row=document.createElement('div'),name=document.createElement('span'),button=document.createElement('button');
        name.textContent=item.name+(item.deletedAt?' (삭제됨)':'');button.type='button';button.setAttribute('aria-label',item.name+(item.deletedAt?' 복원':' 삭제'));button.disabled=busy||!permissions.canRemove;
        if(item.deletedAt){button.className='aisel-taxonomy-restore';button.textContent='복원';button.onclick=()=>void run(async()=>{await restoreItem(item.name);if(alive()&&sameSession()){if(lastDeleted?.name===item.name)lastDeleted=null;status.textContent=item.name+' 복원 완료';}return true;});}
        else{
          button.className='aisel-taxonomy-delete';
          if(options.iconActions){button.classList.add('aisel-taxonomy-icon');button.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';}
          else button.textContent='삭제';
          button.onclick=()=>void run(async()=>{await options.remove(item);if(alive()&&sameSession()){lastDeleted={...item};status.textContent=item.name+' 삭제 완료';}return true;});
        }
        row.dataset.orderKey=item.id||item.name;
        if(options.reorder&&!item.deletedAt){
          const grip=document.createElement('button'),up=document.createElement('button'),down=document.createElement('button'),actions=document.createElement('div');
          grip.type=up.type=down.type='button';grip.className='aisel-taxonomy-grip aisel-taxonomy-icon';grip.textContent='≡';grip.setAttribute('aria-label',item.name+' 순서 이동');grip.title='끌어서 순서 변경 · 키보드 위/아래';
          up.className=down.className='aisel-taxonomy-icon';up.textContent='↑';down.textContent='↓';up.setAttribute('aria-label',item.name+' 위로');down.setAttribute('aria-label',item.name+' 아래로');
          const allowed=!busy&&permissions.canRemove;grip.disabled=!allowed;up.disabled=!allowed||index===0;down.disabled=!allowed||index===items.length-1;
          up.onclick=()=>move(index,index-1);down.onclick=()=>move(index,index+1);
          grip.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();move(index,index+(e.key==='ArrowUp'?-1:1));}};
          grip.onpointerdown=e=>startDrag(e,row,grip,items);
          actions.className='aisel-taxonomy-order-actions';actions.append(up,down,button);row.append(grip,name,actions);
        }else row.append(name,button);
        rows.append(row);
      }
      if(!items.length){const empty=document.createElement('p');empty.textContent='등록된 '+options.label+'가 없습니다.';rows.append(empty);}
    }
    const itemKey=item=>item.id||item.name;
    function commitOrder(items,focusKey){
      if(busy||!sameSession()||!alive())return;
      const original=options.list();if(JSON.stringify(items.map(itemKey))===JSON.stringify(original.map(itemKey)))return;
      preview=items;void run(async()=>{try{await options.reorder(items);if(alive())status.textContent='순서 저장됨';}finally{preview=null;}}).then(()=>{
        if(alive()&&focusKey){const row=[...rows.children].find(row=>row.dataset.orderKey===focusKey);row?.querySelector('.aisel-taxonomy-grip')?.focus({preventScroll:true});}
      });
    }
    function move(from,to){const items=options.list();if(to<0||to>=items.length)return;const [item]=items.splice(from,1);items.splice(to,0,item);commitOrder(items,itemKey(item));}
    function startDrag(event,row,grip,items){
      if(busy||event.button!==0||!event.isPrimary||!(options.permissions?.()||{canRemove:true}).canRemove)return;
      const startY=event.clientY,startX=event.clientX;
      drag={row,grip,items:[...items],pointerId:event.pointerId,y:startY,active:false,timer:0};
      rows.setPointerCapture?.(event.pointerId);
      const activate=()=>{if(!drag||!alive())return;drag.active=true;row.classList.add('aisel-taxonomy-dragging');grip.setAttribute('aria-pressed','true');tick();};
      if(event.pointerType==='touch')drag.timer=setTimeout(activate,200);else activate();
      function place(){if(!drag?.active)return;const target=[...rows.children].filter(el=>el!==row&&el.dataset.orderKey).find(el=>{const box=el.getBoundingClientRect();return drag.y<box.top+box.height/2;});rows.insertBefore(row,target||null);}
      function tick(){if(!drag?.active)return;const box=rows.getBoundingClientRect();if(drag.y<box.top+28)rows.scrollTop-=6;else if(drag.y>box.bottom-28)rows.scrollTop+=6;place();dragFrame=requestAnimationFrame(tick);}
      function pointerMove(e){if(!drag||e.pointerId!==drag.pointerId)return;if(!drag.active&&Math.hypot(e.clientY-startY,e.clientX-startX)>8){finish(e,true);return;}drag.y=e.clientY;if(drag.active){e.preventDefault();place();}}
      function finish(e,cancelled=false){if(!drag||e.pointerId!==drag.pointerId)return;const active=drag.active,ordered=[...rows.children].map(el=>items.find(item=>itemKey(item)===el.dataset.orderKey)).filter(Boolean);cleanupDrag();listSignature='';if(active&&!cancelled&&ordered.length===items.length){commitOrder(ordered);render();}else render();}
      function cancel(e){finish(e,true);}
      function escape(e){if(e.key==='Escape'){e.preventDefault();finish({pointerId:drag?.pointerId},true);}}
      rows.addEventListener('pointermove',pointerMove);rows.addEventListener('pointerup',finish);rows.addEventListener('pointercancel',cancel);rows.addEventListener('lostpointercapture',cancel);document.addEventListener('keydown',escape);
      drag.cleanup=()=>{clearTimeout(drag?.timer);cancelAnimationFrame(dragFrame);rows.removeEventListener('pointermove',pointerMove);rows.removeEventListener('pointerup',finish);rows.removeEventListener('pointercancel',cancel);rows.removeEventListener('lostpointercapture',cancel);document.removeEventListener('keydown',escape);row.classList.remove('aisel-taxonomy-dragging');grip.removeAttribute('aria-pressed');if(rows.hasPointerCapture?.(event.pointerId))rows.releasePointerCapture(event.pointerId);};
    }
    function cleanupDrag(){drag?.cleanup?.();drag=null;}
    function run(fn){
      if(operationFlight)return operationFlight;if(!alive()||!sameSession())return Promise.resolve(false);
      busy=true;report(null);render();
      const task=(async()=>{try{const result=await fn();return result!==false;}catch(error){report(error);return false;}finally{if(alive()){busy=false;render();}}})();
      operationFlight=task;task.finally(()=>{if(operationFlight===task)operationFlight=null;});return task;
    }
    function add(restore=false){
      if(operationFlight)return operationFlight;if(composing)return Promise.resolve(false);if(!input.value.trim())return Promise.resolve(true);
      if(!(options.permissions?.()||{canAdd:true}).canAdd)return Promise.resolve(false);
      const name=input.value,atRevision=editRevision;
      return run(async()=>{
        try{
          const item=await options.add(name,{restore});
          if(!alive()||!sameSession()||composing||atRevision!==editRevision||input.value!==name)return false;
          restoreName='';restoreButton.hidden=true;input.value='';status.textContent=item.name+' 추가 완료';options.onSelect?.(item);if(options.closeOnSelect)close();return true;
        }catch(error){if(alive()&&['category_deleted','designer_deleted','reference_category_deleted'].includes(error.code)){restoreName=name;restoreButton.hidden=false;}throw error;}
      });
    }
    function close(){if(closed)return;closed=true;cleanupDrag();stop();panel.remove();options.onClose?.();}
    closeButton.onclick=close;form.onsubmit=event=>{event.preventDefault();void add();};restoreButton.onclick=()=>{if(input.value===restoreName)void add(true);};
    undoButton.onclick=()=>{const entry=lastDeleted;if(entry)void run(async()=>{await restoreItem(entry.name);if(alive()&&sameSession()){lastDeleted=null;status.textContent=entry.name+' 복원 완료';}return true;});};
    input.oninput=()=>{editRevision++;restoreName='';restoreButton.hidden=true;};input.addEventListener('compositionstart',()=>{composing=true;editRevision++;});input.addEventListener('compositionend',()=>{composing=false;});
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}if((event.isComposing||composing||event.keyCode===229)&&event.key==='Enter')event.preventDefault();});
    stop=options.subscribe?.(render)||stop;render();Promise.resolve(options.load?.()).then(()=>{if(alive()){render();if(options.addOnly)input.focus({preventScroll:true});}},report);
    async function flush(){if(composing)return false;if(operationFlight&&!await operationFlight)return false;if(!alive())return !input.value.trim();return add();}
    return {close,panel,input,flush,hasDraft:()=>!closed&&(!!operationFlight||composing||!!input.value.trim()),isComposing:()=>!closed&&composing};
  }

  const store=createStore();
  function mountPicker(select,options={}){
    const document=select.ownerDocument;let config={...options},selected=String(options.value??select.value??''),destroyed=false,manager=null,signature='',priorOnchange=select.onchange;
    function close(){manager?.close();manager=null;}
    function render(){
      if(destroyed)return;
      const active=store.list(),filter=config.mode==='filter';
      const names=filter?active:[...new Set([...active,...(config.includeNames||[])].filter(name=>name&&!store.isRemoved(name)))];
      const values=[['',config.placeholder||'미지정'],...(config.emptyOptions||[]),...names.map(name=>[name,name])];
      const historical=filter?[...new Set(config.includeNames||[])].filter(name=>name&&!active.includes(name)).sort((a,b)=>a.localeCompare(b,'ko')):[];
      if(selected&&!values.some(([value])=>value===selected)&&!historical.includes(selected)){
        if(filter)historical.push(selected);else values.push([selected,selected+(store.isRemoved(selected)?' (삭제됨)':'')]);
      }
      const next=JSON.stringify([values,historical]);
      if(signature!==next&&(!signature||document.activeElement!==select)){
        const fragment=document.createDocumentFragment(),option=(value,label)=>{const e=document.createElement('option');e.value=value;e.textContent=label;e.style.fontWeight='400';return e;};
        for(const [value,label]of values)fragment.append(option(value,label));
        for(const name of historical)fragment.append(option(name,name));
        fragment.append(option(ADD,'＋ 추가'));select.replaceChildren(fragment);signature=next;
      }
      select.value=selected;select.disabled=!!config.disabled;if(config.disabled)close();
    }
    function manage(addOnly){close();const state=store.state();manager=openManager(config.managerHost||select.parentElement,{label:'담당자',title:'담당자',iconActions:true,undo:true,maxLength:160,addOnly,closeOnSelect:addOnly,list:()=>store.list().map(name=>({name})),reorder:items=>root.AiselCatalogOrder.save('designers',items.map(item=>item.name)),load:()=>store.load({force:true}),subscribe:store.subscribe,session:()=>{const s=store.state();return [s.uid,s.generation];},permissions:()=>({canAdd:store.state().canManage,canRemove:store.state().canManage}),add:store.add,remove:item=>store.remove(item.name),onError:config.onError,onSelect:item=>{if(destroyed||config.disabled||state.uid!==store.state().uid||state.generation!==store.state().generation)return;selected=item.name;render();config.onChange?.(selected);},onClose:()=>{manager=null;}});}
    select.onchange=()=>{if(destroyed||config.disabled)return;const value=select.value;if(value===ADD){select.value=selected;manage(true);return;}close();if(config.mode!=='filter'&&value!==selected&&store.isRemoved(value)){select.value=selected;config.onError?.(failure('designer_deleted','삭제된 담당자입니다. 다른 담당자를 선택해주세요.'));return;}selected=value;config.onChange?.(value);};
    const onFocus=()=>{store.load().catch(error=>{if(!destroyed)config.onError?.(error);});},onBlur=()=>setTimeout(render,0);select.addEventListener('focus',onFocus);select.addEventListener('blur',onBlur);const stop=store.subscribe(state=>{if(manager&&(!state.uid||state.generation!==root.AiselAuth?.generation&&root.AiselAuth))close();render();});render();
    return {refresh(next={}){config={...config,...next};if(Object.hasOwn(next,'value')){const value=String(next.value||'');if(value!==selected)close();selected=value;}render();},setValue(value){if(String(value||'')!==selected)close();selected=String(value||'');render();},setDisabled(disabled){config.disabled=!!disabled;render();},close,destroy(){if(destroyed)return;destroyed=true;close();stop();select.removeEventListener('focus',onFocus);select.removeEventListener('blur',onBlur);select.onchange=priorOnchange;}};
  }
  const api={...store,VERSION,cleanName,createStore,mountPicker};
  if(typeof module==='object'&&module.exports)module.exports={...api,openManager};else{root.AiselDesigners=api;root.AiselTaxonomyManager={open:openManager};root.addEventListener('aisel-session-change',()=>store.refreshSession());}
})(typeof window==='object'?window:globalThis);
