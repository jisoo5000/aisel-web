/* Workorder-local USP editing. Imports use the existing meeting permission gate. */
(function (root) {
  'use strict';
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const signature = value => JSON.stringify(value || null);
  function candidates(state, code, uid) {
    if (!state?.available || !state.authorized || !state.complete || state.uid !== uid) return [];
    return state.records.filter(row => row && !row.archivedAt && !row.deleted &&
      (!row.convertedCode || row.convertedCode === code)).sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || '')) || (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  function editablePlanning(previous, serialized, name, output) {
    const next = { ...(previous ? copy(previous) : root.AiselUsp.planning({}, '')), uspKeywordsJson: serialized };
    if (String(output || '').trim() && root.AiselUsp.signature(name, previous) !== root.AiselUsp.signature(name, next)) {
      next.descriptionNeedsReview = true;
    }
    return next;
  }
  function validateCandidate(candidate, id, code) {
    if (!candidate || candidate.id && candidate.id !== id || candidate.designMeeting !== true ||
        candidate.deleted || candidate.designMeetingDeletedAt || candidate.convertedCode && candidate.convertedCode !== code) {
      throw Error('이 작업지시서로 가져올 수 있는 디자인회의를 선택해주세요.');
    }
    return candidate;
  }
  function mount(section, options) {
    const document = section.ownerDocument;
    const button = section.querySelector('#workorderUspRefresh');
    const notice = section.querySelector('#workorderUspNotice');
    const legacy = section.querySelector('#workorderUspLegacy');
    let busy = false, preparing = false, viewKey = null, message = '', picker = null;
    const context = () => options.context();
    const canImport = () => !!root.AiselAccess?.allowed?.('designmeeting');
    const authStamp = () => [root.AiselAuth?.currentUser?.()?.uid || '', root.AiselAuth?.generation, root.AiselAccess?.generation];
    const sameAuth = stamp => JSON.stringify(stamp) === JSON.stringify(authStamp());
    const panel = root.AiselUsp.mount(section.querySelector('#workorderUspKeywords'), {
      inline: true,
      onChange(serialized) {
        const current = context();
        if (busy || !current.editable || (current.planning?.uspKeywordsJson || '[]') === serialized) return;
        message = '';
        options.change(editablePlanning(current.planning, serialized, current.name, current.output), false);
        update();
      }
    });
    function update() {
      const current = context();
      if (viewKey !== current.code) { viewKey = current.code; message = ''; picker?.close(null); }
      section.hidden = false;
      panel.update({ key: current.code, serialized: current.planning?.uspKeywordsJson, disabled: busy || !current.editable });
      button.hidden = !canImport();
      button.disabled = busy || !current.editable;
      button.textContent = busy ? '가져오는 중…' : '디자인회의에서 가져오기';
      if (legacy) { legacy.textContent = current.planning?.uspValue || ''; legacy.hidden = !legacy.textContent; }
      notice.textContent = message || (current.planning?.descriptionNeedsReview ? '상품명·USP가 바뀌었습니다. 기존 상세설명을 확인해주세요.' : '');
      if (picker && (!sameAuth(picker.stamp) || !canImport())) picker.close(null);
    }
    function chooseMeeting(code, stamp) {
      const index = root.AiselGalleryIndex;
      if (!index?.enabled) return Promise.reject(Error('디자인회의 목록을 불러올 수 없습니다. 잠시 후 다시 시도해주세요.'));
      return new Promise(resolve => {
        const dialog = document.createElement('dialog'); dialog.className = 'aisel-workorder-usp-picker';
        const heading = document.createElement('div'); heading.className = 'aisel-workorder-usp-picker-heading';
        const title = document.createElement('h2'); title.id = 'workorderUspPickerTitle'; title.textContent = '디자인회의에서 가져오기';
        const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.textContent = '×'; closeButton.setAttribute('aria-label', '닫기');
        heading.append(title, closeButton);
        const search = document.createElement('input'); search.type = 'search'; search.placeholder = '품명·담당자 검색'; search.setAttribute('aria-label', '디자인회의 검색');
        const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '디자인회의를 불러오는 중…';
        const list = document.createElement('div'); list.className = 'aisel-workorder-usp-picker-list';
        dialog.setAttribute('aria-labelledby', title.id); dialog.append(heading, search, status, list); document.body.append(dialog);
        let finished = false, ready = false, unsubscribe = null;
        const current = () => !finished && sameAuth(stamp) && canImport() && context().code === code;
        const finish = id => {
          if (finished) return; finished = true; unsubscribe?.();
          if (picker?.dialog === dialog) picker = null;
          if (dialog.open) dialog.close(); dialog.remove(); resolve(id);
        };
        picker = { dialog, stamp, close: finish };
        const render = state => {
          list.replaceChildren();
          if (!current()) { finish(null); return; }
          const rows = candidates(state, code, stamp[0]);
          if (!state?.available || !state.authorized || !state.complete || state.uid !== stamp[0]) {
            status.textContent = state?.authorized === false ? '디자인회의 조회 권한을 확인해주세요.' : '디자인회의 목록을 확인하지 못했습니다. 닫은 뒤 다시 시도해주세요.';
            return;
          }
          const query = search.value.trim().toLocaleLowerCase();
          const matched = rows.filter(row => [row.title, row.designer, row.date].join(' ').toLocaleLowerCase().includes(query));
          status.textContent = matched.length ? '가져올 디자인회의를 선택해주세요.' : query ? '검색 결과가 없습니다.' : '가져올 수 있는 디자인회의가 없습니다.';
          for (const row of matched) {
            const item = document.createElement('button'); item.type = 'button';
            const name = document.createElement('span'); name.textContent = row.title || '제목 없는 디자인회의';
            const details = document.createElement('small'); details.textContent = [row.date, row.designer].filter(Boolean).join(' · ');
            item.append(name, details);
            item.onclick = () => {
              if (current() && candidates(index.snapshot('meetings'), code, stamp[0]).some(value => value.id === row.id)) finish(row.id);
              else render(index.snapshot('meetings'));
            };
            list.append(item);
          }
        };
        closeButton.onclick = () => finish(null);
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
        dialog.addEventListener('close', () => finish(null));
        search.addEventListener('input', () => { if (ready) render(index.snapshot('meetings')); });
        dialog.showModal();
        (async () => {
          try {
            await index.warm('meetings', { refresh: true });
            if (!current()) { finish(null); return; }
            ready = true; unsubscribe = index.subscribe('meetings', render);
          } catch (_) { if (current()) status.textContent = '디자인회의 목록을 확인하지 못했습니다. 닫은 뒤 다시 시도해주세요.'; }
        })();
      });
    }
    async function importPlanning() {
      if (busy || preparing || !context().editable || !canImport()) return false;
      preparing = true;
      try {
        if (!await options.waitComposition()) throw Error('한글 입력을 마친 뒤 다시 시도해주세요.');
      } catch (error) {
        message = error.message; update(); return false;
      } finally { preparing = false; }
      if (!context().editable || !canImport()) return false;
      const currentContext = context(), stamp = authStamp();
      const initial = { code: currentContext.code, ref: currentContext.ref, planning: copy(currentContext.planning) };
      let expected = signature(initial.planning);
      const assertCurrent = () => {
        const current = context();
        if (current.code !== initial.code || current.ref !== initial.ref || !sameAuth(stamp) || !canImport() || !current.editable) {
          throw Error('작업지시서 또는 로그인 상태가 바뀌었습니다. 다시 확인해주세요.');
        }
        if (signature(current.planning) !== expected) throw Error('다른 곳에서 USP가 변경됐습니다. 다시 확인해주세요.');
      };
      busy = true; message = ''; update();
      try {
        assertCurrent();
        if (await options.save() === false) throw Error('현재 작업지시서 저장을 먼저 확인해주세요.');
        assertCurrent();
        const id = initial.planning?.candidateId || await chooseMeeting(initial.code, stamp);
        if (!id) return false;
        assertCurrent();
        const raw = await root.AiselCollectionWrites.getMeeting(id);
        assertCurrent();
        const candidate = validateCandidate(raw?.val ? raw.val() : raw, id, initial.code);
        const current = context();
        const next = root.AiselUsp.refreshed(current.planning, candidate, id, current.name, current.output);
        expected = signature(next);
        options.change(next, true);
        if (await options.save() === false) throw Error('USP 저장을 확인하지 못했습니다. 입력은 초안에 유지했습니다.');
        assertCurrent();
        message = '디자인회의 USP를 가져왔습니다.';
        return true;
      } catch (error) {
        if (context().code === initial.code && sameAuth(stamp)) message = error.message || 'USP를 가져오지 못했습니다. 다시 시도해주세요.';
        return false;
      } finally {
        busy = false; update();
      }
    }
    button.addEventListener('click', importPlanning);
    root.addEventListener('aisel-session-change', update);
    root.addEventListener('aisel-access-change', update);
    update();
    return { update, isComposing: panel.isComposing, importPlanning };
  }
  const api = { candidates, editablePlanning, validateCandidate, mount };
  root.AiselWorkorderUsp = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
