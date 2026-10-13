/* AISEL reference collection: compact content/product library; existing server authorization and saves are preserved. */
(function(){
  'use strict';
  const fields=['title','date','category','notes','sourceUrl'];
  const AI=window.AiselReferenceAnalysis;
  const categories={content:'콘텐츠',product:'제품'};
  const clone=v=>JSON.parse(JSON.stringify(v));
  const http=v=>{try{const u=new URL(String(v||''));return /^https?:$/.test(u.protocol)?u.href:'';}catch(_){return '';}};
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let config={},pane,role=null,permissions={},account='',active=null,dirty=false,revision=0,visible=false,authEpoch=0,authorizedStamp=null,showEpoch=0;
  let records=new Map(),cursor=null,checkedAt='',initialized=false,loading=false,saveFlight=null,photoFlight=null;
  let draftStored=true;
  let galleryScroll=0,gallerySignature='',pendingFiles=[],objectUrls=[],draftDb=null,draftTimer=null;
  const $=s=>pane.querySelector(s);
  function ensure(){
    if(pane)return pane;
    pane=document.createElement('section');pane.id='referenceCollectionView';pane.className='noprint';pane.hidden=true;pane.setAttribute('aria-label','레퍼런스 수집');
    pane.innerHTML=`<div id="rcList"><div class="rc-filters" role="group" aria-label="레퍼런스 분류"><button type="button" data-category="content" aria-pressed="true">콘텐츠</button><button type="button" data-category="product" aria-pressed="false">제품</button></div>
      <div class="rc-list-tools"><label class="rc-search"><span class="rc-sr-only">제목 검색</span><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg><input id="rcSearch" type="search" placeholder="제목으로 검색" autocomplete="off"></label><button type="button" id="rcCreate" hidden>+ 등록</button></div>
      <div id="rcNotices"><p id="rcStatus" role="status" aria-live="polite"></p><div class="rc-notice-actions"><button type="button" id="rcLogin">로그인</button><button type="button" id="rcRetry" hidden>연결 다시 확인</button><button type="button" id="rcLatest" hidden>최신 내용 보기</button><button type="button" id="rcSetup" hidden>시트 연결 준비</button></div></div>
      <p class="rc-easy-hint">사진·캡처와 링크만 넣어주세요. AI 정리는 매일 밤 11시에 진행합니다.</p><div id="rcPending"></div><div id="rcGrid" class="rc-grid"></div><p id="rcEmpty" hidden>등록된 콘텐츠 레퍼런스가 없습니다.</p><button type="button" id="rcMore" hidden>더 보기</button></div>
      <div id="rcDetail" hidden>
      <div class="rc-title-row"><label class="rc-field rc-title"><span class="rc-sr-only">제목</span><input data-rc-field="title" type="text" maxlength="160" placeholder="레퍼런스 제목" aria-label="레퍼런스 제목"></label></div>
      <div class="rc-metadata"><label class="rc-date"><span id="rcDateText" aria-hidden="true"></span><input data-rc-field="date" type="date" aria-label="레퍼런스 날짜"></label><select data-rc-field="category" aria-label="레퍼런스 분류"><option value="content">콘텐츠</option><option value="product">제품</option></select><a id="rcSourceOpen" target="_blank" rel="noopener noreferrer" hidden>↗ 링크</a><button type="button" id="rcLinkToggle" aria-controls="rcLinkPanel" aria-expanded="false">↗ 링크</button><button type="button" id="rcLinkEdit" aria-label="참고 링크 편집" aria-controls="rcLinkPanel" aria-expanded="false">+</button></div>
      <div id="rcLinkPanel" class="rc-link-panel" hidden><label class="rc-field"><span>참고 링크</span><input data-rc-field="sourceUrl" type="url" inputmode="url" maxlength="2000" placeholder="https://"></label></div>
      <div class="rc-capture-tools"><button type="button" id="rcChoosePhotos">사진·캡처</button><button type="button" id="rcTakePhoto">사진 촬영</button></div><input id="rcCameraInput" type="file" accept="image/*" capture="environment" hidden><div id="rcPhotos" class="rc-photos" aria-label="참고 사진"></div><button type="button" id="rcAddPhotos">+ 사진 추가</button><input id="rcPhotoInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>
      <section id="rcAnalysis" class="rc-analysis" aria-live="polite"></section><details class="rc-optional"><summary>참고사항 (선택)</summary><label class="rc-field rc-notes"><span class="rc-sr-only">참고사항</span><textarea data-rc-field="notes" rows="5" maxlength="12000" placeholder="촬영 구도, 디자인 디테일 등 참고할 내용을 적어주세요."></textarea></label></details>
      <div class="rc-detail-actions"><span id="rcAuthor"></span><button type="button" id="rcSave">저장</button></div><label id="rcArchiveWrap" hidden><input id="rcArchive" type="checkbox">시트에 보관하고 목록에서 제외</label></div>`;
    document.body.append(pane);
    $('#rcLogin').onclick=async()=>{try{if(config.login)await config.login();else if(window.AiselDesignMeeting?.login)await window.AiselDesignMeeting.login({scope:'reference'});else throw Error('상단 디자인회의에서 로그인한 뒤 다시 열어주세요.');await access();await refresh();}catch(e){message(errorText(e),true);}};
    $('#rcSetup').onclick=async()=>{try{await call('refEnsure');$('#rcSetup').hidden=true;await refresh();}catch(e){message(errorText(e),true);}};
    $('#rcRetry').onclick=()=>show({history:false});
    $('#rcLatest').onclick=async()=>{if(!active)return;try{if(!await persistDraft()){message('입력을 보관하지 못했습니다. 최신 내용을 열기 전에 내용을 복사해주세요.',true);return;}const record=(await call('refGet',{id:active.id})).record;if(!record)throw Error('최신 내용을 확인하지 못했습니다.');active=clone(record);pendingFiles=[];dirty=false;revision++;$('#rcLatest').hidden=true;renderDetail();message('최신 내용입니다. 이전 입력은 목록의 이어서 작성에 보관했습니다.');}catch(e){message(errorText(e),true);}};
    $('#rcMore').onclick=()=>refresh(true);$('#rcCreate').onclick=()=>create();$('#rcSave').onclick=()=>save();
    $('#rcSearch').oninput=()=>{gallerySignature='';renderList();rememberList();};
    $('.rc-filters').onclick=e=>{const b=e.target.closest('[data-category]');if(!b)return;$('.rc-filters').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));gallerySignature='';renderList();rememberList();};
    fields.forEach(k=>$('[data-rc-field="'+k+'"]').addEventListener('input',()=>{if(!active)return;active[k]=$('[data-rc-field="'+k+'"]').value;if(k==='category')active.categoryMode='manual';markDirty();updateSource();updateDate();}));
    $('#rcLinkToggle').onclick=()=>toggleLink(true);$('#rcLinkEdit').onclick=()=>toggleLink();
    $('#rcAddPhotos').onclick=()=>$('#rcPhotoInput').click();$('#rcPhotoInput').onchange=async e=>{await receive(e.target.files);e.target.value='';await save();};$('#rcChoosePhotos').onclick=()=>$('#rcPhotoInput').click();$('#rcTakePhoto').onclick=()=>$('#rcCameraInput').click();$('#rcCameraInput').onchange=async e=>{await receive(e.target.files);e.target.value='';await save();};
    $('[data-rc-field="sourceUrl"]').addEventListener('blur',()=>save());
    $('#rcArchive').onchange=async e=>{if(!e.target.checked)return;const checkbox=e.target;checkbox.disabled=true;try{if(!await save())return;const data=await call('refArchive',{id:active.id,version:active.version,archived:true});if(!data.record?.archivedAt)throw Error('보관 저장을 확인하지 못했습니다.');records.set(data.record.id,data.record);await removeDraft(data.record.id);active=null;dirty=false;pendingFiles=[];gallerySignature='';showList();setRoute(null,true);message('시트에 보관했습니다.');}catch(err){message(errorText(err),true);}finally{checkbox.checked=false;checkbox.disabled=false;}};
    pane.addEventListener('dragover',e=>{if(active&&e.dataTransfer?.types.includes('Files'))e.preventDefault();});pane.addEventListener('drop',e=>{if(active&&e.dataTransfer?.files.length){e.preventDefault();receive(e.dataTransfer.files);}});
    document.addEventListener('paste',e=>{if(!visible||!active||e.target.closest('input,textarea'))return;const files=[...(e.clipboardData?.items||[])].filter(x=>x.type.startsWith('image/')).map(x=>x.getAsFile());if(files.length){e.preventDefault();receive(files);}});
    window.addEventListener('beforeunload',e=>{if(dirty||pendingFiles.length){persistDraft().catch(()=>{});e.preventDefault();e.returnValue='';}});
    return pane;
  }
  function authStamp(){return {uid:window.AiselAuth?.currentUser()?.uid||null,generation:window.AiselAuth?.generation,epoch:authEpoch};}
  function assertAuth(stamp){const current=authStamp();if(stamp.uid!==current.uid||stamp.generation!==current.generation||stamp.epoch!==current.epoch)throw Object.assign(Error('로그인 상태가 변경되었습니다. 다시 확인해주세요.'),{code:'auth_changed'});}
  async function call(action,payload={}){const bridge=config.bridge||((a,p)=>window.AiselDesignMeeting.bridge(a,[],p));const stamp=authStamp(),result=await bridge(action,payload);assertAuth(stamp);if(result?.ok===false)throw Object.assign(Error(result.error||'연결을 확인해주세요.'),{code:result.code});return result;}
  function message(text,error=false){ensure();if($('#rcDetail').hidden)$('.rc-list-tools').after($('#rcNotices'));else $('#rcDetail').prepend($('#rcNotices'));$('#rcStatus').textContent=text;$('#rcStatus').classList.toggle('rc-error',error);}
  function errorText(e){if(e?.code==='connection_pending'){$('#rcRetry').hidden=false;$('#rcLogin').hidden=true;return '레퍼런스 저장 서버 업데이트가 필요합니다. 관리자에게 연결을 요청해주세요.';}if(e?.code==='conflict'){$('#rcLatest').hidden=false;return draftStored?'다른 기기에서 먼저 수정했습니다. 입력은 이 기기에 보관했습니다. 최신 내용을 확인해주세요.':'다른 기기에서 먼저 수정했습니다. 입력은 화면에 남아 있습니다. 창을 닫기 전에 내용을 복사해주세요.';}if(e?.code==='setup_required'){$('#rcSetup').hidden=role!=='owner';return '레퍼런스 시트 연결을 준비해주세요.';}return e?.message||'저장을 확인하지 못했습니다. 입력을 유지했습니다.';}
  async function access(){const stamp=authStamp(),data=await call('refAccess');assertAuth(stamp);const next=String(data.accountKey||data.email||config.account?.()||'');if(!next)throw Error('로그인 계정 확인이 필요합니다.');if(account&&account!==next){active=null;dirty=false;pendingFiles=[];records.clear();initialized=false;checkedAt='';cursor=null;gallerySignature='';showList();}account=next;role=data.role;permissions=data.permissions||{};if(!permissions.automaticReview)throw Object.assign(Error('레퍼런스 서버181 연결이 필요합니다.'),{code:'connection_pending'});if(permissions.canManage&&permissions.automaticReview)await call('refEnsure');authorizedStamp=stamp;$('#rcRetry').hidden=true;$('#rcLogin').hidden=true;$('#rcCreate').hidden=permissions.canCreate!==true;await renderDrafts();return data;}
  function canEdit(){if(!authorizedStamp)return false;try{assertAuth(authorizedStamp);}catch(_){return false;}return !!active&&(active.version===0?permissions.canCreate===true:active.permissions?.canEdit===true);}
  function setRoute(id,replace=false){const hash=id?'#reference='+encodeURIComponent(id):'#references';history[replace?'replaceState':'pushState']({aiselReference:{id:id||null,scroll:galleryScroll,search:$('#rcSearch').value,category:selectedCategory()}},'',hash);}
  function selectedCategory(){return $('.rc-filters button[aria-pressed="true"]')?.dataset.category||'content';}
  function rememberList(){if(!active&&location.hash==='#references')history.replaceState({aiselReference:{id:null,scroll:window.scrollY,search:$('#rcSearch').value,category:selectedCategory()}},'',location.href);}
  function restoreList(state){if(!state)return;galleryScroll=state.scroll||0;$('#rcSearch').value=state.search||'';$('.rc-filters').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===(categories[state.category]?state.category:'content'))));gallerySignature='';}
  async function show(options={}){
    ensure();if(config.beforeShow&&await config.beforeShow()===false)return false;
    const epoch=++showEpoch,stillVisible=()=>epoch===showEpoch&&visible&&!pane.hidden;
    pane.hidden=false;visible=true;window.dispatchEvent(new CustomEvent('aisel-view-change',{detail:{view:'references'}}));
    const backgroundList=options.background&&!options.id&&!active;
    if(backgroundList){showList();if(options.history!==false&&location.hash!=='#references')setRoute(null);}
    const hydrate=async()=>{try{
      await access();if(!stillVisible())return;
      if(!initialized||!active)await refresh();if(!stillVisible())return;
      if(active&&!dirty&&!pendingFiles.length&&!options.id){const fresh=await call('refGet',{id:active.id});if(fresh.record){active=clone(fresh.record);renderDetail();}}
      if(options.id)await open(options.id,{history:options.history!==false});
      else if(!active&&!backgroundList){showList();if(options.history!==false&&location.hash!=='#references')setRoute(null);}
    }catch(e){if(stillVisible()&&!['auth_changed','session_changed'].includes(e.code)){role=null;$('#rcLogin').hidden=!!window.AiselAuth;$('#rcCreate').hidden=true;message(errorText(e),true);}}};
    // An entry refresh only updates the rendered rows. It must not restore old
    // scroll/history after the user has moved to another menu or scrolled.
    if(options.background)hydrate();else await hydrate();return true;
  }
  async function leave(){if(!await save())return false;showEpoch++;pane.hidden=true;visible=false;return true;}
  function summary(record){const {id,version,title,date,category,creator,createdAt,updatedAt,archivedAt,permissions:recordPermissions,analysis,analysisSignature,analysisState,analysisReceipt,reviewedAt,categoryMode}=record;return {id,version,title,date,category,creator,createdAt,updatedAt,archivedAt,analysis,analysisSignature,analysisState,analysisReceipt,reviewedAt,categoryMode,permissions:recordPermissions,thumbnail:record.thumbnail||record.photos?.[0]?.thumb||''};}
  async function refresh(more=false){ensure();if(loading)return;const epoch=authEpoch;loading=true;$('#rcMore').disabled=true;try{if(!account)await access();const payload={limit:24};if(more&&cursor)payload.cursor=cursor;else if(initialized&&checkedAt)payload.updatedSince=checkedAt;const data=await call('refList',payload);for(const item of data.items||[])records.set(item.id,item);if(more||!initialized)cursor=data.nextCursor||null;else if(data.nextCursor){/* Drain changed rows before advancing the watermark. */let next=data.nextCursor;while(next){const page=await call('refList',{...payload,cursor:next});for(const item of page.items||[])records.set(item.id,item);next=page.nextCursor||null;}}checkedAt=data.checkedAt||checkedAt;initialized=true;renderList();message('');}catch(e){if(epoch===authEpoch)message(errorText(e),true);}finally{if(epoch===authEpoch){loading=false;$('#rcMore').disabled=false;}}}
  function renderList(){
    const category=selectedCategory(),search=$('#rcSearch').value.trim().toLocaleLowerCase();
    const list=[...records.values()].filter(r=>!r.archivedAt&&r.category===category&&(!search||String(r.title||'').toLocaleLowerCase().includes(search))).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||b.id.localeCompare(a.id));
    const sig=JSON.stringify(list);
    if(sig!==gallerySignature){
      gallerySignature=sig;const frag=document.createDocumentFragment();
      for(const r of list){
        const button=document.createElement('button');button.type='button';button.className='rc-card';button.dataset.id=r.id;button.setAttribute('aria-label',(r.title||'제목 없음')+' 상세 보기');button.onclick=()=>open(r.id);
        const src=http(r.thumbnail);
        if(src){const img=document.createElement('img');img.src=src;img.alt='';img.loading='lazy';img.decoding='async';button.append(img);}
        else{const space=document.createElement('span');space.className='rc-no-photo';space.textContent='사진 없음';button.append(space);}
        const info=document.createElement('span');info.className='rc-card-info';
        const title=document.createElement('strong');title.textContent=AI.title(r);
        const meta=document.createElement('span');meta.className='rc-card-meta';
        const tag=document.createElement('span');tag.className='rc-category';tag.textContent=categories[r.category]||'';
        const date=document.createElement('time');date.dateTime=r.date||'';date.textContent=shortDate(r.date);
        meta.append(date,tag);info.append(title,meta);button.append(info);frag.append(button);
      }
      $('#rcGrid').replaceChildren(frag);
    }
    $('#rcEmpty').hidden=!initialized||list.length>0;
    $('#rcEmpty').textContent=search?'현재 불러온 목록에 일치하는 레퍼런스가 없습니다.':'등록된 '+categories[category]+' 레퍼런스가 없습니다.';
    $('#rcMore').hidden=!cursor;
  }
  function shortDate(value){const date=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(date)?date.slice(2).replaceAll('-','.'):date;}
  function updateDate(){$('#rcDateText').textContent=String(active?.date||'').slice(0,10).replaceAll('-','.')||'날짜 선택';}
  function toggleLink(force){const panel=$('#rcLinkPanel');panel.hidden=typeof force==='boolean'?!force:!panel.hidden;for(const id of ['rcLinkToggle','rcLinkEdit'])$('#'+id).setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)$('[data-rc-field="sourceUrl"]').focus();}
  function captureList(){if(active)return;galleryScroll=window.scrollY;rememberList();}
  function showList(){releasePreviews();$('#rcDetail').hidden=true;$('#rcList').hidden=false;$('.rc-list-tools').after($('#rcNotices'));renderList();renderDrafts();requestAnimationFrame(()=>window.scrollTo(0,galleryScroll));}
  async function open(id,options={}){
    ensure();if(active?.id===id)return true;const epoch=showEpoch,stamp=authStamp(),stillVisible=()=>epoch===showEpoch&&visible&&!pane.hidden;
    if(!await save()||!stillVisible())return false;captureList();
    try{message('불러오는 중…');const local=await getDraft(id).catch(()=>null);assertAuth(stamp);if(!stillVisible())return false;
      let record;if(local)record=local.record;else record=(await call('refGet',{id})).record;
      assertAuth(stamp);if(!stillVisible())return false;if(!record?.id)throw Error('레퍼런스를 찾지 못했습니다.');
      active=clone(record);pendingFiles=local?.files||[];dirty=!!local;revision++;$('#rcList').hidden=true;$('#rcDetail').hidden=false;renderDetail();if(options.history!==false)setRoute(id);window.scrollTo(0,0);message(local?'이 기기에 보관한 입력을 이어서 작성할 수 있습니다.':'');return true;
    }catch(e){if(stillVisible()&&e.code!=='auth_changed')message(errorText(e),true);return false;}
  }
  async function create(){if(!permissions.canCreate||!await save())return;captureList();active={id:'ref_'+crypto.randomUUID().replace(/-/g,''),version:0,title:'',date:today(),category:selectedCategory(),notes:'',sourceUrl:'',categoryMode:'auto',photos:[],permissions:{canEdit:true,canArchive:false}};pendingFiles=[];dirty=true;revision++;$('#rcList').hidden=true;$('#rcDetail').hidden=false;renderDetail();setRoute(active.id);await persistDraft();message('');}
  function renderDetail(){$('#rcDetail').prepend($('#rcNotices'));$('#rcLatest').hidden=true;$('#rcSave').disabled=!!saveFlight||!canEdit();$('#rcAddPhotos').disabled=!!saveFlight||!!photoFlight||!canEdit();$('#rcArchive').disabled=false;fields.forEach(k=>{const input=$('[data-rc-field="'+k+'"]');input.value=active[k]||'';input.disabled=!canEdit();});$('#rcAuthor').textContent=active.creator||'';$('#rcSave').hidden=!canEdit();$('#rcAddPhotos').hidden=!canEdit();$('#rcArchiveWrap').hidden=active.permissions?.canArchive!==true;$('#rcArchive').checked=false;$('#rcLinkPanel').hidden=false;$('#rcLinkToggle').setAttribute('aria-expanded','false');$('#rcLinkEdit').setAttribute('aria-expanded','false');for(const id of ['rcChoosePhotos','rcTakePhoto']){$('#'+id).hidden=!canEdit();$('#'+id).disabled=!!saveFlight||!!photoFlight;}updateDate();updateSource();renderPhotos();renderAnalysis();$('[data-rc-field="title"]').placeholder=AI.title(active);}
  function updateSource(){const a=$('#rcSourceOpen'),url=http(active?.sourceUrl);a.hidden=!url;if(url)a.href=url;else a.removeAttribute('href');$('#rcLinkToggle').hidden=!!url;$('#rcLinkToggle').disabled=!canEdit();$('#rcLinkEdit').hidden=!canEdit();}
  function renderAnalysis(){
    const box=$('#rcAnalysis');box.replaceChildren();const heading=document.createElement('h3');heading.textContent='AI 정리';box.append(heading);
    const result=AI.result(active);if(!result){const p=document.createElement('p');p.textContent=active?.version?'밤 11시 자동 검토 대기':'사진이나 링크를 등록하면 자동으로 정리합니다.';box.append(p);return;}
    const grid=document.createElement('div');grid.className='rc-reactions';for(const metric of AI.metrics(active)){const item=document.createElement('span');item.textContent=metric.label+' '+metric.text;grid.append(item);}box.append(grid);
    const note=document.createElement('p');note.className='rc-analysis-caption';note.textContent='등록 자료에서 확인한 수치입니다. 현재 실시간 수치는 아닙니다.';box.append(note);
    const suggestion=document.createElement('p');suggestion.textContent=String(result.application||'활용 제안 확인 필요');box.append(suggestion);
  }
  function releasePreviews(){objectUrls.forEach(u=>URL.revokeObjectURL(u));objectUrls=[];}
  function renderPhotos(){releasePreviews();const box=$('#rcPhotos');box.replaceChildren();const saved=(active?.photos||[]).map(p=>({url:http(p.thumb||p.original),original:http(p.original),saved:true}));const queued=pendingFiles.map(file=>{const url=URL.createObjectURL(file);objectUrls.push(url);return {url,saved:false};});[...saved,...queued].forEach((p,i)=>{const frame=document.createElement('figure'),img=document.createElement('img');if(p.saved&&p.original&&p.original!==p.url)img.onerror=()=>{img.onerror=null;img.src=p.original;};img.src=p.url;img.alt='참고 사진 '+(i+1);img.loading='lazy';img.decoding='async';frame.append(img);if(canEdit()){const b=document.createElement('button');b.type='button';b.textContent='삭제';b.setAttribute('aria-label','사진 '+(i+1)+' 삭제');b.disabled=!!saveFlight||!!photoFlight;b.onclick=()=>{if(p.saved)active.photos.splice(i,1);else pendingFiles.splice(i-saved.length,1);markDirty();renderPhotos();};frame.append(b);}box.append(frame);});if(!saved.length&&!queued.length){const empty=document.createElement('p');empty.className='rc-photo-empty';empty.textContent='참고 사진을 추가해주세요.';box.append(empty);}}
  function markDirty(){dirty=true;revision++;message('입력 중');clearTimeout(draftTimer);draftTimer=setTimeout(()=>persistDraft().catch(()=>message('이 기기에 입력을 보관하지 못했습니다. 창을 닫기 전에 저장해주세요.',true)),120);}
  async function receive(files){if(!active||!canEdit()||saveFlight||photoFlight)return;const valid=[...files].filter(f=>/^image\/(jpeg|png|webp|gif)$/.test(f.type));if(!valid.length){message('JPG, PNG, WebP, GIF 사진을 선택해주세요.',true);return;}if((active.photos?.length||0)+pendingFiles.length+valid.length>12){message('사진은 한 레퍼런스에 12장까지 등록할 수 있습니다.',true);return;}if(valid.some(f=>f.size>26214400)){message('사진 한 장은 25MB 이하로 선택해주세요.',true);return;}pendingFiles.push(...valid);markDirty();renderPhotos();await persistDraft();}
  async function digest(file){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');}
  async function thumbnail(file){const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');const scale=Math.min(1,480/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);let blob;for(const quality of [.8,.65,.5,.35,.2]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=102400)break;}if(!blob||blob.size>102400)throw Error('사진 미리보기 생성에 실패했습니다. 다른 사진으로 다시 시도해주세요.');return {blob,width:image.naturalWidth,height:image.naturalHeight};}finally{URL.revokeObjectURL(url);}}
  function encode(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
  async function uploadPhotos(){while(pendingFiles.length){const file=pendingFiles[0],hash=await digest(file);if(!active.photos)active.photos=[];if(!active.photos.some(p=>p.hash===hash)){const prepared=await AiselPhoto.prepare(file,'collection');const thumb=await thumbnail(prepared.blob);const original=(await call('refUpload',{id:active.id,hash,kind:'original',mime:prepared.blob.type,data:await encode(prepared.blob)})).photo;const small=(await call('refUpload',{id:active.id,hash,kind:'thumb.jpg',mime:'image/jpeg',data:await encode(thumb.blob)})).photo;if(!http(original?.url)||!http(small?.url))throw Error('사진 저장을 확인하지 못했습니다.');active.photos.push({hash,original:original.url,thumb:small.url,width:thumb.width,height:thumb.height,bytes:prepared.bytes,sourceBytes:file.size,sourceWidth:prepared.sourceWidth,sourceHeight:prepared.sourceHeight,thumbBytes:thumb.blob.size});}pendingFiles.shift();await persistDraft();}renderPhotos();}
  async function save(){if(saveFlight)return saveFlight;if(!active||!dirty&&!pendingFiles.length)return true;try{await window.AiselAuth?.ready?.({allowGuardRequest:true});}catch(e){message(e.message,true);return false;}if(saveFlight)return saveFlight;if(!active||!dirty&&!pendingFiles.length)return true;if(active.version===0&&!String(active.title||'').trim()&&!String(active.notes||'').trim()&&!active.sourceUrl&&!(active.photos||[]).length&&!pendingFiles.length){await removeDraft(active.id);dirty=false;return true;}if(!canEdit()){message('이 레퍼런스는 조회만 가능합니다.',true);return false;}if(active.sourceUrl&&!http(active.sourceUrl)){message('출처 링크는 http 또는 https 주소로 입력해주세요.',true);await persistDraft();return false;}const task=async()=>{const id=active.id;$('#rcSave').disabled=true;$('#rcAddPhotos').disabled=true;try{await persistDraft();message('저장 중…');photoFlight=uploadPhotos();await photoFlight;photoFlight=null;const snapshot=clone(active),sentRevision=revision;const patch=Object.fromEntries(fields.map(k=>[k,snapshot[k]||'']));patch.photos=snapshot.photos||[];patch.categoryMode=snapshot.categoryMode||'auto';const data=await call('refSave',{id,version:snapshot.version,patch});if(!data.record||data.record.id!==id||!(data.record.version>snapshot.version))throw Error('저장을 확인하지 못했습니다. 입력을 유지했습니다.');records.set(id,summary(data.record));if(active?.id===id){if(sentRevision===revision){active=clone(data.record);dirty=false;await removeDraft(id);}else{active.version=data.record.version;active.permissions=data.record.permissions;await persistDraft();}}gallerySignature='';renderList();renderAnalysis();message(dirty?'추가 입력을 저장해주세요.':'저장됨');return !dirty;}catch(e){await persistDraft().catch(()=>{});message(errorText(e),true);return false;}finally{photoFlight=null;$('#rcSave').disabled=false;$('#rcAddPhotos').disabled=false;}};saveFlight=task();try{return await saveFlight;}finally{saveFlight=null;if(active){$('#rcArchiveWrap').hidden=active.permissions?.canArchive!==true;renderPhotos();}}}
  async function back(){if(!await save())return false;active=null;dirty=false;pendingFiles=[];showList();if(history.state?.aiselReference?.id)history.back();else setRoute(null,true);return true;}
  function db(){if(!draftDb)draftDb=new Promise((resolve,reject)=>{const r=indexedDB.open('aisel-reference-inputs',1);r.onupgradeneeded=()=>r.result.createObjectStore('inputs',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return draftDb;}
  async function storage(mode,value){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('inputs',mode==='all'||mode==='get'?'readonly':'readwrite'),store=tx.objectStore('inputs');const request=mode==='put'?store.put(value):mode==='delete'?store.delete(value):mode==='get'?store.get(value):store.getAll();let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
  async function persistDraft(){if(!account||!active||!dirty&&!pendingFiles.length)return true;const item={key:account+'|'+active.id,account,id:active.id,record:clone(active),files:[...pendingFiles],at:Date.now()};try{await storage('put',item);draftStored=true;return true;}catch(_){draftStored=false;if(!saveFlight)message('이 기기에 입력을 보관하지 못했습니다. 창을 닫기 전에 저장해주세요.',true);return false;}}
  function getDraft(id){return storage('get',account+'|'+id);}
  function removeDraft(id){return storage('delete',account+'|'+id).catch(()=>{});}
  async function renderDrafts(){try{const list=(await storage('all')).filter(d=>d.account===account);const box=$('#rcPending');box.replaceChildren();for(const draft of list){const b=document.createElement('button');b.type='button';b.className='rc-resume';b.textContent='이어서 작성 · '+(draft.record.title||'새 레퍼런스');b.onclick=()=>open(draft.id);box.append(b);}}catch(_){}}
  window.addEventListener('popstate',async e=>{if(!pane||!visible)return;const match=location.hash.match(/^#reference=(.+)$/);if(match){await open(decodeURIComponent(match[1]),{history:false});return;}if(location.hash==='#references'){if(!await save()){setRoute(active?.id,true);return;}active=null;dirty=false;pendingFiles=[];restoreList(e.state?.aiselReference);showList();return;}if(!await leave()){setRoute(active?.id,true);return;}config.onExit?.();});
  async function resetAuth(){
    const epoch=++authEpoch;authorizedStamp=null;role=null;permissions={};loading=false;if(!pane)return true;$('#rcCreate').hidden=true;$('#rcSave').disabled=true;$('#rcAddPhotos').disabled=true;$('#rcArchive').disabled=true;fields.forEach(k=>$('[data-rc-field="'+k+'"]').disabled=true);$('#rcPhotos').querySelectorAll('button').forEach(button=>button.disabled=true);
    // The common shell saves before a user-driven identity change. Preserve any
    // remaining input locally before clearing the previous account's view.
    if((dirty||pendingFiles.length)&&!await persistDraft())return false;
    if(epoch!==authEpoch)return false;
    role=null;permissions={};account='';active=null;dirty=false;pendingFiles=[];records.clear();initialized=false;checkedAt='';cursor=null;gallerySignature='';releasePreviews();$('#rcLogin').hidden=!!window.AiselAuth;$('#rcCreate').hidden=true;$('#rcDetail').hidden=true;$('#rcList').hidden=false;$('#rcPending').replaceChildren();renderList();if(visible)message('로그인 후 레퍼런스를 확인해주세요.');return true;
  }
  window.addEventListener('aisel-owner-auth-change',()=>{if(!window.AiselAuth)resetAuth();});
  window.addEventListener('aisel-session-change',()=>resetAuth());
  window.AiselReferenceCollection={configure(options){config={...config,...options};ensure();return this;},show,open,leave,canLeave:save,back,refresh,save,receive,verifyAccess:access,resetAuth,get active(){return active?.id||null;},get visible(){return visible;}};
})();
