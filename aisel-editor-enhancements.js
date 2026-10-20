(function(root){
 'use strict';const d=root.document,adapter=root.AiselEditorAdapter;if(!adapter)return;
 const original=d.getElementById('designer'),button=d.getElementById('mobileDesignerName'),select=d.createElement('select');select.id='workorderDesignerSelect';select.className='noprint';select.setAttribute('aria-label','담당자');button.after(select);button.hidden=true;
 const manager=d.createElement('div');manager.id='workorderDesignerManager';manager.className='noprint';d.querySelector('#sheet > .title-row').after(manager);
 const notice=d.createElement('span');notice.className='editor-designer-notice noprint';notice.setAttribute('role','status');manager.before(notice);
 const picker=root.AiselDesigners.mountPicker(select,{value:original.value,placeholder:'담당자',managerHost:manager,includeNames:[original.value].filter(Boolean),onChange:name=>{notice.textContent='';adapter.setDesigner(name);},onError:error=>{notice.textContent=error.message;}});
 function syncDesigner(){const name=original.value;picker.refresh({value:name,includeNames:[name].filter(Boolean),disabled:original.disabled||original.readOnly});button.hidden=true;}
 let key=null,finalValue='',pendingFold=false,folded=false,composing=false;
 const records=d.getElementById('mobileSampleRecords'),final=d.getElementById('materials');
 function paint(){
  records.classList.toggle('changes-folded',folded);
  records.querySelectorAll('.changes-toggle').forEach((button,index)=>{
   const text=index?'추가 수정사항':'수정사항';
   let label=button.querySelector('.changes-toggle-label'),icon=button.querySelector('.changes-toggle-icon');
   if(!label||!icon){
    label=d.createElement('span');label.className='changes-toggle-label';
    icon=d.createElementNS('http://www.w3.org/2000/svg','svg');icon.classList.add('changes-toggle-icon');
    icon.setAttribute('viewBox','0 0 14 14');icon.setAttribute('width','14');icon.setAttribute('height','14');
    icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
    const path=d.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','M4.5 3 8.5 7 4.5 11');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');
    path.setAttribute('stroke-width','1.5');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');
    icon.append(path);button.replaceChildren(label,icon);
   }
   if(label.textContent!==text)label.textContent=text;
   button.setAttribute('aria-expanded',String(!folded));
  });
 }
 function foldConfirmed(){
  // A blur cannot acknowledge a failed save or a newer, still-unsaved edit.
  if(pendingFold&&!composing&&d.activeElement!==final&&finalValue&&final.value.trim()===finalValue){
   folded=true;pendingFold=false;paint();
  }
 }
 function refresh(st,code,options={}){
  syncDesigner();
  if(!options.saved&&!options.loaded)return;
  const value=String(st?.materials||'').trim();
  if(key!==code){key=code;finalValue=value;pendingFold=false;folded=!!value;composing=false;paint();return;}
  if(value!==finalValue){
   finalValue=value;pendingFold=!!value;
   if(!value){folded=false;pendingFold=false;}
   foldConfirmed();paint();
  }
 }
 records.addEventListener('click',event=>{if(event.target.closest('.changes-toggle')){folded=!folded;pendingFold=false;paint();}});
 final.addEventListener('blur',foldConfirmed);
 final.addEventListener('input',()=>{if(!final.value.trim()){folded=false;pendingFold=false;paint();}});
 final.addEventListener('compositionstart',()=>{composing=true;});
 final.addEventListener('compositionend',()=>{composing=false;queueMicrotask(foldConfirmed);});
 new MutationObserver(()=>{
  if([...records.querySelectorAll('.changes-toggle')].some((button,index)=>
   button.getAttribute('aria-expanded')!==String(!folded)||!button.querySelector('.changes-toggle-icon')||
   button.querySelector('.changes-toggle-label')?.textContent!==(index?'추가 수정사항':'수정사항')))paint();
 }).observe(records,{childList:true,subtree:true});
 root.AiselEditorEnhancements={refresh,syncDesigner,paintChanges:paint};const current=adapter.state();refresh(current.record,current.code,{loaded:true});paint();root.addEventListener('aisel-session-change',syncDesigner);
})(window);
