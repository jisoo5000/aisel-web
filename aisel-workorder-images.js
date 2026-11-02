/* v289: workorder thumbnails only; one automatic recovery per image/version/KST day. */
(function(root){
 'use strict';
 const attached=new WeakMap(),memory=new Map(),STORAGE='aisel.photo-retry.v289',MAX_MARKERS=128;
 const valid=src=>typeof src==='string'&&/^(data:image\/[^,]+,|https:\/\/|blob:)/i.test(src);
 const day=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(36);}
 function claim(key){
  const today=day();let state;
  try{state=JSON.parse(localStorage.getItem(STORAGE)||'null');}catch{}
  if(!state||state.day!==today||!Array.isArray(state.keys))state={day:today,keys:[]};
  if(memory.get(key)===today||state.keys.includes(key)||state.keys.length>=MAX_MARKERS)return false;
  memory.set(key,today);for(const [k,d]of memory)if(d!==today)memory.delete(k);
  state.keys.push(key);try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch{}
  return true;
 }
 function unavailable(img){
  img.hidden=true;let note=img.parentElement?.querySelector('[data-photo-unavailable]');
  if(!note&&img.parentElement){note=document.createElement('span');note.dataset.photoUnavailable='true';note.textContent='사진 확인 필요';note.style.cssText='font-family:inherit;font-size:12px;line-height:18px;color:#6C727C';img.parentElement.append(note);}
 }
 function show(img){img.hidden=false;img.parentElement?.querySelector('[data-photo-unavailable]')?.remove();}
 const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);attached.get(entry.target)?.start();}
 },{rootMargin:'200px 0px'}):null;
 function attach(img,{code,source,version='',priority=false,readThumbnail}={}){
  const uid=root.AiselAuth?.currentUser?.()?.uid||'',generation=root.AiselAuth?.generation;
  const token={started:false,retried:false,source:String(source||'')};
  const current=()=>attached.get(img)===token&&img.isConnected&&(root.AiselAuth?.currentUser?.()?.uid||'')===uid&&root.AiselAuth?.generation===generation;
  attached.set(img,token);img.dataset.mediaVersion=String(version);img.decoding='async';img.loading=priority?'eager':'lazy';img.fetchPriority=priority?'high':'low';
  const loaded=()=>{if(current())show(img);};
  const failed=async()=>{
   if(!current())return;
   const status=Number(img.dataset.mediaStatus||0);
   if(token.retried||status===401||status===403){unavailable(img);return;}
   token.retried=true;
   if(!claim(hash(uid+'|'+code+'|'+token.source))){unavailable(img);return;}
   try{
    const replacement=typeof readThumbnail==='function'?await readThumbnail(code):'';
    if(!current())return;
    const next=valid(replacement)?replacement:token.source;
    if(!valid(next)||next.startsWith('blob:')){unavailable(img);return;}
    show(img);delete img.dataset.mediaUnavailable;delete img.dataset.mediaStatus;
    // The normal source route still enforces account permissions. No public fallback or DB writes.
    root.AiselMedia?.invalidate?.(next);img.src=next;
   }catch{if(current())unavailable(img);}
  };
  img.addEventListener('load',loaded);img.addEventListener('error',failed);
  token.start=()=>{if(token.started||!current())return;token.started=true;if(valid(token.source))img.src=token.source;else unavailable(img);};
  if(priority||!observer)token.start();else observer.observe(img);
  return()=>{observer?.unobserve(img);img.removeEventListener('load',loaded);img.removeEventListener('error',failed);attached.delete(img);};
 }
 root.AiselWorkorderImages=Object.freeze({attach,policy:Object.freeze({automaticRecoveryPerImagePerKstDay:1,maxRecoveryMarkers:MAX_MARKERS,persistentImageStorage:false,sourceReads:'failed-visible-thumbnail-field-only',newSchedules:0})});
})(window);
