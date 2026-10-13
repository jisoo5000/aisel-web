(function(root){
 'use strict';
 // Keep legacy drafts readable. Media and their referring draft commit together
 // in the existing store, so no database upgrade can block an open editor.
 const prefix='~aisel-media:',cache=new Map();
 const omitted=value=>['undefined','function','symbol'].includes(typeof value);
 function clone(value){
   if(typeof value==='number'&&!Number.isFinite(value))return null;
   if(omitted(value))return undefined;
   if(value===null||typeof value!=='object')return value;
   if(typeof value.toJSON==='function')return clone(value.toJSON());
   if(Array.isArray(value))return Array.from(value,v=>clone(v)??null);
   const out={};for(const key of Object.keys(value)){if(omitted(value[key]))continue;Object.defineProperty(out,key,{value:clone(value[key]),enumerable:true,writable:true,configurable:true});}return out;
 }
 function equal(a,b){
   if(a===b)return true;
   if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
   if(Array.isArray(a))return a.length===b.length&&Array.from(a).every((v,i)=>equal(v??null,b[i]??null));
   const ak=Object.keys(a).filter(k=>!omitted(a[k])),bk=Object.keys(b).filter(k=>!omitted(b[k]));return ak.length===bk.length&&ak.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&equal(a[k],b[k]));
 }
 function media(value){
   let id=cache.get(value);if(id){cache.delete(value);cache.set(value,id);return id;}
   id=prefix+crypto.randomUUID();cache.set(value,id);if(cache.size>32)cache.delete(cache.keys().next().value);return id;
 }
 function pack(record){
   if(record?.schema!==1||!record.values)return {record,media:[]};
   const refs=[],assets=new Map();
   function visit(value,path){
     if(typeof value==='string'&&value.startsWith('data:image/')){const id=media(value);refs.push({path,id});assets.set(id,value);return '';}
     if(!value||typeof value!=='object')return value;
     if(Array.isArray(value))return value.map((v,i)=>visit(v,[...path,i]));
     const out={};for(const k of Object.keys(value))Object.defineProperty(out,k,{value:visit(value[k],[...path,k]),enumerable:true,writable:true,configurable:true});return out;
   }
   const out={...record,values:visit(record.values,['values']),base:visit(record.base,['base'])};
   if(refs.length){out.schema=2;out._aiselMedia=refs;}
   return {record:out,media:[...assets].map(([id,value])=>({id,kind:'aisel-draft-media',value}))};
 }
 function hydrate(db,result){
   const records=Array.isArray(result)?result:[result];
   const packed=records.filter(r=>r?.schema===2&&Array.isArray(r._aiselMedia));if(!packed.length)return Promise.resolve(result);
   return new Promise((resolve,reject)=>{
     const tx=db.transaction('drafts','readonly'),store=tx.objectStore('drafts'),assets=new Map();
     const ids=[...new Set(packed.flatMap(r=>r._aiselMedia.map(ref=>ref.id)))];
     for(const id of ids){const req=store.get(id);req.onsuccess=()=>assets.set(id,req.result?.value);}
     tx.onerror=tx.onabort=()=>reject(tx.error||Error('사진 초안을 읽지 못했습니다.'));
     tx.oncomplete=()=>{try{
       const out=records.map(r=>{
         if(r?.schema!==2||!Array.isArray(r._aiselMedia))return r;
         const value=clone(r);
         for(const ref of r._aiselMedia){
           const photo=assets.get(ref.id);
           if(typeof photo!=='string'||!photo.startsWith('data:image/')||!Array.isArray(ref.path)||!['values','base'].includes(ref.path[0])||ref.path.some(k=>['__proto__','prototype','constructor'].includes(k)))throw Error('사진 초안이 완전하지 않습니다. 현재 창을 유지하고 초안을 확인해주세요.');
           let target=value;for(const key of ref.path.slice(0,-1)){if(!target||typeof target!=='object')throw Error('사진 초안 경로를 확인하지 못했습니다.');target=target[key];}
           target[ref.path.at(-1)]=photo;cache.set(photo,ref.id);if(cache.size>32)cache.delete(cache.keys().next().value);
         }
         value.schema=1;delete value._aiselMedia;return value;
       });resolve(Array.isArray(result)?out:out[0]);
     }catch(e){reject(e);}};
   });
 }
 function transaction(db,mode,operation){return new Promise((resolve,reject)=>{
   let result;const tx=db.transaction('drafts',mode),store=tx.objectStore('drafts'),checked=new Set();
   const timer=setTimeout(()=>{try{tx.abort();}catch(_){}reject(Error('기기 저장을 확인하지 못했습니다.'));},4000);
   tx.onerror=tx.onabort=()=>{clearTimeout(timer);reject(tx.error||Error('기기 저장 실패'));};
   tx.oncomplete=()=>{clearTimeout(timer);hydrate(db,result).then(resolve,reject);};
   const facade={index:name=>store.index(name),getAll:()=>store.getAll(),delete:id=>store.delete(id),put:record=>{
     const packed=pack(record);
     for(const asset of packed.media){if(checked.has(asset.id))continue;checked.add(asset.id);
       // count() checks existence without reading/copying the stored image. It also
       // handles another tab cleaning an acknowledged photo from its own cache.
       const req=store.count(asset.id);req.onsuccess=()=>{if(!req.result)store.put(asset);};
     }
     return store.put(packed.record);
   }};
   try{const req=operation(facade);if(req)req.onsuccess=()=>result=req.result;}catch(e){try{tx.abort();}catch(_){}reject(e);}
 });}
 // Acknowledged drafts release unused photos. The group index skips media bodies;
 // the transaction prevents deletion racing another tab's new draft reference.
 function cleanup(db){return new Promise((resolve,reject)=>{
   const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),used=new Set();let unknown=false;
   const scan=store.index('group').openCursor();scan.onsuccess=()=>{const c=scan.result;if(c){const r=c.value;if(r.schema===2)for(const ref of r._aiselMedia||[])used.add(ref.id);else if(r.schema!==1)unknown=true;c.continue();return;}
     if(unknown)return;const keys=store.getAllKeys(IDBKeyRange.bound(prefix,prefix+'\uffff'));keys.onsuccess=()=>{for(const id of keys.result)if(!used.has(id))store.delete(id);};
   };
   tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);
 });}
 root.AiselDraftStorage={clone,equal,transaction,hydrate,cleanup};
})(globalThis);
