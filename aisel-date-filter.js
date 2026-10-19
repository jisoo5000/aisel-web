/* Shared calendar fields: the whole editable input opens the native picker. */
(function(){
  'use strict';
  function openPicker(input,event){
    if(!input||input.disabled||input.readOnly||input.type!=='date')return false;
    input.focus({preventScroll:true});
    if(typeof input.showPicker!=='function')return false;
    try{input.showPicker();event?.preventDefault();return true;}catch(_){return false;}
  }
  document.addEventListener('click',event=>{
    const target=event.target,input=target?.closest?.('input[type="date"]')||target?.closest?.('label')?.querySelector('input[type="date"]');
    if(input&&!event.defaultPrevented)openPicker(input,event);
  });
  document.addEventListener('keydown',event=>{
    if((event.key==='Enter'||event.key===' ')&&event.target?.matches?.('input[type="date"]'))openPicker(event.target,event);
  });
  function mount(host,{inputId,labelId,label='날짜 필터',format=value=>value,onChange=()=>{}}={}){
    const button=document.createElement('button'),text=document.createElement('span'),panel=document.createElement('div'),input=document.createElement('input');
    host.classList.add('aisel-list-date');
    button.type='button';button.className='aisel-list-date-toggle';button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
    text.id=labelId;text.textContent='날짜 전체';button.append(text);
    panel.id=inputId+'Options';panel.className='aisel-list-date-options';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','날짜 선택');button.setAttribute('aria-controls',panel.id);
    input.id=inputId;input.type='date';input.setAttribute('aria-label',label);input.title='날짜 선택 · 날짜를 지우면 전체 날짜';
    panel.append(input);host.replaceChildren(button,panel);
    function setValue(value,display){input.value=/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value:'';text.textContent=display||(input.value?format(input.value):'날짜 전체');}
    function close(focus=false){panel.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus({preventScroll:true});}
    button.onclick=()=>{if(!panel.hidden){close();return;}panel.hidden=false;button.setAttribute('aria-expanded','true');input.focus({preventScroll:true});};
    input.onchange=()=>{const value=input.value;setValue(value);close(true);onChange(value);};
    // Keep the native picker's Clear / keyboard deletion as the reset operation.
    // There is no second 'all dates' button inside the date popup.
    function outside(event){if(!host.contains(event.target))close();}
    function escape(event){if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation();close(true);}}
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);host.addEventListener('keydown',escape);
    return {input,setValue,close,destroy(){document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);host.removeEventListener('keydown',escape);host.replaceChildren();}};
  }
  window.AiselDateFilter={mount,openPicker};
})();
