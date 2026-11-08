/* 2026-11-08: private meeting sheet, complete candidate lists and one representative photo. */
(function(root){
 'use strict';
 const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'');
 const text=value=>typeof value==='string'?value:'';
 const http=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.href:'';}catch(_){return '';}};
 const rank=row=>{const title=text(row.title).replace(/\s/g,'');return title.includes('컴포트팬츠')?0:title.includes('컴포트스커트')?1:2;};
 async function candidateId(id){const bytes=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(id));return 'refdm_'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
 async function entries(references,meetings){
  const byId=new Map(meetings.map(row=>[row.id,row])),linked=new Set(),out=[];
  for(const ref of references){
   const id=await candidateId(ref.id),meeting=byId.get(id);if(!meeting)continue;
   linked.add(id);out.push({...meeting,title:ref.title||meeting.title,date:meeting.date,designer:meeting.designer,refId:ref.id,reference:ref});
  }
  for(const meeting of meetings)if(!linked.has(meeting.id))out.push({...meeting,refId:''});
  return out.sort((a,b)=>rank(a)-rank(b)||text(a.id).localeCompare(text(b.id)));
 }
 function select(rows,date,designer){return rows.filter(row=>row.date===date&&(!designer||row.designer===designer));}
 function route(date,designer){const u=new URL(root.location.href);u.hash='meeting-materials?'+new URLSearchParams({date,designer});return u.href;}
 function routeSelection(hash=root.location.hash){const match=hash.match(/^#meeting-materials(?:\?(.*))?$/);const p=new URLSearchParams(match?.[1]||'');return {date:validDate(p.get('date'))?p.get('date'):'',designer:p.get('designer')||'',list:p.get('list')==='1',sheet:p.get('sheet')==='1'};}
 root.AiselMeetingMaterialsCore=Object.freeze({candidateId,entries,select,rank,routeSelection,groupRows,dateLabel,reviewSignature,reviewModel,materialFields,documentChunks,wrapLines,googleResource});
 let pane,visible=false,epoch=0,rows=[],loaded=[],stops=[],loading=false;
 let readyFlight=Promise.resolve(true);let directory=true,recordsMode=false,archived=false,detailCache=new Map(),exportFlight=null,presenting=false,presentIndex=0,presentFocus=null;
 // Match gallery-projection.reviewSignature exactly: this is the saved-review wire format.
 function reviewSignature(record){const pictures=Array.isArray(record.photos)?record.photos:(record.photo?[{original:record.photo}]:[]);return JSON.stringify({fields:['title','link','memo','development'].map(k=>String(record[k]||'')),photos:pictures.map(x=>x.hash||x.original).sort()});}
 function reviewModel(record,result){
  const version=Number(record.inputVersion)||1;
  if(!result)return {state:'pending',label:'검토 대기 · 저장된 판단 없음',fields:[]};
  if(result.id!==record.id||Number(result.version)!==version||result.signature!==reviewSignature(record))return {state:'stale',label:'입력 변경 · 재검토 필요',fields:[]};
  if(result.state!=='done'||!text(result.receipt)||!text(result.runId)||!text(result.basis)||!Number.isFinite(Date.parse(result.reviewedAt)))return {state:'pending',label:'검토 미완료 · 확인된 결과 없음',fields:[]};
  let evidence={};try{evidence=typeof result.evidence==='string'?JSON.parse(result.evidence):result.evidence||{};}catch(_){}
  const m=evidence?.munger,modern=m&&typeof m==='object'&&!Array.isArray(m);
  const fields=modern?[
   ['GPT 의견',text(m.opinion)||text(result.verdict)||'미확인'],['살 이유 · USP',text(m.buyReason)||'미확인'],['실제 근거',text(m.evidence)||'미확인'],['실패할 이유',text(m.failureReason)||'미확인'],['다음 검증',text(m.nextValidation)||text(result.next)||'미확인']
  ]:[['기존 GPT 의견',text(result.verdict)||'미확인'],['기존 검토 근거',text(result.reason)||'미확인'],['제안 · 적용 방향',text(result.adaptation)||'미확인'],['미확인 항목',text(result.unknowns)||'미확인'],['다음 검증',text(result.next)||'미확인']];
  fields.push(['근거 · 검토일',result.basis+'\n'+new Date(result.reviewedAt).toISOString().slice(0,10)]);
  return {state:'done',label:modern?'멍거 판단 · GPT 의견':'기존 GPT 검토 · 멍거 항목 재정리 전',fields};
 }
 function materialFields(item){
  const r=item.record,review=item.review||reviewModel(r),decision=decisionLabel(r.decision);
  return [
   ['수요 / 공급',[choice(r.marketDemand,{high:'수요 높음',low:'수요 낮음',niche:'틈새 수요',unknown:'수요 확인 필요'}),choice(r.substituteSupply,{many:'공급 많음',few:'공급 적음',unknown:'공급 확인 필요'})].filter(Boolean).join(' / ')],
   ['USP · 차별성',usp(r)],['인게이지먼트',choice(r.engagementLevel,{high:'높음',low:'낮음',unknown:'확인 필요'})],
   ['디벨롭 방향 · 회의 메모',[r.development,r.meetingMemo,r.memo,...Object.values(r.referenceNotes||{}).map(n=>text(n?.text))].filter(Boolean).join('\n')],
   [review.label,review.state==='done'?'저장된 의견입니다. 회의 결정과 구분합니다.':'현재 입력에 맞는 판단이 확인되면 표시합니다.'],...review.fields,
   ['사람의 회의 결정',[decision,r.decisionReason].filter(Boolean).join('\n')],
   ['가설 · 대상 고객',text(r.hypothesis)],['검증 방법 · 비교안',text(r.validationMethod)],['판단 기준 · 확인 날짜',text(r.successCriteria)],['관찰 결과 · 다음 수정',text(r.validationResult)]
  ];
 }
 // Bound by rendered lines, not string truncation: all text survives into continuation pages.
 function wrapLines(value,width=48){const out=[];for(const paragraph of String(value||'').replace(/\r/g,'').split('\n')){let line='',units=0;for(const ch of paragraph){const n=ch.codePointAt(0)>255?2:1;if(units+n>width&&line){out.push(line);line='';units=0;}line+=ch;units+=n;}out.push(line);}return out;}
 function documentChunks(item){
  const chunks=[],limit=29;let current=[],used=0;
  for(const [label,value] of materialFields(item)){if(!value)continue;let lines=wrapLines(value),part=0;
   while(lines.length){if(limit-used<4){chunks.push(current);current=[];used=0;}
    const take=Math.min(lines.length,limit-used-2);current.push({label:label+(part?' · 계속':''),lines:lines.splice(0,take)});used+=take+2;part++;
   }
  }if(current.length)chunks.push(current);return chunks;
 }
 async function loadReviews(items,stamp,uid){
  for(const item of items)item.review=reviewModel(item.record);
  if(!root.AiselNativeBridge?.request)return;
  for(let i=0;i<items.length;i+=50){const batch=items.slice(i,i+50);
   try{const out=await root.AiselNativeBridge.request('results',batch.map(x=>x.record.id),{versions:Object.fromEntries(batch.map(x=>[x.record.id,Number(x.record.inputVersion)||1]))});assertSession(stamp,uid);
    if(out.ok!==true||!Array.isArray(out.results))throw Error('invalid_review_response');
    for(const item of batch){const matches=out.results.filter(r=>r.id===item.record.id).sort((a,b)=>Number(b.version)-Number(a.version));item.review=reviewModel(item.record,matches[0]);}
   }catch(error){assertSession(stamp,uid);for(const item of batch)item.review={state:'unavailable',label:'판단 연결 확인 필요',fields:[]};}
  }
 }
 const PAGE=20, PEOPLE=['강혜주','장은영'];
 function dateLabel(value){return validDate(value)?value.slice(2).replaceAll('-','. ')+' ('+'일월화수목금토'[new Date(value+'T12:00:00+09:00').getUTCDay()]+')':'날짜 미정';}
 function groupRows(items){const groups=new Map();for(const row of items){const key=JSON.stringify([row.date,row.designer]);if(!groups.has(key))groups.set(key,{date:row.date,designer:row.designer,items:[]});groups.get(key).items.push(row);}return [...groups.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.designer.localeCompare(b.designer));}
 const $=selector=>pane.querySelector(selector),account=()=>root.AiselAuth?.currentUser?.();
 function el(tag,value,cls){const node=document.createElement(tag);if(value!==undefined)node.textContent=value;if(cls)node.className=cls;return node;}
 function button(value,fn){const node=el('button',value);node.type='button';node.addEventListener('click',fn);return node;}
 function message(value,failed=false){$('.amm-message').textContent=value;$('.amm-message').classList.toggle('error',failed);}
 function assertSession(stamp,uid){if(stamp!==epoch||account()?.uid!==uid||!visible||root.AiselAccess?.allowed('designmeeting')!==true)throw Error('계정이나 화면이 변경되었습니다. 회의자료를 다시 열어주세요.');}
 function busy(on){loading=on;if($('.amm-more button'))$('.amm-more button').disabled=on;for(const node of pane.querySelectorAll('.amm-controls button,.amm-controls select,.amm-controls input'))node.disabled=on;$('.amm-print').disabled=on||!loaded.length;$('.amm-share').disabled=on||!loaded.length;for(const b of pane.querySelectorAll('.amm-directory button,.amm-navigation button'))b.disabled=on;}
 function link(value,label){const u=http(value);if(!u)return el('span','');const a=el('a',label||u);a.href=u;a.target='_blank';a.rel='noopener noreferrer';return a;}
 function appLink(kind,id){const u=new URL(root.location.href);u.hash=kind+'='+encodeURIComponent(id);return u.href;}
 function clear(){closePresentation();epoch++;recordsMode=false;if(pane)$('.amm-records').replaceChildren();loaded=[];rows=[];for(const stop of stops)stop();stops=[];detailCache.clear();if(pane){$('.amm-directory')?.replaceChildren();$('.amm-pages').replaceChildren();if($('.amm-more'))$('.amm-more').hidden=true;$('.amm-count').textContent='';busy(false);}document.body.classList.remove('aisel-meeting-print');document.getElementById('aiselMeetingPrintRoot')?.remove();}
 function ensure(){
  if(pane)return;
  pane=el('section',undefined,'amm-view');pane.id='aiselMeetingMaterialsView';pane.hidden=true;
  const top=el('div',undefined,'amm-top'),title=el('div');title.append(el('h2','회의자료'),el('p','회의 기록 · 사진 자료'));
  const legacy=button('기존 무드보드',()=>root.AiselUnified?.show('moodboards'));legacy.className='amm-legacy noprint';top.append(title,legacy);
  const controls=el('div',undefined,'amm-controls noprint');
  const dateLabel=el('label','회의일 '),date=el('input');date.type='date';date.className='amm-date';dateLabel.append(date);
  const personLabel=el('label','디자이너 '),person=el('select');person.className='amm-designer';personLabel.append(person);
  const open=button('회의 열기',()=>loadSelection()),print=button('인쇄 / PDF 저장',()=>printAll()),share=button('링크 복사',()=>shareLink());print.className='amm-print';share.className='amm-share';
  controls.append(dateLabel,personLabel,open,print,share);
  const status=el('p','', 'amm-message');status.setAttribute('role','status');
  const navigation=el('div',undefined,'amm-navigation noprint');
  const back=button('회의 목록',()=>showDirectory()),archive=button('보관함',()=>showDirectory({archive:!archived})),exportButton=button('프레젠테이션 저장',()=>exportPptx()),complete=button('회의 완료',()=>archiveSelection());
  const present=button('발표 보기',()=>startPresentation());present.className='amm-present';
  back.className='amm-back';archive.className='amm-archive';exportButton.className='amm-export';complete.className='amm-complete';const records=button('회의 기록',()=>showRecords());records.className='amm-records-open';navigation.append(records,back,archive,present,exportButton,complete);
  const presenter=el('div',undefined,'amm-presenter noprint');presenter.hidden=true;
  const previous=button('이전',()=>movePresentation(-1)),next=button('다음',()=>movePresentation(1)),exit=button('발표 닫기',()=>closePresentation());previous.className='amm-previous';next.className='amm-next';exit.className='amm-exit';
  const position=el('span','','amm-position');position.setAttribute('aria-live','polite');presenter.append(previous,position,next,exit);
  pane.append(top,navigation,controls,presenter,el('p','','amm-count'),status,el('div',undefined,'amm-records noprint'),el('div',undefined,'amm-directory'),el('div',undefined,'amm-pages'));
  document.getElementById('mainBar').parentNode.append(pane);
  for(const input of [date,person])input.addEventListener('change',()=>{if(!canLeave()){if(loaded[0]){date.value=loaded[0].row.date;person.value=loaded[0].row.designer;}return;}epoch++;loaded=[];$('.amm-pages').replaceChildren();if($('.amm-more'))$('.amm-more').hidden=true;busy(false);message('회의 열기를 누르면 선택한 회의를 불러옵니다.');$('.amm-count').textContent='';});
 }
 function field(label,value,cls=''){const block=el('div',undefined,'amm-field '+cls);block.append(el('strong',label),el('div',text(value),'amm-value'));return block;}
 function choice(value,labels){return labels[value]||'';}
 function usp(record){let list;try{list=JSON.parse(record.uspKeywordsJson||'[]');}catch(_){list=[];}return Array.isArray(list)?list.map(item=>typeof item==='string'?item:typeof item?.value==='string'?item.value:typeof item?.text==='string'?item.text:'').filter(Boolean).join(' · ')||text(record.uspValue):text(record.uspValue);}
 function photoList(record,reference){const result=[],seen=new Set(),meetingPhotos=Array.isArray(record.photos)?record.photos:record.photo?[{original:record.photo,thumb:record.photo}]:Object.values(record.photos||{});for(const photo of [...(reference?.photos||[]),...meetingPhotos]){const original=http(photo.original||photo.url),thumb=http(photo.thumb||photo.thumbnail||original),key=photo.hash||original||thumb;if(!key||seen.has(key))continue;seen.add(key);result.push({original:original||thumb,thumb,hash:photo.hash});}return result;}
 function page(item,index,total){
  const {record,reference,row}=item,article=el('article',undefined,'amm-page'),head=el('header',undefined,'amm-page-head');
  head.append(el('strong',dateLabel(row.date)+' · '+row.designer),el('span',String(index+1).padStart(2,'0')+' / '+total));article.append(head);
  const grid=el('div',undefined,'amm-grid'),left=el('div',undefined,'amm-left'),photos=el('div',undefined,'amm-photos');
  for(const [i,p] of item.photos.slice(0,1).entries()){const img=el('img');img.alt=(row.title||'회의 레퍼런스')+' 사진 '+(i+1);img.loading='lazy';img.decoding='async';img.dataset.original=p.original;img.src=i===0&&row.reference?root.AiselGalleryIndex.imageSource('references',row.refId,p.thumb):p.thumb;photos.append(img);}
  if(!item.photos.length)photos.append(el('p','등록된 사진이 없습니다.'));
  const sources=[...(reference?.sourceLinks||[]),reference?.sourceUrl,record.link,...(record.links||[])].map(http).filter(Boolean);
  const product=field('상품','', 'amm-title');product.querySelector('.amm-value').append(sources[0]?link(sources[0],row.title||'상품'):el('span',row.title||'상품'));
  left.append(photos,product);
  const right=el('div',undefined,'amm-right');
  right.append(field('수요 / 공급',[choice(record.marketDemand,{high:'수요 높음',low:'수요 낮음',niche:'틈새 수요',unknown:'수요 확인 필요'}),choice(record.substituteSupply,{many:'공급 많음',few:'공급 적음',unknown:'공급 확인 필요'})].filter(Boolean).join(' / ')),field('USP · 차별성',usp(record)),field('인게이지먼트',choice(record.engagementLevel,{high:'높음',low:'낮음',unknown:'확인 필요'})),field('디자인 수정 · 회의 메모',[record.development,record.meetingMemo,record.memo,...Object.values(record.referenceNotes||{}).map(note=>text(note?.text))].filter(Boolean).join('\n'),'amm-memo'));
  const review=item.review||reviewModel(record),judgment=el('section',undefined,'amm-judgment');judgment.dataset.state=review.state;judgment.append(el('h3',review.label));
  for(const [label,value]of review.fields)judgment.append(field(label,value));if(!review.fields.length)judgment.append(el('p',review.state==='unavailable'?'저장된 판단을 불러오지 못했습니다. 회의 열기로 다시 확인할 수 있습니다.':'현재 입력에 맞는 저장된 판단이 확인되면 표시합니다.','amm-hint'));right.append(judgment);
  right.append(field('사람의 회의 결정',[decisionLabel(record.decision),record.decisionReason].filter(Boolean).join('\n'),'amm-decision'));
  const experiment=el('details',undefined,'amm-experiment');experiment.append(el('summary','가설 검증'),field('가설 · 대상 고객',record.hypothesis),field('검증 방법 · 비교안',record.validationMethod),field('판단 기준 · 확인 날짜',record.successCriteria),field('관찰 결과 · 다음 수정',record.validationResult));right.append(experiment);
  const actions=el('div',undefined,'amm-actions noprint');actions.append(button('확인 · 수정 / 작업지시서',async()=>{if(await root.AiselUnified.show('designmeeting'))await root.AiselDesignMeeting.open(record.id);}));
  actions.append(button('회의 결정 기록',()=>editDecision(item,article)));grid.append(left,right);article.append(grid,actions);return article;
 }
 const DECISIONS={unselected:'미선택',selected:'선택',progress:'진행',excluded:'드롭',held:'보류'};
 function canLeave(){if(pane?.querySelector('.amm-decision-form')){const note=pane.querySelector('.amm-save-status');note.textContent='회의 결정을 저장하거나 닫은 뒤 이동해주세요.';note.scrollIntoView?.({block:'nearest'});return false;}return true;}
 function decisionLabel(value){return DECISIONS[value]||text(value)||'미선택';}
 async function editDecision(item,article){
  if(loading||archived||article.querySelector('.amm-decision-form'))return;const stamp=epoch,uid=account()?.uid;
  try{const grant=await root.AiselGalleryIndex.authorize('meetings');assertSession(stamp,uid);if(grant.role!=='owner')throw Error('회의 결정은 대표자 계정에서 기록할 수 있습니다.');
   const baseline={meetingMemo:text(item.record.meetingMemo),decision:text(item.record.decision)||'unselected',decisionReason:text(item.record.decisionReason)},form=el('form',undefined,'amm-decision-form noprint');
   const decision=el('select');decision.setAttribute('aria-label','회의 결정');for(const [value,label]of Object.entries(DECISIONS)){const o=el('option',label);o.value=value;decision.append(o);}decision.value=baseline.decision;
   const reason=el('textarea'),memo=el('textarea');reason.setAttribute('aria-label','결정 이유');memo.setAttribute('aria-label','회의 메모');reason.value=baseline.decisionReason;memo.value=baseline.meetingMemo;
   for(const [label,control]of [['회의 결정',decision],['결정 이유',reason],['회의 메모',memo]]){const wrapper=el('label',label);wrapper.append(control);form.append(wrapper);}
   const status=el('p','','amm-save-status');status.setAttribute('role','status');const save=button('저장',()=>{});save.type='submit';const cancel=button('닫기',()=>form.remove());form.append(save,cancel,status);article.append(form);decision.focus();
   form.addEventListener('submit',async event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;cancel.disabled=true;status.textContent='저장 중입니다.';
    try{const access=await root.AiselGalleryIndex.authorize('meetings');assertSession(stamp,uid);if(access.role!=='owner')throw Error('회의 결정 저장 권한을 확인해주세요.');
     const patch={decision:decision.value,decisionReason:reason.value,meetingMemo:memo.value};if(!Object.hasOwn(DECISIONS,patch.decision))throw Error('회의 결정을 선택해주세요.');
     const result=await root.AiselCollectionWrites.mutateMeeting(item.record.id,c=>{
      assertSession(stamp,uid);if(!c||c.designMeeting!==true||c.designMeetingDeletedAt||c.meetingDate!==item.row.date||c.designer!==item.row.designer||(Number(c.inputVersion)||1)!==(Number(item.record.inputVersion)||1)||reviewSignature(c)!==reviewSignature(item.record)||Object.keys(baseline).some(k=>(text(c[k])||(k==='decision'?'unselected':''))!==baseline[k]))throw Error('다른 곳에서 자료가 변경되었습니다. 입력을 복사한 뒤 회의를 다시 열어주세요.');
      return {...c,...patch,updatedAt:Date.now()};
     });assertSession(stamp,uid);if(!result.committed)throw Error('저장을 확인하지 못했습니다. 입력은 그대로 남아 있습니다.');
     item.record=result.snapshot.val();detailCache.delete(item.record.id);root.AiselGalleryIndex.remember('meetings',{...item.row,decision:item.record.decision,updatedAt:item.record.updatedAt,version:item.record.inputVersion});
     article.replaceWith(page(item,loaded.indexOf(item),loaded.length));if(presenting)paintPresentation();message('회의 결정을 저장했습니다. 제작·발주는 기존 작업지시서에서 진행합니다.');
    }catch(error){if(stamp===epoch)status.textContent=error.message||'저장하지 못했습니다. 입력을 보관해주세요.';}finally{save.disabled=false;cancel.disabled=false;}
   });
  }catch(error){if(stamp===epoch)message(error.message,true);}
 }
 async function startPresentation(){if(loading||!canLeave())return;const focus=document.activeElement;await loadSelection({refresh:false,all:true});if(!loaded.length||loaded.length!==selectionTotal)return;presentFocus=focus;presenting=true;presentIndex=0;pane.classList.add('amm-presenting');document.body.classList.add('aisel-presenting');$('.amm-presenter').hidden=false;paintPresentation();$('.amm-exit').focus();}
 function paintPresentation(){if(!presenting)return;for(const [i,node]of [...$('.amm-pages').children].entries())node.hidden=i!==presentIndex;$('.amm-position').textContent=(presentIndex+1)+' / '+loaded.length;$('.amm-previous').disabled=presentIndex===0;$('.amm-next').disabled=presentIndex===loaded.length-1;$('.amm-pages').scrollTop=0;}
 function movePresentation(delta){if(!presenting)return;presentIndex=Math.max(0,Math.min(loaded.length-1,presentIndex+delta));paintPresentation();}
 function closePresentation(){presenting=false;pane?.classList.remove('amm-presenting');document.body.classList.remove('aisel-presenting');if(pane){const bar=$('.amm-presenter');if(bar)bar.hidden=true;for(const node of $('.amm-pages').children)node.hidden=false;}if(presentFocus?.isConnected)presentFocus.focus();presentFocus=null;}
 root.addEventListener('keydown',event=>{if(!presenting||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||event.target.isContentEditable)return;if(['ArrowLeft','ArrowRight','Escape'].includes(event.key)){event.preventDefault();if(event.key==='Escape')closePresentation();else movePresentation(event.key==='ArrowRight'?1:-1);}else if(event.key==='Tab'){const nodes=[...pane.querySelectorAll('button,input,select,textarea,a[href],summary')].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
 let selectionTotal=0;
 async function loadSelection({refresh=true}={}){
  if(!canLeave())return;closePresentation();
  const date=$('.amm-date').value,designer=$('.amm-designer').value;recordsMode=false;directory=false;setMode();if(!validDate(date)){message('회의 날짜를 선택해주세요.',true);return;}
  const stamp=++epoch,uid=account()?.uid;loaded=[];$('.amm-pages').replaceChildren();if($('.amm-more'))$('.amm-more').hidden=true;busy(true);message('선택한 회의의 전체 자료를 확인하고 있습니다.');
  try{
   await root.AiselGalleryIndex.warm('meetings',refresh?{refresh:true,archived,all:true}:{preferCache:true,archived,all:true});assertSession(stamp,uid);
   const meetings=root.AiselGalleryIndex.snapshot('meetings',{archived});
   if(!meetings.available||!meetings.complete)throw Error('전체 목록 확인이 끝나지 않았습니다. 일부만 인쇄하지 않도록 다시 불러와주세요.');
   rows=await entries([],meetings.records);assertSession(stamp,uid);
   const chosen=select(rows,date,designer);selectionTotal=chosen.length;
   const results=new Array(chosen.length),previews=new Array(chosen.length);let cursor=0,finished=0;
   const placeholders=chosen.map(row=>{const item=el('div',row.title||'회의자료를 불러오는 중입니다.','amm-loading');item.setAttribute('role','status');return item;});
   $('.amm-pages').replaceChildren(...placeholders);$('.amm-count').textContent=date+' · '+(designer||'전체 디자이너')+' · '+chosen.length+'개';
   await Promise.all(Array.from({length:Math.min(3,chosen.length)},async()=>{while(cursor<chosen.length){const n=cursor++,row=chosen[n];const cached=detailCache.get(row.id),revision=JSON.stringify([row.version,row.updatedAt,archived]);let item;
     if(!refresh&&cached?.revision===revision&&Date.now()-cached.at<300000)item=cached.item;
     else {const detail=await root.AiselGalleryIndex.detail('meetings',row.id);assertSession(stamp,uid);const refId=detail.record.sourceRefId||'';const ref=refId?await root.AiselGalleryIndex.detail('references',refId):null;assertSession(stamp,uid);item={record:detail.record,reference:ref?.record};detailCache.set(row.id,{revision,item,at:Date.now()});}
     const {record,reference}=item;row.refId=record.sourceRefId||'';
     if(!!record.designMeetingDeletedAt!==archived||reference?.archivedAt&&!archived)throw Error('삭제 또는 보관된 항목이 있습니다. 회의 열기를 다시 눌러주세요.');
     if(reference&&record.sourceRefId!==reference.id)throw Error('레퍼런스와 디자인회의 연결을 확인하지 못했습니다.');
     if((record.meetingDate||'')!==date||(designer&&(record.designer||'')!==designer))throw Error('회의 날짜나 담당자가 변경되었습니다. 회의 열기를 다시 눌러주세요.');
     const fresh={...row,reference,title:reference?.title||record.title||'',date:record.meetingDate||'',designer:record.designer||''};results[n]={row:fresh,record,reference,photos:photoList(record,reference)};
     previews[n]=page(results[n],n,chosen.length);placeholders[n].replaceWith(previews[n]);finished++;message(chosen.length+'개 중 '+finished+'개를 불러왔습니다.');
   }}));assertSession(stamp,uid);
   loaded=results.slice().sort((a,b)=>rank(a.row)-rank(b.row)||text(a.row.id).localeCompare(text(b.row.id)));
   await loadReviews(loaded,stamp,uid);assertSession(stamp,uid);$('.amm-pages').replaceChildren(...loaded.map((item,i)=>page(item,i,loaded.length)));
   $('.amm-count').textContent=date+' · '+(designer||'전체 디자이너')+' · '+loaded.length+'개';
   const mismatches=loaded.filter(x=>x.reference&&x.record.meetingDate&&x.reference.date!==x.record.meetingDate).length;
   message(!loaded.length?'해당 날짜의 디자인회의가 없습니다.':mismatches?'디자인회의에 지정된 회의일 기준입니다. 원본 레퍼런스 날짜와 다른 '+mismatches+'개는 원본 기록을 함께 확인해주세요.':'전체 '+selectionTotal+'개');
   history.replaceState({aiselUnified:true,view:'meetingmaterials'},'',route(date,designer));
  }catch(error){if(stamp===epoch){epoch++;loaded=[];$('.amm-pages').replaceChildren();if($('.amm-more'))$('.amm-more').hidden=true;message(error.message||'회의자료를 불러오지 못했습니다.',true);busy(false);}}
  finally{if(stamp===epoch)busy(false);}
 }
 function setMode(){
  $('.amm-records').hidden=!recordsMode;pane.classList.toggle('amm-records-mode',recordsMode);$('.amm-records-open').hidden=recordsMode;$('.amm-directory').hidden=recordsMode||!directory;$('.amm-controls').hidden=recordsMode||directory;$('.amm-pages').hidden=recordsMode||directory;$('.amm-back').hidden=!recordsMode&&directory;
  $('.amm-export').hidden=recordsMode||directory;$('.amm-present').hidden=recordsMode||directory;$('.amm-complete').hidden=recordsMode||directory;$('.amm-archive').hidden=recordsMode||!directory;
  $('.amm-archive').textContent=archived?'진행 중':'보관함';$('.amm-complete').textContent=archived?'진행 중으로 복원':'회의 완료';
  if(directory&&$('.amm-more'))$('.amm-more').hidden=true;
 }

 // Configuration contains navigation URLs only. Google retains file access and saves edits.
 function googleResource(value,kind){
  try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='docs.google.com'||u.username||u.password||u.port)return '';
   if(!new RegExp('^/'+kind+'/d/[A-Za-z0-9_-]+/(?:edit|preview)/?$').test(u.pathname))return '';return u.href;
  }catch(_){return '';}
 }
 async function showRecords(){
  if(!canLeave())return false;closePresentation();recordsMode=true;directory=false;loaded=[];$('.amm-pages').replaceChildren();$('.amm-count').textContent='';setMode();
  const stamp=++epoch,uid=account()?.uid,box=$('.amm-records');box.replaceChildren();busy(true);message('회의 기록을 여는 중입니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
   assertSession(stamp,uid);if(!uid)throw Error('로그인 후 회의 기록을 열어주세요.');
   const response=await fetch('meeting-resources.json',{cache:'no-cache',signal:controller.signal});if(!response.ok)throw Error('회의 자료 연결을 확인해주세요.');
   const config=await response.json();assertSession(stamp,uid);
   const sheet=googleResource(config.sheet,'spreadsheets'),materials=googleResource(config.materials,'spreadsheets');if(!sheet)throw Error('회의 기록 주소를 확인해주세요.');
   const tools=el('div',undefined,'amm-record-tools'),external=link(sheet,'새 창에서 열기');external.className='amm-resource-link';tools.append(external);
   for(const [key,label] of [['tuesday','화요일 · 장은영'],['thursday','목요일 · 강혜주']]){
    const url=googleResource(config[key],'presentation')||materials;if(url){const a=link(url,label);a.className='amm-resource-link';tools.append(a);}
   }
   const note=el('p','사진·판단·회의 기록은 같은 Google 시트에 저장합니다.','amm-record-note');
   const frame=el('iframe');frame.title='디자인회의 기록';frame.className='amm-record-frame';frame.referrerPolicy='strict-origin-when-cross-origin';
   const embed=new URL(sheet);embed.searchParams.set('rm','minimal');frame.src=embed.href;box.append(tools,note,frame);
   message('');const url=new URL(root.location.href);url.hash='meeting-materials?sheet=1';history.replaceState({aiselUnified:true,view:'meetingmaterials'},'',url);
   return true;
  }catch(error){if(stamp===epoch){box.replaceChildren();message(error.name==='AbortError'?'회의 자료 연결이 지연되고 있습니다. 다시 열어주세요.':error.message,true);}return false;}
  finally{clearTimeout(timer);if(stamp===epoch)busy(false);}
 }

 function renderDirectory(){
  const box=$('.amm-directory');box.replaceChildren();const groups=groupRows(rows),people=[...PEOPLE,...new Set(groups.map(g=>g.designer).filter(p=>!PEOPLE.includes(p)))];
  for(const person of people){const column=el('section',undefined,'amm-person');column.append(el('h3',person||'담당자 미지정'));const matches=groups.filter(g=>g.designer===person);
   for(const group of matches){const open=button('',()=>openGroup(group));open.className='amm-meeting-card';const photo=group.items[0]?.thumbnail;
    if(http(photo)){const img=el('img');img.alt=(person||'미지정')+' '+dateLabel(group.date)+' 대표 사진';img.loading='lazy';img.decoding='async';img.src=photo;open.append(img);}
    else open.append(el('span','사진 없음','amm-empty-photo'));
    open.append(el('time',dateLabel(group.date)));open.title=group.items.length+'개 자료';column.append(open);
   }
   if(!matches.length)column.append(el('p',archived?'보관한 회의가 없습니다.':'예정된 회의가 없습니다.'));
   box.append(column);
  }
  $('.amm-count').textContent='';message(archived?'보관한 회의입니다. 선택하면 복원할 수 있습니다.':'');
 }
 async function showDirectory({archive=archived,refresh=false}={}){
  if(!canLeave())return false;closePresentation();
  recordsMode=false;directory=true;archived=archive;loaded=[];$('.amm-pages').replaceChildren();setMode();const stamp=++epoch,uid=account()?.uid;busy(true);message('회의 목록을 확인하고 있습니다.');
  try{
   await root.AiselGalleryIndex.warm('meetings',refresh?{refresh:true,archived,all:true}:{preferCache:true,archived,all:true});assertSession(stamp,uid);
   const meetings=root.AiselGalleryIndex.snapshot('meetings',{archived});if(!meetings.available||!meetings.complete)throw Error('회의 목록을 확인하지 못했습니다. 다시 열어주세요.');
   rows=await entries([],meetings.records);assertSession(stamp,uid);renderDirectory();return true;
  }catch(error){if(stamp===epoch){$('.amm-directory').replaceChildren();message(error.message,true);}return false;}finally{if(stamp===epoch)busy(false);}
 }
 async function openGroup(group){
  $('.amm-date').value=group.date;setPeople(group.designer);$('.amm-designer').value=group.designer;await loadSelection({refresh:false});
 }
 function setPeople(selected=''){
  const people=[...new Set([...PEOPLE,...rows.map(row=>row.designer),selected].filter(Boolean))];$('.amm-designer').replaceChildren();
  for(const value of ['',...people]){const option=el('option',value||'전체');option.value=value;$('.amm-designer').append(option);}
 }
 function show({hash,background=false}={}){
  ensure();visible=true;pane.hidden=false;document.body.classList.add('aisel-meeting-materials-open');$('.amm-legacy').hidden=true;
  const ready=(async()=>{const requested=routeSelection(hash);archived=false;
   if(requested.date){directory=false;setPeople(requested.designer);$('.amm-date').value=requested.date;$('.amm-designer').value=requested.designer;await loadSelection({refresh:false});}
   else if(requested.list)await showDirectory({archive:false});else await showRecords();return true;
  })();readyFlight=ready;return background?Promise.resolve(true):ready;
 }
 async function archiveSelection(){
  if(loading||!canLeave()||!validDate($('.amm-date').value))return;
  const date=$('.amm-date').value,designer=$('.amm-designer').value,uid=account()?.uid,stamp=epoch;
  const targets=select(rows,date,designer);if(!targets.length)return;
  try{const grant=await root.AiselGalleryIndex.authorize('meetings');assertSession(stamp,uid);if(grant.role!=='owner'){message('회의 완료와 복원은 대표자 계정에서 할 수 있습니다.',true);return;}}catch(error){message(error.message,true);return;}
  busy(true);let finished=0;
  try{
   for(const row of targets){assertSession(stamp,uid);const out=await root.AiselCollectionWrites.mutateMeeting(row.id,c=>{
    if(!c||c.designMeeting!==true||c.meetingDate!==date||designer&&c.designer!==designer)throw Error('회의 날짜나 담당자가 바뀐 항목이 있습니다. 목록을 다시 확인해주세요.');
    if(c.conversion?.state==='running')throw Error('작업지시서 전환 중인 항목이 있습니다. 완료 후 다시 시도해주세요.');
    if(!!c.designMeetingDeletedAt!==archived)return undefined;
    if(archived){const next={...c,updatedAt:Date.now()};delete next.designMeetingDeletedAt;delete next.designMeetingDeletedBy;return next;}
    return {...c,designMeetingDeletedAt:Date.now(),designMeetingDeletedBy:uid,updatedAt:Date.now()};
   });assertSession(stamp,uid);if(!out.committed)throw Error('회의 상태가 변경되었습니다. 목록을 다시 확인해주세요.');const record=out.snapshot.val();
   root.AiselGalleryIndex.remember('meetings',{...row,updatedAt:record.updatedAt,archivedAt:record.designMeetingDeletedAt||0},{archived:!archived});detailCache.delete(row.id);finished++;
   }
   await showDirectory({archive:archived,refresh:true});message(archived?'진행 중으로 복원했습니다.':'회의를 보관했습니다. 사진과 메모는 그대로 유지됩니다.');
  }catch(error){message(finished+' / '+targets.length+'개 반영 · '+error.message,true);}finally{busy(false);}
 }
 function documentPlan(item){const fields=documentChunks(item),photos=item.photos||[],count=Math.max(fields.length,Math.ceil(photos.length/2),1);return Array.from({length:count},(_,i)=>({fields:fields[i]||[],photos:photos.slice(i*2,i*2+2)}));}
 function documentPages(item,index,total){const plan=documentPlan(item);return plan.map((chunk,part)=>{
  const article=el('article',undefined,'amm-page amm-output-page'),head=el('header',undefined,'amm-page-head');head.append(el('strong',dateLabel(item.row.date)+' · '+item.row.designer),el('span',(index+1)+' / '+total+(plan.length>1?' · 자료 '+(part+1)+'/'+plan.length:'')));article.append(head);
  const grid=el('div',undefined,'amm-grid'),left=el('div',undefined,'amm-left'),photos=el('div',undefined,'amm-photos');for(const photo of chunk.photos){const img=el('img');img.alt=item.row.title||'회의 사진';img.dataset.original=photo.original;img.src=photo.thumb;photos.append(img);}if(!chunk.photos.length)photos.append(el('p',part?'추가 기록':'등록된 사진이 없습니다.'));
  left.append(photos,el('div','회의 중 메모\n\n___________________________________\n\n___________________________________','amm-handnotes'),link(route(item.row.date,item.row.designer),'앱에서 회의자료 열기'));
  const right=el('div',undefined,'amm-right');right.append(field('제품',item.row.title||'제목 없음','amm-title'));for(const section of chunk.fields)right.append(field(section.label,section.lines.join('\n')));grid.append(left,right);article.append(grid);return article;
 });}
 let pptLibrary;
 async function loadPptLibrary(){
  if(root.PptxGenJS)return root.PptxGenJS;if(!pptLibrary)pptLibrary=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='vendor/pptxgen.bundle-3.12.0.js';script.onload=()=>root.PptxGenJS?resolve(root.PptxGenJS):reject(Error('프레젠테이션 도구를 불러오지 못했습니다.'));script.onerror=()=>reject(Error('프레젠테이션 도구 연결을 확인해주세요.'));document.head.append(script);}).catch(error=>{pptLibrary=null;throw error;});return pptLibrary;
 }
 async function exportPptx(){
  if(!canLeave())return;
  if(exportFlight)return exportFlight;
  exportFlight=(async()=>{if(loading)return;await loadSelection({refresh:false,all:true});if(loading||!loaded.length||loaded.length!==selectionTotal)return;
   const stamp=epoch,uid=account()?.uid;busy(true);message('프레젠테이션 파일을 준비합니다.');
   try{
    const Pptx=await loadPptLibrary();assertSession(stamp,uid);const ppt=new Pptx();ppt.defineLayout({name:'AISEL_A4',width:11.69,height:8.27});ppt.layout='AISEL_A4';ppt.author='AISEL';ppt.subject='디자인 회의자료';ppt.title=dateLabel($('.amm-date').value)+' 디자인 회의';ppt.lang='ko-KR';
    for(const item of loaded){const chunks=documentPlan(item);for(const [part,chunk]of chunks.entries()){assertSession(stamp,uid);const slide=ppt.addSlide();slide.background={color:'FFFFFF'};
     slide.addText(dateLabel(item.row.date)+' · '+item.row.designer+'    '+(loaded.indexOf(item)+1)+' / '+loaded.length+(chunks.length>1?' · 자료 '+(part+1)+'/'+chunks.length:''),{x:.4,y:.25,w:10.9,h:.35,fontSize:12,color:'6C727C',fontFace:'맑은 고딕'});
     for(const [pi,photo]of chunk.photos.entries()){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const response=await fetch(photo.original||photo.thumb,{signal:controller.signal});if(!response.ok)throw Error('사진을 불러오지 못했습니다.');const blob=await response.blob();const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});assertSession(stamp,uid);
      const dimensions=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({w:img.naturalWidth,h:img.naturalHeight});img.onerror=reject;img.src=data;});
      const cell=4.8/chunk.photos.length,scale=Math.min(cell/dimensions.w,5.7/dimensions.h),w=dimensions.w*scale,h=dimensions.h*scale;slide.addImage({data,x:.4+pi*cell+(cell-w)/2,y:.9+(5.7-h)/2,w,h});
     }finally{clearTimeout(timer);}}
     slide.addText(item.row.title||'제목 없음',{x:5.5,y:.85,w:5.8,h:.6,fontSize:18,bold:true,color:'34383C',fontFace:'맑은 고딕',fit:'shrink'});
     let y=1.65;for(const section of chunk.fields){slide.addText(section.label,{x:5.5,y,w:5.8,h:.19,fontSize:10.5,bold:true,color:'34383C',fontFace:'맑은 고딕',margin:0});y+=.2;
      const h=section.lines.length*.18;slide.addText(section.lines.join('\n'),{x:5.5,y,w:5.8,h:h+.03,fontSize:10.5,color:'34383C',fontFace:'맑은 고딕',margin:0,breakLine:false,paraSpaceAfterPt:0,lineSpacingMultiple:1});y+=h+.16;}
     slide.addText('회의 중 메모\n\n___________________________________\n\n___________________________________',{x:.4,y:6.65,w:4.8,h:.75,fontSize:10,color:'6C727C',fontFace:'맑은 고딕',margin:0});
     slide.addText('앱에서 회의자료 열기',{x:.4,y:7.75,w:5,h:.2,fontSize:10,hyperlink:{url:route(item.row.date,item.row.designer)}});
    }}
    assertSession(stamp,uid);await ppt.writeFile({fileName:$('.amm-date').value+'_'+($('.amm-designer').value||'전체')+'_디자인회의.pptx'});assertSession(stamp,uid);message('프레젠테이션을 저장했습니다.');
   }catch(error){if(stamp===epoch)message(error.message||'프레젠테이션 저장에 실패했습니다.',true);}finally{if(stamp===epoch)busy(false);}
  })().finally(()=>exportFlight=null);return exportFlight;
 }
 async function openSelection(date,designer,{exportFile=false}={}){
  const hash='#meeting-materials?'+new URLSearchParams({date,designer});
  if(!await root.AiselUnified.show('meetingmaterials',{id:hash}))return;
  await readyFlight;if(exportFile)await exportPptx();
 }
 function hide(){visible=false;if(pane)pane.hidden=true;document.body.classList.remove('aisel-meeting-materials-open');clear();}
 async function shareLink(){try{await navigator.clipboard.writeText(route($('.amm-date').value,$('.amm-designer').value));message('회의 링크를 복사했습니다. 기존 앱 접근 권한이 있는 디자이너가 볼 수 있습니다.');}catch(_){message('주소창의 회의 링크를 복사해주세요.');}}
 async function imageReady(img){if(img.complete&&img.naturalWidth)return;await new Promise((resolve,reject)=>{let timer;const done=()=>{clearTimeout(timer);img.removeEventListener('load',ok);img.removeEventListener('error',fail);},ok=()=>{done();resolve();},fail=()=>{done();reject(Error('사진을 모두 불러오지 못했습니다. 다시 시도해주세요.'));};img.addEventListener('load',ok);img.addEventListener('error',fail);timer=setTimeout(fail,25000);if(img.complete&&img.naturalWidth)ok();});}
 async function printAll(){if(!canLeave())return;if(loading||!loaded.length)return;if(loaded.length<selectionTotal){await loadSelection({refresh:false,all:true});if(loading||loaded.length!==selectionTotal||!loaded.length)return;}const stamp=epoch,uid=account()?.uid;busy(true);message('인쇄용 원본 사진을 준비합니다.');let printRoot;
  try{
   printRoot=el('div');printRoot.id='aiselMeetingPrintRoot';printRoot.append(...loaded.flatMap((item,i)=>documentPages(item,i,loaded.length)));document.body.append(printRoot);
   const images=[...printRoot.querySelectorAll('img')];let cursor=0;await Promise.all(Array.from({length:Math.min(3,images.length)},async()=>{while(cursor<images.length){const img=images[cursor++];img.loading='eager';img.src=img.dataset.original;await imageReady(img);assertSession(stamp,uid);}}));
   await document.fonts?.ready;assertSession(stamp,uid);document.body.classList.add('aisel-meeting-print');
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));assertSession(stamp,uid);root.print();message('인쇄 창에서 전체 페이지를 선택하거나 PDF로 저장하세요.');
  }catch(error){if(stamp===epoch)message(error.message||'인쇄를 준비하지 못했습니다.',true);}
  finally{if(!document.body.classList.contains('aisel-meeting-print'))printRoot?.remove();if(stamp===epoch)busy(false);}
 }
 root.addEventListener('afterprint',()=>{document.body.classList.remove('aisel-meeting-print');document.getElementById('aiselMeetingPrintRoot')?.remove();});
 root.addEventListener('aisel-session-change',()=>{hide();});
 root.addEventListener('aisel-access-change',()=>{if(visible&&root.AiselAccess?.allowed('designmeeting')!==true)hide();});
 root.AiselMeetingMaterials={show,hide,canLeave,openSelection,exportPptx,ready:()=>readyFlight,get visible(){return visible;}};
})(window);


