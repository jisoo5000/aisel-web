/* v289: visible-first protected media; bounded, account-scoped same-day reuse. */
(function(root){
 'use strict';
 const BUCKET='aisel-workorder.firebasestorage.app',ENDPOINT='https://asia-southeast1-aisel-workorder.cloudfunctions.net/mediaV246';
 const CONFIG='https://aisel-workorder-default-rtdb.asia-southeast1.firebasedatabase.app/aiselAccess/v1/config/mediaProtected.json';
 const originalFetch=root.fetch.bind(root),srcProperty=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src'),setAttribute=Element.prototype.setAttribute;
 const sources=new WeakMap(),revisions=new WeakMap(),pending=new WeakMap(),cache=new Map(),controllers=new Set(),retired=new Set(),queue=[];
 const MAX_ENTRIES=32,MAX_BYTES=8*1024*1024,CONCURRENCY=3;
 const blank='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
 let enabled=null,configFlight=null,epoch=0,boundUser=null,active=0,accessScope;
 const day=()=>new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
 function pathOf(value){try{const u=new URL(String(value),location.href),prefix='/v0/b/'+BUCKET+'/o/';return u.protocol==='https:'&&u.hostname==='firebasestorage.googleapis.com'&&u.pathname.startsWith(prefix)?decodeURIComponent(u.pathname.slice(prefix.length)):null;}catch{return null;}}
 async function ready(){
  if(enabled!==null)return enabled;
  if(!configFlight)configFlight=originalFetch(CONFIG,{cache:'no-store',credentials:'omit'}).then(r=>{if(!r.ok)throw Error('사진 접근 설정을 확인하지 못했습니다.');return r.json();}).then(v=>{if(v!==null&&v!==false&&v!==true)throw Error('잘못된 사진 접근 설정');enabled=v===true;return enabled;}).finally(()=>{configFlight=null;});
  return configFlight;
 }
 function auth(){try{return root.AiselAuth||(root.parent!==root?root.parent.AiselAuth:null);}catch{return null;}}
 async function user(){
  if(!auth())await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{root.removeEventListener('aisel-session-ready',done);reject(Error('로그인이 필요합니다.'));},15000);function done(){clearTimeout(timer);resolve();}root.addEventListener('aisel-session-ready',done,{once:true});});
  await auth().initialized;
  const u=auth().currentUser();if(!u||u.isAnonymous)throw Object.assign(Error('로그인이 필요합니다.'),{status:401});return u;
 }
 async function request(path,upload){
  const u=await user(),generation=epoch,controller=new AbortController();controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),60000);
  try{
   const headers={Authorization:'Bearer '+await u.getIdToken()},body=upload?upload.blob:JSON.stringify({path});
   if(upload){headers['Content-Type']=upload.blob.type||'image/jpeg';headers['X-Aisel-Path']=encodeURIComponent(path);if(upload.code)headers['X-Aisel-Code']=upload.code;}else headers['Content-Type']='application/json';
   const response=await originalFetch(ENDPOINT,{method:'POST',headers,body,cache:'no-store',credentials:'omit',signal:controller.signal});
   if(generation!==epoch||auth().currentUser()?.uid!==u.uid)throw Error('로그인 계정이 변경되었습니다.');
   if(!response.ok)throw Object.assign(Error(response.status===403?'이 사진을 볼 권한이 없습니다.':'사진을 불러오지 못했습니다.'),{status:response.status});
   return response;
  }finally{clearTimeout(timer);controllers.delete(controller);}
 }
 function used(url){return [...document.querySelectorAll('img')].some(img=>srcProperty.get.call(img)===url);}
 function release(item){if(!item?.url)return;if(used(item.url))retired.add(item.url);else URL.revokeObjectURL(item.url);}
 function sweep(){for(const url of retired)if(!used(url)){URL.revokeObjectURL(url);retired.delete(url);}}
 function trim(){
  let bytes=[...cache.values()].reduce((n,x)=>n+(x.bytes||0),0);
  for(const [key,item] of cache){
   if(cache.size<=MAX_ENTRIES&&bytes<=MAX_BYTES)break;
   if(!item.done)continue;
   cache.delete(key);bytes-=item.bytes||0;release(item);
  }
  sweep();
 }
 function drain(){
  while(active<CONCURRENCY&&queue.length){
   const task=queue.shift();
   if(task.epoch!==epoch){task.reject(Error('계정 변경'));continue;}
   active++;
   Promise.resolve().then(task.run).then(task.resolve,task.reject).finally(()=>{active--;drain();});
  }
 }
 function limited(run){return new Promise((resolve,reject)=>{queue.push({run,resolve,reject,epoch});drain();});}
 function invalidatePath(path){
  for(const [key,item] of cache)if(item.path===path){cache.delete(key);release(item);}
 }
 async function imageURL(value,version=''){
  if(!await ready())return value;
  const path=pathOf(value);if(!path)return value;
  const u=await user(),key=u.uid+':'+String(value)+':'+version,generation=epoch,prior=cache.get(key);
  if(prior&&prior.day===day()){cache.delete(key);cache.set(key,prior);return prior.promise;}
  if(prior){cache.delete(key);release(prior);}
  const item={day:day(),path,done:false,bytes:0};
  item.promise=limited(async()=>{
   if(generation!==epoch||auth().currentUser()?.uid!==u.uid)throw Error('계정 변경');
   const response=await request(path),blob=await response.blob();
   if(generation!==epoch||auth().currentUser()?.uid!==u.uid)throw Error('계정 변경');
   if(blob.type&&!blob.type.startsWith('image/'))throw Error('사진 형식 확인 필요');
   item.bytes=blob.size;item.url=URL.createObjectURL(blob);item.done=true;
   return item.url;
  }).catch(e=>{if(cache.get(key)===item)cache.delete(key);throw e;});
  cache.set(key,item);
  // Trim after assignment reactions, so a URL being displayed is never revoked mid-load.
  item.promise.then(()=>setTimeout(trim,0),()=>{});return item.promise;
 }
 function start(img,value,revision){
  pending.delete(img);
  imageURL(String(value),img.dataset.mediaVersion||'').then(url=>{
   if(revisions.get(img)!==revision)return;
   delete img.dataset.mediaUnavailable;delete img.dataset.mediaStatus;
   srcProperty.set.call(img,url);
  }).catch(error=>{
   if(revisions.get(img)!==revision)return;
   img.removeAttribute('src');img.dataset.mediaUnavailable='true';img.dataset.mediaStatus=String(error.status||0);img.dispatchEvent(new Event('error'));
  });
 }
 const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){const task=pending.get(entry.target);observer.unobserve(entry.target);if(task&&revisions.get(entry.target)===task.revision)start(entry.target,task.value,task.revision);}
 },{rootMargin:'200px 0px'}):null;
 function assign(img,value){
  const path=pathOf(value),revision=(revisions.get(img)||0)+1;revisions.set(img,revision);
  observer?.unobserve(img);pending.delete(img);
  if(!path){sources.delete(img);srcProperty.set.call(img,value);return;}
  sources.set(img,String(value));img.removeAttribute('src');
  if(observer&&img.loading==='lazy'){
   pending.set(img,{value:String(value),revision});observer.observe(img);
  }else start(img,String(value),revision);
 }
 Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,enumerable:srcProperty.enumerable,get(){return sources.get(this)||srcProperty.get.call(this);},set(value){assign(this,value);}});
 Element.prototype.setAttribute=function(name,value){if(this instanceof HTMLImageElement&&String(name).toLowerCase()==='src'){assign(this,value);return;}return setAttribute.call(this,name,value);};
 function scanOne(img){const src=img.getAttribute('src');if(pathOf(src)&&sources.get(img)!==src)assign(img,src);}
 function scan(node){if(node.nodeType!==1)return;if(node instanceof HTMLImageElement)scanOne(node);node.querySelectorAll?.('img').forEach(scanOne);}
 function detached(node){if(node.nodeType!==1)return;const cancel=img=>{if(!img.isConnected){observer?.unobserve(img);pending.delete(img);revisions.set(img,(revisions.get(img)||0)+1);}};if(node instanceof HTMLImageElement)cancel(node);node.querySelectorAll?.('img').forEach(cancel);}
 new MutationObserver(changes=>{for(const change of changes){if(change.type==='attributes')scanOne(change.target);else{change.removedNodes.forEach(detached);change.addedNodes.forEach(scan);}}sweep();}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
 root.fetch=async function(input,options){
  const url=typeof input==='string'||input instanceof URL?String(input):input?.url,path=pathOf(url),method=String(options?.method||input?.method||'GET').toUpperCase();
  if(!path||!['GET','HEAD'].includes(method)||!await ready())return originalFetch(input,options);
  return request(path);
 };
 async function upload(ref,blob,code){
  let url;
  if(!await ready()){await ref.put(blob,{contentType:blob.type||'image/jpeg',cacheControl:'private,no-store'});url=await ref.getDownloadURL();}
  else url=(await (await request(ref.fullPath,{blob,code})).json()).url;
  invalidatePath(ref.fullPath);return url;
 }
 function clear(){
  epoch++;observer?.disconnect();
  for(const task of queue.splice(0))task.reject(Error('계정 변경'));
  for(const c of controllers)c.abort();controllers.clear();
  for(const item of cache.values())if(item.url)URL.revokeObjectURL(item.url);cache.clear();
  for(const url of retired)URL.revokeObjectURL(url);retired.clear();
  document.querySelectorAll('img').forEach(img=>{if(sources.has(img)){pending.delete(img);revisions.set(img,(revisions.get(img)||0)+1);srcProperty.set.call(img,blank);}});
 }
 function reloadVisible(){if(auth()?.currentUser())document.querySelectorAll('img').forEach(img=>{const src=sources.get(img);if(src)assign(img,src);});}
 function bindAccess(){
  if(!root.AiselAccess?.subscribe||bindAccess.done)return;bindAccess.done=true;
  root.AiselAccess.subscribe(session=>{
   const next=JSON.stringify(session?[session.uid,session.active,session.role,session.permissions]:null);
   if(accessScope===undefined){accessScope=next;return;}
   if(next===accessScope)return;accessScope=next;clear();if(session?.active)reloadVisible();
  });
 }
 function bind(){bindAccess();if(!auth()||bind.done)return;bind.done=true;boundUser=auth().currentUser()?.uid||null;auth().subscribe(()=>{const uid=auth().currentUser()?.uid||null;if(uid===boundUser)return;boundUser=uid;clear();if(uid)reloadVisible();});}
 root.addEventListener('aisel-session-ready',bind);document.addEventListener('DOMContentLoaded',bind,{once:true});bind();
 root.AiselMedia={ready,upload,pathOf,clear,imageURL,invalidate(value){const path=pathOf(value);if(path)invalidatePath(path);},policy:Object.freeze({timezone:'Asia/Seoul',automaticRevalidation:'once-per-calendar-day-on-demand',maxEntries:MAX_ENTRIES,maxBytes:MAX_BYTES,concurrency:CONCURRENCY,persistentImageStorage:false}),stats:()=>({entries:cache.size,bytes:[...cache.values()].reduce((n,x)=>n+(x.bytes||0),0),active,queued:queue.length})};
 ready().catch(()=>{});
})(window);
