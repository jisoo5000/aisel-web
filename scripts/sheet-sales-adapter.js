(function(root){
  'use strict';
  const text=value=>value==null?'':String(value).trim();
  const headerKey=value=>text(value).replace(/\s+/g,'');
  const returnHeaders=[
    {header:'추정수령기준반품신청률',key:'estimated-receipt-return-request-rate',label:'추정 수령 기준 반품 신청률',shortLabel:'반품 신청%',note:'발송 다음 날 수령을 가정한 반품 신청률입니다. 관찰 기한이 지난 출고분 기준이며, 실제 수령일이나 최종 반품 완료율을 뜻하지 않습니다.'},
    {header:'반품률',key:'legacy-sheet-return-rate',label:'운영시트 반품률',shortLabel:'반품%',note:'운영시트에 표시된 반품률입니다.'}
  ];
  function parse(rows){
    if(!Array.isArray(rows))throw Error('시트 자료 형식을 확인해 주세요.');
    const header=rows.findIndex(row=>{
      if(!Array.isArray(row))return false;
      const keys=row.map(headerKey);
      return keys.includes('상품명')&&keys.includes('판매수량')&&returnHeaders.some(metric=>keys.includes(metric.header));
    });
    if(header<0)throw Error('신상성과 표 머리글을 확인해 주세요.');
    const keys=rows[header].map(headerKey);
    const matches=returnHeaders.filter(metric=>keys.includes(metric.header));
    if(matches.length!==1)throw Error('반품 지표 열을 하나로 확인해 주세요.');
    const metric=matches[0],names=['상품명','디자이너','공장명','판매수량','전체판매비중',metric.header];
    const cols=names.map(name=>{
      if(keys.filter(key=>key===name).length!==1)throw Error('신상성과 필수 열을 확인해 주세요.');
      return keys.indexOf(name);
    });
    const pct=value=>{
      const s=text(value);
      if(!s||s==='—'||s==='-'||/미확인|확인 중/.test(s))return null;
      if(!/^\d+(?:\.\d+)?%$/.test(s))throw Error('비율 표시 형식을 확인해 주세요.');
      const n=Number(s.slice(0,-1));if(n>100)throw Error('비율 범위를 확인해 주세요.');return n;
    };
    const items=[];
    for(let i=header+1;i<rows.length;i++){
      const row=rows[i]||[],name=text(row[cols[0]]);
      if(!name||name==='합계')break;
      const raw=text(row[cols[3]]).replace(/,/g,'');
      const qty=/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):null;
      items.push({name,designer:text(row[cols[1]])||'미확인',factory:text(row[cols[2]])||'미확인',qty,share:pct(row[cols[4]]),returns:pct(row[cols[5]]),index:i});
    }
    if(!items.length)throw Error('신상성과 상품 자료가 없습니다.');
    if(new Set(items.map(item=>item.name)).size!==items.length)throw Error('중복 상품명을 확인해 주세요.');
    const complete=items.every(item=>item.qty!==null);
    items.sort((a,b)=>(b.qty??-1)-(a.qty??-1)||a.index-b.index);
    let rank=0,lastQty=null;
    const period=text(rows[1]?.[0]).match(/\d{4}\.\d{2}\.\d{2}\s*[–—~-]\s*(?:\d{4}\.)?\d{2}\.\d{2}/)?.[0]||'';
    return {schemaVersion:1,source:'operations-sheet',sourceSheetId:2026100512,periodLabel:period,
      returnMetric:{key:metric.key,label:metric.label,shortLabel:metric.shortLabel,note:metric.note},
      items:items.map((item,i)=>{if(item.qty!==lastQty){rank=i+1;lastQty=item.qty;}return {rank:complete?rank:null,name:item.name,designer:item.designer,factory:item.factory,share:item.share,returns:item.returns};})};
  }
  if(typeof module==='object'&&module.exports)module.exports={parse};
  else root.AiselSheetSales={parse};
})(typeof globalThis==='object'?globalThis:this);
