/* Account-scoped access transport. Backend policy, never display names, grants access. */
(function(root){
 'use strict';
 const endpoint='https://asia-southeast1-aisel-workorder.cloudfunctions.net/accessV233';
 const listeners=new Set(),controllers=new Set();
 let session=null,epoch=0,flight=null,started=false,timer=null,lastError='';
 const auth=()=>root.AiselAuth,user=()=>auth()?.currentUser?.();
 const changed=()=>Object.assign(Error('로그인 계정이 변경되었습니다. 다시 확인해주세요.'),{code:'session_changed'});
 function emit(){for(const fn of listeners)try{fn(session,lastError);}catch(error){console.error(error);}root.dispatchEvent(new CustomEvent('aisel-access-change',{detail:{session,error:lastError}}));}
 function clear(){epoch++;session=null;flight=null;lastError='';for(const controller of controllers)controller.abort();controllers.clear();emit();}
 async function request(action,payload={}){
  const expected=epoch,account=user(),generation=auth()?.generation;
  if(!account?.uid)throw Object.assign(Error('로그인해주세요.'),{code:'unauthenticated'});
  await auth().ready();const token=await account.getIdToken();
  if(expected!==epoch||account.uid!==user()?.uid||generation!==auth()?.generation)throw changed();
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);controllers.add(controller);
  try{
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({...payload,action}),credentials:'omit',cache:'no-store',signal:controller.signal});
   const result=await response.json();
   if(expected!==epoch||account.uid!==user()?.uid||generation!==auth()?.generation)throw changed();
   if(!response.ok||result.ok!==true){
    const code=result.code||result.error||'access_failed';
    const messages={permission_denied:'이 계정으로 사용할 수 없는 자료입니다.',unauthenticated:'로그인 후 다시 확인해주세요.',protection_not_active:'접근 제한 준비를 먼저 완료해주세요. 계정은 아직 중지되지 않았습니다.',email_already_exists:'이미 등록된 이메일입니다. 기존 계정 연결을 이용해주세요.',invalid_staff:'이름·이메일·12자 이상의 초기 비밀번호를 확인해주세요.',revision_conflict:'다른 곳에서 변경된 정보입니다. 목록을 다시 열어 확인해주세요.',assignment_conflict:'담당자가 변경된 자료입니다. 대상을 다시 확인해주세요.',unknown_member:'기존 앱에 등록된 직원 이메일을 확인해주세요.',workorder_exists:'이미 사용 중인 품번입니다. 새 품번을 선택해주세요.',sales_source_not_ready:'판매성과 연결을 준비 중입니다. 잠시 후 다시 확인해주세요.'};
    throw Object.assign(Error(messages[code]||result.message||'계정 권한을 확인하지 못했습니다. 다시 시도해주세요.'),{code});
   }
   return result;
  }finally{clearTimeout(timeout);controllers.delete(controller);}
 }
 function refresh(){
  if(flight)return flight;
  if(!user()){if(session)clear();return Promise.resolve(null);}
  const expected=epoch;
  const next=request('session').then(value=>{if(expected!==epoch)throw changed();const signature=JSON.stringify(value);lastError='';if(JSON.stringify(session)!==signature){session=value;emit();}return session;}).catch(error=>{if(expected===epoch){session=null;lastError=error.message;emit();}throw error;}).finally(()=>{if(flight===next)flight=null;});
  flight=next;return next;
 }
 function subscribe(fn){listeners.add(fn);fn(session,lastError);return ()=>listeners.delete(fn);}
 function allowed(view){if(!session?.active)return false;return session.permissions?.views?.includes(view==='editor'?'orders':view)===true;}
 // A legacy listener is attached only after a server-verified session. Once
 // protection is enabled, freelancers receive records through scoped APIs.
 function watchLegacy(ref,event,callback,error){
  let attached=false,boundUid='',handler=null;
  return subscribe(value=>{
   const allow=!!value?.active&&!value.permissions?.ownOnly,uid=value?.uid||'';
   if(allow===attached&&(!allow||uid===boundUid))return;
   if(attached&&handler)ref.off(event,handler);attached=allow;boundUid=uid;
   if(!allow){handler=null;return;}
   const expected=epoch;
   handler=snapshot=>{if(attached&&expected===epoch&&session?.uid===uid&&!session.permissions?.ownOnly)callback(snapshot);};
   ref.on(event,handler,error||(()=>{}));
  });
 }
 // Display projection only: legacy designer remains the original document field.
 function projectWorkorders(items,assignments={}){
  return Object.fromEntries(Object.entries(items||{}).map(([code,item])=>{
   const projected={...item};
   if(Object.prototype.hasOwnProperty.call(assignments,code))projected.currentAssigneeName=String(assignments[code]?.assigneeName||'').trim();
   return [code,projected];
  }));
 }
 function start(){if(started||!auth())return;started=true;
  auth().subscribe(()=>{clear();refresh().catch(()=>{});});
  auth().initialized.then(()=>refresh()).catch(()=>{});
  timer=setInterval(()=>{if(!document.hidden)refresh().catch(()=>{});},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh().catch(()=>{});});
 }
 root.AiselAccess={request,refresh,subscribe,allowed,watchLegacy,projectWorkorders,start,get session(){return session;},get generation(){return epoch;},get ownOnly(){return !!session?.permissions?.ownOnly;},get isOwner(){return session?.role==='owner'&&session.active===true;}};
 root.addEventListener('aisel-session-ready',start);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
