/* v201: read-only access to photos copied from a design meeting.
 * The workorder's p1 image, editing controls, save payload and print image stay canonical. */
(function(root){
 'use strict';
 const pending=new Set();
 let code='',photos=[],trigger=null,dialog=null,photo=null,counter=null,status=null,previous=null,next=null,index=0,loadingCode='',loadingNotice=null,recoveryHost=null,recoveryHome=null,recoveryObserver=null;
 function source(value){
  if(typeof value!=='string')return '';
  const text=value.trim();
  if(/^data:image\/(?:png|jpe?g|webp|gif|avif|heic|heif);base64,/i.test(text))return text;
  try{const url=new URL(text,location.href);return /^https?:$/.test(url.protocol)&&text?url.href:'';}catch(_){return '';}
 }
 function list(state){
  if(!Array.isArray(state?.designMeetingPhotos))return [];
  return state.designMeetingPhotos.map(p=>typeof p==='string'?{original:source(p),thumb:''}:{original:source(p?.original||p?.url),thumb:source(p?.thumb)})
   .filter(p=>p.original||p.thumb);
 }
 function button(label,action){const el=document.createElement('button');el.type='button';el.textContent=label;el.onclick=action;return el;}
 function ensure(){
  if(trigger)return true;
  const box=document.getElementById('ph1');if(!box)return false;
  trigger=button('',event=>{event.stopPropagation();open(0);});trigger.id='workorderMeetingPhotos';trigger.className='noprint';trigger.hidden=true;trigger.setAttribute('aria-haspopup','dialog');box.append(trigger);
  dialog=document.createElement('dialog');dialog.id='workorderMeetingPhotoViewer';dialog.className='noprint';dialog.setAttribute('aria-labelledby','workorderMeetingPhotoTitle');
  const header=document.createElement('div');header.className='wmp-heading';const title=document.createElement('strong');title.id='workorderMeetingPhotoTitle';title.textContent='회의 사진';
  const close=button('닫기',()=>dialog.close());header.append(title,close);
  photo=document.createElement('img');photo.className='wmp-photo';photo.decoding='async';photo.alt='';
  photo.onerror=()=>{const thumb=photos[index]?.thumb;if(thumb&&photo.getAttribute('src')!==thumb){photo.src=thumb;return;}status.textContent='사진을 불러오지 못했습니다.';};
  photo.onload=()=>{status.textContent='';};
  status=document.createElement('p');status.className='wmp-status';status.setAttribute('role','status');
  const navigation=document.createElement('div');navigation.className='wmp-navigation';previous=button('이전',()=>display(index-1));next=button('다음',()=>display(index+1));counter=document.createElement('span');counter.setAttribute('aria-live','polite');navigation.append(previous,counter,next);
  dialog.append(header,photo,status,navigation);document.body.append(dialog);
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();display(index-1);}else if(event.key==='ArrowRight'){event.preventDefault();display(index+1);}});
  dialog.addEventListener('close',()=>{photo.removeAttribute('src');status.textContent='';});
  return true;
 }
 function display(value){
  if(!photos.length)return;index=Math.max(0,Math.min(photos.length-1,value));
  const selected=photos[index];photo.alt='회의 사진 '+(index+1);status.textContent='';photo.src=selected.original||selected.thumb;
  counter.textContent=(index+1)+' / '+photos.length;previous.disabled=index===0;next.disabled=index===photos.length-1;
 }
 function open(value=0){
  if(!photos.length||!ensure())return false;
  if(!dialog.open)dialog.showModal();display(value);return true;
 }
 function clear(){
  code='';photos=[];unlock();if(trigger){trigger.hidden=true;trigger.textContent='';}
  if(dialog?.open)dialog.close();
 }
 function render(value,state){
  if(loadingCode&&loadingCode!==value)return;
  unlock();
  for(const request of [...pending])if(request.code===value)request.finish(true);
  const nextPhotos=list(state);
  if(code===value&&photos.length===nextPhotos.length&&photos.every((p,i)=>p.original===nextPhotos[i].original&&p.thumb===nextPhotos[i].thumb))return;
  if(dialog?.open)dialog.close();code=value||'';photos=nextPhotos;
  if(!ensure())return;trigger.hidden=!code||photos.length<2;trigger.textContent='회의 사진 '+photos.length+'장';trigger.dataset.code=code;
 }
 function expectOpen(value,timeout=15000){
  let request,timer;
  const ready=new Promise(resolve=>{request={code:value,finish(result){clearTimeout(timer);pending.delete(request);resolve(result);}};pending.add(request);timer=setTimeout(()=>request.finish(false),timeout);});
  return {ready,cancel(){request.finish(false);}};
 }
 function liftRecovery(){
  if(!loadingCode||recoveryHome)return;
  const editor=document.getElementById('editorView'),panel=document.getElementById('localDraftStatus');
  if(!panel||!editor?.contains(panel))return;
  if(!recoveryHost){recoveryHost=document.createElement('div');recoveryHost.id='workorderLoadingRecovery';recoveryHost.className='noprint';}
  loadingNotice.after(recoveryHost);
  const placeholder=document.createComment('aisel draft recovery position');
  recoveryHome={panel,placeholder,parent:panel.parentNode,next:panel.nextSibling};
  panel.before(placeholder);recoveryHost.append(panel);
 }
 function restoreRecovery(){
  recoveryObserver?.disconnect();recoveryObserver=null;
  if(recoveryHome){
   const {panel,placeholder,parent,next}=recoveryHome;
   if(placeholder.isConnected)placeholder.replaceWith(panel);
   else if(parent?.isConnected)parent.insertBefore(panel,next?.parentNode===parent?next:null);
   else document.querySelector('#editorView .toolbar')?.after(panel);
   recoveryHome=null;
  }
  recoveryHost?.remove();
 }
 function unlock(){
  restoreRecovery();
  loadingCode='';const editor=document.getElementById('editorView');if(editor){editor.inert=false;editor.removeAttribute('aria-busy');}
  if(loadingNotice)loadingNotice.hidden=true;
 }
 function beginLoading(value){
  const editor=document.getElementById('editorView');if(!editor)return;
  loadingCode=value;editor.inert=true;editor.setAttribute('aria-busy','true');
  if(!loadingNotice){loadingNotice=document.createElement('p');loadingNotice.id='workorderLoadingNotice';loadingNotice.className='noprint';loadingNotice.setAttribute('role','status');editor.before(loadingNotice);}
  loadingNotice.textContent='작업지시서를 불러오는 중…';loadingNotice.hidden=false;
  // Keep the existing recovery buttons usable even while the previous form is
  // inert. Moving the same node preserves its draft context and click handlers.
  liftRecovery();recoveryObserver?.disconnect();recoveryObserver=new MutationObserver(liftRecovery);
  recoveryObserver.observe(editor,{childList:true,subtree:true});
 }
 function failed(value){
  for(const request of [...pending])if(request.code===value)request.finish(false);
  if(loadingCode===value&&loadingNotice){loadingNotice.textContent='작업지시서를 불러오지 못했습니다. 목록에서 다시 열어주세요.';loadingNotice.hidden=false;}
 }
 function empty(value,isNew){if(isNew)render(value,{});else failed(value);}
 root.AiselWorkorderMeetingPhotos={render,clear,open,expectOpen,failed,beginLoading,empty,get currentCode(){return code;}};
})(window);
