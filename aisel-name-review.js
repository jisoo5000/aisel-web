/* Product names: provisional until the owner explicitly confirms this exact name. */
(function(root){
'use strict';
const clean=v=>String(v??'').trim();
const clone=v=>JSON.parse(JSON.stringify(v));
function state(doc={}) {
 const stored=doc.nameReview||{};
 return {version:1,revision:Number(stored.revision)||0,currentName:clean(doc.pumMyeong),
  confirmedName:clean(stored.confirmedName),requestedName:clean(stored.requestedName),
  history:clone(stored.history||{})};
}
function final(doc){const r=state(doc);return !!r.currentName&&r.confirmedName===r.currentName;}
function sameVersion(a,b){return clean(a?.pumMyeong)===clean(b?.pumMyeong)&&JSON.stringify(a?.nameReview||null)===JSON.stringify(b?.nameReview||null);}
function change(doc,action,value,actor,at=Date.now()){
 if(!actor?.uid)throw Error('로그인 후 이름을 변경해주세요.');
 const r=state(doc),before=r.currentName,name=clean(value),owner=actor.isOwner===true;
 let kind=action;
 if(['confirm','unconfirm','accept','keep'].includes(action)&&!owner)throw Error('최종 이름 확정은 대표님만 할 수 있습니다.');
 if(action==='edit'||action==='restore'){
  if(!name)throw Error('상품명을 입력해주세요.');
  if(name.length>180)throw Error('상품명은 180자 이내로 입력해주세요.');
  if(final(doc)&&!owner){
   if(name===before){if(!r.requestedName)return null;r.requestedName='';kind='cancel-request';}
   else{if(name===r.requestedName)return null;r.requestedName=name;kind='request';}
  }else{
   if(name===before)return null;
   r.currentName=name;r.confirmedName='';r.requestedName='';
  }
 }else if(action==='confirm'){
  if(!before)throw Error('상품명을 먼저 입력해주세요.');
  if(r.requestedName)throw Error('이름 변경 요청을 먼저 확인해주세요.');
  if(final(doc))return null;
  r.confirmedName=before;
 }else if(action==='unconfirm'){
  if(!r.confirmedName)return null;r.confirmedName='';
 }else if(action==='accept'){
  if(!r.requestedName)throw Error('변경 요청이 없습니다.');
  r.currentName=r.requestedName;r.confirmedName=r.currentName;r.requestedName='';
 }else if(action==='keep'){
  if(!r.requestedName)return null;r.requestedName='';
 }else throw Error('알 수 없는 이름 변경입니다.');
 if(!Object.keys(r.history).length&&before)r.history.r0={name:before,kind:'initial',at:0,by:'기존 이름',uid:''};
 r.revision++;
 r.history['r'+r.revision]={name:r.currentName,from:before,proposed:kind==='request'?r.requestedName:'',kind,at,by:clean(actor.name)||'담당자',uid:actor.uid};
 return {pumMyeong:r.currentName,pumAuto:'0',nameReview:r};
}
function aliases(doc){const r=state(doc);return [...new Set(Object.values(r.history).flatMap(x=>[x.name,x.from]).map(clean).filter(Boolean))].join(' ');}
function canOrder(doc,target){
 if(!['order','initialOrder'].includes(target))return true;
 if(['order','pdp','sale'].includes(doc?.status)||doc?.initialOrder)return true;
 return final(doc);
}
function mount({document,container,getDoc,getActor,act}){
 let signature='',busy=false,message='';
 const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 async function run(action,value){if(busy)return;busy=true;message='저장 중…';render(true);
  try{await act(action,value);message='저장됨';}catch(e){message=e.message||'저장하지 못했습니다. 다시 확인해주세요.';}
  finally{busy=false;render(true);}
 }
 function render(force=false){
  const doc=getDoc()||{},actor=getActor()||{},r=state(doc),locked=final(doc);
  const sig=JSON.stringify([doc.pumMyeong,doc.nameReview,actor.isOwner,actor.uid,busy,message]);
  if(!force&&sig===signature)return;signature=sig;
  const detailsOpen=container.querySelector('details')?.open||false;
  container.replaceChildren();container.hidden=!doc.pumMyeong;
  if(container.hidden)return;
  const row=el('div',undefined,'name-review-row');
  row.append(el('span',locked?'최종 확정':'미확정','name-review-state'));
  if(!locked&&r.revision)row.append(el('span','이름 변경됨','name-review-muted'));
  if(actor.isOwner){
   const label=el('label',undefined,'name-final-label'),check=el('input');
   check.type='checkbox';check.checked=locked;check.disabled=busy;check.setAttribute('aria-label','최종 이름 확정');
   check.addEventListener('change',()=>run(check.checked?'confirm':'unconfirm'));
   label.append(check,document.createTextNode('최종 이름 확정'));row.append(label);
  }
  container.append(row);
  const help=locked?'이름을 바꾸면 대표님이 다시 확인합니다.':'대표님이 최종 확정하기 전까지 미확정입니다.';
  container.append(el('p',help,'name-review-muted'));
  if(r.requestedName){
   const box=el('div',undefined,'name-request');
   box.append(el('strong','이름 변경 요청'),el('div',r.currentName+' → '+r.requestedName));
   if(actor.isOwner){for(const [action,title]of [['accept','이 이름으로 확정'],['keep','기존 이름 유지']]){const b=el('button',title);b.type='button';b.disabled=busy;b.addEventListener('click',()=>run(action));box.append(b);}}
   else box.append(el('p','대표님 확인 전까지 확정된 이름을 유지합니다.'));
   container.append(box);
  }
  const history=Object.values(r.history).sort((a,b)=>(b.at||0)-(a.at||0));
  if(history.length){
   const details=el('details');details.open=detailsOpen;details.append(el('summary','이름 변경 이력'));
   const labels={initial:'기존 이름',edit:'이름 변경',restore:'이전 이름으로',confirm:'최종 확정',unconfirm:'확정 해제',request:'변경 요청',accept:'요청 이름 확정',keep:'기존 이름 유지','cancel-request':'요청 취소'};
   for(const entry of history){
    const item=el('div',undefined,'name-history-item'),text=entry.kind==='request'?entry.from+' → '+entry.proposed:entry.name;
    item.append(el('div',text),el('small',[labels[entry.kind]||entry.kind,entry.by,entry.at?new Date(entry.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):''].filter(Boolean).join(' · ')));
    const name=entry.kind==='request'?entry.proposed:entry.name;
    if(name&&name!==r.currentName){const b=el('button',locked&&!actor.isOwner?'이 이름으로 요청':'이 이름으로 되돌리기');b.type='button';b.disabled=busy;b.addEventListener('click',()=>run('restore',name));item.append(b);}
    details.append(item);
   }
   container.append(details);
  }
  if(message){const p=el('p',message,'name-review-message');p.setAttribute('role','status');container.append(p);}
 }
 return {render,clearMessage(){message='';render();}};
}
const api={state,final,sameVersion,change,aliases,canOrder,mount};
if(typeof module==='object'&&module.exports)module.exports=api;
root.AiselNames=api;
})(typeof window==='object'?window:globalThis);
