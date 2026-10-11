/* v174: five shared menus; preserve each collection's bounded list state. */
(function(){
 'use strict';
 const A=window.AiselUnifiedAdapter,DM=window.AiselDesignMeeting,RC=window.AiselReferenceCollection;
 if(!A||!DM||!RC)return;
 const main=document.getElementById('mainBar'),$=id=>document.getElementById(id);
 let current='',busy=false,frame=null,productState=null,returnToProducts=false,bridgeReady=null,knownRole=null;
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
 function memberUser(){try{return (window.firebase?.apps||[]).map(app=>app.auth().currentUser).find(u=>u?.emailVerified&&String(u.email||'').toLowerCase()==='sooana1214@gmail.com')||(window.firebase?.apps||[]).find(app=>app.name==='aiselDesignMeeting')?.auth().currentUser;}catch(_){return null;}}
 function rememberRole(value){const user=memberUser();if(!user?.emailVerified||!user.uid||!validRoles.includes(value))return;try{localStorage.setItem(landingKey,JSON.stringify({uid:user.uid,role:value,checkedAt:Date.now()}));}catch(_){} }
 function landingRole(){const verified=role();if(validRoles.includes(verified))return verified;const user=memberUser();if(!user?.emailVerified||!user.uid)return null;try{const hint=JSON.parse(localStorage.getItem(landingKey));const age=Date.now()-hint?.checkedAt;if(hint?.uid===user.uid&&age>=0&&age<86400000&&validRoles.includes(hint.role))return hint.role;}catch(_){}return null;}
 function landingView(){const value=landingRole();return value==='logistics'?'products':value==='designer'?'orders':'sales';}
 function restoreLanding(){if(!landingOpen||busy||!landingRole())return;landingOpen=false;const target=landingView();if(current!==target)show(target,{replace:true});}
 for(const event of ['pointerdown','keydown','input'])document.addEventListener(event,()=>{landingOpen=false;},{capture:true,once:true});
 window.addEventListener('aisel-role-verified',e=>{if(!validRoles.includes(e.detail?.role))return;knownRole=e.detail.role;rememberRole(knownRole);applyRole();restoreLanding();});
 function post(type,extra={}){frame?.contentWindow?.postMessage({type,...extra},location.origin);}
 function unmount(){if(!frame)return;try{const state=frame.contentWindow?.AiselStatusEmbed?.getState();if(state)productState=state;}catch(_){}frame.remove();frame=null;}
 function mount(){if(frame)return;frame=document.createElement('iframe');frame.id='productProgressFrame';frame.title='제품 진행 현황';frame.src='status.html?embedded=1&v=173';pane.append(frame);}
 function select(view){
  current=view;
  for(const b of main.querySelectorAll('.maintab')){const on=b.dataset.main===(view==='editor'?'orders':view);b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));}
  const active=main.querySelector('.maintab.active');if(active){const a=active.getBoundingClientRect(),n=main.getBoundingClientRect();if(a.left<n.left)main.scrollLeft+=a.left-n.left;else if(a.right>n.right)main.scrollLeft+=a.right-n.right;}
  if(view!=='products')unmount();pane.hidden=view!=='products';
  if(view!=='references')$('referenceCollectionView').hidden=true;
  if(view!=='designmeeting')$('designMeetingView').hidden=true;
 }
 function route(view,replace=false,code){const url=new URL(location.href);url.hash=view==='products'?'products':view==='orders'?'workorders':view==='sales'?'sales':view==='editor'?'workorder='+encodeURIComponent(code):url.hash;history[replace?'replaceState':'pushState']({aiselUnified:true,view,code:code||null},'',url);}
 async function guard(target){
  if(current==='references'&&target!=='references'&&!await RC.canLeave())return false;
  if(current==='designmeeting'&&target!=='designmeeting'&&!await DM.canLeave())return false;
  if(!await A.leave())return false;
  if(current==='references'&&target!=='references'&&!await RC.leave())return false;
  return true;
 }
 async function show(view,{history:writeHistory=true,replace=false,code}={}){
  if(!['products','orders','sales','editor','references','designmeeting'].includes(view))return false;
  if(!allowedView(view)){info('이 메뉴는 담당 권한이 있는 계정에서 사용할 수 있습니다.');return false;}
  if(view==='editor'&&(typeof code!=='string'||!code.trim()||code.length>160||/[.#$\[\]\/\u0000-\u001f]/.test(code)))return false;
  if(busy)return false;busy=true;
  try{
   if(!await guard(view))return false;info();if(view!=='editor')returnToProducts=false;
   if(view==='references'){if(await RC.show({history:writeHistory})===false)return false;select(view);return true;}
   if(view==='designmeeting'){if(await DM.show({history:writeHistory,preserveDetail:false})===false)return false;select(view);return true;}
   A.hide();select(view);
   if(view==='products'){mount();$('appBrandHeader').hidden=false;$('appPageTitle').textContent='제품 진행 현황';document.body.dataset.aiselListView='products';}
   else if(view==='orders')await A.orders();
   else if(view==='sales'){await A.sales();window.AiselSheetSalesSource?.refreshIfStale?.();}
   else if(view==='editor'){A.open(code);returnToProducts=true;}
   select(view);
   if(writeHistory)route(view,replace,code);
   window.scrollTo(0,0);return true;
  }catch(e){info(e.message||'화면을 열지 못했습니다. 다시 시도해주세요.');return false;}
  finally{busy=false;}
 }
 async function referenceBridge(action,payload){
  if(bridgeReady!==true){
   const response=await fetch(window.AISEL_DESIGN_MEETING_BRIDGE,{signal:AbortSignal.timeout(12000)});
   const state=await response.json();bridgeReady=state.referenceReady===true;
   if(!bridgeReady)throw Object.assign(Error('레퍼런스 저장 연결을 준비하고 있습니다. 연결이 완료되면 등록할 수 있습니다.'),{code:'connection_pending'});
  }
  const result=await DM.bridge(action,[],payload);
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
  if(data.type==='aisel-status-ready')post('aisel-status-config',{canOpenWorkorder:allowedWorkorder(),state:productState});
  if(data.type==='aisel-status-state')productState=data.state;
  if(data.type==='aisel-status-open-workorder'&&allowedWorkorder()&&typeof data.code==='string'){
   productState=data.state||productState;show('editor',{code:data.code});
  }
 });
 window.addEventListener('aisel-owner-auth-change',()=>{knownRole=null;applyRole();restoreLanding();});
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
  try{
   if(target.owner==='unified'){
    if(!await show(target.view,{history:false,code:target.code})){restoreLocation(previous);return;}
    lastLocation=next;return;
   }
   busy=true;
   if(!await guard(target.view)){restoreLocation(previous);return;}
   if(target.owner==='reference'){
    const id=new URL(next.url).hash.startsWith('#reference=')?decodeURIComponent(new URL(next.url).hash.slice(11)):undefined;
    if(await RC.show({history:false,id})===false){restoreLocation(previous);return;}
   }else if(target.owner==='meeting'){
    if(await DM.show({history:false,preserveDetail:true})===false){restoreLocation(previous);return;}
   }else{returnToProducts=false;A.hide();select(target.view);}
   select(target.view);lastLocation=next;
   // Their own handlers restore list/detail scroll after the shared leave guard succeeds.
   replayingPop=true;
   try{window.dispatchEvent(new PopStateEvent('popstate',{state:next.state}));}finally{replayingPop=false;}
  }catch(error){restoreLocation(previous);info(error.message||'화면을 열지 못했습니다.');}
  finally{busy=false;}
 };
 window.AiselUnified={show,get view(){return current;}};
 applyRole();
 const hash=location.hash;
 if(/^#reference=/.test(hash))RC.show({id:decodeURIComponent(hash.slice(11)),history:false});
 else if(hash==='#references')show('references',{history:false});
 else if(/^#design-meeting/.test(hash)){} // DM owns its direct detail route.
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
})();
