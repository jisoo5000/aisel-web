/* v205: keep reference saves running after durable, account-scoped menu transitions. */
(function(){
 'use strict';
 const A=window.AiselUnifiedAdapter,DM=window.AiselDesignMeeting,RC=window.AiselReferenceCollection;
 if(!A||!DM||!RC)return;
 const main=document.getElementById('mainBar'),$=id=>document.getElementById(id);
 let current='',busy=false,pendingNavigation=null,frame=null,productState=null,returnToProducts=false,knownRole=null,navigationRevision=0;
 const directEntry=!!location.hash||!!new URLSearchParams(location.search).get('code');
 let landingOpen=!directEntry;
 let lastLocation={state:history.state,url:location.href},replayingPop=false;
 // Track the last committed location, including each collection's own detail routes.
 for(const method of ['pushState','replaceState']){const original=history[method];history[method]=function(...args){const value=original.apply(this,args);lastLocation={state:history.state,url:location.href};return value;};}
 const pane=document.createElement('section');pane.id='productProgressView';pane.className='noprint';pane.hidden=true;
 const notice=document.createElement('p');notice.id='unifiedNotice';notice.className='noprint';notice.setAttribute('role','status');
 main.after(notice,pane);
 const orders=main.querySelector('[data-main="orders"]');orders.textContent='작업지시서';
 const products=document.createElement('button');products.type='button';products.className='maintab';products.dataset.main='products';products.textContent='제품진행';
 const refs=document.createElement('button');refs.type='button';refs.className='maintab';refs.dataset.main='references';refs.textContent='레퍼런스';
 const sales=main.querySelector('[data-main="sales"]');sales.textContent='판매성과';
 main.append(sales,products,refs,main.querySelector('[data-main="designmeeting"]'),orders);
 function info(s=''){notice.textContent=s;}
 // Warm each collection without changing the visible pane or waiting in navigation.
 // Modules authorize their own requests; the landing-role hint is never an access grant.
 let galleryWarmKey='';
 function scheduleGalleryWarm(){
  const session=window.AiselAuth,user=session?.currentUser();
  if(!user?.uid||!user.emailVerified||!session.normalized||document.hidden)return;
  const key=user.uid+':'+session.generation;
  if(galleryWarmKey===key)return;galleryWarmKey=key;
  const run=()=>{
   if(window.AiselAuth!==session||key!==(session.currentUser()?.uid+':'+session.generation)||!session.normalized)return;
   if(document.hidden){galleryWarmKey='';return;}
   if(window.AiselGalleryIndex?.enabled){window.AiselGalleryIndex.start().catch(()=>{});return;}
   const calls=[];
   if(knownRole!=='logistics'&&RC.preloadGallery)calls.push(Promise.resolve().then(()=>RC.preloadGallery()));
   if(!['md','logistics'].includes(knownRole)&&DM.preloadGallery)calls.push(Promise.resolve().then(()=>DM.preloadGallery()));
   Promise.allSettled(calls).catch(()=>{});
  };
  if(window.requestIdleCallback)window.requestIdleCallback(run,{timeout:2500});else setTimeout(run,750);
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleGalleryWarm();});
 function role(){return A.isOwner()?'owner':knownRole||DM.getRole();}
 function allowedWorkorder(){return ['owner','designer'].includes(role());}
 function allowedView(view){return !((['md','logistics'].includes(role())&&['orders','editor','designmeeting'].includes(view))||(role()==='logistics'&&view==='references'));}
 function applyRole(){
  const limited=['md','logistics'].includes(role());
  orders.hidden=limited;
  const meeting=main.querySelector('[data-main="designmeeting"]');if(meeting)meeting.hidden=limited;
  refs.hidden=role()==='logistics';post('aisel-status-config',{canOpenWorkorder:allowedWorkorder()});
 }
 // A tiny account-scoped preference selects a landing page only. It never grants access.
 const landingKey='aisel.unified.landing.v1',validRoles=['owner','designer','md','logistics'];
 function memberUser(){if(window.AiselAuth)return window.AiselAuth.currentUser();try{return (window.firebase?.apps||[]).map(app=>app.auth().currentUser).find(u=>u?.emailVerified&&String(u.email||'').toLowerCase()==='sooana1214@gmail.com')||(window.firebase?.apps||[]).find(app=>app.name==='aiselDesignMeeting')?.auth().currentUser;}catch(_){return null;}}
 function rememberRole(value){const user=memberUser();if(!user?.emailVerified||!user.uid||!validRoles.includes(value))return;try{localStorage.setItem(landingKey,JSON.stringify({uid:user.uid,role:value,checkedAt:Date.now()}));}catch(_){} }
 function landingRole(){const verified=role();if(validRoles.includes(verified))return verified;const user=memberUser();if(!user?.emailVerified||!user.uid)return null;try{const hint=JSON.parse(localStorage.getItem(landingKey));const age=Date.now()-hint?.checkedAt;if(hint?.uid===user.uid&&age>=0&&age<86400000&&validRoles.includes(hint.role))return hint.role;}catch(_){}return null;}
 function landingView(){const value=landingRole();return value==='logistics'?'products':value==='designer'?'orders':'sales';}
 function restoreLanding(){if(!landingOpen||busy||!landingRole())return;landingOpen=false;const target=landingView();if(current!==target)show(target,{replace:true});}
 for(const event of ['pointerdown','keydown','input'])document.addEventListener(event,()=>{landingOpen=false;},{capture:true,once:true});
 // Resuming input cancels a destination chosen before that input. A delayed save
 // acknowledgement must never hide the form the user has continued editing.
 for(const name of ['input','change','compositionstart'])document.addEventListener(name,event=>{
  const form=event.target?.closest?.('#editorView,#designMeetingView,#referenceCollectionView');
  if(!form||form.hidden||getComputedStyle(form).display==='none')return;
  navigationRevision++;
  if(busy&&pendingNavigation){pendingNavigation.resolve(false);pendingNavigation=null;}
 },true);
 window.addEventListener('aisel-role-verified',e=>{if(!validRoles.includes(e.detail?.role))return;if(e.detail.uid!==undefined&&e.detail.uid!==window.AiselAuth?.currentUser()?.uid)return;if(e.detail.generation!==undefined&&e.detail.generation!==window.AiselAuth?.generation)return;knownRole=e.detail.role;rememberRole(knownRole);applyRole();restoreLanding();});
 function post(type,extra={}){frame?.contentWindow?.postMessage({type,...extra},location.origin);}
 function unmount(){if(!frame)return;try{const state=frame.contentWindow?.AiselStatusEmbed?.getState();if(state)productState=state;}catch(_){}frame.remove();frame=null;}

 // The product list scrolls inside an iframe. Wheel/touch events over the shell's
 // header or side gutters belong to the parent document and never reach it.
 // Forward only those gestures; native gestures inside the iframe stay native.
 function productScrollRoot(){
  if(current!=='products'||!frame||pane.hidden)return null;
  try{
   const doc=frame.contentDocument,win=frame.contentWindow;
   if(!doc?.body||doc.querySelector('.viewer.on,dialog[open]'))return null;
   const root=doc.scrollingElement||doc.documentElement;
   if(win.getComputedStyle(doc.body).overflowY==='hidden')return null;
   return root.scrollHeight>win.innerHeight+1?root:null;
  }catch(_){return null;}
 }
 function shellGestureBlocked(target){
  return !!document.querySelector('dialog[open]')||!!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
 }
 function moveProductBy(delta){
  const root=productScrollRoot();if(!root||!Number.isFinite(delta)||!delta)return false;
  const before=root.scrollTop,limit=Math.max(0,root.scrollHeight-root.ownerDocument.defaultView.innerHeight);
  root.scrollTop=Math.max(0,Math.min(limit,before+delta));
  return Math.abs(root.scrollTop-before)>.1;
 }
 document.addEventListener('wheel',event=>{
  if(event.defaultPrevented||event.ctrlKey||event.metaKey||shellGestureBlocked(event.target)||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
  const scale=event.deltaMode===1?18:event.deltaMode===2?(frame?.contentWindow?.innerHeight||innerHeight):1;
  if(moveProductBy(event.deltaY*scale))event.preventDefault();
 },{passive:false});
 let productTouch=null;
 document.addEventListener('touchstart',event=>{
  productTouch=event.touches.length===1&&productScrollRoot()&&!shellGestureBlocked(event.target)?
   {x:event.touches[0].clientX,y:event.touches[0].clientY}:null;
 },{passive:true});
 document.addEventListener('touchmove',event=>{
  if(!productTouch||event.touches.length!==1||event.defaultPrevented)return;
  const touch=event.touches[0],dx=touch.clientX-productTouch.x,dy=productTouch.y-touch.clientY;
  if(Math.abs(dx)>Math.abs(dy)){productTouch=null;return;}
  if(Math.abs(dy)<4)return;
  if(moveProductBy(dy))event.preventDefault();
  productTouch={x:touch.clientX,y:touch.clientY};
 },{passive:false});
 for(const name of ['touchend','touchcancel'])document.addEventListener(name,()=>{productTouch=null;},{passive:true});

 function mount(){if(frame)return;frame=document.createElement('iframe');frame.id='productProgressFrame';frame.title='제품 진행 현황';frame.src='status.html?embedded=1&v=199';pane.append(frame);}
 function select(view){
  current=view;
  $('appBrandHeader').hidden=false;$('appPageTitle').textContent=({sales:'판매성과',products:'제품진행',references:'레퍼런스',designmeeting:'디자인회의',orders:'작업지시서',editor:'작업지시서'})[view]||'작업지시서';
  for(const b of main.querySelectorAll('.maintab')){const on=b.dataset.main===(view==='editor'?'orders':view);b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));}
  const active=main.querySelector('.maintab.active');if(active){const a=active.getBoundingClientRect(),n=main.getBoundingClientRect();if(a.left<n.left)main.scrollLeft+=a.left-n.left;else if(a.right>n.right)main.scrollLeft+=a.right-n.right;}
  if(view!=='products')unmount();pane.hidden=view!=='products';
  if(view!=='references')$('referenceCollectionView').hidden=true;
  if(view!=='designmeeting')$('designMeetingView').hidden=true;
 }
 function route(view,replace=false,code){const url=new URL(location.href);url.hash=view==='products'?'products':view==='orders'?'workorders':view==='sales'?'sales':view==='editor'?'workorder='+encodeURIComponent(code):url.hash;history[replace?'replaceState':'pushState']({aiselUnified:true,view,code:code||null},'',url);}
 async function guard(target,intent=navigationRevision){
  const isCurrent=()=>intent===navigationRevision;
  // A menu switch keeps the same account and document alive. Once the current
  // input is durable locally, the reference request can finish in its own pane.
  // Identity changes below still use the default server-confirmed save guard.
  if(current==='references'&&target!=='references'&&(!await RC.canLeave({allowLocal:true,isCurrent})||!isCurrent()))return false;
  if(current==='designmeeting'&&target!=='designmeeting'&&(!await DM.canLeave()||!isCurrent()))return false;
  if(!isCurrent()||!await A.leave()||!isCurrent())return false;
  if(current==='references'&&target!=='references'&&(!isCurrent()||!await RC.leave({allowLocal:true,isCurrent})||!isCurrent()))return false;
  return isCurrent();
 }
 function drainNavigation(completed=true){
  if(busy||!pendingNavigation)return;
  const next=pendingNavigation;pendingNavigation=null;
  if(!completed){next.resolve(false);return;}
  show(next.view,next.options).then(next.resolve);
 }
 async function restoreAfterOpenFailure(view,previousCode,previousLocation){
  // Detach the failed subscription before a late response can replace another screen.
  A.hide();select(view);
  if(view==='designmeeting')window.AiselDesignMeetingAdapter.restore();
  else if(view==='references')await RC.show({history:false,preserveDetail:true,background:true});
  else if(view==='products')mount();
  else if(view==='sales')await A.sales();
  else if(view==='editor'&&previousCode)await A.open(previousCode);
  else{await A.orders();select('orders');}
  restoreLocation(previousLocation);
 }
 async function show(view,{history:writeHistory=true,replace=false,code}={}){
  if(!['products','orders','sales','editor','references','designmeeting'].includes(view))return false;
  if(!allowedView(view)){info('이 메뉴는 담당 권한이 있는 계정에서 사용할 수 있습니다.');return false;}
  if(view==='editor'&&(typeof code!=='string'||!code.trim()||code.length>160||/[.#$\[\]\/\u0000-\u001f]/.test(code)))return false;
  // Keep the latest destination while an input save is finishing.
  if(busy)return new Promise(resolve=>{pendingNavigation?.resolve(false);pendingNavigation={view,options:{history:writeHistory,replace,code},resolve};});
  const previousView=current,previousCode=window.AiselWorkorderMeetingPhotos?.currentCode,previousLocation={state:history.state,url:location.href},intent=navigationRevision;
  busy=true;let completed=false,openingEditor=false;
  try{
   if(!await guard(view,intent)||intent!==navigationRevision)return false;info();if(view!=='editor')returnToProducts=false;
   if(view==='references'){if(await RC.show({history:writeHistory,background:true,preserveDetail:false})===false)return false;select(view);completed=true;return true;}
   if(view==='designmeeting'){if(await DM.show({history:writeHistory,preserveDetail:false,background:true})===false)return false;select(view);completed=true;return true;}
   if(intent!==navigationRevision)return false;
   A.hide();select(view);
   if(view==='products'){mount();$('appBrandHeader').hidden=false;$('appPageTitle').textContent='제품 진행 현황';document.body.dataset.aiselListView='products';}
   else if(view==='orders')await A.orders();
   else if(view==='sales'){await A.sales();window.AiselSheetSalesSource?.refreshIfStale?.();}
   else if(view==='editor'){
    openingEditor=true;
    const waiting=window.AiselWorkorderMeetingPhotos?.expectOpen(code);
    try{
     if(await A.open(code)===false||waiting&&!await waiting.ready)throw Error('작업지시서를 불러오지 못했습니다. 입력 내용은 유지했습니다. 다시 열어주세요.');
    }finally{waiting?.cancel();}
    returnToProducts=previousView==='products';
   }
   select(view);
   if(writeHistory)route(view,replace,code);
   window.scrollTo(0,0);completed=true;return true;
  }catch(e){
   if(openingEditor){try{await restoreAfterOpenFailure(previousView,previousCode,previousLocation);}catch(_){A.hide();}}
   info(e.message||'화면을 열지 못했습니다. 다시 시도해주세요.');return false;
  }
  finally{busy=false;drainNavigation(completed);}
 }
 async function referenceBridge(action,payload){
  const session=window.AiselAuth,generation=session?.generation,uid=session?.currentUser()?.uid||null;
  // refAccess already checks the authenticated backend contract. A separate
  // unauthenticated health GET adds another Apps Script round trip before every
  // cold entry; it neither authorizes the user nor makes the following POST safer.
  const result=await DM.bridge(action,[],payload);
  if(session&&(generation!==session.generation||uid!==(session.currentUser()?.uid||null)))throw Object.assign(Error('로그인 계정이 변경되었습니다. 다시 확인해주세요.'),{code:'session_changed'});
  if(action==='refAccess'&&validRoles.includes(result?.role)){knownRole=result.role;rememberRole(knownRole);applyRole();}
  return result;
 }
 RC.configure({bridge:referenceBridge,login:()=>DM.login({scope:'reference'}),beforeShow:async()=>{
  if(!await guard('references'))return false;A.hide();select('references');$('appBrandHeader').hidden=false;$('appPageTitle').textContent='레퍼런스';document.body.dataset.aiselListView='references';return true;
 }});
 // Capture before the existing tab handlers so only one navigation runs.
 main.addEventListener('click',e=>{const b=e.target.closest('.maintab[data-main]');if(!b)return;landingOpen=false;e.preventDefault();e.stopImmediatePropagation();show(b.dataset.main);},true);
 window.addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==frame?.contentWindow)return;
  const data=e.data||{};
  if(data.type==='aisel-status-ready'){post('aisel-status-config',{canOpenWorkorder:allowedWorkorder(),state:productState});window.AiselAuth?.syncFrame?.();}
  if(data.type==='aisel-status-state')productState=data.state;
  if(data.type==='aisel-status-open-workorder'&&allowedWorkorder()&&typeof data.code==='string'){
   productState=data.state||productState;show('editor',{code:data.code});
  }
 });
 window.addEventListener('aisel-owner-auth-change',()=>{if(window.AiselAuth)return;knownRole=null;applyRole();restoreLanding();});
 window.addEventListener('aisel-session-change',()=>{knownRole=null;applyRole();restoreLanding();});
 window.addEventListener('aisel-view-change',e=>{if(e.detail?.view)select(e.detail.view);});
 window.addEventListener('aisel-legacy-view-change',e=>{
  if(busy)return;queueMicrotask(()=>{if(busy)return;select(e.detail.view==='orders'?(A.editorVisible()?'editor':'orders'):e.detail.view);});
 });
 $('backToListBtn').addEventListener('click',e=>{if(!returnToProducts)return;e.preventDefault();e.stopImmediatePropagation();show('products',{replace:true}).then(ok=>{if(ok)returnToProducts=false;});},true);
 function historyTarget(state,hash){
  if(state?.aiselReference||/^#references?$|^#reference=/.test(hash))return {owner:'reference',view:'references'};
  if(state?.aiselDesignMeeting||/^#design-meeting(?:=|$)/.test(hash))return {owner:'meeting',view:'designmeeting'};
  if(state?.aiselUnified)return {owner:'unified',view:state.view,code:state.code};
  if(state?.aisel)return {owner:'legacy',view:state.view==='editor'?'editor':state.view==='sales'?'sales':'orders'};
  return null;
 }
 function restoreLocation(previous){history.replaceState(previous.state,'',previous.url);}
 // Capture cross-module browser navigation before legacy/detail listeners can hide unsaved input.
 window.AiselUnifiedNavigationPreflight=async e=>{
  if(replayingPop)return;
  landingOpen=false;
  const target=historyTarget(e.state,location.hash);if(!target)return;
  const previous=lastLocation,next={state:e.state,url:location.href};
  if(!allowedView(target.view)){e.stopImmediatePropagation();restoreLocation(previous);info('이 메뉴는 담당 권한이 있는 계정에서 사용할 수 있습니다.');return;}
  if(target.owner!=='unified'&&target.view===current){lastLocation=next;return;}
  e.stopImmediatePropagation();
  if(busy){restoreLocation(previous);return;}
  if(target.owner==='unified'){
   if(!await show(target.view,{history:false,code:target.code})){restoreLocation(previous);return;}
   lastLocation=next;return;
  }
  let completed=false;
  try{
   busy=true;
   if(!await guard(target.view)){restoreLocation(previous);return;}
   if(target.owner==='reference'){
    const id=new URL(next.url).hash.startsWith('#reference=')?decodeURIComponent(new URL(next.url).hash.slice(11)):undefined;
    if(await RC.show({history:false,id,preserveDetail:!!id})===false){restoreLocation(previous);return;}
   }else if(target.owner==='meeting'){
    if(await DM.show({history:false,preserveDetail:true})===false){restoreLocation(previous);return;}
   }else{returnToProducts=false;A.hide();select(target.view);}
   select(target.view);lastLocation=next;
   // Their own handlers restore list/detail scroll after the shared leave guard succeeds.
   replayingPop=true;
   try{window.dispatchEvent(new PopStateEvent('popstate',{state:next.state}));}finally{replayingPop=false;}
   completed=true;
  }catch(error){restoreLocation(previous);info(error.message||'화면을 열지 못했습니다.');}
  finally{busy=false;drainNavigation(completed);}
 };
 window.AiselUnified={show,get view(){return current;}};
 // Conversion and reopening a linked meeting use the same save guard, route and
 // acknowledged editor load as every other cross-menu workorder navigation.
 if(window.AiselDesignMeetingAdapter)window.AiselDesignMeetingAdapter.open=code=>show('editor',{code});
 applyRole();
 const hash=location.hash;
 if(/^#reference=/.test(hash))RC.show({id:decodeURIComponent(hash.slice(11)),history:false});
 else if(hash==='#references')show('references',{history:false});
 else if(/^#design-meeting(?:=|$)/.test(hash)){
  // Reload a meeting list or detail through its existing owner, without adding a route.
  show('designmeeting',{history:false}).then(ok=>{
   if(ok===false)return;
   if(hash.startsWith('#design-meeting='))DM.open(decodeURIComponent(hash.slice(16)),{history:false}).catch(error=>info(error.message));
  }).catch(error=>info(error.message));
 }
 else if(new URLSearchParams(location.search).get('code'))select('editor');
 else if(/^#workorder=/.test(hash))show('editor',{history:false,code:decodeURIComponent(hash.slice(11))});
 else show(hash==='#sales'?'sales':hash==='#workorders'?'orders':hash==='#products'?'products':landingView(),{replace:true}).then(restoreLanding);
 // Reuse existing Firebase auth restoration; do not perform another role lookup.
 // The member app is normally lazy. Restore it only when this device has a recent landing hint.
 try{
  const hint=JSON.parse(localStorage.getItem(landingKey)),age=Date.now()-hint?.checkedAt;
  if(landingOpen&&hint?.uid&&validRoles.includes(hint.role)&&age>=0&&age<86400000&&window.firebase&&!(firebase.apps||[]).some(app=>app.name==='aiselDesignMeeting'))firebase.initializeApp(firebase.app().options,'aiselDesignMeeting');
 }catch(_){}
 for(const app of window.firebase?.apps||[]){try{app.auth().onAuthStateChanged(()=>queueMicrotask(restoreLanding));}catch(_){} }
 initCommonSession();

 function initCommonSession(){
  const sdk=window.firebase;if(!sdk?.auth||!sdk.apps?.length)return;
  let app,auth;
  try{app=sdk.apps.find(a=>a.name==='aiselSalesReadOnly')||sdk.initializeApp(sdk.app().options,'aiselSalesReadOnly');auth=app.auth();}catch(_){return;}
  const header=$('appBrandHeader'),button=document.createElement('button');button.id='aiselSessionButton';button.type='button';button.textContent='로그인';button.setAttribute('aria-haspopup','dialog');header.append(button);
  const dialog=document.createElement('dialog');dialog.id='aiselAccountDialog';dialog.className='noprint';dialog.setAttribute('aria-labelledby','aiselAccountTitle');
  dialog.innerHTML='<div class="account-heading"><h2 id="aiselAccountTitle">로그인</h2><button type="button" id="aiselAccountClose" aria-label="계정 창 닫기">×</button></div><p id="aiselAccountIdentity"></p><p id="aiselAccountStatus" role="status" aria-live="polite"></p><div class="account-actions"><button type="button" id="aiselAccountGoogle">Google 계정으로 로그인</button><button type="button" id="aiselMeetingTools" hidden>디자인회의 관리 도구</button><button type="button" id="aiselAccountLogout" hidden>로그아웃</button></div>';
  document.body.append(dialog);document.body.dataset.aiselCommonSession='ready';
  const google=$('aiselAccountGoogle'),logoutButton=$('aiselAccountLogout'),meetingTools=$('aiselMeetingTools'),status=$('aiselAccountStatus'),identity=$('aiselAccountIdentity');
  let generation=0,previousUid,authReady=false,suppressMigration=false,migration=null,sessionBusy=false,loginFlight=null,resolveLogin=null,rejectLogin=null;
  let normalization=null,normalizedUid=null,loggingOut=false,normalizationError='',saveGuardDepth=0;
  const listeners=new Set(),sameProject=a=>a.options?.projectId===app.options?.projectId;
  const currentUser=()=>auth.currentUser||null;
  const cancelled=()=>Object.assign(Error('로그인을 취소했습니다.'),{code:'auth/popup-closed-by-user'});
  function renderAccount(){const user=currentUser();button.textContent=user?'계정':'로그인';button.setAttribute('aria-label',user?'로그인 계정과 로그아웃':'로그인');$('aiselAccountTitle').textContent=user?'계정':'로그인';identity.textContent=user?.email||'';identity.hidden=!user;google.hidden=!!user&&!normalizationError;google.textContent=user?'계정 연결 확인':'Google 계정으로 로그인';logoutButton.hidden=!user;logoutButton.disabled=sessionBusy;meetingTools.hidden=!user||!allowedWorkorder();meetingTools.disabled=sessionBusy;}
  function sessionDetail(reason){const user=currentUser();return {uid:user?.uid||null,email:user?.email||'',generation,reason};}
  function clearNormalizationError(){if(normalizationError&&notice.textContent===normalizationError)info();normalizationError='';}
  function syncFrame(reason='sync',requestId){post('aisel-session-change',{...sessionDetail(reason),requestId});}
  function publish(reason){
   const user=currentUser(),uid=user?.uid||null,old=previousUid;renderAccount();if(uid===old)return;
   previousUid=uid;generation++;normalizedUid=null;clearNormalizationError();if(old&&uid!==old)suppressMigration=true;
   const detail={...sessionDetail(reason),previousUid:old||null};
   window.dispatchEvent(new CustomEvent('aisel-session-change',{detail}));listeners.forEach(fn=>{try{fn(detail);}catch(_){}});syncFrame(reason);
  }
  async function settle(){saveGuardDepth++;try{if(!await A.leave())return false;if(!await DM.canLeave())return false;if(!await RC.canLeave())return false;return true;}finally{saveGuardDepth--;}}
  function conflictingSessions(uid){return sdk.apps.filter(a=>a!==app&&sameProject(a)).filter(a=>{try{const other=a.auth().currentUser;return other?.uid&&!other.isAnonymous&&other.uid!==uid;}catch(_){return false;}});}
  function ready(options={}){
   const user=currentUser(),uid=user?.uid||null;if(!uid){normalizedUid=null;return Promise.resolve(null);}
   // A collection save inside our own guard already uses the canonical token.
   // Let that guarded request finish; awaiting its parent normalization would deadlock.
   if(options.allowGuardRequest===true&&saveGuardDepth>0)return Promise.resolve(user);
   if(loggingOut)return Promise.reject(Object.assign(Error('로그아웃 중입니다.'),{code:'session_changed'}));
   if(normalization)return normalization.uid===uid?normalization.promise:normalization.promise.catch(()=>{}).then(ready);
   if(!conflictingSessions(uid).length){normalizedUid=uid;clearNormalizationError();return Promise.resolve(user);}
   normalizedUid=null;const expected=generation,entry={uid,promise:null};
   entry.promise=(async()=>{
    if(!await settle())throw Object.assign(Error('입력한 내용을 저장한 뒤 계정 연결을 다시 확인해주세요.'),{code:'save_pending'});
    if(expected!==generation||uid!==currentUser()?.uid)throw Object.assign(Error('로그인 계정이 변경되었습니다.'),{code:'session_changed'});
    for(const other of conflictingSessions(uid)){
     if(expected!==generation||uid!==currentUser()?.uid||loggingOut)throw Object.assign(Error('로그인 계정이 변경되었습니다.'),{code:'session_changed'});
     const otherUid=other.auth().currentUser?.uid;if(otherUid&&otherUid!==uid)await other.auth().signOut();
    }
    if(expected!==generation||uid!==currentUser()?.uid||conflictingSessions(uid).length)throw Object.assign(Error('계정 연결 해제를 확인하지 못했습니다. 다시 확인해주세요.'),{code:'session_changed'});
    normalizedUid=uid;clearNormalizationError();return currentUser();
   })().catch(error=>{if(expected===generation&&uid===currentUser()?.uid){normalizationError=error.message;status.textContent=error.message;info(error.message);}throw error;}).finally(()=>{if(normalization===entry)normalization=null;renderAccount();});
   normalization=entry;return entry.promise;
  }
  function finishLogin(error,result){const resolve=resolveLogin,reject=rejectLogin;resolveLogin=rejectLogin=null;loginFlight=null;if(error)reject?.(error);else resolve?.(result);}
  function login(){
   if(currentUser())return ready().then(user=>({user}));if(loginFlight)return loginFlight;
   loginFlight=new Promise((resolve,reject)=>{resolveLogin=resolve;rejectLogin=reject;});const result=loginFlight;
   renderAccount();status.textContent='입력한 내용을 확인하고 있습니다.';google.disabled=true;dialog.showModal();
   Promise.all([settle(),migration||Promise.resolve()]).then(([ok])=>{if(!loginFlight)return;if(ok&&currentUser()){finishLogin(null,{user:currentUser()});dialog.close();}else if(ok){status.textContent='';google.disabled=false;}else{status.textContent='입력한 내용을 저장한 뒤 다시 로그인해주세요.';finishLogin(Object.assign(Error(status.textContent),{code:'save_pending'}));}}).catch(error=>{status.textContent=error.message||'입력한 내용을 확인하지 못했습니다.';finishLogin(error);});
   return result;
  }
  google.addEventListener('click',()=>{
   if(sessionBusy||google.disabled)return;
   if(currentUser()){
    sessionBusy=true;google.disabled=true;status.textContent='계정 연결을 확인하고 있습니다.';
    ready().then(user=>{status.textContent='';finishLogin(null,{user});dialog.close();},error=>{status.textContent=error.message;}).finally(()=>{sessionBusy=false;google.disabled=false;renderAccount();});return;
   }
   if(!loginFlight)return;sessionBusy=true;google.disabled=true;status.textContent='로그인 중…';suppressMigration=true;
   const provider=new sdk.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
   // Invoke the popup synchronously from this click, after the save guard has settled.
   let popup;try{popup=auth.signInWithPopup(provider);}catch(error){popup=Promise.reject(error);}
   Promise.resolve(popup).then(async result=>{publish('login');await ready();status.textContent='';finishLogin(null,result);dialog.close();}).catch(error=>{status.textContent=normalizationError||(/popup-closed-by-user|cancelled-popup-request/.test(error?.code||'')?'로그인을 취소했습니다. 다시 로그인할 수 있습니다.':'로그인하지 못했습니다. 다시 시도해주세요.');}).finally(()=>{sessionBusy=false;google.disabled=false;renderAccount();});
  });
  function frameDisconnect(){
   if(!frame?.contentWindow)return Promise.resolve();const target=frame.contentWindow,requestId='session-'+crypto.randomUUID();
   return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(Error('샘플 시트 연결 해제를 확인하지 못했습니다. 다시 로그아웃해주세요.'));},12000);
    function receive(e){if(e.origin!==location.origin||e.source!==target||e.data?.type!=='aisel-session-cleared'||e.data.requestId!==requestId)return;clearTimeout(timer);window.removeEventListener('message',receive);e.data.ok?resolve():reject(Error('샘플 시트 연결 해제를 확인하지 못했습니다.'));}
    window.addEventListener('message',receive);target.postMessage({type:'aisel-session-change',...sessionDetail('logout'),uid:null,email:'',requestId},location.origin);
   });
  }
  async function logout(){
   if(sessionBusy)return false;sessionBusy=true;renderAccount();status.textContent='입력한 내용을 확인하고 있습니다.';
   try{
    if(!await settle()){status.textContent='입력한 내용을 저장한 뒤 다시 로그아웃해주세요.';return false;}
    suppressMigration=true;loggingOut=true;if(migration)await migration.catch(()=>{});if(normalization)await normalization.promise.catch(()=>{});await frameDisconnect();
    const outcomes=await Promise.allSettled(sdk.apps.filter(a=>{const user=a.auth().currentUser;return sameProject(a)&&user&&!user.isAnonymous;}).map(a=>a.auth().signOut()));publish('logout');
    if(outcomes.some(r=>r.status==='rejected'))throw Error('일부 연결을 해제하지 못했습니다. 다시 로그아웃해주세요.');
    status.textContent='';dialog.close();return true;
   }catch(error){status.textContent=error.message||'로그아웃하지 못했습니다.';return false;}finally{loggingOut=false;sessionBusy=false;renderAccount();}
  }
  async function verifySession(){
   const expected=generation,uid=currentUser()?.uid;if(!uid)return;
   try{if(DM.verifyAccess)await DM.verifyAccess();}
   catch(error){
    if(expected!==generation||uid!==currentUser()?.uid)return;
    if(error?.code==='forbidden'){try{await referenceBridge('refAccess',{});}catch(other){if(expected===generation)info(other.message||'메뉴 권한을 확인하지 못했습니다.');}}
    else info(error.message||'메뉴 권한을 확인하지 못했습니다.');
   }
  }
  function requestLogin(){return login().then(async result=>{await verifySession();return result;});}
  button.addEventListener('click',()=>{if(currentUser()){renderAccount();status.textContent=normalizationError;dialog.showModal();}else requestLogin().catch(error=>{if(!/popup-closed-by-user|cancelled-popup-request/.test(error?.code||''))info(error.message||'로그인하지 못했습니다.');});});
  logoutButton.addEventListener('click',logout);
  meetingTools.addEventListener('click',async()=>{if(sessionBusy)return;dialog.close();if(current==='designmeeting'||await show('designmeeting'))DM.openTools?.();});
  $('aiselAccountClose').addEventListener('click',()=>{if(!sessionBusy)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(sessionBusy)event.preventDefault();});dialog.addEventListener('close',()=>{if(loginFlight&&!sessionBusy)finishLogin(cancelled());});
  window.AiselAuth={currentUser,ready,login,requestLogin,logout,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},syncFrame,get generation(){return generation;},get normalized(){return normalizedUid===(currentUser()?.uid||null)&&!normalizationError;}};
  async function adoptExistingSession(){
   if(!authReady||currentUser()||suppressMigration||migration||loginFlight||sessionBusy||typeof auth.updateCurrentUser!=='function')return;
   const prior=sdk.apps.filter(a=>a!==app&&sameProject(a)&&a.name!=='aiselShootingSamples').map(a=>{try{return a.auth().currentUser;}catch(_){return null;}}).find(user=>user?.uid&&user.emailVerified);
   if(!prior)return;migration=Promise.resolve(auth.updateCurrentUser(prior));try{await migration;publish('restore');}catch(_){/* Existing session remains intact; sign-in can be retried from the common entry. */}finally{migration=null;}
  }
  auth.onAuthStateChanged(()=>{authReady=true;publish('auth');if(!loggingOut)ready().then(scheduleGalleryWarm).catch(()=>{});adoptExistingSession();});
  for(const other of sdk.apps.filter(a=>a!==app&&sameProject(a))){try{other.auth().onAuthStateChanged(()=>{adoptExistingSession();if(currentUser()&&!loggingOut)ready().catch(()=>{});});}catch(_){} }
  renderAccount();
 }
})();
