(function(root){
 'use strict';
 function parse(raw){try{if(!raw)return {version:1,rows:[]};const value=JSON.parse(raw);if(value.version!==1||!Array.isArray(value.rows)||value.rows.some(r=>!r||typeof r.id!=='string'||!Array.isArray(r.lines)))return null;return value;}catch(_){return null;}}
 function mount({document:d,getKey,getBase,negotiation:n}){
  const make=(tag,cls,text)=>{const e=d.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;},base=d.getElementById('costCell'),head=base.querySelector('.sec-title');
  head.classList.add('size-cost-heading');const label=make('span','','원가계산서');head.replaceChildren(label);
  function sizeNote(cls,label,value,oninput){const e=make('textarea',cls);e.rows=2;e.value=value??'';e.placeholder='1 (S M) / 2 (L XL)\n2번 사이즈(XL)로 원가 계산';e.title='1 (S M) / 2 (L XL) · 2번 사이즈(XL)로 원가 계산';e.setAttribute('aria-label',label);e.maxLength=60;if(oninput)e.oninput=()=>oninput(e.value);return e;}
  const size=sizeNote('size-cost-note noprint','기본 원가계산서 사이즈와 계산 기준','');size.id='costSizeNote';
  const printSize=make('span','size-cost-base-print');const plus=make('button','size-cost-add noprint','+');plus.type='button';plus.setAttribute('aria-label','사이즈별 원가계산서 추가');head.append(size,printSize,plus);
  const field=make('input');field.id='costVariantsData';field.type='hidden';d.getElementById('editorView').append(field);
  const list=make('div','size-cost-list noprint');base.after(list);
  const sizes=d.querySelector('#sheet .sizespec'),sizeAdd=d.getElementById('addSizeSpecCol');sizeAdd.textContent='+';sizeAdd.setAttribute('aria-label','사이즈 추가');sizeAdd.title='사이즈 추가';d.querySelector('#sizeSpecHead th:last-child').append(sizeAdd);function paintSizes(){const count=d.querySelectorAll('#sizeSpecHead .colhead').length;sizes.dataset.wide=String(count>6);sizes.style.setProperty('--size-table-min',(92+count*38)+'px');sizes.querySelectorAll('.ss-val').forEach(e=>{e.dataset.filled=String(e.value.trim()!==''&&e.value.trim()!=='-');});}
  sizes.addEventListener('input',paintSizes);new MutationObserver(paintSizes).observe(sizes.querySelector('table'),{childList:true,subtree:true});root.addEventListener('beforeprint',paintSizes);paintSizes();
  const print=make('div','size-cost-print');d.querySelector('#sheet > .detail2 > .cell.mat').append(print);
  let data={version:1,rows:[]},key='',signature='',editors=[];
  const money=value=>Number(value||0).toLocaleString('ko-KR')+'원';
  const total=row=>n.assessment(row.lines,row,row.fixedNegotiations||{}).amount;
  function printText(){printSize.textContent=size.value;print.replaceChildren();for(const row of data.rows){const block=make('section');block.append(make('strong','', '원가계산서 · '+(row.size||'사이즈 미기재')));const table=make('table'),heading=make('tr');for(const text of ['항목','단가','수량','금액'])heading.append(make('th','',text));table.append(heading);for(const line of row.lines.filter(l=>!n.isFixedLossLine(l))){const result=n.evaluate(line.unit,line.negotiation,line.qty),tr=make('tr');for(const text of [line.nm||'',result.included?'포함':money(result.applied),line.qty||'1',money(result.amount)])tr.append(make('td','',text));table.append(tr);}block.append(table);for(const [prop,label]of [['gongim','공임'],['siyage','시야게']])block.append(make('div','',label+' '+money(n.evaluate(row[prop],row.fixedNegotiations?.[prop],1,true).amount)));block.append(make('div','','로스 1,000원'),make('strong','','원가 '+money(total(row))));print.append(block);}}
  function commit(){field.value=JSON.stringify(data);signature=field.value;printText();field.dispatchEvent(new Event('input',{bubbles:true}));}
  function input(cls,label,value,oninput){const e=make('input',cls);e.type='text';e.value=value??'';e.setAttribute('aria-label',label);e.oninput=()=>oninput(e.value);return e;}
  function button(cls,label,action){const e=make('button',cls,label);e.type='button';e.onclick=action;return e;}
  function draw(){for(const editor of editors)editor.remove();editors=[];list.replaceChildren();for(const row of data.rows){
   const card=make('section','size-cost-card'),heading=make('div','size-cost-heading');card.dataset.costVariant=row.id;
   const note=sizeNote('size-cost-note','추가 원가계산서 사이즈와 계산 기준',row.size,v=>{row.size=v;commit();});
   const remove=button('size-cost-remove','×',()=>{if(!root.confirm('이 사이즈의 원가계산서를 삭제할까요?'))return;data.rows=data.rows.filter(r=>r!==row);commit();draw();});remove.setAttribute('aria-label','추가 원가계산서 삭제');const copy=button('size-cost-add','+',()=>addCost(row));copy.setAttribute('aria-label','이 원가계산서 복사 추가');heading.append(make('strong','','원가계산서'),note,copy);card.append(heading);
   const table=make('table','size-cost-table'),thead=make('thead'),tr=make('tr');for(const text of ['항목','단가','수량','금액',''])tr.append(make('th','',text));thead.append(tr);const body=make('tbody');table.append(thead,body);card.append(table);
   const totalNode=make('strong','size-cost-total');const update=()=>{totalNode.textContent=money(total(row));printText();};
   for(const line of row.lines){if(n.isFixedLossLine(line))continue;const tr=make('tr'),nm=make('td'),unit=make('td'),qty=make('td'),amt=make('td','size-cost-amount'),del=make('td');
    const refresh=()=>{amt.textContent=Number(n.evaluate(line.unit,line.negotiation,line.qty).amount||0).toLocaleString('ko-KR');update();};
    const name=input('size-cost-name','추가 원가 항목',line.nm,v=>{line.nm=v;tr.hidden=n.isFixedLossLine(line);refresh();commit();});nm.append(name);
    const q=input('size-cost-qty','추가 원가 수량',line.qty,v=>{line.qty=v;refresh();commit();});q.inputMode='decimal';qty.append(q);
    const editor=n.attachEditor(unit,{title:()=>line.nm||'자재',legacy:()=>line.unit,quantity:()=>line.qty,worker:()=>d.getElementById('designer').value,get:()=>line.negotiation,set:value=>{line.negotiation=value;},change:()=>{refresh();commit();}});editors.push(editor);
    const removeLine=button('size-cost-delete','×',()=>{row.lines=row.lines.filter(l=>l!==line);commit();draw();});removeLine.setAttribute('aria-label','추가 원가 항목 삭제');del.append(removeLine);tr.append(nm,unit,qty,amt,del);body.append(tr);refresh();
   }
   card.append(button('size-cost-add-line','+ 항목 추가',()=>{row.lines.push({nm:'',unit:'',qty:''});commit();draw();}));
   for(const [prop,label]of [['gongim','공임'],['siyage','시야게']]){const line=make('div','size-cost-fixed'),host=make('div');line.append(make('span','',label),host);card.append(line);const editor=n.attachEditor(host,{fixed:true,title:()=>label,legacy:()=>row[prop],quantity:()=>1,worker:()=>d.getElementById('designer').value,get:()=>row.fixedNegotiations?.[prop],set:value=>{row.fixedNegotiations={...row.fixedNegotiations,[prop]:value};},change:()=>{update();commit();}});editors.push(editor);}
   const loss=make('div','size-cost-fixed');loss.append(make('span','','로스'),make('span','','1,000원'));const sum=make('div','size-cost-sum');sum.append(make('span','','원가'),totalNode);const footer=make('div','size-cost-footer');remove.textContent='원가표 삭제';footer.append(remove);card.append(loss,sum,footer);list.append(card);update();
  }printText();}
  function addCost(source){if(plus.disabled)return;const copied=n.clone(source);data.rows.push({...copied,id:crypto.randomUUID(),size:''});commit();draw();list.lastElementChild.querySelector('.size-cost-note').focus();}plus.onclick=()=>addCost(getBase());
  size.addEventListener('input',printText);
  function refresh(){paintSizes();const next=String(getKey()||''),raw=field.value;printSize.textContent=size.value;if(key===next&&signature===raw)return;key=next;signature=raw;const parsed=parse(raw);plus.disabled=!parsed;data=parsed||{version:1,rows:[]};draw();}
  root.addEventListener('beforeprint',printText);return {refresh};
 }
 root.AiselSizeCosts={mount,parse};if(typeof module==='object'&&module.exports)module.exports=root.AiselSizeCosts;
})(typeof window==='object'?window:globalThis);
