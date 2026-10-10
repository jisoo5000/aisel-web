(function(root){
  'use strict';
  const material=['title','link','memo','development'];
  const states={idle:'미요청',queued:'검토 대기',running:'검토 중',done:'결과 있음',blocked:'확인 필요',error:'재시도 필요',stale:'재검토 필요'};
  function httpUrl(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch(e){return '';}}
  function photos(c){return Array.isArray(c.photos)?c.photos:(c.photo?[{original:c.photo,thumb:c.photo,legacy:true}]:[]);}
  function replacePhoto(c,key,next,now=Date.now()){
    const list=photos(c),index=list.findIndex(p=>(p.hash||p.original)===key);
    if(index<0){if(list.some(p=>(p.hash||p.original)===(next.hash||next.original))&&(c.photoHistory||[]).some(p=>(p.hash||p.original)===key))return c;throw Error('다른 기기에서 사진이 변경됐습니다. 현재 사진을 다시 선택해주세요.');}
    const old=list[index];if((old.hash||old.original)===(next.hash||next.original))return c;
    const changed=list.map((p,i)=>i===index?next:p).filter((p,i,a)=>a.findIndex(x=>(x.hash||x.original)===(p.hash||p.original))===i);
    const history=[...(c.photoHistory||[])];if(!history.some(p=>(p.hash||p.original)===key))history.push({...old,replacedAt:now});
    return edit(c,{photos:changed,photo:changed[0]?.original||'',photoHistory:history},now);
  }
  function signature(c){return JSON.stringify({fields:material.map(k=>String(c[k]||'')),links:Array.isArray(c.links)?c.links:[],photos:photos(c).map(p=>p.hash||p.original).sort()});}
  function evidence(result){try{const value=typeof result?.evidence==='string'?JSON.parse(result.evidence):result?.evidence;return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch(e){return {};}}
  function reviewSummary(result){
    const basis=evidence(result).judgmentBasis||{};
    const old=String(result?.reason||'');
    const labelled=label=>{const match=old.match(new RegExp('(?:^|\\n)'+label+'\\s*[:：]\\s*([^\\n]+)'));return match?match[1].trim():'';};
    const line=value=>typeof value==='string'?value.trim().split(/\r?\n/)[0]:'';
    return {demand:line(basis.demand)||labelled('수요')||'미확인',supply:line(basis.supply)||labelled('공급')||'미확인',differentiation:line(basis.differentiation)||labelled('차별성')||'미정',additional:line(result?.unknowns)};
  }
  function dateLabel(value){if(!value)return '';const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'2-digit',month:'2-digit',day:'2-digit'}).format(d).replace(/\s/g,'').replace(/\.$/,'');}
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
  const api={material,states,httpUrl,photos,signature,edit,status,rowKey,evidence,reviewSummary,dateLabel,replacePhoto};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AiselDesignMeetingCore=api;
})(typeof window==='object'?window:globalThis);
