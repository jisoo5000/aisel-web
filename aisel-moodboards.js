/* v233: owner boards link existing references; no image copies or automatic conversion. */
(function () {
  'use strict';
  const ROOT = 'aiselMoodboards/v1/boards', MAX = 100;
  let pane, boards = [], references = new Map(), selected = null, base = null, dirty = false, flight = null, epoch = 0, visible = false, stop, openRevision = 0;
  const user = () => window.AiselAuth?.currentUser();
  const clone = value => JSON.parse(JSON.stringify(value));
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function button(text, action) { const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node; }
  const $ = selector => pane.querySelector(selector);
  function notice(text = '', failed = false) { $('.mb-message').textContent = text; $('.mb-message').classList.toggle('error', failed); }
  function assertSession(stamp, uid) { if (stamp !== epoch || user()?.uid !== uid) throw Error('계정이 변경되었습니다. 다시 열어주세요.'); }
  async function request(path = '', method = 'GET', value, etag) {
    const stamp = epoch, account = user(), grant = await window.AiselGalleryIndex.authorize('references');
    if (!account?.uid || grant.role !== 'owner' || grant.uid !== account.uid) throw Error('대표자 계정에서 사용할 수 있습니다.');
    assertSession(stamp, account.uid);
    const app = (window.firebase?.apps || []).find(candidate => { try { return candidate.auth().currentUser?.uid === account.uid && candidate.options?.projectId === 'aisel-workorder'; } catch (_) { return false; } });
    if (!app?.options?.databaseURL) throw Error('로그인을 확인해주세요.');
    const token = await account.getIdToken(); assertSession(stamp, account.uid);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(app.options.databaseURL.replace(/\/$/, '') + '/' + ROOT + path + '.json?auth=' + encodeURIComponent(token), {
        method, credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(method === 'GET' ? { 'X-Firebase-ETag': 'true' } : {}), ...(etag ? { 'if-match': etag } : {}) },
        ...(value === undefined ? {} : { body: JSON.stringify(value) })
      });
      assertSession(stamp, account.uid);
      if (response.status === 412) throw Error('다른 곳에서 수정한 내용이 있습니다. 입력을 유지했으니 다시 열어 비교해주세요.');
      if ([401, 403].includes(response.status)) throw Error('저장 권한을 확인하지 못했습니다. 입력은 유지됩니다.');
      if (!response.ok) throw Error('서버에 연결하지 못했습니다. 다시 시도해주세요.');
      const result = await response.json(); assertSession(stamp, account.uid);
      return { value: result, etag: response.headers.get('etag') };
    } finally { clearTimeout(timer); }
  }
  function draftKey() { return 'aisel.moodboards.draft.v233.' + user()?.uid; }
  function keepDraft() { try { if (selected && dirty) localStorage.setItem(draftKey(), JSON.stringify({ selected, base })); } catch (_) {} }
  function change() { dirty = true; keepDraft(); notice('저장 전'); }
  function currentReferences() {
    const state = window.AiselGalleryIndex.snapshot('references');
    if (state.authorized !== true || state.uid !== user()?.uid || state.role !== 'owner') return [];
    return state.records || [];
  }
  function cover(id) {
    const record = references.get(id), wrap = el('div', undefined, 'mb-photo');
    if (record?.thumbnail && /^https:\/\//.test(record.thumbnail)) {
      const img = el('img'); img.alt = record.title || '레퍼런스'; img.loading = 'lazy'; img.decoding = 'async';
      img.src = window.AiselGalleryIndex.imageSource('references', id, record.thumbnail); wrap.append(img);
    } else wrap.append(el('span', record ? '사진 없음' : '삭제·보관되었거나 조회할 수 없는 자료'));
    return wrap;
  }
  function renderList() {
    const list = $('.mb-board-list'); list.replaceChildren();
    list.append(button('+ 추가', () => open({ id: 'board_' + crypto.randomUUID().replace(/-/g, ''), title: '', referenceIds: [], createdAt: Date.now(), createdByUid: user().uid, revision: 0 })));
    for (const board of boards.filter(item => !item.archivedAt).sort((a, b) => b.updatedAt - a.updatedAt)) {
      const card = button('', () => open(board)); card.className = 'mb-board-card';
      for (const id of (board.referenceIds || []).slice(0, 4)) card.append(cover(id));
      card.append(el('strong', board.title), el('span', (board.referenceIds || []).length + '개 자료')); list.append(card);
    }
  }
  function renderReferences() {
    const list = $('.mb-linked'); list.replaceChildren();
    for (const [index, id] of selected.referenceIds.entries()) {
      const row = el('article', undefined, 'mb-linked-card'); row.append(cover(id), el('p', references.get(id)?.title || '연결된 자료'));
      const actions = el('div', undefined, 'mb-actions');
      actions.append(button('열기', async () => { if (window.AiselUnified) { if (!await window.AiselUnified.show('references')) return; } else if (!await leave()) return; await window.AiselReferenceCollection.show({ id, history: true }); }),
        button('↑', () => move(index, -1)), button('↓', () => move(index, 1)), button('빼기', () => { selected.referenceIds.splice(index, 1); change(); renderReferences(); }));
      actions.children[1].disabled = index === 0; actions.children[2].disabled = index === selected.referenceIds.length - 1;
      row.append(actions); list.append(row);
    }
    renderChoices();
  }
  function move(index, delta) { const next = index + delta; if (next < 0 || next >= selected.referenceIds.length) return; [selected.referenceIds[index], selected.referenceIds[next]] = [selected.referenceIds[next], selected.referenceIds[index]]; change(); renderReferences(); }
  function renderChoices() {
    const search = $('.mb-search').value.trim().toLocaleLowerCase(), list = $('.mb-choices'); list.replaceChildren();
    for (const record of currentReferences().filter(record => !record.archivedAt && (!search || [record.title, record.designer].join(' ').toLocaleLowerCase().includes(search)))) {
      const row = el('label', undefined, 'mb-choice'), input = el('input'); input.type = 'checkbox'; input.checked = selected.referenceIds.includes(record.id);
      input.addEventListener('change', () => { if (input.checked) { if (selected.referenceIds.length >= MAX) { input.checked = false; notice('한 보드에 최대 100개까지 연결할 수 있습니다.', true); return; } selected.referenceIds.push(record.id); } else selected.referenceIds = selected.referenceIds.filter(id => id !== record.id); change(); renderReferences(); });
      row.append(input, cover(record.id), el('span', record.title || '레퍼런스')); list.append(row);
    }
  }
  async function open(board, options = {}) {
    const read = ++openRevision;
    if (dirty) { notice('작성 중인 보드를 먼저 저장해주세요.', true); return false; }
    if (board.revision && !options.draft) { try { const current = normalized((await request('/' + encodeURIComponent(board.id))).value); if (read !== openRevision || dirty) return false; if (!current) throw Error('보드를 찾을 수 없습니다.'); board = current; } catch (error) { if (pane) notice(error.message, true); return false; } }
    selected = clone(board); selected.referenceIds = selected.referenceIds || []; base = board.revision ? clone(board) : null; dirty = !board.revision;
    $('.mb-board-list').hidden = true; $('.mb-editor').hidden = false; $('.mb-title').value = selected.title; $('.mb-search').value = ''; renderReferences(); if (dirty) keepDraft(); notice(dirty ? '저장 전' : '저장됨');
    return true;
  }
  function normalized(value) { if (!value) return null; return { ...value, referenceIds: value.referenceIds || [] }; }
  async function persist() {
    if (!selected || !dirty) return true;
    const record = clone(selected), title = record.title.trim();
    if (!title) { notice('보드 제목을 입력해주세요.', true); $('.mb-title').focus(); return false; }
    const original = base ? clone(base) : null, stamp = epoch, uid = user()?.uid;
    if (flight) return flight;
    const controls = [...$('.mb-editor').querySelectorAll('button,input')]; controls.forEach(control => { control.dataset.wasDisabled = String(control.disabled); control.disabled = true; });
    const task = (async () => {
      notice('저장 중');
      const path = '/' + encodeURIComponent(record.id), read = await request(path), current = normalized(read.value);
      // An uncertain previous response may already have persisted this exact draft.
      const intended = { ...record, title, revision: (original?.revision || 0) + 1 };
      if (current && current.revision === intended.revision && current.title === intended.title && same(current.referenceIds, intended.referenceIds) && current.createdByUid === intended.createdByUid && (current.archivedAt || 0) === (intended.archivedAt || 0)) {
        selected = clone(current); base = clone(current); dirty = false;
      } else {
        if (!same(current, normalized(original))) throw Error('다른 곳에서 수정한 내용이 있습니다. 현재 입력은 보관됩니다.');
        if (!read.etag) throw Error('서버의 저장 상태를 확인하지 못했습니다. 다시 시도해주세요.');
        intended.updatedAt = Date.now(); await request(path, 'PUT', intended, read.etag);
        const verified = normalized((await request(path)).value);
        if (!same(normalized(intended), verified)) throw Error('저장 결과를 확인하지 못했습니다. 다시 저장하면 같은 보드에서 이어집니다.');
        selected = clone(verified); base = clone(verified); dirty = false;
      }
      assertSession(stamp, uid); localStorage.removeItem(draftKey());
      boards = [...boards.filter(board => board.id !== selected.id), clone(selected)]; notice('저장됨'); return true;
    })().catch(error => { if (stamp === epoch) { keepDraft(); notice(error.message || '저장하지 못했습니다. 입력은 유지됩니다.', true); } return false; }).finally(() => { controls.forEach(control => { control.disabled = control.dataset.wasDisabled === 'true'; }); if (flight === task) flight = null; });
    flight = task; return task;
  }
  async function back() { if (selected && !base && !selected.title.trim() && !selected.referenceIds.length) { dirty = false; try { localStorage.removeItem(draftKey()); } catch (_) {} } if (!await persist()) return false; selected = base = null; dirty = false; $('.mb-editor').hidden = true; $('.mb-board-list').hidden = false; renderList(); notice(); return true; }
  function ensure() {
    if (pane) return;
    pane = el('section', undefined, 'noprint'); pane.id = 'aiselMoodboardsView'; pane.hidden = true;
    const message = el('p', '', 'mb-message'); message.setAttribute('role', 'status');
    const editor = el('div', undefined, 'mb-editor'); editor.hidden = true;
    const toolbar = el('div', undefined, 'mb-actions'), title = el('input'); title.className = 'mb-title'; title.placeholder = '보드 제목'; title.maxLength = 120; title.setAttribute('aria-label', '보드 제목'); title.addEventListener('input', () => { selected.title = title.value; change(); });
    toolbar.append(button('목록', back), button('저장', persist), button('취소', () => { if (dirty && !confirm('저장 전 변경을 취소할까요?')) return; try { localStorage.removeItem(draftKey()); } catch (_) {} dirty = false; selected = base = null; $('.mb-editor').hidden = true; $('.mb-board-list').hidden = false; renderList(); notice(); }), button('보관', async () => { if (!selected || !confirm('보드를 보관할까요? 연결된 원본 자료는 유지됩니다.')) return; selected.archivedAt = Date.now(); change(); await back(); }));
    const search = el('input'); search.className = 'mb-search'; search.placeholder = '🔍 검색'; search.setAttribute('aria-label', '검색'); search.addEventListener('input', renderChoices);
    const choices = el('details'); choices.append(el('summary', '+ 자료 연결'), search, el('div', undefined, 'mb-choices'));
    editor.append(toolbar, title, el('div', undefined, 'mb-linked'), choices);
    const restore = button('보관한 보드', async () => {
      if (!await back()) { if (dirty) return; }
      const list = $('.mb-board-list'); list.replaceChildren(button('목록', () => { renderList(); notice(); }));
      for (const board of boards.filter(item => item.archivedAt)) list.append(button(board.title + ' · 복원', async () => { if (!await open(board)) return; delete selected.archivedAt; change(); if (await persist()) await back(); }));
      notice('보관한 보드만 표시합니다.');
    });
    pane.append(restore, message, el('div', undefined, 'mb-board-list'), editor); document.getElementById('mainBar').after(pane);
  }
  async function show() {
    ensure(); visible = true; pane.hidden = false; const stamp = epoch;
    try {
      const grant = await window.AiselGalleryIndex.authorize('references');
      if (grant.role !== 'owner') throw Error('대표자 계정에서 사용할 수 있습니다.');
      await window.AiselGalleryIndex.warm('references'); if (stamp !== epoch || !visible) return false;
      references = new Map(currentReferences().map(record => [record.id, record]));
      const result = await request(); if (stamp !== epoch || !visible) return false;
      boards = Object.entries(result.value || {}).map(([id, board]) => ({ ...board, id, referenceIds: board.referenceIds || [] }));
      if (!stop) stop = window.AiselGalleryIndex.subscribe('references', state => {
        if (state.authorized !== true) { keepDraft(); references.clear(); if (pane && visible) { $('.mb-editor').hidden = true; $('.mb-linked').replaceChildren(); $('.mb-choices').replaceChildren(); $('.mb-board-list').replaceChildren(); notice('로그인과 접근 권한을 다시 확인해주세요.'); } return; }
        references = new Map(currentReferences().map(record => [record.id, record]));
        if (visible) { $('.mb-editor').hidden = !selected; $('.mb-board-list').hidden = !!selected; if (!dirty && !flight) selected ? renderReferences() : renderList(); }
      });
      renderList();
      if (!selected) { try { const recovery = JSON.parse(localStorage.getItem(draftKey())); if (recovery?.selected?.id) { open(recovery.selected, { draft: true }); base = recovery.base; dirty = true; notice('저장 전 입력을 복원했습니다.'); } } catch (_) {} }
      return true;
    } catch (error) { if (stamp === epoch && pane && visible) notice(error.message || '보드를 불러오지 못했습니다.', true); return false; }
  }
  async function leave() { if (dirty && !await persist()) return false; hide(); return true; }
  function hide() { visible = false; if (pane) pane.hidden = true; }
  function clearSession() { epoch++; openRevision++; stop?.(); stop = null; boards = []; references.clear(); selected = base = null; dirty = false; flight = null; if (pane) { pane.replaceChildren(); pane.remove(); pane = null; } visible = false; }
  window.addEventListener('aisel-session-change', clearSession);
  window.addEventListener('aisel-access-change', event => { const session = event.detail?.session; if (!session?.active || session.role !== 'owner' || session.uid !== user()?.uid) clearSession(); });
  window.addEventListener('beforeunload', event => { if (dirty) { keepDraft(); event.preventDefault(); event.returnValue = ''; } });
  window.AiselMoodboards = Object.freeze({ show, leave, hide, save: persist, get visible() { return visible; } });
})();
