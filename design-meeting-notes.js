(function(root){
  'use strict';
  // Reference notes are meeting metadata. They never change review inputs,
  // inputVersion, a verified review receipt, or existing workorder fields.
  const fields=['date','text','categoryId'];
  const categoryId=note=>String(note?.categoryId||'');
  function value(note){return note?{date:String(note.date||''),text:String(note.text||''),categoryId:categoryId(note)}:null;}
  function same(a,b){return JSON.stringify(value(a))===JSON.stringify(value(b));}
  function validDate(date){const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);if(!match)return false;const d=new Date(date+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date;}
  function notes(candidate){const raw=candidate?.referenceNotes;if(raw==null)return {};if(typeof raw!=='object'||Array.isArray(raw))throw Error('참고 저장 형식을 확인해주세요. 입력한 내용은 유지했습니다.');return raw;}
  function conflict(){return Object.assign(Error('다른 기기에서 같은 참고를 수정했습니다. 입력은 유지했습니다. 최신 내용을 확인해주세요.'),{code:'note_conflict'});}
  function apply(candidate,changes,now=Date.now()){
    if(!candidate||candidate.designMeeting!==true||candidate.designMeetingDeletedAt)throw Error('삭제되었거나 찾을 수 없는 디자인회의입니다. 입력한 참고는 유지했습니다.');
    const next={...notes(candidate)};
    for(const change of changes){
      if(!/^note_[a-zA-Z0-9_-]{8,100}$/.test(change.id))throw Error('참고 연결 정보를 확인해주세요.');
      const remote=next[change.id]||null,base=change.base||null,target=change.next||null;
      if(target===null){if(!same(remote,base)&&remote!==null)throw conflict();delete next[change.id];continue;}
      if(!validDate(String(target.date||'')))throw Error('참고 날짜를 확인해주세요.');
      if(typeof target.text!=='string'||target.text.length>20000)throw Error('참고는 20,000자 이내로 입력해주세요.');
      if(Object.prototype.hasOwnProperty.call(target,'categoryId')&&target.categoryId!==''&&!/^cat_[a-f0-9]{64}$/.test(target.categoryId))throw Error('참고 분류를 확인해주세요. 입력한 내용은 유지했습니다.');
      if(!remote&&base)throw conflict();
      if(remote&&!base&&!same(remote,target))throw conflict();
      const merged={...(remote||{}),createdAt:remote?.createdAt||target.createdAt||now};
      for(const key of fields){
        // An older editor omits categoryId. That omission is not a request to
        // clear a classification another editor saved. Explicit '' clears it.
        if(key==='categoryId'&&!Object.prototype.hasOwnProperty.call(target,key))continue;
        const read=note=>key==='categoryId'?categoryId(note):note?.[key];
        if(!base||read(target)!==read(base)){
          if(base&&read(remote)!==read(base)&&read(remote)!==read(target))throw conflict();
          merged[key]=read(target);
        }
      }
      next[change.id]={...merged,updatedAt:now};
    }
    if(Object.keys(next).length>100)throw Error('참고는 후보별로 최대 100개까지 저장할 수 있습니다.');
    return {...candidate,referenceNotes:next,updatedAt:now};
  }
  function today(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
  const api={value,same,validDate,notes,apply,today};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AiselDesignMeetingNotes=api;
})(typeof window==='object'?window:globalThis);
