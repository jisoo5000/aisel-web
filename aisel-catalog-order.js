/* Shared catalog display order only; never rewrites records or photos. */
(function(root){
  'use strict';
  const fail=(code,message)=>Object.assign(Error(message),{code});
  function createStore(options={}){
    const states=new Map(),listeners=new Set();let session='',epoch=0;
    const sessionKey=()=>JSON.stringify(options.session?.()??[root.AiselAuth?.currentUser?.()?.uid||'',root.AiselAuth?.generation||0]);
    const request=(...args)=>options.request?options.request(...args):root.AiselCollectionWrites.catalogOrderRequest(...args);
    function sync(){const next=sessionKey();if(next!==session){session=next;epoch++;states.clear();emit();}}
    function emit(){for(const fn of listeners)try{fn();}catch(_){} }
    function state(kind){sync();if(!['designers','noteCategories','lookCategories'].includes(kind))throw fail('invalid','순서 목록을 확인해주세요.');if(!states.has(kind))states.set(kind,{revision:0,ids:[],ready:false,flight:null,saving:false,loaded:0});return states.get(kind);}
    function checked(raw){if(raw==null)return {revision:0,ids:[]};if(!Number.isSafeInteger(raw.revision)||raw.revision<1||!Array.isArray(raw.ids)||raw.ids.length>500||raw.ids.some(id=>typeof id!=='string'||!id||id.length>160)||new Set(raw.ids).size!==raw.ids.length)throw fail('order_response','저장된 순서를 확인하지 못했습니다.');return {revision:raw.revision,ids:[...raw.ids]};}
    function guard(e){sync();if(e!==epoch)throw fail('auth_changed','로그인 계정이 변경되었습니다.');}
    async function load(kind,{force=false}={}){const s=state(kind);if(s.flight)return s.flight;if(s.ready&&!force&&Date.now()-s.loaded<30000)return s;const e=epoch,revision=s.revision;const task=(async()=>{const raw=await request(kind);guard(e);if(revision===s.revision&&!s.saving){Object.assign(s,checked(raw),{ready:true,loaded:Date.now()});emit();}return s;})();s.flight=task;try{return await task;}finally{if(s.flight===task)s.flight=null;}}
    function sort(kind,items,key='id'){const s=state(kind),ranks=new Map(s.ids.map((id,i)=>[id,i]));return [...items].sort((a,b)=>(ranks.get(a[key])??Infinity)-(ranks.get(b[key])??Infinity)||(Date.parse(a.createdAt)||0)-(Date.parse(b.createdAt)||0)||a.name.localeCompare(b.name,'ko'));}
    async function save(kind,ids){const s=state(kind);if(!s.ready)throw fail('order_pending','목록을 다시 열고 순서를 변경해주세요.');if(s.saving)throw fail('order_busy','순서를 저장하고 있습니다.');if(!Array.isArray(ids)||!ids.length||ids.length>500||new Set(ids).size!==ids.length)throw fail('invalid','항목 순서를 확인해주세요.');if(JSON.stringify(s.ids)===JSON.stringify(ids))return s;const e=epoch,revision=s.revision;s.saving=true;
      try{const raw=await request(kind,{ids:[...ids],expectedRevision:revision});guard(e);const result=checked(raw);if(result.revision!==revision+1||JSON.stringify(result.ids)!==JSON.stringify(ids))throw fail('order_response','순서 저장 결과를 확인하지 못했습니다.');Object.assign(s,result,{loaded:Date.now()});emit();return s;}
      catch(error){guard(e);s.saving=false;try{await load(kind,{force:true});}catch(_){}throw error;}
      finally{s.saving=false;}
    }
    function subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}
    return {load,sort,save,subscribe,reset:sync,state:kind=>{const s=state(kind);return {ready:s.ready,revision:s.revision,ids:[...s.ids]};}};
  }
  const api=createStore();if(typeof module==='object'&&module.exports)module.exports={createStore};else{root.AiselCatalogOrder=api;root.addEventListener('aisel-session-change',api.reset);}
})(typeof window==='object'?window:globalThis);
