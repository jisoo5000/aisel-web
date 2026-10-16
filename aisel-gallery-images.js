/* v218: warm the first visible-sized photo set after verified gallery access.
 * Keep bytes in the browser image cache, never duplicate pictures in the DB. */
(function () {
  'use strict';
  const gallery=window.AiselGalleryIndex;
  if(!gallery?.enabled)return;
  const images=new Map(),states=new Map(),queue=[];
  const LIMIT=18,CONCURRENCY=2,PER_KIND=3;
  let owner='',generation=null,epoch=0,running=0;
  function current(){const u=window.AiselAuth?.currentUser?.();return u?.emailVerified?u:null;}
  function validUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='firebasestorage.googleapis.com'&&u.pathname.startsWith('/v0/b/aisel-workorder.firebasestorage.app/o/moodboardRefPhotos%2F')?u.href:'';}catch(_){return '';}}
  function clear(){epoch++;for(const item of images.values())item.cancel();images.clear();queue.length=0;running=0;}
  function session(){const u=current(),g=window.AiselAuth?.generation;if(!u||u.uid!==owner||g!==generation){clear();owner=u?.uid||'';generation=g;}return !!u&&window.navigator?.onLine!==false;}
  function allowed(kind){if(!session())return false;const kinds=kind?[kind]:[...states.keys()];return kinds.some(k=>{const s=gallery.snapshot(k);return s.uid===owner&&s.available&&s.authorized===true&&gallery.canPreview(k);});}
  function trim(max=LIMIT){for(const [key,item]of images){if(images.size<=max)break;if(item.done){images.delete(key);item.cancel();}}}
  function drain(){
    if(!allowed())return;
    while(running<CONCURRENCY&&queue.length){const item=queue.shift();if(item.done||item.epoch!==epoch)continue;if(!allowed(item.kind)){item.cancel();images.delete(item.key);continue;}running++;item.started=true;
      const finish=ok=>{if(item.done)return;item.done=true;clearTimeout(item.timer);item.image.onload=item.image.onerror=null;if(item.epoch===epoch)running--;const accepted=ok&&item.epoch===epoch&&allowed(item.kind);item.resolve(accepted);if(!accepted)images.delete(item.key);trim();drain();};
      item.finish=finish;item.image.onload=()=>{if(typeof item.image.decode==='function')Promise.resolve(item.image.decode()).then(()=>finish(true),()=>finish(item.image.naturalWidth>0));else finish(true);};
      item.image.onerror=()=>finish(false);item.timer=setTimeout(()=>{item.image.src='';finish(false);},12000);
      item.image.decoding='async';item.image.fetchPriority='low';item.image.src=item.url;
    }
  }
  function preload(value,kind){
    if(!['references','meetings'].includes(kind)||!allowed(kind))return Promise.resolve(false);
    const url=validUrl(value);if(!url)return Promise.resolve(false);
    const key=kind+'|'+url,found=images.get(key);if(found)return found.promise;
    trim(LIMIT-1);if(images.size>=LIMIT)return Promise.resolve(false);
    const item={key,kind,url,epoch,done:false,started:false,image:new Image()};
    item.promise=new Promise(resolve=>{item.resolve=resolve;});
    item.cancel=()=>{clearTimeout(item.timer);item.image.onload=item.image.onerror=null;if(!item.done){item.done=true;item.resolve(false);}item.image.src='';};
    images.set(key,item);queue.push(item);drain();return item.promise;
  }
  function warm(){
    if(!allowed()||document.hidden||window.navigator?.connection?.saveData)return;
    // Only warm the first screen. Scroll-driven images retain normal lazy loading.
    for(const kind of states.keys()){const state=gallery.snapshot(kind);if(state.uid===owner&&state.available&&state.authorized===true){
      const rows=[...state.records].filter(r=>!r.archivedAt).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||Number(b.createdAt||0)-Number(a.createdAt||0));
      for(const row of rows.slice(0,PER_KIND))if(gallery.preview(kind,row.id)?.isCurrent())preload(row.thumbnail,kind);
    }}drain();
  }
  for(const kind of ['references','meetings'])gallery.subscribe(kind,state=>{
    session();states.set(kind,state);
    if(state.authorized===false||state.mode==='denied'){clear();states.delete(kind);}
    warm();
  });
  window.addEventListener('aisel-session-change',()=>{clear();states.clear();owner='';generation=null;});
  window.addEventListener('offline',()=>clear());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)warm();});
  window.AiselGalleryImages=Object.freeze({preload});
})();
