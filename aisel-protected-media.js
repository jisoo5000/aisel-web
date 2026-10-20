(function(root){
 'use strict';
 const BUCKET='aisel-workorder.firebasestorage.app',ENDPOINT='https://asia-southeast1-aisel-workorder.cloudfunctions.net/mediaV246';
 const CONFIG='https://aisel-workorder-default-rtdb.asia-southeast1.firebasedatabase.app/aiselAccess/v1/config/mediaProtected.json';
 const originalFetch=root.fetch.bind(root),srcProperty=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src'),setAttribute=Element.prototype.setAttribute;
 const sources=new WeakMap(),revisions=new WeakMap(),cache=new Map(),controllers=new Set();
 const blank='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
 let enabled=null,configFlight=null,epoch=0,boundUser=null;
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
  const u=auth().currentUser();if(!u||u.isAnonymous)throw Error('로그인이 필요합니다.');return u;
 }
 async function request(path,upload){
  const u=await user(),generation=epoch,controller=new AbortController();controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),60000);
  try{
   const headers={Authorization:'Bearer '+await u.getIdToken()},body=upload?upload.blob:JSON.stringify({path});
   if(upload){headers['Content-Type']=upload.blob.type||'image/jpeg';headers['X-Aisel-Path']=encodeURIComponent(path);if(upload.code)headers['X-Aisel-Code']=upload.code;}else headers['Content-Type']='application/json';
   const response=await originalFetch(ENDPOINT,{method:'POST',headers,body,cache:'no-store',credentials:'omit',signal:controller.signal});
   if(generation!==epoch||auth().currentUser()?.uid!==u.uid)throw Error('로그인 계정이 변경되었습니다.');
   if(!response.ok)throw Error(response.status===403?'이 사진을 볼 권한이 없습니다.':'사진을 불러오지 못했습니다.');
   return response;
  }finally{clearTimeout(timer);controllers.delete(controller);}
 }
 async function imageURL(value){
  if(!await ready())return value;
  const path=pathOf(value),u=await user(),key=u.uid+':'+path,generation=epoch,prior=cache.get(key);
  if(prior&&Date.now()-prior.at<60000)return prior.promise;
  if(prior?.url)URL.revokeObjectURL(prior.url);
  const item={at:Date.now()};item.promise=request(path).then(r=>r.blob()).then(blob=>{if(generation!==epoch)throw Error('계정 변경');return item.url=URL.createObjectURL(blob);}).catch(e=>{cache.delete(key);throw e;});cache.set(key,item);return item.promise;
 }
 function assign(img,value){
  const path=pathOf(value),revision=(revisions.get(img)||0)+1;revisions.set(img,revision);
  if(!path){sources.delete(img);srcProperty.set.call(img,value);return;}
  sources.set(img,String(value));img.removeAttribute('src');
  imageURL(String(value)).then(url=>{if(revisions.get(img)===revision)srcProperty.set.call(img,url);}).catch(()=>{if(revisions.get(img)===revision){img.removeAttribute('src');img.dataset.mediaUnavailable='true';img.dispatchEvent(new Event('error'));}});
 }
 Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,enumerable:srcProperty.enumerable,get(){return sources.get(this)||srcProperty.get.call(this);},set(value){assign(this,value);}});
 Element.prototype.setAttribute=function(name,value){if(this instanceof HTMLImageElement&&String(name).toLowerCase()==='src'){assign(this,value);return;}return setAttribute.call(this,name,value);};
 function scan(node){if(node.nodeType!==1)return;if(node instanceof HTMLImageElement){const src=node.getAttribute('src');if(pathOf(src)&&sources.get(node)!==src)assign(node,src);}node.querySelectorAll?.('img').forEach(scan);}
 new MutationObserver(changes=>{for(const change of changes){if(change.type==='attributes')scan(change.target);else change.addedNodes.forEach(scan);}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
 root.fetch=async function(input,options){
  const url=typeof input==='string'||input instanceof URL?String(input):input?.url,path=pathOf(url),method=String(options?.method||input?.method||'GET').toUpperCase();
  if(!path||!['GET','HEAD'].includes(method)||!await ready())return originalFetch(input,options);
  return request(path);
 };
 async function upload(ref,blob,code){
  if(!await ready()){await ref.put(blob,{contentType:blob.type||'image/jpeg',cacheControl:'private,no-store'});return ref.getDownloadURL();}
  return (await (await request(ref.fullPath,{blob,code})).json()).url;
 }
 function clear(){
  epoch++;for(const c of controllers)c.abort();controllers.clear();for(const item of cache.values())if(item.url)URL.revokeObjectURL(item.url);cache.clear();
  document.querySelectorAll('img').forEach(img=>{if(sources.has(img)){revisions.set(img,(revisions.get(img)||0)+1);srcProperty.set.call(img,blank);}});
 }
 function bind(){if(!auth()||bind.done)return;bind.done=true;boundUser=auth().currentUser()?.uid||null;auth().subscribe(()=>{const uid=auth().currentUser()?.uid||null;if(uid===boundUser)return;boundUser=uid;clear();if(uid)document.querySelectorAll('img').forEach(img=>{const src=sources.get(img);if(src)assign(img,src);});});}
 root.addEventListener('aisel-session-ready',bind);bind();
 root.AiselMedia={ready,upload,pathOf,clear,imageURL};
 ready().catch(()=>{});
})(window);
