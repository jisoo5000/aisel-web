/* Native Firebase auxiliary actions. Never falls back to Apps Script. */
(function(){
 'use strict';
 const ENDPOINT='https://asia-southeast1-aisel-workorder.cloudfunctions.net/collectionsV214';
 async function request(action,ids=[],extra={}){
  const user=window.AiselAuth?.currentUser?.(),generation=window.AiselAuth?.generation;
  const check=()=>{if(!user?.uid||!user.emailVerified||window.AiselAuth?.currentUser?.()?.uid!==user.uid||window.AiselAuth.generation!==generation)throw Object.assign(Error('로그인 상태를 확인해주세요.'),{code:'auth_changed'});};
  check();const token=await user.getIdToken();check();
  const response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'nativeBridge',request:{...extra,action,ids}}),signal:AbortSignal.timeout(20000),cache:'no-store',credentials:'omit'});
  check();let data;try{data=await response.json();}catch{throw Object.assign(Error('서버 연결을 확인하지 못했습니다. 입력은 기기에 보관됩니다.'),{code:'network'});}
  if(!response.ok||data.ok===false){const code=data.error||data.code||'network';throw Object.assign(Error(code==='permission_denied'?'이 계정의 자료 접근 권한을 확인해주세요.':'요청을 완료하지 못했습니다. 저장된 자료는 유지됩니다.'),{code});}
  return data;
 }
 window.AiselNativeBridge=Object.freeze({version:217,request});
})();
