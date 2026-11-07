/* AISEL ERP shell 1: reuse authorized navigation and existing save guards. */
(function () {
  'use strict';
  const main = document.getElementById('mainBar');
  const header = document.getElementById('appBrandHeader');
  if (!main || !header || !window.AiselUnified || document.getElementById('aiselErpNavigation')) return;
  const media = window.matchMedia('(min-width: 1024px)');
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
  const groups = [
    ['상품·제작', ['references', 'designmeeting', 'meetingmaterials', 'orders']],
    ['판매', ['sales']], ['물류', ['products']]
  ];
  const labels = [];
  groups.forEach(([label, views]) => {
    const caption = document.createElement('div'); caption.className = 'erp-nav-group'; caption.textContent = label;
    main.append(caption);
    const buttons = views.map(view => main.querySelector('[data-main="' + view + '"]')).filter(Boolean);
    buttons.forEach(button => main.append(button)); labels.push({ caption, buttons });
  });
  let drawerOpen = false, desktopCollapsed = false, savedInert = [];
  function restoreBackground() {
    savedInert.forEach(([element, wasInert]) => { element.inert = wasInert; }); savedInert = [];
  }
  function setDrawer(open, returnFocus = true) {
    drawerOpen = !!open && !media.matches;
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
    else if (returnFocus) toggle.focus();
  }
  function render() {
    const visible = media.matches ? !desktopCollapsed : drawerOpen;
    aside.hidden = !visible; backdrop.hidden = !drawerOpen;
    body.classList.toggle('erp-drawer-open', drawerOpen);
    body.classList.toggle('erp-sidebar-collapsed', desktopCollapsed);
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.setAttribute('aria-label', visible ? '업무 메뉴 접기' : '업무 메뉴 열기');
    close.hidden = media.matches;
  }
  function sync() {
    labels.forEach(({caption, buttons}) => { const hidden = !buttons.some(button => !button.hidden); if (caption.hidden !== hidden) caption.hidden = hidden; });
    for (const button of main.querySelectorAll('.maintab')) {
      if (button.classList.contains('active') && !button.hidden) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }
  toggle.addEventListener('click', () => {
    if (media.matches) { desktopCollapsed = !desktopCollapsed; render(); }
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
  media.addEventListener('change', () => { desktopCollapsed = false; setDrawer(false, false); });
  body.classList.add('aisel-erp-shell'); sync(); render();
})();
