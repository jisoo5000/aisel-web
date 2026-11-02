/* Sales availability is an explicit workorder classification, separate from production. */
(function(root){
 'use strict';
 const values=['','selling','not_selling'],reasons=['','prelaunch','paused','ended'];
 const filters=['active','all','selling','not_selling','unknown','ended'];
 function state(st={}){const availability=values.includes(st.salesAvailability)?st.salesAvailability:'';return {availability,reason:availability==='not_selling'&&reasons.includes(st.salesUnavailableReason)?st.salesUnavailableReason:''};}
 function filter(value){return filters.includes(value)?value:'active';}
 function matches(st,value){const s=state(st);switch(filter(value)){case'all':return true;case'selling':return s.availability==='selling';case'not_selling':return s.availability==='not_selling';case'unknown':return !s.availability;case'ended':return s.availability==='not_selling'&&s.reason==='ended';default:return !(s.availability==='not_selling'&&s.reason==='ended');}}
 function label(st){const s=state(st);if(!s.availability)return '판매 여부 미확인';if(s.availability==='selling')return '판매중';const reason={prelaunch:'출시 전',paused:'일시 중지',ended:'판매 종료'}[s.reason];return '판매 안 함'+(reason?' · '+reason:'');}
 function refresh(document){const choice=document.getElementById('salesAvailability'),reason=document.getElementById('salesUnavailableReason'),box=document.getElementById('salesUnavailableReasonField');if(!choice||!reason||!box)return;box.hidden=choice.value!=='not_selling';reason.disabled=box.hidden;}
 function mount(document){const choice=document.getElementById('salesAvailability');if(!choice||choice.dataset.mounted)return;choice.dataset.mounted='true';choice.addEventListener('change',()=>{if(choice.value!=='not_selling')document.getElementById('salesUnavailableReason').value='';refresh(document);});refresh(document);}
 const api={state,filter,matches,label,refresh,mount};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.AiselSalesAvailability=api;
})(typeof window==='object'?window:globalThis);
