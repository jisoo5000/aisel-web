(function(root){
 'use strict';
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 function keywords(raw){try{const list=typeof raw==='string'?JSON.parse(raw||'[]'):raw;return Array.isArray(list)&&list.length<=5&&list.every(v=>typeof v==='string')?list:[];}catch(_){return [];}}
 function planning(candidate,id){return {schemaVersion:2,source:'human',marketDemand:candidate.marketDemand||'',substituteSupply:candidate.substituteSupply||'',uspValue:candidate.uspValue||'',uspKeywordsJson:candidate.uspKeywordsJson||'[]',engagementLevel:candidate.engagementLevel||'',candidateId:id||candidate.id||'',sourceInputVersion:candidate.inputVersion||0,sourceUpdatedAt:candidate.updatedAt||0,recordedAt:Date.now()};}
 function signature(name,plan){return JSON.stringify([String(name||''),keywords(plan?.uspKeywordsJson),String(plan?.uspValue||'')]);}
 function refreshed(previous,candidate,id,name,output){
  if(previous?.candidateId&&previous.candidateId!==id)throw Error('연결된 디자인회의가 다릅니다.');
  if((candidate.inputVersion||0)<(previous?.sourceInputVersion||0))throw Error('이전 버전으로 갱신할 수 없습니다.');
  if((candidate.updatedAt||0)<(previous?.sourceUpdatedAt||0))throw Error('이전 USP 내용으로 갱신할 수 없습니다.');
  const next={...clone(previous||{}),...planning(candidate,id)};
  if(String(output||'').trim()&&signature(name,previous)!==signature(name,next))next.descriptionNeedsReview=true;
  return next;
 }
 // Stable inline inputs keep Korean composition and focus intact during live updates.
 function mountInline(host,{onChange}={}){
  const document=host.ownerDocument;host.classList.add('aisel-usp','aisel-usp-inline');
  const row=document.createElement('div');row.className='aisel-usp-row';row.setAttribute('aria-label','USP 키워드');host.append(row);
  let values=[],key='',disabled=false;const composing=new Set();
  const measure=document.createElement('canvas').getContext('2d');
  function fitKeyword(input){
   if(!measure)return;
   const style=document.defaultView.getComputedStyle(input);
   measure.font=style.font||style.fontSize+' '+style.fontFamily;
   const width=Math.max(22,Math.ceil(measure.measureText(input.value||input.placeholder||'').width)+10);
   input.style.setProperty('--aisel-usp-width',width+'px');
  }
  const inputs=Array.from({length:5},(_,index)=>{
   const input=document.createElement('input');input.type='text';input.className='aisel-usp-keyword';input.placeholder=String(index+1);input.setAttribute('aria-label','USP 키워드 '+(index+1));row.append(input);
   const commit=()=>{if(disabled||composing.has(index))return;while(values.length<=index)values.push('');values[index]=input.value;while(values.length&&!values.at(-1))values.pop();onChange?.(JSON.stringify(values));};
   input.addEventListener('input',()=>{fitKeyword(input);commit();});input.addEventListener('blur',commit);input.addEventListener('compositionstart',()=>composing.add(index));input.addEventListener('compositionend',()=>{composing.delete(index);commit();});return input;
  });
  return {isComposing:()=>composing.size>0,update(next={}){
   const changedKey=String(next.key||'')!==key;if(changedKey){key=String(next.key||'');composing.clear();}
   disabled=!!next.disabled;const incoming=keywords(next.serialized);
   inputs.forEach((input,index)=>{input.disabled=disabled;if(changedKey||!composing.has(index)&&document.activeElement!==input){input.value=incoming[index]||'';values[index]=incoming[index]||'';}fitKeyword(input);});
   while(values.length&&!values.at(-1))values.pop();
  }};
 }
 function mount(host,{onChange,readOnly=false,inline=false}={}){
  if(inline&&!readOnly)return mountInline(host,{onChange});
  const document=host.ownerDocument;host.classList.add('aisel-usp');
  const row=document.createElement('div');row.className='aisel-usp-row';row.setAttribute('aria-label','USP 키워드');host.append(row);
  const legacy=document.createElement('p');legacy.className='aisel-usp-legacy';legacy.hidden=true;host.append(legacy);
  const edit=document.createElement('div');edit.className='aisel-usp-edit';edit.hidden=true;
  const input=document.createElement('input');input.type='text';input.placeholder='짧은 키워드';input.setAttribute('aria-label','USP 키워드 수정');edit.append(input);
  const before=document.createElement('button'),after=document.createElement('button'),remove=document.createElement('button'),close=document.createElement('button');
  for(const [button,label]of [[before,'←'],[after,'→'],[remove,'삭제'],[close,'닫기']]){button.type='button';button.textContent=label;edit.append(button);}
  before.setAttribute('aria-label','USP 앞 순서로');after.setAttribute('aria-label','USP 뒤 순서로');
  const hint=document.createElement('small');hint.textContent='짧은 키워드 최대 5개';edit.append(hint);host.append(edit);
  let values=[],selected=-1,disabled=readOnly,composing=false,key='',last='';
  function render(){
   const sig=JSON.stringify([values,disabled]);if(sig===last)return;last=sig;row.replaceChildren();
   const count=readOnly?values.length:5;
   for(let index=0;index<count;index++){
    const button=document.createElement(readOnly?'span':'button');if(!readOnly){button.type='button';button.disabled=disabled;button.onclick=()=>{selected=index;edit.hidden=false;input.value=values[index]||'';input.focus();controls();};}
    button.className='aisel-usp-keyword';button.textContent=values[index]||'+';button.setAttribute('aria-label','USP '+(index+1)+(values[index]?' '+values[index]:' 추가'));row.append(button);
   }
   row.hidden=readOnly&&!values.length;controls();
  }
  function controls(){input.disabled=disabled;before.disabled=disabled||selected<=0||!values[selected];after.disabled=disabled||selected<0||selected>=values.length-1;remove.disabled=disabled||selected<0||!values[selected];}
  function emit(){while(values.length&&!values.at(-1))values.pop();onChange?.(JSON.stringify(values));render();}
  function commit(){if(selected<0||disabled||composing)return;while(values.length<=selected)values.push('');values[selected]=input.value;emit();}
  input.oninput=commit;input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;commit();});input.onblur=commit;
  before.onclick=()=>{if(before.disabled)return;[values[selected-1],values[selected]]=[values[selected],values[selected-1]];selected--;emit();};
  after.onclick=()=>{if(after.disabled)return;[values[selected+1],values[selected]]=[values[selected],values[selected+1]];selected++;emit();};
  remove.onclick=()=>{if(remove.disabled)return;values.splice(selected,1);selected=-1;edit.hidden=true;emit();};close.onclick=()=>{commit();edit.hidden=true;selected=-1;};
  return {isComposing:()=>composing,update(next={}){
   const newKey=String(next.key||''),changedKey=newKey!==key;if(changedKey){key=newKey;selected=-1;edit.hidden=true;input.value='';composing=false;}
   disabled=readOnly||!!next.disabled;
   const incoming=keywords(next.serialized);if(changedKey||JSON.stringify(incoming)!==JSON.stringify(values)&&!composing&&document.activeElement!==input)values=incoming;
   const text=String(next.legacy||'');if(legacy.textContent!==text)legacy.textContent=text;legacy.hidden=!text;
   render();
  }};
 }
 const api={keywords,planning,signature,refreshed,mount};root.AiselUsp=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
