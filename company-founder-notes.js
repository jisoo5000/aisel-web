/* Private owner notebook. Business text is stored only by the existing authenticated ERP API. */
(function(root){
 'use strict';
 const schema='aisel-founder-notes-v1',prefix='ceo-note-';
 let selected='',query='',showArchive=false,revision=0,account='';
 const kst=()=>new Date(Date.now()+32400000).toISOString().slice(0,10);
 function identity(){const s=root.AiselAccess?.session;return s?.active===true&&s.role==='owner'&&!s.legacy&&!s.passwordChangeRequired?[s.uid,s.credentialVersion||0].join(':'):'';}
 function read(p){if(!p?.id?.startsWith(prefix))return null;try{const d=JSON.parse(p.notes);if(d.schema!==schema||!['principle','memo'].includes(d.type))return null;if(d.type==='principle'&&(!Number.isSafeInteger(d.order)||d.order<1||typeof d.checked!=='boolean'))return null;if(d.type==='memo'&&(typeof d.parentId!=='string'||!validDate(d.date)||typeof d.body!=='string'))return null;return {...d,project:p};}catch(_){return null;}}
 function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
 function sortMemos(rows){return [...rows].sort((a,b)=>b.date.localeCompare(a.date)||(b.project.createdAt||0)-(a.project.createdAt||0)||b.project.id.localeCompare(a.project.id));}
 function reset(){revision++;selected='';query='';showArchive=false;account='';}
 function styles(){
  if(document.getElementById('founderNotesStyle'))return;
  const s=document.createElement('style');s.id='founderNotesStyle';s.textContent=
  '.fn-workspace{min-width:0;color:#34383C}.fn-workspace *{box-sizing:border-box}.fn-toolbar,.fn-actions,.fn-heading{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.fn-heading{justify-content:space-between;margin-bottom:6px}.fn-heading h2{font-size:16px;line-height:24px;font-weight:600;margin:0}.fn-workspace button,.fn-workspace input:not([type=checkbox]),.fn-workspace select{font:inherit;font-size:12px;line-height:18px;min-height:28px;border:1px solid #E3E5E7;border-radius:3px;background:#fff;color:#34383C}.fn-workspace button{padding:3px 8px;cursor:pointer}.fn-workspace button:disabled{opacity:.5;cursor:default}.fn-workspace input{padding:3px 6px;min-width:0}.fn-search{flex:1;min-width:120px!important}.fn-table-wrap{overflow-x:auto;margin-top:6px}.fn-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;line-height:18px}.fn-table th,.fn-table td{padding:6px;border-bottom:1px solid #E3E5E7;vertical-align:middle;text-align:left;overflow-wrap:anywhere}.fn-table th{font-weight:500;color:#6C727C;background:#F1F3F6}.fn-table th:nth-child(1){width:62px}.fn-table th:nth-child(2){width:44px}.fn-table th:nth-child(3){width:43%}.fn-table td:nth-child(1),.fn-table td:nth-child(2),.fn-table th:nth-child(1),.fn-table th:nth-child(2){text-align:center}.fn-order{width:100%;text-align:center;padding:2px!important}.fn-check{width:16px;height:16px;accent-color:#667B9B;vertical-align:middle}.fn-open{border:0!important;text-align:left;font-weight:600!important;white-space:normal;width:100%;padding:2px 0!important}.fn-checked{background:#F3F6FA}.fn-subtle{color:#6C727C;font-size:12px;line-height:18px;margin:6px 0}.fn-form{display:grid;gap:6px}.fn-field{display:grid;gap:6px;font-size:12px;min-width:0}.fn-field input,.fn-field textarea{width:100%;max-width:100%}.fn-field textarea{font:inherit;font-size:14px;line-height:22px;padding:8px;border:1px solid #E3E5E7;border-radius:3px;min-height:100px;resize:vertical;background:#fff;color:#34383C}.fn-field [name=body]{min-height:220px}.fn-form .fn-actions{margin-top:6px}.fn-meta{display:grid;grid-template-columns:1fr 1fr;gap:6px}.fn-check-label{display:flex;align-items:center;gap:6px;align-self:end;min-height:28px;font-size:12px}.fn-detail-title{font-size:16px;line-height:24px;overflow-wrap:anywhere;margin:6px 0}.fn-reference,.fn-body{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0;font-size:14px;line-height:22px}.fn-reference{background:#F6F6F6;padding:8px}.fn-memo{padding:8px 0;border-top:1px solid #E3E5E7}.fn-memo-head{display:flex;align-items:center;justify-content:space-between;gap:6px;color:#6C727C;font-size:12px}.fn-empty{padding:16px 0;color:#6C727C}.fn-workspace :focus-visible{outline:2px solid #667B9B;outline-offset:2px}@media(max-width:430px){.fn-table th:nth-child(1){width:50px}.fn-table th:nth-child(2){width:36px}.fn-table th:nth-child(3){width:41%}.fn-table th,.fn-table td{padding:6px 3px}.fn-meta{grid-template-columns:1fr}.fn-toolbar{align-items:stretch}}';
  document.head.append(s);
 }
 function render(ctx){
  const who=identity();if(!who){ctx.host.replaceChildren();return;}if(account&&account!==who)reset();account=who;styles();
  const run=revision,{host,el,button}=ctx,wrap=el('div','fn-workspace');host.append(wrap);
  const rows=()=>ctx.projects().map(read).filter(Boolean),current=()=>run===revision&&identity()===who&&host.isConnected;
  const status=(text,error=false)=>{if(current())ctx.message(text,error);};
  function draw(){if(current()){ctx.setDirty(false);ctx.redraw();}}
  function heading(text){const h=el('div','fn-heading');h.append(el('h2','',text));return h;}
  function btn(text,fn){return button(text,fn,'fn-button');}
  function field(form,name,label,value,kind='text',max=3000){
   const l=el('label','fn-field',label),i=el(kind==='textarea'?'textarea':'input');i.name=name;if(kind!=='textarea')i.type=kind;i.value=value??'';i.maxLength=max;l.append(i);form.append(l);return i;
  }
  // Freeze the request on failure. Repeating a save uses the same idempotency key.
  function saver(){
   let pending=null;
   return async function save(action,p,values,done){
    if(ctx.isWriting())return false;
    if(!pending){pending={action,id:p?.id||prefix+root.crypto.randomUUID(),expectedVersion:p?.version||0,requestId:'req-'+root.crypto.randomUUID(),...(action==='companyArchive'?{archived:values.archived}:{project:values})};}
    ctx.setWriting(true);ctx.setDirty(true);status('저장 중');
    try{
     const {action:op,...payload}=pending;
     const saved=await ctx.request(op,payload);
     const checked=await ctx.request('companyGet',{id:pending.id});
     if(!current())return false;
     if(!saved.item||!checked.item||checked.item.id!==pending.id||checked.item.version<saved.item.version)throw Error('저장 결과를 다시 확인해 주세요.');
     ctx.upsert(checked.item);pending=null;ctx.setWriting(false);ctx.setDirty(false);done?.(checked.item);draw();status('저장 완료');return true;
    }catch(e){status(e.message==='version_conflict'?'다른 곳에서 수정한 기록이 있습니다. 입력은 유지했습니다. 목록으로 돌아가 새로고침한 뒤 다시 확인해 주세요.':e.message==='idempotency_conflict'?'저장 요청이 달라졌습니다. 최신 기록을 확인해 주세요.':'저장을 확인하지 못했습니다. 입력을 유지했으니 다시 저장해 주세요.',true);return false;}
    finally{if(current())ctx.setWriting(false);}
   };
  }
  function editPrinciple(record){
   ctx.setDirty(false);wrap.replaceChildren(heading(record?'원칙 수정':'새 원칙'));
   const form=el('form','fn-form'),title=field(form,'title','제목',record?.project.title,'text',160);title.required=true;
   const meta=el('div','fn-meta'),order=field(meta,'order','순서',record?.order||Math.max(0,...rows().filter(r=>r.type==='principle').map(r=>r.order))+1,'number');order.min='1';order.max='999999';order.step='1';order.required=true;
   const checkLabel=el('label','fn-check-label'),check=el('input','fn-check');check.type='checkbox';check.name='checked';check.checked=!!record?.checked;checkLabel.append(check,el('span','','다시 볼 원칙'));meta.append(checkLabel);form.append(meta);
   const reference=field(form,'reference','참고사항',record?.project.goal||'','textarea',2000);
   const actions=el('div','fn-actions'),save=el('button','','저장');save.type='submit';const cancel=btn('취소',()=>{if(!ctx.isWriting())draw();});actions.append(save,cancel);form.append(actions);wrap.append(form);title.focus();
   const doSave=saver();let frozen=false;
   form.addEventListener('input',()=>ctx.setDirty(true));
   form.addEventListener('submit',async e=>{e.preventDefault();if(ctx.isWriting()||!form.reportValidity())return;const orderValue=Number(order.value);if(!Number.isSafeInteger(orderValue)||orderValue<1)return;
    const values={title:title.value.trim(),goal:reference.value.trim(),notes:JSON.stringify({schema,type:'principle',order:orderValue,checked:check.checked}),...(!record?{kind:'operation'}:{})};if(!values.title)return;
    frozen=true;for(const i of form.querySelectorAll('input,textarea'))i.disabled=true;save.disabled=cancel.disabled=true;
    const ok=await doSave(record?'companyUpdate':'companyCreate',record?.project,values,item=>{selected=item.id;});
    if(!ok&&current()){save.disabled=cancel.disabled=false;save.textContent='다시 저장';}
   });
  }
  function editMemo(parent,record){
   ctx.setDirty(false);wrap.replaceChildren(heading(record?'메모 수정':'발전 메모 추가'),el('p','fn-subtle',parent.project.title));
   const form=el('form','fn-form'),date=field(form,'date','날짜',record?.date||kst(),'date');date.required=true;
   const body=field(form,'body','생각·발전 내용',record?.body||'','textarea',5000);body.required=true;body.placeholder='새롭게 느낀 점, 달라진 생각, 다음에 해볼 일을 적어주세요.';
   const actions=el('div','fn-actions'),save=el('button','','저장');save.type='submit';const cancel=btn('취소',()=>{if(!ctx.isWriting())draw();});actions.append(save,cancel);form.append(actions);wrap.append(form);body.focus();
   const doSave=saver();form.addEventListener('input',()=>ctx.setDirty(true));
   form.addEventListener('submit',async e=>{e.preventDefault();if(ctx.isWriting()||!form.reportValidity()||!validDate(date.value)||!body.value.trim())return;
    const values={title:parent.project.title.slice(0,145)+' · 메모',notes:JSON.stringify({schema,type:'memo',parentId:parent.project.id,date:date.value,body:body.value.trim()}),...(!record?{kind:'operation'}:{})};
    for(const i of form.querySelectorAll('input,textarea'))i.disabled=true;save.disabled=cancel.disabled=true;
    const ok=await doSave(record?'companyUpdate':'companyCreate',record?.project,values);
    if(!ok&&current()){save.disabled=cancel.disabled=false;save.textContent='다시 저장';}
   });
  }
  function detail(r){
   const top=heading('사장학 개론');top.append(btn('목록으로',()=>{selected='';draw();}));wrap.append(top,el('h3','fn-detail-title',r.project.title));
   wrap.append(el('p','fn-subtle','순서 '+r.order+(r.checked?' · 다시 볼 원칙':'')+' · 작성 '+new Date(r.project.createdAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})));
   wrap.append(el('p','fn-reference',r.project.goal||'참고사항을 적어보세요.'));
   const actions=el('div','fn-actions'),edit=btn('원칙 수정',()=>editPrinciple(r)),memo=btn('메모 추가',()=>editMemo(r));edit.disabled=memo.disabled=!!r.project.archived;actions.append(edit,memo);
   const doArchive=saver(),archiveBtn=btn(r.project.archived?'복원':'보관',async()=>{archiveBtn.disabled=true;const ok=await doArchive('companyArchive',r.project,{archived:!r.project.archived},()=>{selected='';});if(!ok&&current()){ctx.setDirty(false);archiveBtn.disabled=false;}});
   actions.append(archiveBtn);wrap.append(actions,el('p','fn-subtle','발전 메모 · 최신 날짜순'));
   const memos=sortMemos(rows().filter(x=>x.type==='memo'&&x.parentId===r.project.id&&!x.project.archived));
   if(!memos.length)wrap.append(el('p','fn-empty','아직 발전 메모가 없습니다. 첫 생각을 적어보세요.'));
   for(const m of memos){const card=el('article','fn-memo'),h=el('div','fn-memo-head');const time=el('time','',m.date);time.dateTime=m.date;h.append(time);if(!r.project.archived)h.append(btn('수정',()=>editMemo(r,m)));card.append(h,el('p','fn-body',m.body));wrap.append(card);}
  }
  if(selected){const r=rows().find(r=>r.type==='principle'&&r.project.id===selected);if(r){detail(r);return;}selected='';}
  const top=heading('사장학 개론'),add=btn('새 원칙',()=>editPrinciple());add.disabled=!ctx.ready();top.append(add);wrap.append(top);
  wrap.append(el('p','fn-subtle','원칙을 적고, 제목을 눌러 발전된 생각을 날짜별로 쌓아보세요.'));
  const toolbar=el('div','fn-toolbar'),search=el('input','fn-search');search.type='search';search.value=query;search.placeholder='제목·참고사항·메모 검색';search.setAttribute('aria-label','원칙 검색');
  const archive=el('select');archive.setAttribute('aria-label','원칙 보관 상태');for(const [value,label]of [['live','전체 원칙'],['archive','보관함']]){const o=el('option','',label);o.value=value;archive.append(o);}archive.value=showArchive?'archive':'live';
  const refresh=btn('새로고침',()=>ctx.refresh());refresh.disabled=!ctx.ready();toolbar.append(search,archive,refresh);wrap.append(toolbar);
  const tableWrap=el('div','fn-table-wrap'),table=el('table','fn-table');table.setAttribute('aria-label','경영 원칙');const thead=el('thead'),tr=el('tr');for(const text of ['순서','체크','제목','참고사항']){const th=el('th','',text);th.scope='col';tr.append(th);}thead.append(tr);const tbody=el('tbody');table.append(thead,tbody);tableWrap.append(table);wrap.append(tableWrap);
  const empty=el('p','fn-empty');wrap.append(empty);
  function fill(){
   tbody.replaceChildren();const all=rows(),needle=query.trim().toLowerCase();
   const list=all.filter(r=>r.type==='principle'&&!!r.project.archived===showArchive&&(!needle||[r.project.title,r.project.goal,...all.filter(m=>m.type==='memo'&&m.parentId===r.project.id&&!m.project.archived).map(m=>m.body)].join(' ').toLowerCase().includes(needle))).sort((a,b)=>a.order-b.order||(a.project.createdAt||0)-(b.project.createdAt||0)||a.project.id.localeCompare(b.project.id));
   empty.textContent=!ctx.ready()?'기록을 불러오는 중…':list.length?'':needle?'검색 결과가 없습니다.':showArchive?'보관한 원칙이 없습니다.':'새 원칙을 추가해 보세요.';empty.hidden=ctx.ready()&&list.length>0;
   for(const r of list){
    const row=el('tr',r.checked?'fn-checked':''),orderCell=el('td'),order=el('input','fn-order');order.type='number';order.min='1';order.max='999999';order.step='1';order.value=r.order;order.disabled=showArchive;order.setAttribute('aria-label',r.project.title+' 순서');orderCell.append(order);
    const checkCell=el('td'),check=el('input','fn-check');check.type='checkbox';check.checked=r.checked;check.disabled=showArchive;check.setAttribute('aria-label',r.project.title+' 다시 볼 원칙');checkCell.append(check);
    const nameCell=el('td'),open=button(r.project.title,()=>{selected=r.project.id;draw();},'fn-open');nameCell.append(open);
    const ref=el('td','',r.project.goal||'');row.append(orderCell,checkCell,nameCell,ref);tbody.append(row);
    const quick=saver();
    const change=async()=>{if(ctx.isWriting())return;const value=Number(order.value);if(!Number.isSafeInteger(value)||value<1||value>999999){order.value=r.order;return;}const checked=check.checked;order.disabled=check.disabled=true;
     const ok=await quick('companyUpdate',r.project,{notes:JSON.stringify({schema,type:'principle',order:value,checked})});
     if(!ok&&current()){ctx.setDirty(false);order.value=r.order;check.checked=r.checked;order.disabled=check.disabled=false;fill();}
    };
    order.addEventListener('change',change);check.addEventListener('change',change);
   }
  }
  search.addEventListener('input',()=>{query=search.value;fill();});archive.addEventListener('change',()=>{showArchive=archive.value==='archive';fill();});fill();
 }
 root.AiselFounderNotes=Object.freeze({render,reset,read,sortMemos,validDate,schema,prefix});
})(window);
