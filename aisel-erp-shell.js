/* AISEL ERP shell 1: reuse authorized navigation and existing save guards. */
(function () {
  'use strict';
  const main = document.getElementById('mainBar');
  const header = document.getElementById('appBrandHeader');
  if (!main || !header || !window.AiselUnified || document.getElementById('aiselErpNavigation')) return;
  // Desktop navigation stays pinned even in a narrow window or at browser zoom.
  // iPadOS can report a Mac UA; touch distinguishes it from a desktop Mac.
  const userAgent = navigator.userAgent || '';
  const touchApple = /Macintosh|MacIntel/.test(userAgent + ' ' + navigator.platform) && navigator.maxTouchPoints > 0;
  const mobileDevice = /Android|iPhone|iPad|iPod/.test(userAgent) || touchApple;
  const desktopDevice = !mobileDevice && /Windows NT|Macintosh|X11|CrOS|Linux x86_64/.test(userAgent);
  const media = window.matchMedia('(min-width: 1024px) and (orientation: landscape)');
  const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const pinnedMenu = () => desktopDevice || (!mobileDevice && pointer.matches) || media.matches;
  const body = document.body;
  const aside = document.createElement('aside');
  aside.id = 'aiselErpNavigation'; aside.className = 'noprint';
  aside.setAttribute('aria-label', '업무 메뉴');
  const heading = document.createElement('div'); heading.className = 'erp-nav-heading';
  const brand = document.createElement('span'); brand.textContent = 'AISEL'; brand.className = 'erp-brand';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'erp-nav-close';
  close.textContent = '×'; close.setAttribute('aria-label', '업무 메뉴 닫기');
  heading.append(brand, close);
  const subtitle = document.createElement('p'); subtitle.className = 'erp-nav-subtitle'; subtitle.textContent = '업무 관리';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.id = 'aiselErpMenuToggle'; toggle.className = 'noprint';
  toggle.setAttribute('aria-controls', aside.id); toggle.setAttribute('aria-label', '업무 메뉴 열기');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  const backdrop = document.createElement('button'); backdrop.type = 'button'; backdrop.id = 'aiselErpBackdrop';
  backdrop.className = 'noprint'; backdrop.tabIndex = -1; backdrop.setAttribute('aria-label', '업무 메뉴 닫기');
  header.prepend(toggle); header.before(aside, backdrop); aside.append(heading, subtitle, main);
  main.setAttribute('role', 'navigation'); main.setAttribute('aria-label', '업무 순서');
  const labels = [], expandedGroups = new Set();
  let menuRole, groupScope;
  function arrange(){
    const session=window.AiselAccess?.session,role=session?.role||'pending';
    subtitle.textContent=session?.displayName?[session.displayName,({designer:'디자이너',logistics:'물류',md:'MD',owner:'대표'})[role]].filter(Boolean).join(' · '):'업무 관리';
    const scope=(session?.uid||'')+':'+role;
    if(scope!==groupScope){expandedGroups.clear();groupScope=scope;menuRole=null;}
    if(role===menuRole)return;menuRole=role;
    for(const {caption}of labels)caption.remove();labels.length=0;
    for(const button of main.querySelectorAll('.maintab'))delete button.dataset.erpGroupCollapsed;
    const groups=role==='designer'?[['내 작업',['references','designmeeting','orders']],['판매',['sales']]]
      :role==='logistics'?[['물류',['products','samples']],['기타',['orders','designmeeting','meetingmaterials','references','sales']]]
      :role==='md'?[['판매',['sales']],['상품',['references','orders','designmeeting','meetingmaterials']],['물류',['products','samples']]]
      :[['상품·제작',['references','designmeeting','meetingmaterials','orders']],['판매',['sales']],['물류',['products','samples']]];
    groups.push(['업무',['operations']],['관리',['staff','permissionaudit']]);
    for(const item of window.AiselCompanyERP?.navigation()||[]){let group=groups.find(g=>g[0]===item.group);if(!group){group=[item.group,[]];groups.push(group);}group[1].push(item.view);}
    groups.forEach(([label,views])=>{
      const caption=document.createElement('button');caption.type='button';caption.className='erp-nav-group';
      const title=document.createElement('span');title.textContent=label;
      const arrow=document.createElement('span');arrow.className='erp-nav-chevron';arrow.setAttribute('aria-hidden','true');
      arrow.innerHTML='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m5 3 5 5-5 5"/></svg>';
      caption.append(title,arrow);main.append(caption);
      const buttons=views.map(view=>main.querySelector('[data-main="'+view+'"]')).filter(Boolean);
      buttons.forEach(button=>{if(!button.id)button.id='erp-nav-item-'+encodeURIComponent(button.dataset.main);main.append(button);});
      caption.setAttribute('aria-controls',buttons.map(button=>button.id).join(' '));
      const group={caption,buttons,label};labels.push(group);
      caption.addEventListener('click',()=>{
        const opening=!expandedGroups.has(label);
        expandedGroups.clear();
        if(opening)expandedGroups.add(label);
        labels.forEach(syncGroup);
      });
    });
  }
  let drawerOpen = false, pinnedCollapsed = false, savedInert = [];
  function restoreBackground() {
    savedInert.forEach(([element, wasInert]) => { element.inert = wasInert; }); savedInert = [];
  }
  function setDrawer(open, returnFocus = true) {
    drawerOpen = !!open && !pinnedMenu();
    restoreBackground();
    if (drawerOpen) {
      for (const element of body.children) {
        if (element === aside || element === backdrop || /^(SCRIPT|STYLE|LINK)$/.test(element.tagName)) continue;
        savedInert.push([element, element.inert]); element.inert = true;
      }
      aside.setAttribute('role', 'dialog'); aside.setAttribute('aria-modal', 'true');
    } else { aside.removeAttribute('role'); aside.removeAttribute('aria-modal'); }
    render();
    if (drawerOpen) close.focus();
    else if (returnFocus && !pinnedMenu()) toggle.focus();
  }
  function render() {
    const pinned = pinnedMenu() && !pinnedCollapsed;
    const visible = pinned || drawerOpen;
    aside.hidden = !visible; backdrop.hidden = !drawerOpen;
    body.classList.toggle('erp-drawer-open', drawerOpen);
    toggle.hidden = false;
    body.classList.toggle('erp-nav-pinned', pinned);
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.setAttribute('aria-label', visible ? '업무 메뉴 접기' : '업무 메뉴 열기');
    toggle.title = visible ? '업무 메뉴 접기' : '업무 메뉴 열기';
    close.hidden = pinnedMenu();
  }
  function syncGroup({caption,buttons,label}) {
    const hidden=!buttons.some(button=>!button.hidden),expanded=expandedGroups.has(label);
    if(caption.hidden!==hidden)caption.hidden=hidden;
    caption.setAttribute('aria-expanded',String(expanded));
    // Keep permission visibility separate from the user's disclosure state.
    for(const button of buttons)button.dataset.erpGroupCollapsed=String(!expanded);
  }
  function sync() {
    const focusedGroup=labels.find(group=>group.caption===document.activeElement)?.label;
    arrange();
    labels.forEach(syncGroup);
    if(focusedGroup&&!main.contains(document.activeElement)){
      const target=labels.find(group=>group.label===focusedGroup&&!group.caption.hidden)?.caption;
      if(target&&!aside.hidden)target.focus();else if(drawerOpen)close.focus();else toggle.focus();
    }
    for (const button of main.querySelectorAll('.maintab')) {
      if (button.classList.contains('active') && !button.hidden) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }
  toggle.addEventListener('click', () => {
    if (pinnedMenu()) { pinnedCollapsed = !pinnedCollapsed; render(); }
    else setDrawer(!drawerOpen);
  });
  close.addEventListener('click', () => setDrawer(false));
  backdrop.addEventListener('click', () => setDrawer(false));
  aside.addEventListener('keydown', event => {
    if (!drawerOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); setDrawer(false); return; }
    if (event.key !== 'Tab') return;
    const items = [...aside.querySelectorAll('button:not([disabled]):not([hidden]),a[href]')].filter(element => element.getClientRects().length);
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  new MutationObserver(records => {
    sync();
    // A committed route updates active/aria-pressed. A refused save leaves the drawer open.
    if (drawerOpen && records.some(record => record.attributeName === 'aria-pressed')) setDrawer(false);
  }).observe(main, { subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'class', 'aria-pressed'] });
  window.addEventListener('aisel-access-change', () => { sync(); if (drawerOpen) setDrawer(false); });
  const syncLayout = () => {
    const focused = document.activeElement;
    setDrawer(false, false);
    if (aside.hidden && aside.contains(focused)) toggle.focus();
    else if (!aside.hidden && pinnedMenu() && focused === close) toggle.focus();
  };
  media.addEventListener('change', syncLayout);
  pointer.addEventListener('change', syncLayout);
  body.classList.add('aisel-erp-shell'); sync(); render();
  window.AiselErpShell=Object.freeze({closeMenu:()=>setDrawer(false,false),refresh:()=>{menuRole=null;sync();}});
  // A short, optional performance cue on the workorder list. Data comes only
  // from the existing assigned-sales service and stays in this account's memory.
  const gallery=document.getElementById('galleryView');
  if(gallery){
    const cue=document.createElement('button');cue.type='button';cue.id='aiselDesignerSalesCue';cue.className='erp-sales-cue noprint';cue.hidden=true;
    const title=document.createElement('span');title.textContent='담당 상품 판매성과';
    const detail=document.createElement('span');detail.className='erp-sales-cue-detail';detail.textContent='판매성과 보기';
    cue.append(title,detail);gallery.prepend(cue);
    let scope='',revision=0,flight=null,rendered=false;
    function permitted(){const a=window.AiselAccess;return a?.session?.active===true&&a.session.role==='designer'&&a.ownOnly===true&&a.allowed('sales');}
    function update(){
      const a=window.AiselAccess,key=permitted()?JSON.stringify([a.session.uid,a.session.permissions]):'';
      if(key!==scope){scope=key;revision++;flight=null;rendered=false;detail.textContent='판매성과 보기';cue.removeAttribute('title');}
      cue.hidden=!permitted()||window.AiselUnified.view!=='orders';
      if(cue.hidden||flight||rendered||!window.AiselSheetSalesSource?.readSummary)return;
      rendered=true;
      const expected=revision;flight=Promise.resolve(window.AiselSheetSalesSource.readSummary()).then(snapshot=>{
        if(expected!==revision||!permitted())return;
        if(!snapshot){detail.textContent='판매성과에서 연결 상태 확인';return;}
        const rows=snapshot.items||[],ratings=rows.map(row=>window.AiselSheetSalesView?.performance(row)),low=ratings.filter(rating=>rating?.key==='low').length,unknown=ratings.filter(rating=>!rating).length;
        detail.textContent=rows.length?'연결 '+rows.length+'개 · 확인 필요 '+low+'개'+(unknown?' · 판단 대기 '+unknown+'개':''):'연결된 담당 상품 없음';
        cue.title=[snapshot.periodLabel||'운영시트 집계 기간','확인 필요: 판매비중 10% 미만 또는 반품 지표 20% 이상',snapshot.readAt?'자료 확인 '+snapshot.readAt:''].filter(Boolean).join(' · ');
      }).catch(()=>{if(expected===revision)detail.textContent='판매성과에서 연결 상태 확인';}).finally(()=>{if(expected===revision)flight=null;});
    }
    cue.addEventListener('click',()=>window.AiselUnified.show('sales'));
    window.addEventListener('aisel-access-change',update);
    window.addEventListener('aisel-workspace-route',update);
    window.addEventListener('aisel-sales-source-ready',update);
    window.addEventListener('aisel-sales-snapshot',()=>{rendered=false;update();});
    window.addEventListener('aisel-assigned-index-change',()=>{revision++;flight=null;rendered=false;detail.textContent='판매성과 보기';update();});
    update();
  }
})();

/* 2026-11-11: one source link and compact heading for every authorized workspace.
   This registry is navigation only: it never fetches or synchronizes Google data. */
(function(root){
 'use strict';
 const header=document.getElementById('appBrandHeader');
 if(!header||document.getElementById('aiselWorkspaceSheet'))return;
 const book='1zkd_VXxnqw27LArmZ7lNfOhwQnTDjDGqnYrJrvRs-Xg';
 const product='1i3IoFbY5lfUX80fH608f59EKk23mkSAkIs_pRGjlNPA';
 const meetings='1M-SIsip6OwpFVuk6kgpvECKcR-8hJcUkHsLvaX56TBQ';
 const sales='1lgJpmwHFRQYT0XqXyZOdTiMswaPOmUj2e_36cFQrit0';
 const source=(id,gid,title)=>({url:'https://docs.google.com/spreadsheets/d/'+id+'/edit#gid='+gid,title});
 const registry={
  orders:source(product,2026100410,'AISEL 제품·작업지시서 / 작업지시서'),
  editor:source(product,2026100410,'AISEL 제품·작업지시서 / 작업지시서'),
  products:source(product,2026100410,'AISEL 제품·작업지시서 / 작업지시서'),
  references:source('1aFz93S83fvuzW24LMX7s7BA9d7x3orKnY3219Nx55Kk',2026110201,'에이슬 레퍼런스 / 콘텐츠 사진'),
  designmeeting:source(meetings,2026101101,'AISEL 디자인회의 / 디자인회의 검토대기'),
  meetingmaterials:source(meetings,2026101101,'AISEL 디자인회의 / 디자인회의 검토대기'),
  samples:source('16sQmAVKB07qrhOgzacozifIATmeqalhqGQViCgY_Pug',1840754350,'촬영샘플관리 / 촬영샘플관리'),
  sales:source(sales,2026100512,'AISEL 운영DB / 신상 성과'),
  'company-salesTable':source(sales,2026100512,'AISEL 운영DB / 신상 성과'),
  'company-finance':source('1N341S2gmxCWkpIiTy9A2Jj05C3ayWKFC-tNTS9IRX9Y',0,'광고성과 기록 / 광고성과'),
  'company-hiring':source('1zho3CXpJtXJH_qirPo4dcImDcFf2IK0qtI4dg-FgRqM',1102,'에이슬 채용·인력 현황 / 채용 현황'),
  'company-attendance':source(book,394706886,'ERP 운영대장 / 출퇴근'),
  'company-leave':source(book,1504605267,'ERP 운영대장 / 휴가신청'),
  'company-automation':source(book,1099923818,'ERP 운영대장 / 원본연결'),
  'company-apiUsage':source(book,2026111121,'ERP 운영대장 / Google API 사용 내역'),
  'company-replenishment':source('1Nj3gn7oJ1q0mtTdMzE8ScPlITY9FoTweB8aTVguxoO8',2026111110,'제작발주 / 판매·재고')
 };
 for(const key of ['overview','operation','product','content','growth'])registry['company-'+key]=source(book,696470300,'ERP 운영대장 / 업무대장');
 const management=new Set(['company-hiring','company-attendance','company-leave','company-automation','company-apiUsage','company-evaluation']);
 const link=document.createElement('a');link.id='aiselWorkspaceSheet';link.textContent='구글시트';link.className='noprint';
 link.target='_blank';link.rel='noopener noreferrer';link.hidden=true;header.append(link);
 function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='docs.google.com'&&!u.username&&!u.password&&!u.port&&/^\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit\/?$/.test(u.pathname)?u.href:'';}catch(_){return '';}}
 function selection(){
  const view=root.AiselUnified?.view,s=root.AiselAccess?.session;
  // A company-wide workbook must never expand a staff member's assigned-record access.
  if(!view||s?.active!==true||s.role!=='owner'||!s.uid||s.legacy||s.passwordChangeRequired)return null;
  if(management.has(view)&&!root.AiselManagement?.unlocked)return null;
  const spec=root.AiselWorkflowDomain?.specs?.[String(view).replace(/^company-/,'')];
  let item=spec?.sheetId!==undefined?source(book,spec.sheetId,'ERP 운영대장 / '+spec.sheet):registry[view];
  if(view==='references'){
   const tab=document.querySelector('#referenceCollectionView .rc-filters [aria-pressed="true"]'),label=tab?.textContent.trim(),category=tab?.dataset.category;
   const shared={marketing:[2026103102,'마케팅'],idea:[2026110203,'아이디어'],'촬영':[2026103103,'촬영'],'코디':[2026103104,'코디']};
   const chosen=shared[category]||shared[label];
   if(category==='product')item=source(product,2026101316,'AISEL 제품·작업지시서 / 레퍼런스 수집');
   else if(chosen)item=source('1aFz93S83fvuzW24LMX7s7BA9d7x3orKnY3219Nx55Kk',chosen[0],'에이슬 레퍼런스 / '+chosen[1]);
  }
  if(view==='company-replenishment'){
   const frame=document.querySelector('#aiselCompanyWorkspace .ce-replenishment-frame');
   const url=safeUrl(frame?.src);if(url)item={url,title:'제작발주 / '+frame.title};
  }
  if(view==='meetingmaterials'&&document.querySelector('#aiselMeetingMaterialsView.amm-records-mode')){
   const frame=document.querySelector('.amm-record-frame'),url=safeUrl(frame?.src);if(url)item={url,title:'디자인회의 / 회의 기록'};
  }
  return {view,item};
 }
 function refresh(){
  const result=selection();link.hidden=!result;
  const url=safeUrl(result?.item?.url),title=result?.item?.title;
  if(url){link.href=url;link.removeAttribute('aria-disabled');link.removeAttribute('tabindex');link.title=title;link.setAttribute('aria-label','구글시트 · '+title);}
  else{link.removeAttribute('href');link.setAttribute('aria-disabled','true');link.tabIndex=-1;link.title='이 화면은 앱에서 관리하며 연결된 구글시트가 없습니다.';link.setAttribute('aria-label','구글시트 연결 없음');}
 }
 link.addEventListener('click',event=>{refresh();if(link.hidden||!link.hasAttribute('href'))event.preventDefault();});
 for(const name of ['aisel-workspace-route','aisel-access-change','aisel-session-change','aisel-management-locked'])root.addEventListener(name,refresh);
 // Track locally rendered sub-tabs only; no timer and no extra network requests.
 let queued=false;
 const observer=new MutationObserver(records=>{
  if(!records.some(r=>r.target!==header&&!header.contains(r.target)))return;
  if(queued)return;queued=true;queueMicrotask(()=>{queued=false;refresh();});
 });
 observer.observe(document.body,{childList:true,subtree:true});
 function measure(){const height=Math.ceil(header.getBoundingClientRect().height);if(height>0)document.body.style.setProperty('--aisel-header-offset',(height+6)+'px');}
 if(root.ResizeObserver)new ResizeObserver(measure).observe(header);else root.addEventListener('resize',measure);
 refresh();measure();
 root.AiselWorkspaceUI=Object.freeze({refresh,sourceFor:()=>selection()?.item||null});
})(window);
