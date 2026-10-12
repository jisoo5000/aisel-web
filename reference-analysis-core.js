(function(root){
 'use strict';
 const names={likes:'좋아요',comments:'댓글',saves:'저장',shares:'공유',views:'조회'};
 function result(record){const r=record?.analysis;return record?.analysisState==='done'&&record.analysisReceipt&&record.reviewedAt&&record.analysisSignature&&r?.id===record.id&&r.inputHash===record.analysisSignature&&['content','product'].includes(r.category)?r:null;}
 function title(record){return String(record?.title||result(record)?.title||'사진 레퍼런스');}
 function metrics(record){const r=result(record);return Object.entries(names).map(([key,label])=>{const m=r?.metrics?.[key],valid=m?.confidence==='clear'&&['image','link'].includes(m.source)&&Number.isSafeInteger(m.value)&&m.value>=0;return {key,label,text:valid?((typeof m.raw==='string'&&m.raw?m.raw:m.value.toLocaleString('ko-KR'))):'확인 불가',source:valid?m.source:null};});}
 const api={result,title,metrics};if(typeof module==='object'&&module.exports)module.exports=api;else root.AiselReferenceAnalysis=api;
})(typeof window==='object'?window:globalThis);
