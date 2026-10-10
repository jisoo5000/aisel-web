(function(){
 'use strict';
 const C=window.AiselDesignMeetingCore, $dm=s=>document.querySelector(s);
 const ROOT=firebase.database().ref('moodboardRefs');
 const BRIDGE=window.AISEL_DESIGN_MEETING_BRIDGE||'';
 const OWNER='sooana1214@gmail.com';
 let cards={},results=[],active=null,filter='planned',limit=40,lastSig='',listening=false,busy=false,detailDirty=false,role=null;
 const pending=new Map(),dirtyFields=new Set();let savePromise=null;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const safe=v=>esc(C.httpUrl(v));
 const uid=()=> 'dm_'+crypto.randomUUID().replace(/-/g,'');
 const pane=$dm('#designMeetingView');
 const login=document.createElement('button');login.type='button';login.textContent='디자인회의 로그인';login.id='dmLogin';pane.querySelector('#dmTools').append(login);
 const members=document.createElement('details');members.id='dmMembers';members.hidden=true;members.innerHTML='<summary>참여자 관리</summary><p>Google 로그인 이메일을 등록하면 사진 등록·검토 요청·결과 확인을 사용할 수 있습니다. 등록·중지 시 메시지는 보내지 않습니다.</p><label>참여자 Google 이메일 <input type="email" id="dmMemberEmail" autocomplete="off"></label><button type="button" id="dmMemberAdd">참여자 등록</button><div id="dmMemberList"></div>';login.after(members);
 function memberUser(){return (firebase.apps||[]).map(a=>{try{return a.auth().currentUser;}catch(e){return null;}}).find(u=>u?.emailVerified&&String(u.email||'').toLowerCase()===OWNER)||(firebase.apps||[]).find(a=>a.name==='aiselDesignMeeting')?.auth().currentUser;}
 function applyRole(){members.hidden=role!=='owner';login.textContent=role==='owner'?'대표자 · 디자인회의 연결됨':role==='designer'?'디자이너 · 디자인회의 연결됨':'디자인회의 로그인';$dm('#dmConvert').hidden=role!=='owner';$dm('#dmDrop').hidden=role!=='owner';$dm('#dmWorkorder').hidden=role!=='owner';for(const k of ['decision','decisionReason'])$dm('[data-dm-field="'+k+'"]').disabled=role!=='owner';render();}
 async function access(){const data=await bridge('access',[]);role=data.role;applyRole();return data;}
 function showMembers(items){const box=$dm('#dmMemberList');box.replaceChildren();for(const m of items){const row=document.createElement('p');row.textContent=m.email+' · '+(m.active?'사용 중':'사용 중지');const b=document.createElement('button');b.type='button';b.textContent=m.active?'사용 중지':'다시 허용';b.onclick=async()=>{try{const data=await bridge('setMember',[],{email:m.email,active:!m.active});showMembers(data.members);message('참여자 권한을 저장했습니다.');}catch(e){message(e.message,true);}};row.append(b);box.append(row);}}
 members.addEventListener('toggle',async()=>{if(members.open)try{showMembers((await bridge('members',[])).members);}catch(e){message(e.message,true);}});
 $dm('#dmMemberAdd').onclick=async()=>{try{const data=await bridge('setMember',[],{email:$dm('#dmMemberEmail').value,active:true});showMembers(data.members);$dm('#dmMemberEmail').value='';message('참여자를 등록했습니다. 해당 계정으로 Google 로그인하면 사용할 수 있습니다.');}catch(e){message(e.message,true);}};
 login.onclick=async()=>{try{if(!memberUser()){const app=(firebase.apps||[]).find(a=>a.name==='aiselDesignMeeting')||firebase.initializeApp(firebase.app().options,'aiselDesignMeeting');const provider=new firebase.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await app.auth().signInWithPopup(provider);}await access();}catch(e){role=null;applyRole();message(e.message,true);}};
 window.addEventListener('aisel-owner-auth-change',()=>{if(!memberUser()){role=null;applyRole();}});
 function message(text,error=false){$dm('#dmStatus').textContent=text;$dm('#dmStatus').classList.toggle('dm-error',error);if(active)requestAnimationFrame(fitDetail);}
 function current(id){return cards[id];}
 function state(c){return C.status(c,results);}
 function confirmedResult(c){return results.find(r=>r.id===c.id&&Number(r.version)===(Number(c.inputVersion)||1)&&r.state==='done'&&r.receipt&&r.reviewedAt);}
 async function mutate(id,patch,material=false){
   const out=await ROOT.child(id).transaction(c=>c?material?C.edit(c,patch):{...c,...patch,updatedAt:Date.now()}:undefined,undefined,false);
   if(!out.committed)throw Error('후보 저장을 확인하지 못했습니다. 입력을 유지했습니다.');
   cards[id]=out.snapshot.val();return cards[id];
 }
 let draftDb;
 function drafts(){if(!draftDb)draftDb=new Promise((resolve,reject)=>{const r=indexedDB.open('aisel-design-meeting-drafts',1);r.onupgradeneeded=()=>r.result.createObjectStore('files',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return draftDb;}
 async function local(action,item){const db=await drafts();return new Promise((resolve,reject)=>{const tx=db.transaction('files',action==='all'?'readonly':'readwrite'),store=tx.objectStore('files');let request;if(action==='put')request=store.put(item);else if(action==='delete')request=store.delete(item);else request=store.getAll();let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);});}
 async function digest(file){const bytes=await file.arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 async function thumbnail(file){
   const url=URL.createObjectURL(file);
   try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,480/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.78));if(!blob)throw Error('썸네일 생성 실패');return {blob,width:img.width,height:img.height};}finally{URL.revokeObjectURL(url);}
 }
 async function upload(item){
   pending.set(item.id,item);renderPending();
   try{
     await access();
     const existing=(await ROOT.child(item.id).once('value')).val();
     const uploaded=existing?C.photos(existing):[];
     const photos=item.replaceKey?[]:[...uploaded];
     for(let n=0;n<item.files.length;n++){
       const file=item.files[n],hash=await digest(file);
       if(photos.some(p=>p.hash===hash))continue;
       const reusable=Object.values(cards).flatMap(C.photos).find(p=>p.hash===hash&&p.original&&p.thumb);
       if(reusable){photos.push({...reusable});continue;}
       const thumb=await thumbnail(file);
       // Original bytes preserve tall screenshots and small lettering. No resizing of existing workorder photos.
       const encode=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
       const original=(await bridge('upload',[],{id:item.id,hash,kind:'original',mime:file.type,data:await encode(file)})).photo.url;
       const small=(await bridge('upload',[],{id:item.id,hash,kind:'thumb.jpg',mime:'image/jpeg',data:await encode(thumb.blob)})).photo.url;
       photos.push({hash,original,thumb:small,width:thumb.width,height:thumb.height,bytes:file.size,thumbBytes:thumb.blob.size});
     }
     const out=await ROOT.child(item.id).transaction(c=>{
       if(c&&item.replaceKey)return C.replacePhoto(c,item.replaceKey,photos[0]);
       if(!c&&item.replaceKey)return;
       if(c){const merged=[...C.photos(c)];photos.forEach(p=>{if(!merged.some(x=>(x.hash||x.original)===(p.hash||p.original)))merged.push(p);});return C.edit(c,{photos:merged,photo:merged[0]?.original||''});}
       return {id:item.id,designMeeting:true,inputVersion:1,photos,photo:photos[0]?.original||'',title:'',link:'',memo:'',development:'',createdAt:Date.now(),updatedAt:Date.now(),reviewState:'idle',decision:'unselected',meetingDate:'',convertedCode:''};
     },undefined,false);
     if(!out.committed)throw Error('카드 저장 확인 실패');
     cards[item.id]=out.snapshot.val();pending.delete(item.id);await local('delete',item.id);renderPending();render();if(active===item.id){renderDetailPhotos(cards[item.id]);renderReview(cards[item.id]);}message('사진과 후보를 저장했습니다.');await enqueueCandidate(item.id);
   }catch(e){item.error=e.message;pending.set(item.id,item);renderPending();message('사진을 보관했습니다. 실패한 항목을 다시 시도해주세요. '+e.message,true);}
 }
 function renderPending(){const box=$dm('#dmPending');box.replaceChildren();for(const item of pending.values()){const row=document.createElement('div');row.className='dm-pending';row.textContent=`${item.files.length}장 · ${item.error||'저장 중…'}`;if(item.error){const b=document.createElement('button');b.textContent='다시 시도';b.onclick=()=>upload(item);row.append(b);}box.append(row);}}
 async function receive(files,target=null,replaceKey=null){
   const images=[...files].filter(f=>f.type.startsWith('image/'));const usable=replaceKey?images.slice(0,1):images;if(!usable.length)return;
   if(target&&detailDirty){await saveDetail();if(detailDirty)return;}
   const grouped=target||$dm('#dmGroup').checked;
   const groups=grouped?[usable]:usable.map(f=>[f]);
   for(const group of groups){const item={id:target||uid(),files:group,...(replaceKey?{replaceKey}:{})};try{await local('put',item);}catch(e){message('이 기기는 임시 사진 보관을 지원하지 않습니다. 업로드가 끝날 때까지 화면을 유지해주세요.',true);}await upload(item);}
 }
 function render(){
   if(pane.hidden)return;
   if(pane.contains(document.activeElement)&&document.activeElement.matches('input:not([type=checkbox]):not([type=search]),textarea,select,[contenteditable=true]'))return;
   const q=$dm('#dmSearch').value.toLowerCase();
   const all=Object.values(cards).filter(c=>c.designMeeting===true);
   const selected=all.filter(c=>['selected','progress'].includes(c.decision)&&!c.convertedCode);
   $dm('#dmConvert').textContent=`작업지시서 · ${selected.length}개`;$dm('#dmConvert').disabled=!selected.length||busy;$dm('#dmConvert').hidden=role!=='owner'||!selected.length||!!active;
   const shown=all.filter(c=>{
     if(filter==='planned'&&(c.decision==='excluded'||c.convertedCode))return false;
     if(filter==='drop'&&c.decision!=='excluded')return false;
     if(filter==='unselected'&&c.decision!=='unselected')return false;
     if(filter==='progress'&&c.decision!=='progress')return false;
     if(q&&!`${c.title||''} ${c.memo||''} ${c.link||''}`.toLowerCase().includes(q))return false;
     if(filter==='pending'&&state(c)==='done')return false;
     if(filter==='done'&&state(c)!=='done')return false;
     if(filter==='selected'&&c.decision!=='selected')return false;
     if(filter==='linked'&&!c.convertedCode)return false;return true;
   }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
   $dm('#dmCount').textContent=`불러온 ${all.length}개 · 표시 ${Math.min(limit,shown.length)}개`;
   $dm('#dmMore').hidden=shown.length<=limit&&!hasOlder;$dm('#dmMore').textContent=shown.length>limit?'더 보기':'이전 후보 더 보기';
   const sig=JSON.stringify([shown.slice(0,limit),results,filter,q,role]);if(sig===lastSig)return;lastSig=sig;
   const grid=$dm('#dmGrid');
   let add=$dm('#dmGallery');if(!add){add=document.createElement('button');add.type='button';add.id='dmGallery';add.className='dm-add-card';add.textContent='+ 사진 추가';add.onclick=()=>{$dm('#dmFileInput').dataset.target='';$dm('#dmFileInput').click();};grid.append(add);}
   const keep=new Set(shown.slice(0,limit).map(c=>c.id));for(const node of grid.querySelectorAll('.dm-card'))if(!keep.has(node.dataset.id))node.remove();let previous=add;
   for(const c of shown.slice(0,limit)){
     const result=confirmedResult(c),photo=C.photos(c)[0];let card=[...grid.children].find(n=>n.dataset.id===c.id);if(!card){card=document.createElement('article');card.className='dm-card';card.dataset.id=c.id;
     card.innerHTML=`<button class="dm-open" type="button">${photo?.thumb?`<img loading="lazy" decoding="async" src="${safe(photo.thumb)}" alt="후보 사진">`:'<span class="dm-no-photo">사진 없음</span>'}<div class="dm-card-info"><strong>${esc(c.title||'사진 후보')}</strong><div class="dm-colors"></div><time>${esc(C.dateLabel(c.createdAt))}</time></div></button><label class="dm-select"><input type="checkbox" aria-label="${esc(c.title||'후보')} 선택"></label>`;
     }
     const opener=card.querySelector('.dm-open'),src=C.httpUrl(photo?.thumb),oldImg=opener.querySelector('img');
     if(src){if(oldImg){if(oldImg.getAttribute('src')!==src)oldImg.src=src;}else{opener.querySelector('.dm-no-photo')?.remove();const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.alt='후보 사진';img.src=src;opener.prepend(img);}}
     else if(oldImg){const empty=document.createElement('span');empty.className='dm-no-photo';empty.textContent='사진 없음';oldImg.replaceWith(empty);}
     card.querySelector('strong').textContent=c.title||'사진 후보';card.querySelector('time').textContent=C.dateLabel(c.createdAt);card.querySelector('input').setAttribute('aria-label',(c.title||'후보')+' 선택');
     const colors=card.querySelector('.dm-colors');colors.replaceChildren();renderColors(colors,c,result);
     card.querySelector('.dm-open').onclick=()=>open(c.id);
     card.querySelector('input').checked=['selected','progress'].includes(c.decision);card.querySelector('input').disabled=role!=='owner';card.querySelector('input').onchange=async e=>{const desired=e.target.checked;try{if(role!=='owner')throw Error('대표자 선택은 대표자만 변경할 수 있습니다.');await mutate(c.id,{decision:desired?'selected':'unselected'});render();}catch(err){e.target.checked=!desired;message(err.message,true);}};
     if(previous.nextElementSibling!==card)previous.after(card);previous=card;
   }
 }
 async function open(id){if(detailDirty){await saveDetail();if(detailDirty)return;}active=id;$dm('#dmTools').close();message('');const c=current(id);if(!c)return;detailDirty=false;dirtyFields.clear();$dm('#dmList').hidden=true;$dm('.dm-toolbar').hidden=true;$dm('#dmConvert').hidden=true;
   const detail=$dm('#dmDetail');detail.hidden=false;window.scrollTo(0,0);$dm('.dm-detail-body').scrollTop=0;$dm('#dmDetailTitle').textContent=c.title||'후보 상세';
   for(const k of ['title','link','memo','development','meetingDate','decision','decisionReason','meetingMemo'])$dm('[data-dm-field="'+k+'"]').value=c[k]||(['decision'].includes(k)?'unselected':'');
   $dm('#dmDetailSaveState').textContent='';$dm('#dmSaveDetail').hidden=true;renderLinks(c);renderDesigner(c);renderDetailPhotos(c);renderReview(c);watchActive();requestAnimationFrame(fitDetail);refresh(false,[id]);
 }
 function fitDetail(){
   if(pane.hidden||$dm('#dmDetail').hidden)return;
   const detail=$dm('#dmDetail'),viewport=window.visualViewport;
   const bottom=(viewport?.height||innerHeight)+(viewport?.offsetTop||0);
   detail.style.setProperty('--dm-height',Math.max(240,bottom-detail.getBoundingClientRect().top-4)+'px');
   const body=$dm('.dm-detail-body'),photos=$dm('#dmPhotos');
   const nonPhoto=[...body.children].filter(n=>n!==photos&&!n.hidden).reduce((sum,n)=>{const s=getComputedStyle(n);return sum+n.getBoundingClientRect().height+parseFloat(s.marginTop||0)+parseFloat(s.marginBottom||0);},0);
   detail.style.setProperty('--dm-photo-height',Math.max(140,Math.min(340,body.clientHeight-nonPhoto-8))+'px');
 }
 window.addEventListener('resize',fitDetail);window.visualViewport?.addEventListener('resize',fitDetail);
 function renderColors(box,c,result){const source=c.selectedColors||C.evidence(result).colors||[];const raw=Array.isArray(source)?source:[];const names=window.colorNames_?window.colorNames_(raw):raw.filter(x=>typeof x==='string');for(const name of names){const chip=document.createElement('span');chip.className='gcard-color-chip';chip.textContent=name;const info=window.colorHex_?.(name);if(info&&/^#[0-9a-f]{3,8}$/i.test(info.hex)){chip.style.backgroundColor=info.hex;if(/^#[0-9a-f]{3,8}$/i.test(info.text))chip.style.color=info.text;}box.append(chip);}}
 function renderDesigner(c){const select=$dm('#dmDesigner');select.replaceChildren(new Option('미지정',''));const names=[...new Set([...(window.AiselDesignMeetingAdapter.designers?.()||[]),c.designer].filter(Boolean))];for(const name of names)select.add(new Option(name,name));select.value=c.designer||'';}
 function renderLinks(c){const box=$dm('#dmLinks');box.replaceChildren();const links=Array.isArray(c.links)?c.links:(c.link?[c.link]:[]);links.forEach((url,index)=>{const row=document.createElement('div');row.className='dm-link-row';row.innerHTML='<a class="dm-link-open" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/></svg><span>링크</span></a><button class="dm-icon" type="button" aria-label="링크 수정"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 16l-1 5 5-1L20 8a2.83 2.83 0 0 0-4-4Z"/></svg></button><button class="dm-icon" type="button" aria-label="링크 삭제"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button>';row.querySelector('a').href=C.httpUrl(url);const buttons=row.querySelectorAll('button');buttons[0].onclick=()=>editLink(index);buttons[1].onclick=()=>editLink(index,true);box.append(row);});if(!links.length){const empty=document.createElement('button');empty.type='button';empty.className='dm-link-open';empty.innerHTML="<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2\"/></svg><span>링크</span>";empty.onclick=()=>editLink();box.append(empty);}const add=document.createElement('button');add.type='button';add.className='dm-link-add';add.textContent='+';add.setAttribute('aria-label','링크 추가');add.onclick=()=>manageLinks();box.append(add);}
 function manageLinks(){
   const c=current(active),links=Array.isArray(c.links)?c.links:(c.link?[c.link]:[]);
   let dlg=$dm('#dmLinkDialog');if(!dlg){dlg=document.createElement('dialog');dlg.id='dmLinkDialog';dlg.className='dm-dialog';pane.append(dlg);}dlg.replaceChildren();
   const title=document.createElement('h3');title.textContent='상품 링크';dlg.append(title);
   links.forEach((url,index)=>{const row=document.createElement('p'),a=document.createElement('a');a.href=C.httpUrl(url);a.target='_blank';a.rel='noopener';a.textContent='링크 '+(index+1);row.append(a);for(const [text,remove] of [['수정',false],['삭제',true]]){const b=document.createElement('button');b.textContent=text;b.onclick=async()=>{dlg.close();await editLink(index,remove);};row.append(b);}dlg.append(row);});
   const add=document.createElement('button');add.textContent='링크 추가';add.onclick=()=>{dlg.close();editLink();};const close=document.createElement('button');close.textContent='닫기';close.onclick=()=>dlg.close();dlg.append(add,close);dlg.showModal();
 }
 async function editLink(index,remove=false){if(!active||!await saveDetail())return;const c=current(active),links=Array.isArray(c.links)?[...c.links]:(c.link?[c.link]:[]);if(remove){links.splice(index,1);}else{const value=window.prompt('상품 링크',index===undefined?'':links[index]);if(value===null)return;if(!C.httpUrl(value)){message('http 또는 https 상품 링크를 입력해주세요.',true);return;}if(index===undefined)links.unshift(C.httpUrl(value));else links[index]=C.httpUrl(value);}try{await access();await mutate(c.id,{links,link:links[0]||''},true);$dm('[data-dm-field="link"]').value=links[0]||'';renderLinks(current(c.id));renderReview(current(c.id));await enqueueCandidate(c.id);}catch(e){message(e.message,true);}}
 function renderDetailPhotos(c){const box=$dm('#dmPhotos');const photos=C.photos(c),signature=JSON.stringify([c.id,photos.map(p=>[p.hash,p.original,p.thumb])]);if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.replaceChildren();$dm('#dmAddPhotos').hidden=photos.length>0;photos.forEach((p,i)=>{const button=document.createElement('button');button.type='button';button.className='dm-photo';button.dataset.photoKey=p.hash||p.original;button.setAttribute('aria-label','참고 사진 '+(i+1)+' 변경');button.onclick=()=>{const input=$dm('#dmReplaceInput');input.dataset.target=c.id;input.dataset.key=p.hash||p.original;input.click();};const img=document.createElement('img');img.loading='lazy';img.src=C.httpUrl(p.original||p.thumb);img.alt='참고 사진 '+(i+1);button.append(img);box.append(button);});}
 function renderReview(c){if(!c)return;const result=confirmedResult(c),status=state(c),box=$dm('#dmReview');box.replaceChildren();$dm('#dmDates').textContent=['등록 '+(C.dateLabel(c.createdAt)||'—'),result?'검토 '+C.dateLabel(result.reviewedAt):''].filter(Boolean).join(' · ');$dm('#dmDrop').textContent=c.decision==='excluded'?'복원':'드롭';$dm('#dmWorkorder').textContent='작업지시서';
   {const summary=result?C.reviewSummary(result):{demand:'—',supply:'—',differentiation:'—',additional:''},table=document.createElement('table');table.className='dm-evidence';for(const [label,key] of [['수요','demand'],['공급','supply'],['차별성','differentiation']]){const tr=table.insertRow();const th=document.createElement('th');th.scope='row';th.textContent=label;const td=document.createElement('td');td.textContent=summary[key];tr.append(th,td);}box.append(table);if(summary.additional){const p=document.createElement('p');p.className='dm-additional';const strong=document.createElement('strong');strong.textContent='추가 고려사항';p.append(strong,document.createTextNode(summary.additional));box.append(p);}}
   $dm('#dmReviewState').textContent=result?'':(C.states[status]||'확인 필요');const row=results.find(r=>r.id===c.id&&Number(r.version)===Number(c.inputVersion));if(row?.error)$dm('#dmReviewState').textContent=row.error;$dm('#dmRequest').hidden=!!result||['running','queued'].includes(status);$dm('#dmOpenWorkorder').hidden=true;requestAnimationFrame(fitDetail);
 }
 function saveDetail(){if(savePromise)return savePromise;savePromise=(async()=>{let ok;do{ok=await saveDetailNow();}while(ok&&detailDirty);return ok;})().finally(()=>savePromise=null);return savePromise;}
 async function saveDetailNow(){if(!active||!detailDirty)return true;const id=active;const patch={};for(const k of dirtyFields)patch[k]=$dm('[data-dm-field="'+k+'"]').value;try{await access();}catch(e){$dm('#dmDetailSaveState').textContent=e.message;return false;}
   if(role!=='owner'){delete patch.decision;delete patch.decisionReason;dirtyFields.delete('decision');dirtyFields.delete('decisionReason');}
   if(patch.link&&!C.httpUrl(patch.link)){$dm('#dmDetailSaveState').textContent='상품 링크는 http 또는 https 주소를 입력해주세요.';return false;}
   $dm('#dmDetailSaveState').textContent='저장 중…';try{await mutate(id,patch,true);for(const [k,v] of Object.entries(patch)){if($dm('[data-dm-field="'+k+'"]').value===v)dirtyFields.delete(k);}detailDirty=dirtyFields.size>0;$dm('#dmDetailSaveState').textContent=detailDirty?'미저장':'';$dm('#dmSaveDetail').hidden=true;renderReview(current(id));lastSig='';render();if(Object.keys(patch).some(k=>C.material.includes(k)))await enqueueCandidate(id);return true;}catch(e){$dm('#dmDetailSaveState').textContent=e.message;$dm('#dmSaveDetail').hidden=false;return false;}
 }
 async function memberToken(){
   const user=memberUser();if(!user?.emailVerified)throw Error('디자인회의 로그인 후 사용해주세요.');return user.getIdToken();
 }
 async function bridge(action,ids,extra={}){
   if(!BRIDGE)throw Error('시트 연결 배포 대기입니다. 후보와 사진은 앱에 보존됩니다.');
   const token=await memberToken();
   const response=await fetch(BRIDGE,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...extra,action,ids,token}),redirect:'follow'});
   if(!response.ok)throw Error('시트 응답 확인 실패');const data=await response.json();if(!data.ok)throw Error(data.error||'시트 저장 확인 실패');
   if(Array.isArray(data.results)&&data.results.length){const keys=new Set(data.results.map(r=>C.rowKey(r.id,r.version)));results=results.filter(r=>!keys.has(C.rowKey(r.id,r.version))).concat(data.results);}
   if(action==='results'||action==='enqueue'){render();if(active&&!detailDirty)renderReview(current(active));}return data;
 }
 async function enqueueCandidate(id){try{const data=await bridge('enqueue',[id]);const saved=data.saved?.find(r=>r.id===id);if(!saved)throw Error('검토 대기 저장 확인 필요');await mutate(id,{reviewRequestedVersion:saved.version,reviewState:'queued',sheetConfirmedAt:data.checkedAt});if(active===id)renderReview(current(id));}catch(e){message('사진/내용은 저장됐습니다. 검토 요청을 다시 시도해주세요. '+e.message,true);if(active===id)$dm('#dmRequest').hidden=false;}}
 async function requestReview(){if(!active||busy)return;if(!await saveDetail())return;busy=true;$dm('#dmRequest').disabled=true;const id=active;
   try{message('검토 대기 목록에 저장 중…');const data=await bridge('enqueue',[id]);const saved=data.saved.find(r=>r.id===id);if(!saved)throw Error('후보 저장 확인 없음');await mutate(id,{reviewRequestedVersion:saved.version,reviewState:'queued',sheetConfirmedAt:data.checkedAt});message('시트에 검토 요청을 저장했습니다.');renderReview(current(id));}catch(e){message(e.message,true);}finally{busy=false;$dm('#dmRequest').disabled=false;render();}
 }
 const resultChecks=new Map(),resultFlights=new Map();
 async function refresh(force=false,onlyIds=null){
   if(pane.hidden||!memberUser())return;
   const visible=onlyIds||(active?[active]:[...$dm('#dmGrid').querySelectorAll('.dm-card')].map(n=>n.dataset.id));
   const need=visible.filter(id=>cards[id]?.reviewRequestedVersion&&(force||Date.now()-(resultChecks.get(C.rowKey(id,cards[id].inputVersion))||0)>60000));
   const waits=[];for(let n=0;n<need.length;n+=40){
     const group=need.slice(n,n+40),keys=group.map(id=>C.rowKey(id,cards[id].inputVersion)),key=keys.slice().sort().join('|');
     if(resultFlights.has(key)){waits.push(resultFlights.get(key));continue;}
     const flight=bridge('results',group,{versions:Object.fromEntries(group.map(id=>[id,cards[id].inputVersion||1]))}).then(()=>keys.forEach(k=>resultChecks.set(k,Date.now()))).catch(e=>message(e.message,true)).finally(()=>resultFlights.delete(key));resultFlights.set(key,flight);waits.push(flight);
   }await Promise.all(waits);
 }
 async function adopt(){
   await access();
   const dlg=$dm('#dmAdoptDialog'),list=$dm('#dmAdoptList');list.replaceChildren();
   const snapshot=await ROOT.once('value');
   for(const [id,c] of Object.entries(snapshot.val()||{})){if(c.designMeeting)continue;const row=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.value=id;row.append(input,document.createTextNode(c.memo||c.link||new Date(c.createdAt||0).toLocaleDateString('ko-KR')));list.append(row);}
   dlg.showModal();
 }
 async function adoptSelected(){const ids=[...$dm('#dmAdoptList').querySelectorAll('input:checked')].map(e=>e.value);
   await access();
   for(const id of ids){const out=await ROOT.child(id).transaction(c=>c?{...c,id,designMeeting:true,sourceRefId:c.sourceRefId||id,inputVersion:c.inputVersion||1,reviewState:c.reviewState||'idle',decision:c.decision||'unselected'}:undefined,undefined,false);if(!out.committed)throw Error('레퍼런스 연결 저장을 확인하지 못했습니다.');cards[id]=out.snapshot.val();}
   $dm('#dmAdoptDialog').close();render();message(ids.length+'개 레퍼런스를 같은 사진 주소로 연결했습니다.');
 }
 async function conversionDialog(ids=null){if(busy)return;if(detailDirty&&!await saveDetail())return;
   const chosen=Object.values(cards).filter(c=>c.designMeeting&&['selected','progress'].includes(c.decision)&&!c.convertedCode&&(!Array.isArray(ids)||ids.includes(c.id)));if(!chosen.length)return;
   const dlg=$dm('#dmConversionDialog'),list=$dm('#dmConversionList');list.replaceChildren();
   for(const c of chosen){const row=document.createElement('div');row.dataset.id=c.id;row.className='dm-conversion-row';row.innerHTML=`<strong>${esc(c.title||'사진 후보')}</strong><label>시즌<select class="dm-season"><option value="">선택</option>${document.getElementById('season').innerHTML}</select></label><label>카테고리<select class="dm-category"><option value="">선택</option>${catSel.innerHTML}</select></label>`;row.querySelector('.dm-season').value='';row.querySelector('.dm-category').value='';list.append(row);}
   dlg.showModal();
 }
 async function convertOne(id,season,category){
   await access();if(role!=='owner')throw Error('작업지시서 전환은 대표자만 사용할 수 있습니다.');
   const token=uid(),now=Date.now();
   const reserved=await ROOT.child(id).transaction(c=>{
     if(!c||!['selected','progress'].includes(c.decision)||c.convertedCode)return;
     if(c.conversion?.leaseUntil>now&&c.conversion?.owner!==token)return;
     return {...c,conversion:{...c.conversion,state:'running',owner:token,leaseUntil:now+120000}};
   },undefined,false);
   if(!reserved.committed){const c=(await ROOT.child(id).once('value')).val();if(c?.convertedCode)return c.convertedCode;throw Error('다른 기기에서 전환 중이거나 선택이 해제됐습니다.');}
   let c=reserved.snapshot.val(),code=c.conversion?.code;
   try{
     // The reservation remains on the candidate after any partial failure. Retries always recover that workorder first.
     let st;
     for(let attempt=0;attempt<12;attempt++){
       if(!code){
         const prefix=`AS-${season}-${CATS[Number(category)].code}-`;
         const index=(await woIndexRoot.once('value')).val()||{};
         const max=Math.max(0,...Object.keys(index).filter(k=>k.startsWith(prefix)).map(k=>Number(k.slice(prefix.length))||0));
         const next=await firebase.database().ref('designMeetingCodeCounters/'+season+'_'+CATS[Number(category)].code).transaction(v=>Math.max(Number(v)||0,max)+1,undefined,false);
         code=prefix+String(next.snapshot.val()).padStart(3,'0');
         const assigned=await ROOT.child(id).transaction(value=>value?.conversion?.owner===token?{...value,conversion:{...value.conversion,code:value.conversion.code||code,state:'running',leaseUntil:Date.now()+120000}}:undefined,undefined,false);
         if(!assigned.committed)throw Error('다른 기기에서 이어서 전환 중입니다. 연결 결과를 새로 확인해주세요.');
         c=assigned.snapshot.val();code=c.conversion.code;
       }
       const existing=(await woRoot.child(code).once('value')).val();
       if(existing?.designMeetingCandidateId===id){st=existing;break;}
       if(existing){code=null;continue;}
       st=window.AiselDesignMeetingAdapter.blank(season,category);
       const pics=C.photos(c),result=confirmedResult(c);
       st={...st,designer:c.designer||'',selectedColors:c.selectedColors||C.evidence(result).colors||[],season,cat:String(category),seq:code.split('-').at(-1),pumMyeong:c.title||'',pumAuto:'0',p1:pics[0]?.original||'',p1Thumb:pics[0]?.thumb||'',photoStage:'reference',refLink:c.link||'',refLinks:Array.isArray(c.links)?c.links:(c.link?[c.link]:[]),sizeSpec:(st.sizeSpec||[]).map(row=>({...row,values:(row.values||[]).map(()=> '')})),predNote:[c.memo,c.development,result?'[판단 근거] '+JSON.stringify(C.reviewSummary(result)):'[판단 근거] '+C.states[state(c)]].filter(Boolean).join('\n'),meetingNotes:c.meetingMemo||'',designMeetingCandidateId:id,designMeetingInputVersion:c.inputVersion,designMeetingPhotos:pics,designMeetingReview:result||null,designMeetingSourceLink:location.href+'#design-meeting='+id,status:'sampling',createdAt:Date.now(),updatedAt:Date.now()};
       const created=await woRoot.child(code).transaction(value=>value===null?st:undefined,undefined,false);
       if(created.committed)break;
       const read=created.snapshot.val();if(read?.designMeetingCandidateId===id){st=read;break;}code=null;
     }
     if(!code||!st)throw Error('품번 예약 실패');
     const check=(await woRoot.child(code).once('value')).val();if(check?.designMeetingCandidateId!==id)throw Error('작업지시서 저장 확인 실패');
     if(await writeIndexIfChanged_(code,check)===false)throw Error('작업지시서는 저장됐습니다. 목록 연결을 다시 시도해주세요.');
     const final=await ROOT.child(id).transaction(value=>value?.conversion?.code===code?{...value,convertedCode:code,conversion:{...value.conversion,state:'done',leaseUntil:0,confirmedAt:Date.now()}}:undefined,undefined,false);
     if(!final.committed)throw Error('작업지시서 연결 저장 확인 실패');cards[id]=final.snapshot.val();return code;
   }catch(e){await ROOT.child(id).transaction(value=>value?.conversion?.owner===token?{...value,conversion:{...value.conversion,state:'error',leaseUntil:0,error:e.message}}:undefined,undefined,false).catch(()=>{});throw e;}
 }
 async function convertSelected(){const rows=[...$dm('#dmConversionList').children];if(rows.some(r=>!r.querySelector('.dm-season').value||r.querySelector('.dm-category').value==='')){$dm('#dmConversionStatus').textContent='각 후보의 시즌·카테고리를 선택해주세요.';return;}
   busy=true;$dm('#dmConversionConfirm').disabled=true;let ok=0;const errors=[];
   for(const row of rows){try{await convertOne(row.dataset.id,row.querySelector('.dm-season').value,row.querySelector('.dm-category').value);ok++;}catch(e){errors.push(e.message);}}
   busy=false;$dm('#dmConversionConfirm').disabled=false;window.AiselDesignMeetingAdapter.restore();lastSig='';render();if(active)renderReview(current(active));
   $dm('#dmConversionStatus').textContent=`${ok}/${rows.length}개 저장 확인${errors.length?' · '+errors.join(' / '):''}`;
   if(!errors.length)$dm('#dmConversionDialog').close();message(`${ok}개 작업지시서 연결을 확인했습니다.${errors.length?' 실패 후보만 다시 시도해주세요.':''}`,!!errors.length);
 }
 // Indexed chronological windows; key breaks equal timestamp ties.
 const PAGE=40;let latestQuery=null,latestCallback=null,olderCursor=null,hasOlder=false,loadingOlder=false,latestIds=new Set(),olderIds=new Set(),activeRef=null,activeCallback=null,draftsLoaded=false;
 function entries(snap){return Object.entries(snap.val()||{}).map(([id,c])=>({...c,id})).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||(a.id<b.id?-1:a.id>b.id?1:0));}
 function accept(values){for(const c of values){if(c.designMeeting===true)cards[c.id]=c;else delete cards[c.id];}}
 function repaintActive(){if(!active||detailDirty||!cards[active])return;const c=cards[active];if(!pane.contains(document.activeElement)){renderDetailPhotos(c);renderLinks(c);renderDesigner(c);$dm('#dmDetailTitle').textContent=c.title||'후보 상세';}renderReview(c);}
 function stopActive(){if(activeRef)activeRef.off('value',activeCallback);activeRef=null;activeCallback=null;}
 function watchActive(){stopActive();if(!active||pane.hidden||document.hidden)return;const id=active;activeRef=ROOT.child(id);activeCallback=snap=>{const c=snap.val();if(c){cards[id]={...c,id};repaintActive();}else message('이 후보를 찾을 수 없습니다.',true);};activeRef.on('value',activeCallback,e=>message(e.message,true));}
 function stopListening(){if(latestQuery)latestQuery.off('value',latestCallback);latestQuery=null;latestCallback=null;listening=false;stopActive();}
 function startListening(){
   if(listening||pane.hidden||document.hidden)return;listening=true;
   latestQuery=ROOT.orderByChild('createdAt').limitToLast(PAGE);
   latestCallback=snap=>{const values=entries(snap),next=new Set(values.map(c=>c.id));for(const id of latestIds)if(!next.has(id)&&!olderIds.has(id)&&id!==active)delete cards[id];latestIds=next;accept(values);
     if(!olderIds.size){olderCursor=values[0]?{value:values[0].createdAt??null,id:values[0].id}:null;hasOlder=values.length===PAGE;}
     render();repaintActive();refresh();
   };latestQuery.on('value',latestCallback,e=>{message(e.message,true);stopListening();});
 }
 async function more(){
   if(hasOlder&&!loadingOlder&&olderCursor){loadingOlder=true;$dm('#dmMore').disabled=true;try{
     const cursor=olderCursor,snap=await ROOT.orderByChild('createdAt').endAt(cursor.value,cursor.id).limitToLast(PAGE+1).once('value');
     const values=entries(snap).filter(c=>c.id!==cursor.id);accept(values);values.forEach(c=>olderIds.add(c.id));hasOlder=values.length===PAGE;
     if(values.length)olderCursor={value:values[0].createdAt??null,id:values[0].id};
   }catch(e){message(e.message,true);}finally{loadingOlder=false;$dm('#dmMore').disabled=false;}}
   limit+=PAGE;lastSig='';render();await refresh();
 }
 async function show(){
   await window.AiselDesignMeetingAdapter.leave();
   ['editorView','galleryView','salesView','moodboardView','quickOrderView','sampleMgmtView'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
   pane.hidden=false;setMainTabActive_('designmeeting');startListening();watchActive();
   if(!draftsLoaded){draftsLoaded=true;try{for(const item of await local('all')){item.error='이전에 전송하지 못한 사진 · 다시 시도해주세요.';pending.set(item.id,item);}renderPending();}catch(e){}}
   render();await refresh();
   if(memberUser())try{await access();}catch(e){role=null;applyRole();message(e.message,true);}else applyRole();
 }
 new MutationObserver(()=>{if(pane.hidden)stopListening();else startListening();}).observe(pane,{attributes:true,attributeFilter:['hidden']});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopListening();else if(!pane.hidden){startListening();watchActive();refresh();}});
 $dm('#dmMainTab').onclick=async()=>{if(!await saveDetail())return;$dm('#dmDetail').hidden=true;$dm('#dmList').hidden=false;$dm('.dm-toolbar').hidden=false;active=null;stopActive();lastSig='';await show();};

 $dm('#dmToolsToggle').onclick=()=>$dm('#dmTools').showModal();
 $dm('#dmToolsClose').onclick=()=>$dm('#dmTools').close();
 $dm('#dmReplaceInput').onchange=e=>{receive(e.target.files,e.target.dataset.target,e.target.dataset.key);e.target.value='';};
 $dm('#dmCamera').onclick=()=>{$dm('#dmCameraInput').click();};
 $dm('#dmFileInput').onchange=e=>{receive(e.target.files,e.target.dataset.target||null);e.target.value='';};
 $dm('#dmCameraInput').onchange=e=>{receive(e.target.files);e.target.value='';};
 $dm('#dmAddPhotos').onclick=()=>{$dm('#dmFileInput').dataset.target=active;$dm('#dmFileInput').click();};
 $dm('#dmAddLink').onclick=async()=>{const link=$dm('#dmNewLink').value.trim();if(!C.httpUrl(link)){message('상품 링크를 입력해주세요.',true);return;}const id=uid();try{await access();const c={id,designMeeting:true,inputVersion:1,link,title:'',memo:'',createdAt:Date.now(),updatedAt:Date.now(),reviewState:'idle',decision:'unselected'};await ROOT.child(id).update(c);cards[id]=c;$dm('#dmNewLink').value='';await open(id);await enqueueCandidate(id);}catch(e){message(e.message,true);}};
 $dm('#dmSearch').oninput=()=>{limit=40;render();refresh();};
 $dm('#dmFilters').onclick=e=>{if(!e.target.dataset.filter)return;filter=e.target.dataset.filter;$dm('#dmFilters').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===e.target));limit=40;render();refresh();};
 $dm('#dmMore').onclick=more;
 $dm('#dmDetail').querySelectorAll('[data-dm-field]').forEach(el=>el.addEventListener('input',()=>{detailDirty=true;dirtyFields.add(el.dataset.dmField);$dm('#dmDetailSaveState').textContent='미저장';}));
 $dm('#dmSaveDetail').onclick=saveDetail;
 $dm('#dmCloseDetail').onclick=async()=>{if(await saveDetail()){$dm('#dmDetail').hidden=true;$dm('#dmList').hidden=false;$dm('.dm-toolbar').hidden=false;active=null;stopActive();lastSig='';render();}};
 $dm('#dmRequest').onclick=requestReview;$dm('#dmRefresh').onclick=()=>refresh(true);
 $dm('#dmConvert').onclick=conversionDialog;$dm('#dmConversionConfirm').onclick=convertSelected;
 $dm('#dmConversionCancel').onclick=()=>{if(!busy)$dm('#dmConversionDialog').close();};
 $dm('#dmOpenWorkorder').onclick=async()=>{if(!await saveDetail())return;const code=current(active)?.convertedCode;if(code)window.AiselDesignMeetingAdapter.open(code);};
 $dm('#dmAdopt').onclick=adopt;$dm('#dmAdoptConfirm').onclick=()=>adoptSelected().catch(e=>message(e.message,true));$dm('#dmAdoptCancel').onclick=()=>$dm('#dmAdoptDialog').close();
 function target(e){return e.target.closest('#dmPhotos')?active:null;}
 pane.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});
 pane.addEventListener('drop',e=>{if(e.dataTransfer?.files.length){e.preventDefault();receive(e.dataTransfer.files,target(e),e.target.closest('.dm-photo')?.dataset.photoKey||null);}});
 document.addEventListener('paste',e=>{if(pane.hidden||e.target.closest('input,textarea,[contenteditable="true"]'))return;const files=[...(e.clipboardData?.items||[])].filter(x=>x.type.startsWith('image/')).map(x=>x.getAsFile());if(files.length){e.preventDefault();receive(files,target(e),e.target.closest('.dm-photo')?.dataset.photoKey||null);}});
 document.addEventListener('focusout',()=>setTimeout(render,60));
 window.addEventListener('beforeunload',e=>{if(detailDirty||pending.size){e.preventDefault();e.returnValue='';}});
 $dm('#dmDesigner').onchange=async e=>{const id=active;if(!id)return;const value=e.target.value;try{await access();await mutate(id,{designer:value});message('담당자를 저장했습니다.');}catch(err){e.target.value=current(id)?.designer||'';message(err.message,true);}};
 $dm('#dmDetailTitle').oninput=e=>{dirtyFields.add('title');detailDirty=true;$dm('[data-dm-field="title"]').value=e.target.textContent.trim();};$dm('#dmDetailTitle').onblur=saveDetail;
 $dm('#dmDrop').onclick=async()=>{if(!active||!await saveDetail())return;try{await access();if(role!=='owner')throw Error('대표자만 변경할 수 있습니다.');await mutate(active,{decision:current(active).decision==='excluded'?'unselected':'excluded'});renderReview(current(active));lastSig='';render();}catch(e){message(e.message,true);}};
 $dm('#dmWorkorder').onclick=async()=>{if(!active||!await saveDetail())return;try{await access();if(role!=='owner')throw Error('대표자만 사용할 수 있습니다.');const c=current(active);if(c.convertedCode){window.AiselDesignMeetingAdapter.open(c.convertedCode);return;}await mutate(active,{decision:'selected'});await conversionDialog([active]);}catch(e){message(e.message,true);}};
 window.AiselDesignMeeting={show,open,mutate,receive,convertOne,refresh,bridge,core:C};
})();
