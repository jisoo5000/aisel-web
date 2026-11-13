/* A single shared popup keeps choices centered on Windows, macOS and phones.
   The original select remains the form control and owns every value/event. */
(function () {
 'use strict';
 if(window.AiselSelect)return;
 let current=null,menu=null,entries=[],active=-1,observer=null,treeObserver=null,restore=null;
 let typed='',typedAt=0,lastPointer=null,lastPointerAt=0;
 const supported=node=>node instanceof HTMLSelectElement&&!node.multiple&&node.size<=1&&!node.matches(':disabled');
 const unavailable=option=>option.disabled||option.parentElement?.disabled;
 const visible=option=>!option.hidden&&!option.parentElement?.hidden;
 function close(){
  if(!current)return;
  observer?.disconnect();observer=null;treeObserver?.disconnect();treeObserver=null;
  if(menu.hasAttribute('popover')&&menu.matches(':popover-open'))menu.hidePopover();
  menu.hidden=true;
  for(const [name,value]of Object.entries(restore)){
   if(value===null)current.removeAttribute(name);else current.setAttribute(name,value);
  }
  current=null;entries=[];active=-1;typed='';
 }
 function highlight(index,scroll=true){
  active=index;
  for(const item of entries)item.node.toggleAttribute('data-active',item.index===index);
  const item=entries.find(item=>item.index===index);
  if(item){current.setAttribute('aria-activedescendant',item.node.id);if(scroll)item.node.scrollIntoView({block:'nearest'});}
  else current.removeAttribute('aria-activedescendant');
 }
 function position(){
  if(!current)return;
  const r=current.getBoundingClientRect(),viewport=window.visualViewport;
  const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
  if(!current.isConnected||!supported(current)||r.width===0||r.height===0||r.bottom<top||r.top>top+height){close();return;}
  const roomBelow=top+height-r.bottom-8,roomAbove=r.top-top-8;
  const above=roomBelow<Math.min(menu.scrollHeight,240)&&roomAbove>roomBelow;
  menu.style.maxWidth=Math.max(0,width-16)+'px';
  menu.style.minWidth=Math.min(r.width,Math.max(0,width-16))+'px';
  menu.style.maxHeight=Math.max(0,Math.min(320,above?roomAbove:roomBelow))+'px';
  const box=menu.getBoundingClientRect();
  menu.style.left=Math.max(left+8,Math.min(r.left+(r.width-box.width)/2,left+width-box.width-8))+'px';
  menu.style.top=Math.max(top+8,above?r.top-box.height:r.bottom)+'px';
 }
 function render(){
  if(!current)return;
  const previous=active;entries=[];menu.replaceChildren();
  let group=null;
  for(const option of current.options){
   if(!visible(option))continue;
   if(option.parentElement.tagName==='OPTGROUP'&&group!==option.parentElement){
    group=option.parentElement;
    const heading=document.createElement('div');heading.className='aisel-select-group';heading.textContent=group.label;heading.setAttribute('role','presentation');menu.append(heading);
   }
   const node=document.createElement('div');node.className='aisel-select-option';node.id='aiselSelectOption-'+option.index;
   node.setAttribute('role','option');node.setAttribute('aria-selected',String(option.selected));node.setAttribute('aria-disabled',String(!!unavailable(option)));
   node.dataset.index=String(option.index);node.textContent=option.label;
   menu.append(node);entries.push({index:option.index,node,option});
  }
  const chosen=entries.find(item=>item.index===previous&&!unavailable(item.option))||entries.find(item=>item.option.selected&&!unavailable(item.option))||entries.find(item=>!unavailable(item.option));
  position();if(current)highlight(chosen?.index??-1);
 }
 function open(select){
  if(!supported(select))return;
  if(current===select){close();return;}
  close();
  if(!menu){
   menu=document.createElement('div');menu.id='aiselSelectMenu';menu.hidden=true;menu.setAttribute('role','listbox');
   if(typeof menu.showPopover==='function')menu.setAttribute('popover','manual');
   document.body.append(menu);
   menu.addEventListener('click',event=>{
    const node=event.target.closest('[role="option"]');if(node)choose(Number(node.dataset.index));
   });
   menu.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse'||!current)return;
    const node=event.target.closest('[role="option"]'),item=entries.find(item=>item.node===node);
    if(item&&!unavailable(item.option))highlight(item.index,false);
   });
   menu.addEventListener('mousedown',event=>event.preventDefault());
  }
  // A menu outside a modal dialog would be inert, even in the top layer.
  (select.closest('dialog')||document.body).append(menu);
  select.focus({preventScroll:true});current=select;
  restore=Object.fromEntries(['aria-controls','aria-expanded','aria-activedescendant'].map(name=>[name,select.getAttribute(name)]));
  select.setAttribute('aria-controls',menu.id);select.setAttribute('aria-expanded','true');
  const label=select.getAttribute('aria-label')||[...(select.labels||[])].map(node=>node.textContent.trim()).join(' ')||select.title||'선택';
  menu.setAttribute('aria-label',label);
  const labelledBy=select.getAttribute('aria-labelledby');if(labelledBy)menu.setAttribute('aria-labelledby',labelledBy);else menu.removeAttribute('aria-labelledby');
  const style=getComputedStyle(select);
  for(const name of ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing'])menu.style[name]=style[name];
  menu.hidden=false;if(menu.hasAttribute('popover'))menu.showPopover();
  render();
  if(!current)return;
  observer=new MutationObserver(()=>{if(!supported(select)||!select.isConnected){close();return;}render();});
  observer.observe(select,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','label','selected','value','multiple','size']});
  treeObserver=new MutationObserver(()=>{if(!select.isConnected||!supported(select)||!select.getClientRects().length)close();});
  treeObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','hidden','class','style']});
 }
 function choose(index){
  const select=current,option=select?.options[index];
  if(!select||!supported(select)||!option||unavailable(option)||!visible(option))return;
  const changed=select.selectedIndex!==index;
  close();
  if(changed){select.selectedIndex=index;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
 }
 document.addEventListener('pointerdown',event=>{
  if(supported(event.target)&&event.button===0){
   event.preventDefault();lastPointer=event.target;lastPointerAt=performance.now();open(event.target);
  }else if(current&&!menu.contains(event.target))close();
 },true);
 document.addEventListener('click',event=>{
  if(!supported(event.target))return;
  event.preventDefault();
  if(event.target!==lastPointer||performance.now()-lastPointerAt>800)open(event.target);
 },true);
 document.addEventListener('keydown',event=>{
  if(!supported(event.target)||event.isComposing)return;
  const key=event.key,printable=key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey;
  if(!current){
   if(!['ArrowDown','ArrowUp','Enter',' '].includes(key)&&!printable)return;
   event.preventDefault();event.stopPropagation();open(event.target);
   if(!printable||key===' ')return;
  }
  if(current!==event.target)return;
  if(key==='Tab'){close();return;}
  if(key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(key==='Enter'||key===' '&&!typed){event.preventDefault();event.stopPropagation();choose(active);return;}
  const enabled=entries.filter(item=>!unavailable(item.option));
  if(['ArrowDown','ArrowUp','Home','End','PageDown','PageUp'].includes(key)){
   event.preventDefault();event.stopPropagation();typed='';
   const index=enabled.findIndex(item=>item.index===active),delta=key==='PageDown'?5:key==='PageUp'?-5:key==='ArrowDown'?1:-1;
   const next=key==='Home'?0:key==='End'?enabled.length-1:Math.max(0,Math.min(enabled.length-1,index+delta));
   if(enabled[next])highlight(enabled[next].index);return;
  }
  if(printable){
   event.preventDefault();event.stopPropagation();
   const now=performance.now();typed=now-typedAt<700?typed+key:key;typedAt=now;
   const query=/^(.)\1+$/u.test(typed)?key:typed,index=enabled.findIndex(item=>item.index===active);
   const ordered=query.length===1?[...enabled.slice(index+1),...enabled.slice(0,index+1)]:enabled;
   const found=ordered.find(item=>item.option.label.trim().toLocaleLowerCase().startsWith(query.toLocaleLowerCase()));
   if(found)highlight(found.index);
  }
 },true);
 document.addEventListener('focusin',event=>{if(current&&event.target!==current&&!menu.contains(event.target))close();});
 document.addEventListener('scroll',event=>{if(current&&event.target!==menu&&!menu.contains(event.target))close();},true);
 document.addEventListener('change',event=>{if(event.target===current){active=current.selectedIndex;render();}},true);
 document.addEventListener('reset',close,true);
 window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);
 window.addEventListener('pagehide',close);window.addEventListener('beforeprint',close);
 window.matchMedia('print').addEventListener('change',event=>{if(event.matches)close();});
 window.AiselSelect=Object.freeze({close});
})();
