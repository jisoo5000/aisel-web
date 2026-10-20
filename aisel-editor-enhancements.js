(function(root){
 'use strict';const d=root.document,adapter=root.AiselEditorAdapter;if(!adapter)return;
 const original=d.getElementById('designer'),button=d.getElementById('mobileDesignerName'),select=d.createElement('select');select.id='workorderDesignerSelect';select.className='noprint';select.setAttribute('aria-label','담당자');button.after(select);button.hidden=true;
 const manager=d.createElement('div');manager.id='workorderDesignerManager';manager.className='noprint';d.querySelector('#sheet > .title-row').after(manager);
 const notice=d.createElement('span');notice.className='editor-designer-notice noprint';notice.setAttribute('role','status');manager.before(notice);
 const picker=root.AiselDesigners.mountPicker(select,{value:original.value,placeholder:'담당자',managerHost:manager,includeNames:[original.value].filter(Boolean),onChange:name=>{notice.textContent='';adapter.setDesigner(name);},onError:error=>{notice.textContent=error.message;}});
 function syncDesigner(){const name=original.value;picker.refresh({value:name,includeNames:[name].filter(Boolean),disabled:original.disabled||original.readOnly});button.hidden=true;}
 let key=null,finalValue='',pendingFold=false,folded=false;
 const records=d.getElementById('mobileSampleRecords'),final=d.getElementById('materials');
 function paint(){records.classList.toggle('changes-folded',folded);records.querySelectorAll('.changes-toggle').forEach((button,index)=>{button.textContent=(index?'추가 수정사항':'수정사항')+' '+(folded?'▸':'▾');button.setAttribute('aria-expanded',String(!folded));});}
 function refresh(st,code,options={}){syncDesigner();const value=String(st?.materials||'').trim();if(key!==code){key=code;finalValue=value;pendingFold=false;folded=!!value;paint();return;}if(options.saved&&value!==finalValue){finalValue=value;pendingFold=!!value;if(!value){folded=false;pendingFold=false;}if(d.activeElement!==final&&pendingFold){folded=true;pendingFold=false;}paint();}}
 records.addEventListener('click',event=>{if(event.target.closest('.changes-toggle')){folded=!folded;pendingFold=false;paint();}});
 final.addEventListener('blur',()=>{if(pendingFold){folded=true;pendingFold=false;paint();}});
 new MutationObserver(()=>{const buttons=records.querySelectorAll('.changes-toggle');if(buttons.length&&buttons[0].getAttribute('aria-expanded')!==String(!folded))paint();}).observe(records,{childList:true,subtree:true});
 root.AiselEditorEnhancements={refresh,syncDesigner};const current=adapter.state();refresh(current.record,current.code,{loaded:true});root.addEventListener('aisel-session-change',syncDesigner);
})(window);
