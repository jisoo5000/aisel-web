/* v283: 24-card preview pages and complete print preparation. v267: shared compact screen, background loading and incremental read-only meeting previews. */
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
 function routeSelection(hash=root.location.hash){const match=hash.match(/^#meeting-materials(?:\?(.*))?$/);const p=new URLSearchParams(match?.[1]||'');return {date:validDate(p.get('date'))?p.get('date'):'',designer:p.get('designer')||''};}
 root.AiselMeetingMaterialsCore=Object.freeze({candidateId,entries,select,rank,routeSelection,groupRows,dateLabel});
 let pane,visible=false,epoch=0,rows=[],loaded=[],stops=[],loading=false;
 let readyFlight=Promise.resolve(true);let directory=true,archived=false,groupLimits=new Map(),detailCache=new Map(),exportFlight=null;
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
 function clear(){epoch++;loaded=[];rows=[];for(const stop of stops)stop();stops=[];detailCache.clear();if(pane){$('.amm-directory')?.replaceChildren();$('.amm-pages').replaceChildren();if($('.amm-more'))$('.amm-more').hidden=true;$('.amm-count').textContent='';busy(false);}document.body.classList.remove('aisel-meeting-print');document.getElementById('aiselMeetingPrintRoot')?.remove();}
 function ensure(){
  if(pane)return;
  pane=el('section',undefined,'amm-view');pane.id='aiselMeetingMaterialsView';pane.hidden=true;
  const top=el('div',undefined,'amm-top'),title=el('div');title.append(el('h2','회의자료'),el('p','회의 날짜를 선택해 자료를 확인하세요.'));
  const legacy=button('기존 무드보드',()=>root.AiselUnified?.show('moodboards'));legacy.className='amm-legacy noprint';top.append(title,legacy);
  const controls=el('div',undefined,'amm-controls noprint');
  const dateLabel=el('label','회의일 '),date=el('input');date.type='date';date.className='amm-date';dateLabel.append(date);
  const personLabel=el('label','디자이너 '),person=el('select');person.className='amm-designer';personLabel.append(person);
  const open=button('회의 열기',()=>loadSelection()),print=button('인쇄 / PDF 저장',()=>printAll()),share=button('링크 복사',()=>shareLink());print.className='amm-print';share.className='amm-share';
  controls.append(dateLabel,personLabel,open,print,share);
  const status=el('p','', 'amm-message');status.setAttribute('role','status');
  const navigation=el('div',undefined,'amm-navigation noprint');
  const back=button('회의 목록',()=>showDirectory()),archive=button('보관함',()=>showDirectory({archive:!archived})),exportButton=button('프레젠테이션 저장',()=>exportPptx()),complete=button('회의 완료',()=>archiveSelection());
  back.className='amm-back';archive.className='amm-archive';exportButton.className='amm-export';complete.className='amm-complete';navigation.append(back,archive,exportButton,complete);
  pane.append(top,navigation,controls,el('p','','amm-count'),status,el('div',undefined,'amm-directory'),el('div',undefined,'amm-pages'));
  document.getElementById('mainBar').parentNode.append(pane);
  for(const input of [date,person])input.addEventListener('change',()=>{epoch++;loaded=[];$('.amm-pages').replaceChildren();if($('.amm-more'))$('.amm-more').hidden=true;busy(false);message('회의 열기를 누르면 선택한 회의를 불러옵니다.');$('.amm-count').textContent='';});
 }
 function field(label,value,cls=''){const block=el('div',undefined,'amm-field '+cls);block.append(el('strong',label),el('div',text(value),'amm-value'));return block;}
 function choice(value,labels){return labels[value]||'';}
 function usp(record){let list;try{list=JSON.parse(record.uspKeywordsJson||'[]');}catch(_){list=[];}return Array.isArray(list)?list.map(item=>typeof item==='string'?item:typeof item?.value==='string'?item.value:typeof item?.text==='string'?item.text:'').filter(Boolean).join(' · ')||text(record.uspValue):text(record.uspValue);}
 function photoList(record,reference){const result=[],seen=new Set(),meetingPhotos=Array.isArray(record.photos)?record.photos:record.photo?[{original:record.photo,thumb:record.photo}]:Object.values(record.photos||{});for(const photo of [...(reference?.photos||[]),...meetingPhotos]){const original=http(photo.original||photo.url),thumb=http(photo.thumb||photo.thumbnail||original),key=photo.hash||original||thumb;if(!key||seen.has(key))continue;seen.add(key);result.push({original:original||thumb,thumb,hash:photo.hash});}return result;}
 function page(item,index,total){
  const {record,reference,row}=item,article=el('article',undefined,'amm-page'),head=el('header',undefined,'amm-page-head');
  head.append(el('strong',dateLabel(row.date)+' · '+row.designer),el('span',String(index+1).padStart(2,'0')+' / '+total));article.append(head);
  const grid=el('div',undefined,'amm-grid'),left=el('div',undefined,'amm-left'),photos=el('div',undefined,'amm-photos');
  for(const [i,p] of item.photos.entries()){const img=el('img');img.alt=(row.title||'회의 레퍼런스')+' 사진 '+(i+1);img.loading='lazy';img.decoding='async';img.dataset.original=p.original;img.src=i===0&&row.reference?root.AiselGalleryIndex.imageSource('references',row.refId,p.thumb):p.thumb;photos.append(img);}
  if(!item.photos.length)photos.append(el('p','등록된 사진이 없습니다.'));
  const links=el('div',undefined,'amm-links');links.append(link(appLink('design-meeting',record.id),'디자인회의 열기'));
  if(row.refId)links.append(link(appLink('reference',row.refId),'원본 레퍼런스'));
  const sources=[...(reference?.sourceLinks||[]),reference?.sourceUrl,record.link,...(record.links||[])].map(http).filter(Boolean);
  for(const u of [...new Set(sources)])links.append(link(u,u));
  left.append(photos,links);
  const right=el('div',undefined,'amm-right');
  right.append(field('제목',row.title,'amm-title'),field('수요 / 공급',[choice(record.marketDemand,{high:'수요 높음',low:'수요 낮음',niche:'틈새 수요',unknown:'수요 확인 필요'}),choice(record.substituteSupply,{many:'공급 많음',few:'공급 적음',unknown:'공급 확인 필요'})].filter(Boolean).join(' / ')),field('USP · 차별성',usp(record)),field('인게이지먼트',choice(record.engagementLevel,{high:'높음',low:'낮음',unknown:'확인 필요'})),field('디자인 수정 · 회의 메모',[record.development,record.meetingMemo,record.memo,...Object.values(record.referenceNotes||{}).map(note=>text(note?.text))].filter(Boolean).join('\n'),'amm-memo'));
  const experiment=el('div',undefined,'amm-experiment');experiment.append(el('strong','가설 검증'),el('p','예: 타깃 고객에게 핏 또는 컬러 한 가지만 바꿔 비교하고, 선택 이유를 기록합니다.','amm-hint'),field('가설 · 대상 고객',record.hypothesis),field('검증 방법 · 비교안',record.validationMethod),field('판단 기준 · 확인 날짜',record.successCriteria),field('관찰 결과 · 다음 수정',record.validationResult));right.append(experiment);
  const actions=el('div',undefined,'amm-actions noprint');actions.append(button('확인 · 수정 / 작업지시서',async()=>{if(await root.AiselUnified.show('designmeeting'))await root.AiselDesignMeeting.open(record.id);}));
  grid.append(left,right);article.append(grid,actions);return article;
 }
 let pageLimit=20,selectionKey="",selectionTotal=0;
 async function loadSelection({refresh=true,more=false,all=false}={}){
  const date=$('.amm-date').value,designer=$('.amm-designer').value;directory=false;setMode();if(!validDate(date)){message('회의 날짜를 선택해주세요.',true);return;}
  const stamp=++epoch,uid=account()?.uid;loaded=[];$('.amm-pages').replaceChildren();if($('.amm-more'))$('.amm-more').hidden=true;busy(true);message('선택한 회의의 전체 자료를 확인하고 있습니다.');
  try{
   await root.AiselGalleryIndex.warm('meetings',refresh?{refresh:true,archived,all:true}:{preferCache:true,archived,all:true});assertSession(stamp,uid);
   const meetings=root.AiselGalleryIndex.snapshot('meetings',{archived});
   if(!meetings.available||!meetings.complete)throw Error('전체 목록 확인이 끝나지 않았습니다. 일부만 인쇄하지 않도록 다시 불러와주세요.');
   rows=await entries([],meetings.records);assertSession(stamp,uid);
   const key=JSON.stringify([date,designer]);if(selectionKey!==key||!more&&!all)pageLimit=20;selectionKey=key;if(more)pageLimit+=20;const complete=select(rows,date,designer);selectionTotal=complete.length;if(all)pageLimit=complete.length;
   const chosen=complete.slice(0,pageLimit),results=new Array(chosen.length),previews=new Array(chosen.length);let cursor=0,finished=0;
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
   $('.amm-pages').replaceChildren(...loaded.map((item,i)=>{const node=previews[results.indexOf(item)];node.querySelector('.amm-page-head span').textContent=String(i+1).padStart(2,'0')+' / '+loaded.length;return node;}));
   $('.amm-count').textContent=date+' · '+(designer||'전체 디자이너')+' · '+loaded.length+' / '+selectionTotal+'개';let moreControl=$('.amm-more');if(!moreControl){moreControl=el('div',undefined,'amm-more aisel-page-more noprint');const moreButton=button('더 보기 · 20개',()=>loadSelection({refresh:false,more:true}));moreControl.append(moreButton);$('.amm-pages').after(moreControl);}moreControl.hidden=loaded.length>=selectionTotal;moreControl.querySelector('button').textContent='더 보기 · '+Math.min(20,selectionTotal-loaded.length)+'개';
   const mismatches=loaded.filter(x=>x.reference&&x.record.meetingDate&&x.reference.date!==x.record.meetingDate).length;
   message(!loaded.length?'해당 날짜의 디자인회의가 없습니다.':mismatches?'디자인회의에 지정된 회의일 기준입니다. 원본 레퍼런스 날짜와 다른 '+mismatches+'개는 원본 기록을 함께 확인해주세요.':'전체 '+selectionTotal+'개 중 '+loaded.length+'개를 불러왔습니다. 인쇄는 전체 자료로 준비합니다.');
   history.replaceState({aiselUnified:true,view:'meetingmaterials'},'',route(date,designer));
  }catch(error){if(stamp===epoch){epoch++;loaded=[];$('.amm-pages').replaceChildren();if($('.amm-more'))$('.amm-more').hidden=true;message(error.message||'회의자료를 불러오지 못했습니다.',true);busy(false);}}
  finally{if(stamp===epoch)busy(false);}
 }
 function setMode(){
  $('.amm-directory').hidden=!directory;$('.amm-controls').hidden=directory;$('.amm-pages').hidden=directory;$('.amm-back').hidden=directory;
  $('.amm-export').hidden=directory;$('.amm-complete').hidden=directory;$('.amm-archive').hidden=!directory;
  $('.amm-archive').textContent=archived?'진행 중':'보관함';$('.amm-complete').textContent=archived?'진행 중으로 복원':'회의 완료';
  if(directory&&$('.amm-more'))$('.amm-more').hidden=true;
 }
 function renderDirectory(){
  const box=$('.amm-directory');box.replaceChildren();const groups=groupRows(rows),people=[...PEOPLE,...new Set(groups.map(g=>g.designer).filter(p=>!PEOPLE.includes(p)))];
  for(const person of people){const column=el('section',undefined,'amm-person');column.append(el('h3',person||'담당자 미지정'));const matches=groups.filter(g=>g.designer===person),limit=groupLimits.get(person)||10;
   for(const group of matches.slice(0,limit)){const open=button('',()=>openGroup(group));open.className='amm-meeting-card';const photo=group.items[0]?.thumbnail;
    if(http(photo)){const img=el('img');img.alt=(person||'미지정')+' '+dateLabel(group.date)+' 대표 사진';img.loading='lazy';img.decoding='async';img.src=photo;open.append(img);}
    else open.append(el('span','사진 없음','amm-empty-photo'));
    open.append(el('time',dateLabel(group.date)));open.title=group.items.length+'개 자료';column.append(open);
   }
   if(!matches.length)column.append(el('p',archived?'보관한 회의가 없습니다.':'예정된 회의가 없습니다.'));
   if(matches.length>limit){const more=button('더 보기',()=>{groupLimits.set(person,limit+10);renderDirectory();});more.className='amm-directory-more';column.append(more);}
   box.append(column);
  }
  $('.amm-count').textContent='';message(archived?'보관한 회의입니다. 선택하면 복원할 수 있습니다.':'');
 }
 async function showDirectory({archive=archived,refresh=false}={}){
  directory=true;archived=archive;loaded=[];$('.amm-pages').replaceChildren();setMode();const stamp=++epoch,uid=account()?.uid;busy(true);message('회의 목록을 확인하고 있습니다.');
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
   else await showDirectory({archive:false});return true;
  })();readyFlight=ready;return background?Promise.resolve(true):ready;
 }
 async function archiveSelection(){
  if(loading||!validDate($('.amm-date').value))return;
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
 let pptLibrary;
 async function loadPptLibrary(){
  if(root.PptxGenJS)return root.PptxGenJS;if(!pptLibrary)pptLibrary=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='vendor/pptxgen.bundle-3.12.0.js';script.onload=()=>root.PptxGenJS?resolve(root.PptxGenJS):reject(Error('프레젠테이션 도구를 불러오지 못했습니다.'));script.onerror=()=>reject(Error('프레젠테이션 도구 연결을 확인해주세요.'));document.head.append(script);}).catch(error=>{pptLibrary=null;throw error;});return pptLibrary;
 }
 async function exportPptx(){
  if(exportFlight)return exportFlight;
  exportFlight=(async()=>{if(loading)return;await loadSelection({refresh:false,all:true});if(loading||!loaded.length||loaded.length!==selectionTotal)return;
   const stamp=epoch,uid=account()?.uid;busy(true);message('프레젠테이션 파일을 준비합니다.');
   try{
    const Pptx=await loadPptLibrary();assertSession(stamp,uid);const ppt=new Pptx();ppt.defineLayout({name:'AISEL_A4',width:11.69,height:8.27});ppt.layout='AISEL_A4';ppt.author='AISEL';ppt.subject='디자인 회의자료';ppt.title=dateLabel($('.amm-date').value)+' 디자인 회의';ppt.lang='ko-KR';
    for(const item of loaded){assertSession(stamp,uid);const slide=ppt.addSlide();slide.background={color:'FFFFFF'};
     slide.addText(dateLabel(item.row.date)+' · '+item.row.designer,{x:.4,y:.25,w:10.9,h:.35,fontSize:14,color:'6C727C',fontFace:'맑은 고딕'});
     const photo=item.photos[0];if(photo){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const response=await fetch(photo.original||photo.thumb,{signal:controller.signal});if(!response.ok)throw Error('사진을 불러오지 못했습니다.');const blob=await response.blob();const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});assertSession(stamp,uid);
      const dimensions=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({w:img.naturalWidth,h:img.naturalHeight});img.onerror=reject;img.src=data;});
      const scale=Math.min(4.8/dimensions.w,6.2/dimensions.h),w=dimensions.w*scale,h=dimensions.h*scale;slide.addImage({data,x:.4+(4.8-w)/2,y:.9+(6.2-h)/2,w,h});
     }finally{clearTimeout(timer);}}
     const r=item.record;slide.addText(item.row.title||'제목 없음',{x:5.5,y:.9,w:5.8,h:.7,fontSize:21,bold:true,color:'34383C',fontFace:'맑은 고딕',fit:'shrink'});
     const labels=[['수요 / 공급',[choice(r.marketDemand,{high:'높음',low:'낮음',niche:'틈새',unknown:'확인 필요'}),choice(r.substituteSupply,{many:'많음',few:'적음',unknown:'확인 필요'})].filter(Boolean).join(' / ')],['USP · 차별성',usp(r)],['인게이지먼트',choice(r.engagementLevel,{high:'높음',low:'낮음',unknown:'확인 필요'})],['회의 메모',[r.development,r.meetingMemo,r.memo,...Object.values(r.referenceNotes||{}).map(n=>text(n.text))].filter(Boolean).join('\n')]];
     labels.push(['가설 · 대상 고객',r.hypothesis||''],['검증 방법 · 판단 기준',[r.validationMethod,r.successCriteria].filter(Boolean).join(' / ')],['관찰 결과 · 다음 수정',r.validationResult||'']);
     labels.forEach(([label,value],i)=>slide.addText(label+'\n'+value,{x:5.5,y:1.75+i*.82,w:5.8,h:.77,fontSize:11,color:'34383C',fontFace:'맑은 고딕',breakLine:false,fit:'shrink',margin:0}));
     slide.addText('앱에서 회의자료 열기',{x:.4,y:7.75,w:5,h:.2,fontSize:10,hyperlink:{url:route(item.row.date,item.row.designer)}});
    }
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
 async function printAll(){if(loading||!loaded.length)return;if(loaded.length<selectionTotal){await loadSelection({refresh:false,all:true});if(loading||loaded.length!==selectionTotal||!loaded.length)return;}const stamp=epoch,uid=account()?.uid;busy(true);message('인쇄용 원본 사진을 준비합니다.');let printRoot;
  try{
   printRoot=el('div');printRoot.id='aiselMeetingPrintRoot';printRoot.append(...loaded.map((item,i)=>page(item,i,loaded.length)));document.body.append(printRoot);
   const images=[...printRoot.querySelectorAll('img')];let cursor=0;await Promise.all(Array.from({length:Math.min(3,images.length)},async()=>{while(cursor<images.length){const img=images[cursor++];img.loading='eager';img.src=img.dataset.original;await imageReady(img);assertSession(stamp,uid);}}));
   await document.fonts?.ready;assertSession(stamp,uid);document.body.classList.add('aisel-meeting-print');
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));assertSession(stamp,uid);root.print();message('인쇄 창에서 전체 페이지를 선택하거나 PDF로 저장하세요.');
  }catch(error){if(stamp===epoch)message(error.message||'인쇄를 준비하지 못했습니다.',true);}
  finally{if(!document.body.classList.contains('aisel-meeting-print'))printRoot?.remove();if(stamp===epoch)busy(false);}
 }
 root.addEventListener('afterprint',()=>{document.body.classList.remove('aisel-meeting-print');document.getElementById('aiselMeetingPrintRoot')?.remove();});
 root.addEventListener('aisel-session-change',()=>{hide();});
 root.addEventListener('aisel-access-change',()=>{if(visible&&root.AiselAccess?.allowed('designmeeting')!==true)hide();});
 root.AiselMeetingMaterials={show,hide,openSelection,exportPptx,ready:()=>readyFlight,get visible(){return visible;}};
})(window);
