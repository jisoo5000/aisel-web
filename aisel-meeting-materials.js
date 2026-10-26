/* v266: date-wide meeting materials reuse authorized records; no document copies or writes. */
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
   linked.add(id);out.push({...meeting,title:ref.title||meeting.title,date:ref.date,designer:ref.designer,refId:ref.id,reference:ref});
  }
  for(const meeting of meetings)if(!linked.has(meeting.id))out.push({...meeting,refId:''});
  return out.filter(row=>!row.archivedAt).sort((a,b)=>rank(a)-rank(b)||text(a.id).localeCompare(text(b.id)));
 }
 function select(rows,date,designer){return rows.filter(row=>row.date===date&&(!designer||row.designer===designer));}
 function route(date,designer){const u=new URL(root.location.href);u.hash='meeting-materials?'+new URLSearchParams({date,designer});return u.href;}
 function routeSelection(hash=root.location.hash){const match=hash.match(/^#meeting-materials(?:\?(.*))?$/);const p=new URLSearchParams(match?.[1]||'');return {date:validDate(p.get('date'))?p.get('date'):'',designer:p.get('designer')||''};}
 root.AiselMeetingMaterialsCore=Object.freeze({candidateId,entries,select,rank,routeSelection});
 let pane,visible=false,epoch=0,rows=[],loaded=[],stops=[],loading=false;
 const $=selector=>pane.querySelector(selector),account=()=>root.AiselAuth?.currentUser?.();
 function el(tag,value,cls){const node=document.createElement(tag);if(value!==undefined)node.textContent=value;if(cls)node.className=cls;return node;}
 function button(value,fn){const node=el('button',value);node.type='button';node.addEventListener('click',fn);return node;}
 function message(value,failed=false){$('.mm-message').textContent=value;$('.mm-message').classList.toggle('error',failed);}
 function assertSession(stamp,uid){if(stamp!==epoch||account()?.uid!==uid||!visible||root.AiselAccess?.allowed('designmeeting')!==true)throw Error('계정이나 화면이 변경되었습니다. 회의자료를 다시 열어주세요.');}
 function busy(on){loading=on;for(const node of pane.querySelectorAll('.mm-controls button,.mm-controls select,.mm-controls input'))node.disabled=on;$('.mm-print').disabled=on||!loaded.length;$('.mm-share').disabled=on||!loaded.length;}
 function link(value,label){const u=http(value);if(!u)return el('span','');const a=el('a',label||u);a.href=u;a.target='_blank';a.rel='noopener noreferrer';return a;}
 function appLink(kind,id){const u=new URL(root.location.href);u.hash=kind+'='+encodeURIComponent(id);return u.href;}
 function clear(){epoch++;loaded=[];rows=[];for(const stop of stops)stop();stops=[];if(pane){$('.mm-pages').replaceChildren();$('.mm-count').textContent='';busy(false);}document.body.classList.remove('aisel-meeting-print');document.getElementById('aiselMeetingPrintRoot')?.remove();}
 function ensure(){
  if(pane)return;
  pane=el('section',undefined,'mm-view');pane.id='aiselMeetingMaterialsView';pane.hidden=true;
  const top=el('div',undefined,'mm-top'),title=el('div');title.append(el('h2','회의자료'),el('p','해당 날짜의 디자인회의 전체를 확인하고 종이에 메모하세요.'));
  const legacy=button('기존 무드보드',()=>root.AiselUnified?.show('moodboards'));legacy.className='mm-legacy noprint';top.append(title,legacy);
  const controls=el('div',undefined,'mm-controls noprint');
  const dateLabel=el('label','회의일 '),date=el('input');date.type='date';date.className='mm-date';dateLabel.append(date);
  const personLabel=el('label','디자이너 '),person=el('select');person.className='mm-designer';personLabel.append(person);
  const open=button('전체 보기',()=>loadSelection()),print=button('인쇄 / PDF 저장',()=>printAll()),share=button('회의 링크 복사',()=>shareLink());print.className='mm-print';share.className='mm-share';
  controls.append(dateLabel,personLabel,open,print,share);
  const status=el('p','', 'mm-message');status.setAttribute('role','status');
  pane.append(top,controls,el('p','','mm-count'),status,el('div',undefined,'mm-pages'));
  document.getElementById('mainBar').parentNode.append(pane);
  for(const input of [date,person])input.addEventListener('change',()=>{epoch++;loaded=[];$('.mm-pages').replaceChildren();busy(false);message('전체 보기를 누르면 선택한 회의를 불러옵니다.');$('.mm-count').textContent='';});
 }
 function field(label,value,cls=''){const block=el('div',undefined,'mm-field '+cls);block.append(el('strong',label),el('div',text(value),'mm-value'));return block;}
 function choice(value,labels){return labels[value]||'';}
 function usp(record){let list;try{list=JSON.parse(record.uspKeywordsJson||'[]');}catch(_){list=[];}return Array.isArray(list)?list.map(item=>typeof item==='string'?item:typeof item?.value==='string'?item.value:typeof item?.text==='string'?item.text:'').filter(Boolean).join(' · ')||text(record.uspValue):text(record.uspValue);}
 function photoList(record,reference){const result=[],seen=new Set(),meetingPhotos=Array.isArray(record.photos)?record.photos:record.photo?[{original:record.photo,thumb:record.photo}]:Object.values(record.photos||{});for(const photo of [...(reference?.photos||[]),...meetingPhotos]){const original=http(photo.original||photo.url),thumb=http(photo.thumb||photo.thumbnail||original),key=photo.hash||original||thumb;if(!key||seen.has(key))continue;seen.add(key);result.push({original:original||thumb,thumb,hash:photo.hash});}return result;}
 function page(item,index,total){
  const {record,reference,row}=item,article=el('article',undefined,'mm-page'),head=el('header',undefined,'mm-page-head');
  head.append(el('strong',row.date+' · '+row.designer),el('span',String(index+1).padStart(2,'0')+' / '+total));article.append(head);
  const grid=el('div',undefined,'mm-grid'),left=el('div',undefined,'mm-left'),photos=el('div',undefined,'mm-photos');
  for(const [i,p] of item.photos.entries()){const img=el('img');img.alt=(row.title||'회의 레퍼런스')+' 사진 '+(i+1);img.loading='lazy';img.decoding='async';img.dataset.original=p.original;img.src=i===0&&row.reference?root.AiselGalleryIndex.imageSource('references',row.refId,p.thumb):p.thumb;photos.append(img);}
  if(!item.photos.length)photos.append(el('p','등록된 사진이 없습니다.'));
  const links=el('div',undefined,'mm-links');links.append(link(appLink('design-meeting',record.id),'디자인회의 열기'));
  if(row.refId)links.append(link(appLink('reference',row.refId),'원본 레퍼런스'));
  const sources=[...(reference?.sourceLinks||[]),reference?.sourceUrl,record.link,...(record.links||[])].map(http).filter(Boolean);
  for(const u of [...new Set(sources)])links.append(link(u,u));
  left.append(photos,links);
  const right=el('div',undefined,'mm-right');
  right.append(field('제목',row.title,'mm-title'),field('수요 / 공급',[choice(record.marketDemand,{high:'수요 높음',low:'수요 낮음',niche:'틈새 수요',unknown:'수요 확인 필요'}),choice(record.substituteSupply,{many:'공급 많음',few:'공급 적음',unknown:'공급 확인 필요'})].filter(Boolean).join(' / ')),field('USP · 차별성',usp(record)),field('인게이지먼트',choice(record.engagementLevel,{high:'높음',low:'낮음',unknown:'확인 필요'})),field('디자인 수정 · 회의 메모',[record.development,record.meetingMemo,record.memo,...Object.values(record.referenceNotes||{}).map(note=>text(note?.text))].filter(Boolean).join('\n'),'mm-memo'));
  const experiment=el('div',undefined,'mm-experiment');experiment.append(el('strong','가설 검증'),el('p','예: 타깃 고객에게 핏 또는 컬러 한 가지만 바꿔 비교하고, 선택 이유를 기록합니다.','mm-hint'),field('가설 · 대상 고객',record.hypothesis),field('검증 방법 · 비교안',record.validationMethod),field('판단 기준 · 확인 날짜',record.successCriteria),field('관찰 결과 · 다음 수정',record.validationResult));right.append(experiment);
  const actions=el('div',undefined,'mm-actions noprint');actions.append(button('확인 · 수정 / 작업지시서',async()=>{if(await root.AiselUnified.show('designmeeting'))await root.AiselDesignMeeting.open(record.id);}));
  grid.append(left,right);article.append(grid,actions);return article;
 }
 async function loadSelection(){
  const date=$('.mm-date').value,designer=$('.mm-designer').value;if(!validDate(date)){message('회의 날짜를 선택해주세요.',true);return;}
  const stamp=++epoch,uid=account()?.uid;loaded=[];$('.mm-pages').replaceChildren();busy(true);message('선택한 회의의 전체 자료를 확인하고 있습니다.');
  try{
   await Promise.all(['references','meetings'].map(kind=>root.AiselGalleryIndex.warm(kind,{refresh:true})));assertSession(stamp,uid);
   const refs=root.AiselGalleryIndex.snapshot('references'),meetings=root.AiselGalleryIndex.snapshot('meetings');
   if(!refs.available||!refs.complete||!meetings.available||!meetings.complete)throw Error('전체 목록 확인이 끝나지 않았습니다. 일부만 인쇄하지 않도록 다시 불러와주세요.');
   rows=await entries(refs.records,meetings.records);assertSession(stamp,uid);
   const chosen=select(rows,date,designer),results=new Array(chosen.length);let cursor=0;
   await Promise.all(Array.from({length:Math.min(3,chosen.length)},async()=>{while(cursor<chosen.length){const n=cursor++,row=chosen[n];const [detail,ref]=await Promise.all([root.AiselGalleryIndex.detail('meetings',row.id),row.refId?root.AiselGalleryIndex.detail('references',row.refId):null]);assertSession(stamp,uid);const record=detail.record,reference=ref?.record;
     if(record.designMeetingDeletedAt||reference?.archivedAt)throw Error('삭제 또는 보관된 항목이 있습니다. 전체 보기를 다시 눌러주세요.');
     if(reference&&record.sourceRefId!==reference.id)throw Error('레퍼런스와 디자인회의 연결을 확인하지 못했습니다.');
     if((reference?.date||record.meetingDate||record.date||'')!==date||(designer&&(reference?.designer||record.designer||'')!==designer))throw Error('회의 날짜나 담당자가 변경되었습니다. 전체 보기를 다시 눌러주세요.');
     const fresh={...row,title:reference?.title||record.title||'',date:reference?.date||record.meetingDate||record.date,designer:reference?.designer||record.designer||''};results[n]={row:fresh,record,reference,photos:photoList(record,reference)};
   }}));assertSession(stamp,uid);
   loaded=results.sort((a,b)=>rank(a.row)-rank(b.row)||text(a.row.id).localeCompare(text(b.row.id)));
   $('.mm-pages').replaceChildren(...loaded.map((item,i)=>page(item,i,loaded.length)));
   $('.mm-count').textContent=date+' · '+(designer||'전체 디자이너')+' · '+loaded.length+'개 전체';
   const mismatches=loaded.filter(x=>x.reference&&x.record.meetingDate&&x.reference.date!==x.record.meetingDate).length;
   message(!loaded.length?'해당 날짜의 디자인회의가 없습니다.':mismatches?'원본 레퍼런스의 최신 회의일 기준입니다. 기존 회의일과 다른 '+mismatches+'개는 원본 기록을 함께 확인해주세요.':'전체 '+loaded.length+'개를 불러왔습니다. 판단이 없는 칸은 비워두었습니다.');
   history.replaceState({aiselUnified:true,view:'meetingmaterials'},'',route(date,designer));
  }catch(error){if(stamp===epoch){loaded=[];$('.mm-pages').replaceChildren();message(error.message||'회의자료를 불러오지 못했습니다.',true);}}
  finally{if(stamp===epoch)busy(false);}
 }
 async function show({hash}={}){
  ensure();visible=true;pane.hidden=false;$('.mm-legacy').hidden=root.AiselAccess?.allowed('moodboards')!==true;const stamp=++epoch,uid=account()?.uid;busy(true);message('회의 날짜와 담당자를 확인하고 있습니다.');
  try{
   await Promise.all(['references','meetings'].map(kind=>root.AiselGalleryIndex.warm(kind,{preferCache:true})));assertSession(stamp,uid);
   const refs=root.AiselGalleryIndex.snapshot('references'),meetings=root.AiselGalleryIndex.snapshot('meetings');if(!refs.complete||!meetings.complete)throw Error('로그인과 전체 목록을 확인한 뒤 다시 열어주세요.');
   rows=await entries(refs.records,meetings.records);assertSession(stamp,uid);
   const requested=routeSelection(hash),previous=$('.mm-designer').value,people=[...new Set(rows.map(row=>row.designer).filter(Boolean))].sort();$('.mm-designer').replaceChildren();for(const value of ['',...people]){const option=el('option',value||'전체');option.value=value;$('.mm-designer').append(option);}
   $('.mm-designer').value=requested.designer||previous;const dates=[...new Set(rows.map(row=>row.date).filter(validDate))].sort(),today=new Date().toLocaleDateString('sv-SE');$('.mm-date').value=requested.date||$('.mm-date').value||dates.find(date=>date>=today)||dates.at(-1)||today;
   busy(false);message('날짜와 디자이너를 선택해 전체 자료를 확인하세요.');
   if(requested.date)await loadSelection();return true;
  }catch(error){if(stamp===epoch){message(error.message,true);busy(false);}return true;}
 }
 function hide(){visible=false;if(pane)pane.hidden=true;clear();}
 async function shareLink(){try{await navigator.clipboard.writeText(route($('.mm-date').value,$('.mm-designer').value));message('회의 링크를 복사했습니다. 기존 앱 접근 권한이 있는 디자이너가 볼 수 있습니다.');}catch(_){message('주소창의 회의 링크를 복사해주세요.');}}
 async function imageReady(img){if(img.complete&&img.naturalWidth)return;await new Promise((resolve,reject)=>{let timer;const done=()=>{clearTimeout(timer);img.removeEventListener('load',ok);img.removeEventListener('error',fail);},ok=()=>{done();resolve();},fail=()=>{done();reject(Error('사진을 모두 불러오지 못했습니다. 다시 시도해주세요.'));};img.addEventListener('load',ok);img.addEventListener('error',fail);timer=setTimeout(fail,25000);if(img.complete&&img.naturalWidth)ok();});}
 async function printAll(){if(loading||!loaded.length)return;const stamp=epoch,uid=account()?.uid;busy(true);message('인쇄용 원본 사진을 준비합니다.');let printRoot;
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
 root.AiselMeetingMaterials={show,hide,get visible(){return visible;}};
})(window);
