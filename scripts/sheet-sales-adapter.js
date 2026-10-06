(function(root){
  'use strict';
  function parse(rows){
    if(!Array.isArray(rows))throw Error('시트 자료 형식을 확인해 주세요.');
    const header=rows.findIndex(r=>Array.isArray(r)&&r.includes('상품명')&&r.includes('판매수량')&&r.includes('반품률'));
    if(header<0)throw Error('신상성과 표 머리글을 확인해 주세요.');
    const names=['상품명','디자이너','공장명','판매수량','전체 판매비중','반품률'];
    const cols=names.map(n=>rows[header].indexOf(n));
    if(cols.some(n=>n<0))throw Error('신상성과 필수 열이 없습니다.');
    const text=v=>v==null?'':String(v).trim();
    const pct=v=>{const s=text(v);if(!s||s==='—'||s==='-'||/미확인|확인 중/.test(s))return null;if(!/^\d+(?:\.\d+)?%$/.test(s))throw Error('비율 표시 형식을 확인해 주세요.');const n=Number(s.slice(0,-1));if(n>100)throw Error('비율 범위를 확인해 주세요.');return n;};
    const items=[];
    for(let i=header+1;i<rows.length;i++){
      const r=rows[i]||[],name=text(r[cols[0]]);
      if(!name||name==='합계')break;
      const raw=text(r[cols[3]]).replace(/,/g,'');
      const qty=/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):null;
      items.push({name,designer:text(r[cols[1]])||'미확인',factory:text(r[cols[2]])||'미확인',qty,share:pct(r[cols[4]]),returns:pct(r[cols[5]]),index:i});
    }
    if(!items.length)throw Error('신상성과 상품 자료가 없습니다.');
    if(new Set(items.map(x=>x.name)).size!==items.length)throw Error('중복 상품명을 확인해 주세요.');
    const complete=items.every(x=>x.qty!==null);
    items.sort((a,b)=>(b.qty??-1)-(a.qty??-1)||a.index-b.index);
    let rank=0,lastQty=null;
    const period=text(rows[1]?.[0]).match(/\d{4}\.\d{2}\.\d{2}\s*[–—~-]\s*(?:\d{4}\.)?\d{2}\.\d{2}/)?.[0]||'';
    return {schemaVersion:1,source:'operations-sheet',sourceSheetId:2026100512,periodLabel:period,items:items.map((x,i)=>{if(x.qty!==lastQty){rank=i+1;lastQty=x.qty;}return {rank:complete?rank:null,name:x.name,designer:x.designer,factory:x.factory,share:x.share,returns:x.returns};})};
  }
  if(typeof module==='object'&&module.exports)module.exports={parse};
  else root.AiselSheetSales={parse};
})(typeof globalThis==='object'?globalThis:this);
