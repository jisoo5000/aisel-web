(function(root){
  'use strict';
  const material=['title','link','memo','development'];
  const states={idle:'미요청',queued:'검토 대기',running:'검토 중',done:'결과 있음',blocked:'확인 필요',error:'재시도 필요',stale:'재검토 필요'};
  function httpUrl(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch(e){return '';}}
  function photos(c){return Array.isArray(c.photos)?c.photos:(c.photo?[{original:c.photo,thumb:c.photo,legacy:true}]:[]);}
  function signature(c){return JSON.stringify({fields:material.map(k=>String(c[k]||'')),photos:photos(c).map(p=>p.hash||p.original).sort()});}
  function edit(c,patch,now=Date.now()){
    const next={...c,...patch,updatedAt:now};
    if(signature(c)!==signature(next)){next.inputVersion=(Number(c.inputVersion)||1)+1;next.reviewState=c.reviewRequestedVersion?'stale':'idle';}
    return next;
  }
  function status(c,rows){
    const version=Number(c.inputVersion)||1;
    const row=(rows||[]).find(r=>r.id===c.id&&Number(r.version)===version);
    if(row?.state==='done'&&row.receipt&&row.reviewedAt)return 'done';
    if(row&&['running','queued','blocked','error'].includes(row.state))return row.state;
    if(c.reviewRequestedVersion&&Number(c.reviewRequestedVersion)!==version)return 'stale';
    return c.reviewState||'idle';
  }
  function rowKey(id,version){if(!/^[-\w]{8,100}$/.test(id)||!Number.isInteger(Number(version))||Number(version)<1)throw Error('후보 연결 정보를 확인해주세요.');return id+':'+version;}
  const api={material,states,httpUrl,photos,signature,edit,status,rowKey};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AiselDesignMeetingCore=api;
})(typeof window==='object'?window:globalThis);
