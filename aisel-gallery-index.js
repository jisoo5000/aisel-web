/* AISEL gallery summary reader. Enable only after the index and read rules are deployed.
 * This module never writes Firebase or turns a summary into an editable detail record.
 * v213 details come from a separate server-written snapshot or canonical meeting path.
 * SDK events invalidate; fresh authenticated REST responses establish authority/data.
 */
(function () {
  'use strict';
  const enabled = window.AISEL_GALLERY_INDEX_ENABLED === true;
  const native = window.AISEL_NATIVE_ENABLED === true;
  const atomicSnapshots = native && window.AISEL_GALLERY_SNAPSHOTS_ENABLED === true;
  const ROOT = 'aiselGallery/v1', KINDS = ['references', 'meetings'];
  const roles = { references: ['owner', 'designer', 'md'], meetings: ['owner', 'designer'] };
  const CACHE = 'aisel.gallery.v1:', REQUEST_MS = 12000, RETRY_MS = 30000, RECHECK_MS = 60000;
  const buckets = new Map(), subscribers = new Map();
  let epoch = 0, uid = '', email = '', app = null, access = null, accessProved = false, accessNeedsRefresh = false;
  let started = false, accessFlight = null, leaseTimer = null, authorityTimer = null, refreshTimer = null, retryTimer = null;
  let sessionUnsubscribe = null, listeners = [], listenerUid = '', sessionGeneration;
  let enrollment = null;
  let strictAccessFlight = null, proofSequence = 0, acceptedProof = 0, accessProvedAt = 0;
  const overlays = new Map(), detailFlights = new Map(), provenUids = new Set();
  const confirmedMarkers = new Map(), confirmedFlights = new Map(), CONFIRMED = 'aisel.gallery.confirmed.v214:';
  const refreshTargets = new Set();
  const bucketKey = (kind, archived) => kind + (archived ? ':archived' : ':active');
  const validKind = kind => { if (!KINDS.includes(kind)) throw Error('Unknown gallery kind'); return kind; };
  const error = code => Object.assign(Error(code), { code });
  const canonical = () => window.AiselAuth?.currentUser?.() || null;
  const now = () => Date.now();
  const online = () => window.navigator?.onLine !== false;
  const text = (value, max = 500) => typeof value === 'string' ? value.slice(0, max) : '';
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const inlineThumbnail = value => typeof value==='string'&&value.length<=136559&&/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value)?value:'';
  function bucket(kind, archived = false) {
    validKind(kind); const key = bucketKey(kind, archived);
    if (!buckets.has(key)) buckets.set(key, { kind, archived, rows: new Map(), sourceRows: null, meta: null, observedMeta: null, available: false,
      authorized: null, complete: false, mode: enabled ? 'unavailable' : 'disabled', error: null,
      flight: null, paged:false, hasMore:false, pageCursor:null, nextPage:false, revision: 0, loadedRevision: -1, confirmedAt: 0, retryAt: 0, retryCount: 0 });
    return buckets.get(key);
  }
  function hasAuthority(kind, archived = false) {
    const user = canonical();
    return !!(accessProved && online() && user?.uid === uid && user.emailVerified &&
      String(user.email || '').toLowerCase() === email && window.AiselAuth?.generation === sessionGeneration &&
      access?.active === true && (native && access.mode === 'firebase217' || number(access.expiresAt) > now()) && roles[kind].includes(access.role) && (!archived || access.role === 'owner'));
  }
  function snapshot(kind, options = {}) {
    const b = bucket(kind, options.archived === true), trusted = enabled && hasAuthority(kind, b.archived);
    return { available: trusted && b.available, authorized: b.authorized === false ? false : (trusted ? true : null),
      complete: trusted && b.complete, paged:trusted && b.paged, hasMore:trusted && b.hasMore, mode: enabled ? b.mode : 'disabled',
      records: trusted && b.available ? [...b.rows.values()].map(row => ({ ...row })) : [],
      uid: enabled ? uid || null : null, role: trusted ? access.role : '', error: b.error ? { code: b.error.code } : null };
  }
  function preview(kind, id) {
    validKind(kind);
    const b = bucket(kind), row = b.rows.get(id), stamp = epoch, accessVersion = number(access?.updatedAt);
    const current = () => enabled && stamp === epoch && hasAuthority(kind) && !accessNeedsRefresh &&
      number(access?.updatedAt) === accessVersion && b.available && b.rows.get(id) === row &&
      row && !row.archivedAt && /^https:\/\//i.test(row.thumbnail || '');
    // A proven list image can paint while the canonical detail request runs.
    // This receipt grants no body/edit access and cannot outlive its list/ACL.
    if (!current()) return null;
    return Object.freeze({ id, thumbnail: row.thumbnail, source: inlineThumbnail(row.thumbnailData)||row.thumbnail, isCurrent: () => !!current() });
  }
  function imageSource(kind,id,url){const receipt=preview(kind,id);return receipt?.isCurrent()&&receipt.thumbnail===url?receipt.source:url;}
  function canPreview(kind) { return enabled && KINDS.includes(kind) && hasAuthority(kind) && !accessNeedsRefresh; }
  function emit(kind, archived = false) {
    const state = snapshot(kind, { archived });
    for (const callback of subscribers.get(bucketKey(kind, archived)) || []) { try { callback(state); } catch (_) {} }
  }
  function subscribe(kind, callback, options = {}) {
    const key = bucketKey(validKind(kind), options.archived === true);
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key).add(callback); callback(snapshot(kind, options));
    return () => subscribers.get(key)?.delete(callback);
  }
  function detach() {
    clearTimeout(leaseTimer); clearTimeout(authorityTimer); clearTimeout(refreshTimer); clearTimeout(retryTimer);
    leaseTimer = authorityTimer = refreshTimer = retryTimer = null; refreshTargets.clear();
    for (const stop of listeners.splice(0)) { try { stop(); } catch (_) {} }
    listenerUid = '';
  }
  function invalidate(code, denied = false, clearAccount = false) {
    epoch++; accessProved = false; accessProvedAt = 0; accessNeedsRefresh = false; access = null; detach(); accessFlight = null;
    strictAccessFlight = null; acceptedProof = ++proofSequence;
    detailFlights.clear(); confirmedFlights.clear();
    if (window.AiselCollectionWrites?.enabled === true) overlays.clear();
    if ((clearAccount || denied) && uid && app) {
      for (const kind of KINDS) for (const archived of [false, true]) {
        try { window.localStorage.removeItem(cacheKey(kind, archived)); } catch (_) {}
      }
    }
    if (clearAccount) { overlays.clear(); confirmedMarkers.clear(); enrollment = null; uid = ''; email = ''; app = null; }
    for (const b of buckets.values()) {
      b.available = b.complete = false; b.authorized = denied ? false : null;
      b.mode = denied ? 'denied' : 'unavailable'; b.error = error(code); b.rows.clear(); b.sourceRows = null; b.meta = b.observedMeta = null;
      b.flight = null; b.revision++; b.loadedRevision = -1; b.confirmedAt = b.retryAt = b.retryCount = 0;
      emit(b.kind, b.archived);
    }
  }
  function assertSession(stamp) {
    const user = canonical();
    if (stamp !== epoch || user?.uid !== uid || !user?.emailVerified ||
      String(user.email || '').toLowerCase() !== email || window.AiselAuth?.generation !== sessionGeneration) throw error('auth_changed');
    if (!online()) throw error('offline');
  }
  function matchingApp(user) {
    return (window.firebase?.apps || []).filter(candidate => candidate.name !== '[DEFAULT]').find(candidate => {
      try { return candidate.auth().currentUser?.uid === user.uid && /^https:\/\//.test(candidate.options?.databaseURL || ''); }
      catch (_) { return false; }
    }) || null;
  }
  async function read(path, stamp, rootPath = ROOT, query = '') {
    assertSession(stamp); const user = canonical(), token = await user.getIdToken(); assertSession(stamp);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), REQUEST_MS);
    let response;
    try {
      const base = app.options.databaseURL.replace(/\/$/, '');
      response = await fetch(base + '/' + (rootPath ? rootPath + '/' : '') + path + '.json?auth=' + encodeURIComponent(token) + query, {
        cache: 'no-store', credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json' }
      });
      assertSession(stamp);
      if (response.status === 401 || response.status === 403) throw error('permission_denied');
      if (!response.ok) throw error('network');
      const value = await response.json(); assertSession(stamp); return value;
    } catch (cause) {
      if (['auth_changed', 'permission_denied', 'offline'].includes(cause?.code)) throw cause;
      throw error('network');
    } finally { clearTimeout(timer); }
  }
  function validAccess(value) {
    return value?.active === true && String(value.email || '').toLowerCase() === email &&
      ['owner', 'designer', 'md'].includes(value.role) && (native && value.mode === 'firebase217' || number(value.expiresAt) > now());
  }
  async function enroll(stamp) {
    // A never-enrolled UID cannot read its ACL yet. The canonical source API
    // verifies Firebase identity and current membership before provisioning it;
    // successful source access alone never grants summary access.
    assertSession(stamp);
    if (enrollment && now() - enrollment.at < RETRY_MS) {
      if (enrollment.code) throw error(enrollment.code);
      return enrollment.provisioned;
    }
    const bridge = native ? window.AiselNativeBridge?.request : window.AiselDesignMeeting?.bridge;
    if (!bridge) throw error('index_unavailable');
    enrollment = { at: now(), provisioned: false };
    try {
      const result = await bridge('refAccess', [], {}); assertSession(stamp);
      if (result?.ok === false) throw error(result.code || 'permission_denied');
      const provisioned = result?.gallery?.enabled === true && result.gallery.provisioned === true;
      enrollment = { at: now(), provisioned, code: provisioned ? null : 'index_unavailable' };
      if (!provisioned) throw error('index_unavailable');
      return true;
    } catch (cause) {
      assertSession(stamp);
      const denied = ['forbidden', 'unauthorized', 'unauthenticated', 'permission_denied', 'access_denied'].includes(cause?.code) ||
        /Google 로그인 확인|대표자가 등록한 참여자/.test(cause?.message || '');
      const code = denied ? 'permission_denied' : cause?.code === 'index_unavailable' ? 'index_unavailable' : 'network';
      enrollment = { at: now(), provisioned: false, code }; throw error(code);
    }
  }
  async function readAccess(stamp, allowEnrollment = true) {
    if(native){
      let value;
      try{value=await read('access/'+encodeURIComponent(uid),stamp);}catch(cause){if(cause?.code!=='permission_denied')throw cause;}
      if(validAccess(value)&&value.mode==='firebase217')return value;
      // The native endpoint checks authoritative membership and revoked tokens.
      // Its response is only enrollment; current Firebase rules must still pass.
      await enroll(stamp);
      value=await read('access/'+encodeURIComponent(uid),stamp);
      if(!validAccess(value)||value.mode!=='firebase217')throw error('permission_denied');
      return value;
    }
    let value;
    try { value = await read('access/' + encodeURIComponent(uid), stamp); }
    catch (cause) { if (cause?.code !== 'permission_denied' || !allowEnrollment || provenUids.has(uid)) throw cause; }
    if (validAccess(value)) return value;
    // A revoked/expired known session must fail closed immediately; re-enrolling
    // through Apps Script here would put its response back in the detail path.
    if (!allowEnrollment || provenUids.has(uid) || value != null) throw error('permission_denied');
    await enroll(stamp);
    // Neither cached roles nor a bootstrap receipt can substitute for rules.
    value = await read('access/' + encodeURIComponent(uid), stamp);
    if (!validAccess(value)) throw error('permission_denied');
    return value;
  }
  function retryLater(b) {
    if (!enabled || !started || !online() || !canonical()?.uid) return;
    if (b) { b.retryCount++; b.retryAt = now() + RETRY_MS * Math.min(b.retryCount, 4); }
    clearTimeout(retryTimer);
    const pending = [...buckets.values()].filter(item => item.retryAt && item.retryCount <= 3);
    if (!pending.length) { retryTimer = null; return; }
    const stamp = epoch;
    retryTimer = setTimeout(() => {
      retryTimer = null; if (stamp !== epoch) return;
      const due = pending.filter(item => item.retryAt && item.retryAt <= now());
      for (const item of due) warm(item.kind, { archived: item.archived, preferCache: true, refresh: true }).catch(() => {});
      if (!due.length) retryLater();
    }, Math.max(0, Math.min(...pending.map(item => item.retryAt)) - now()));
  }
  function validMeta(value) {
    return value?.schemaVersion === 1 && value.protocolVersion === 207 && value.ready === true &&
      Number.isInteger(value.activeCount) && value.activeCount >= 0 &&
      Number.isInteger(value.archivedCount) && value.archivedCount >= 0 &&
      Number.isSafeInteger(value.generation) && value.generation >= 0 && number(value.reconciledAt) > 0;
  }
  function summary(row, id) {
    if (!row || typeof row !== 'object' || !id || /[.#$\[\]/]/.test(id)) return null;
    const result = { schemaVersion: 1, id, title: text(row.title), date: /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') ? row.date : '',
      designer: text(row.designer, 100), category: text(row.category, 100), contentType: text(row.contentType, 50),
      status: text(row.status, 60), reviewStatus: text(row.reviewStatus, 60), decision: text(row.decision, 60), convertedCode: text(row.convertedCode, 100),
      thumbnail: /^https:\/\//i.test(row.thumbnail || '') ? text(row.thumbnail, 4096) : '',
      thumbnailData: inlineThumbnail(row.thumbnailData),
      version: number(row.version), createdAt: number(row.createdAt), updatedAt: number(row.updatedAt),
      archivedAt: number(row.archivedAt), publicationVersion: number(row.publicationVersion) };
    // RTDB omits empty arrays. An explicit coverage receipt distinguishes a
    // confirmed empty classification set from legacy unknown/malformed data.
    const knownEmpty = row.noteCategoryCoverage === true && row.noteCategoryIds == null && row.categoryIds == null;
    const noteIds = knownEmpty ? [] : Array.isArray(row.noteCategoryIds) ? row.noteCategoryIds : row.categoryIds;
    if (Array.isArray(noteIds) && noteIds.every(id => typeof id === 'string' && /^cat_[a-f0-9]{64}$/.test(id))) {
      result.noteCategoryIds = [...new Set(noteIds)].sort();
      result.noteCategoryCoverage = row.noteCategoryCoverage !== false;
    } else result.noteCategoryCoverage = false;
    return result;
  }
  function parseRows(value, meta, archived) {
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw error('schema_mismatch');
    const rows = new Map();
    for (const [id, raw] of Object.entries(value || {})) {
      const row = summary(raw, id);
      if (!row || raw.schemaVersion !== 1 || raw.id !== id || !!row.archivedAt !== archived) throw error('schema_mismatch');
      rows.set(id, row);
    }
    if (rows.size !== meta[archived ? 'archivedCount' : 'activeCount']) throw error('index_incomplete');
    return rows;
  }
  function cacheKey(kind, archived) { return CACHE + encodeURIComponent(app.options.databaseURL) + ':' + encodeURIComponent(uid) + ':' + bucketKey(kind, archived); }
  function confirmedKey(kind) { return CONFIRMED + encodeURIComponent(app.options.databaseURL) + ':' + encodeURIComponent(uid) + ':' + encodeURIComponent(email) + ':' + kind; }
  function markers(kind) {
    if (window.AiselCollectionWrites?.enabled !== true || !hasAuthority(kind)) return new Map();
    if (!confirmedMarkers.has(kind)) {
      const rows = new Map();
      try {
        const raw = window.localStorage.getItem(confirmedKey(kind));
        const saved = raw && raw.length < 32768 ? JSON.parse(raw) : null;
        if (saved?.uid === uid && saved.email === email && Array.isArray(saved.markers)) {
          for (const m of saved.markers.slice(-40)) if (m && /^[-\w]{1,128}$/.test(m.id) && Number.isSafeInteger(m.version) && m.version > 0 && number(m.updatedAt) > 0) {
            rows.set(m.id, { id: m.id, version: m.version, updatedAt: number(m.updatedAt), archived: m.archived === true, deleted: m.deleted === true, savedAt: number(m.savedAt) });
          }
        }
      } catch (_) { /* A marker never grants authority or supplies a displayed body. */ }
      confirmedMarkers.set(kind, rows);
    }
    return confirmedMarkers.get(kind);
  }
  function persistMarkers(kind) {
    if (!hasAuthority(kind) || window.AiselCollectionWrites?.enabled !== true) return;
    const rows = markers(kind);
    while (rows.size > 40) rows.delete(rows.keys().next().value);
    try {
      if (rows.size) window.localStorage.setItem(confirmedKey(kind), JSON.stringify({ uid, email, markers: [...rows.values()] }));
      else window.localStorage.removeItem(confirmedKey(kind));
    } catch (_) { /* Storage quota cannot turn an acknowledged write into a failure. */ }
  }
  function sourceAtLeast(row, remembered) {
    if (!row) return false;
    if (number(row.version) !== number(remembered.version)) return number(row.version) > number(remembered.version);
    return number(row.updatedAt) >= number(remembered.updatedAt);
  }
  function markConfirmed(kind, row, archived, deleted) {
    if (window.AiselCollectionWrites?.enabled !== true || !Number.isSafeInteger(row.version) || row.version < 1 || row.updatedAt <= 0) return;
    const pending = markers(kind), previous = pending.get(row.id);
    if (previous && !sourceAtLeast(row, previous)) return;
    pending.delete(row.id); pending.set(row.id, { id: row.id, version: row.version, updatedAt: row.updatedAt, archived, deleted, savedAt: now() });
    persistMarkers(kind);
  }
  function sameMeta(a, b) {
    return a?.generation === b.generation && a?.reconciledAt === b.reconciledAt &&
      a?.activeCount === b.activeCount && a?.archivedCount === b.archivedCount;
  }
  function cachedRows(b, meta) {
    if (b.sourceRows && sameMeta(b.meta, meta)) return b.sourceRows;
    try {
      const saved = JSON.parse(window.localStorage.getItem(cacheKey(b.kind, b.archived)) || 'null');
      if (!saved || saved.uid !== uid || saved.email !== email || !sameMeta(saved.meta, meta)) return null;
      return parseRows(saved.records, meta, b.archived);
    } catch (_) { return null; }
  }
  function retainedMeta(b) {
    if (b.sourceRows && validMeta(b.meta)) return b.meta;
    try {
      const saved = JSON.parse(window.localStorage.getItem(cacheKey(b.kind, b.archived)) || 'null');
      return saved?.uid === uid && saved.email === email && validMeta(saved.meta) ? saved.meta : null;
    } catch (_) { return null; }
  }
  function persist(b, meta, rows) {
    if (!hasAuthority(b.kind, b.archived)) return;
    try { window.localStorage.setItem(cacheKey(b.kind, b.archived), JSON.stringify({ uid, email, meta,
      records: Object.fromEntries(rows), savedAt: now() })); } catch (_) { /* Cache failure does not block the list. */ }
  }
  function isAtLeast(row, remembered) {
    if (!row) return false;
    if (remembered.publicationVersion && row.publicationVersion && row.publicationVersion !== remembered.publicationVersion) return row.publicationVersion > remembered.publicationVersion;
    if (remembered.version && row.version && row.version !== remembered.version) return row.version > remembered.version;
    return row.updatedAt >= remembered.updatedAt;
  }
  function mergeRemembered(kind, rows, archived, authoritative = true, meta = null) {
    const merged = new Map(rows), pending = overlays.get(kind), saved = markers(kind);
    let changed = false;
    for (const [id, marker] of saved) {
      const server = rows.get(id);
      if (authoritative && server && sourceAtLeast(server, marker) &&
          (number(server.version) > marker.version || number(server.updatedAt) > marker.updatedAt || (!marker.deleted && !!server.archivedAt === marker.archived))) {
        saved.delete(id); changed = true;
      } else if (!pending?.has(id) || marker.deleted || marker.archived !== archived) merged.delete(id);
    }
    if (changed) persistMarkers(kind);
    for (const [id, local] of pending || []) {
      const server = rows.get(id);
      const newer = server && isAtLeast(server, local.row) && !isAtLeast(local.row, server);
      const acknowledged = server && isAtLeast(server, local.row) && !!server.archivedAt === local.archived && !local.deleted;
      // A collection generation cannot acknowledge deletion of one record.
      // Keep its session-local fence until that record itself proves newer.
      if (authoritative && (newer || acknowledged)) { pending.delete(id); continue; }
      if (local.deleted || local.archived !== archived) merged.delete(id);
      else merged.set(id, { ...local.row });
    }
    return merged;
  }
  function applyRows(b, rows, meta, mode) {
    if (!hasAuthority(b.kind, b.archived)) return;
    b.sourceRows = rows; b.rows = mergeRemembered(b.kind, rows, b.archived, true, meta); b.meta = meta;
    b.available = true; b.complete = !b.paged; b.authorized = true; b.mode = mode; b.error = null; emit(b.kind, b.archived);
  }
  function failBucket(b, code) {
    // A failed revision cannot erase a previously confirmed list or a sibling
    // collection. The existing ACL lease still gates every snapshot and emit.
    if (b.available && hasAuthority(b.kind, b.archived)) b.mode = 'stale';
    else { b.available = b.complete = false; b.rows.clear(); b.mode = 'unavailable'; }
    b.error = error(code); emit(b.kind, b.archived); retryLater(b);
  }
  function remember(kind, row, options = {}) {
    validKind(kind); if (!enabled || !hasAuthority(kind)) return false;
    const clean = summary(row, String(row?.id || '')); if (!clean) return false;
    if (!overlays.has(kind)) overlays.set(kind, new Map());
    const pending = overlays.get(kind), existing = pending.get(clean.id);
    if (existing && !isAtLeast(clean, existing.row)) return false;
    const previous = bucket(kind, false).rows.get(clean.id);
    if (!clean.thumbnailData && previous?.thumbnail === clean.thumbnail) clean.thumbnailData = previous.thumbnailData || '';
    const archived = options.archived === true || clean.archivedAt > 0;
    if (window.AiselCollectionWrites?.enabled === true) clean.publicationVersion = 0;
    markConfirmed(kind, clean, archived, options.deleted === true);
    pending.set(clean.id, { row: clean, archived, deleted: options.deleted === true });
    for (const b of buckets.values()) if (b.kind === kind && b.available) {
      b.rows = mergeRemembered(kind, b.rows, b.archived, false); emit(kind, b.archived);
    }
    return true;
  }
  function canonicalSummary(kind, id, record) {
    const stamp = value => typeof value === 'number' ? value : Date.parse(value || '') || 0;
    const photos = Array.isArray(record.photos) ? record.photos : Object.values(record.photos || {});
    const notes = kind === 'references' ? record.noteEntries || [] : Object.values(record.referenceNotes || {});
    const archivedAt = stamp(kind === 'references' ? record.archivedAt : record.designMeetingDeletedAt);
    return summary({ ...record, id, date: kind === 'references' ? record.date : record.meetingDate || record.date || '',
      category: kind === 'references' ? record.category : 'product', contentType: kind === 'references' ? record.contentType : 'image',
      status: archivedAt ? 'archived' : kind === 'references' ? 'active' : record.convertedCode ? 'linked' : record.decision === 'excluded' ? 'dropped' : 'planned',
      thumbnail: photos[0]?.thumb || record.thumbnail || record.thumb || '',
      version: kind === 'references' ? record.version : record.inputVersion || 1,
      createdAt: stamp(record.createdAt), updatedAt: stamp(record.updatedAt), archivedAt, publicationVersion: 0,
      noteCategoryIds: [...new Set(notes.map(note => note.categoryId).filter(id => /^cat_[a-f0-9]{64}$/.test(id || '')))], noteCategoryCoverage: true }, id);
  }
  function restoreConfirmed(kind, stamp) {
    const saved = markers(kind);
    if (!saved.size || !hasAuthority(kind)) return Promise.resolve();
    if (confirmedFlights.has(kind)) return confirmedFlights.get(kind);
    const grant = detailGrant(kind);
    const task = Promise.all([...saved].map(async ([id, marker]) => {
      const current = () => { assertSession(stamp); if (!hasAuthority(kind) || accessNeedsRefresh || access.role !== grant.role) throw error('permission_denied'); return saved.get(id) === marker; };
      const accept = (row, archived, deleted) => {
        if (!current()) return;
        if (!overlays.has(kind)) overlays.set(kind, new Map());
        overlays.get(kind).set(id, { row, archived, deleted });
        markConfirmed(kind, row, archived, deleted);
        for (const b of buckets.values()) if (b.kind === kind && b.available) {
          b.rows = mergeRemembered(kind, b.sourceRows || b.rows, b.archived, true, b.meta); emit(kind, b.archived);
        }
      };
      try {
        const value = kind === 'references' ? await read('referenceRecords/' + id, stamp) : await read('moodboardRefs/' + id, stamp, '');
        if (!current()) return;
        if (!value || value.deleted === true || kind === 'meetings' && value.designMeeting !== true) {
          accept({ ...marker, publicationVersion: 0 }, false, true); return;
        }
        const record = kind === 'references' ? await window.AiselCollectionWrites.normalizeReference(value, id, grant) : { ...value, id };
        if (!current()) return;
        const row = canonicalSummary(kind, id, record);
        if (!row || !sourceAtLeast(row, marker)) throw error('detail_stale');
        accept(row, row.archivedAt > 0, false);
      } catch (cause) {
        if (stamp !== epoch) return;
        if (cause?.code === 'permission_denied') {
          try {
            // A record may be archived/denied while the team ACL remains valid.
            await proveAccess(stamp, true, false);
            accept({ ...marker, publicationVersion: 0 }, false, true); return;
          } catch (denial) { handleFailure(denial, stamp, []); return; }
        }
        if (authFailure(cause?.code)) { handleFailure(cause, stamp, []); return; }
        // Preserve the acknowledged ID on transient errors, never an unverified body.
        if (saved.get(id) === marker) for (const b of buckets.values()) if (b.kind === kind) retryLater(b);
      }
    })).finally(() => { if (confirmedFlights.get(kind) === task) confirmedFlights.delete(kind); });
    confirmedFlights.set(kind, task); return task;
  }
  function scheduleRefresh(kind, archived) {
    if (!enabled || !started) return;
    const targets = typeof kind === 'string' ? [...buckets.values()].filter(b => b.kind === kind && (archived == null || b.archived === archived)) : [...buckets.values()];
    targets.forEach(b => refreshTargets.add(bucketKey(b.kind, b.archived)));
    if (refreshTimer) return;
    const stamp = epoch;
    refreshTimer = setTimeout(() => {
      refreshTimer = null; if (stamp !== epoch) return;
      const keys = [...refreshTargets]; refreshTargets.clear();
      for (const key of keys) {
        const b = buckets.get(key);
        if (b) warm(b.kind, { archived: b.archived, preferCache: true, refresh: true }).catch(() => {});
      }
    }, 180);
  }
  function watch(ref, update, cancel) {
    listeners.push(() => ref.off('value', update)); ref.on('value', update, cancel);
  }
  function attachListeners(stamp) {
    const listenerKey = uid + '|' + access.role;
    if (listenerUid === listenerKey) return;
    for (const stop of listeners.splice(0)) { try { stop(); } catch (_) {} }
    listenerUid = listenerKey;
    try {
      const db = app.database();
      let firstAccess = true;
      watch(db.ref(ROOT + '/access/' + uid), snap => {
        if (stamp !== epoch) return;
        const value = snap.val(), initial = firstAccess; firstAccess = false;
        // A cached SDK value may revoke conservatively; it can never grant or extend a lease.
        if (!validAccess(value)) { invalidate('permission_denied', true); return; }
        if (value.role !== access?.role) {
          // A role change revokes old-role views immediately. Only REST may grant
          // the replacement role, even when the SDK value came from its cache.
          invalidate('access_changed'); if (!initial) scheduleRefresh(); return;
        }
        if (number(value.updatedAt) > number(access?.updatedAt)) {
          accessNeedsRefresh = true;
          for (const b of buckets.values()) emit(b.kind, b.archived);
          proveAccess(stamp, true).then(() => {
            if (stamp === epoch && accessNeedsRefresh) scheduleRefresh();
          }).catch(cause => handleFailure(cause, stamp, [...buckets.values()]));
        }
      }, () => { if (stamp === epoch) invalidate('permission_denied', true); });
      if (stamp !== epoch) return;
      for (const kind of KINDS) if (roles[kind].includes(access.role)) {
        // The server changes metadata only after publishing a complete summary
        // revision. Subscribe to that small invalidation signal, not row bodies.
        const paths = [kind + '/_meta'];
        for (const path of paths) {
          let first = true;
          watch(db.ref(ROOT + '/' + path), snap => {
            if (stamp !== epoch) return;
            const value = snap.val();
            for (const b of buckets.values()) if (b.kind === kind) b.observedMeta = value;
            if (first) {
              first = false;
              // Initial SDK data is normally covered by the REST read. If it
              // arrives later with a different revision, retain that signal.
              if (![...buckets.values()].some(b => b.kind === kind && b.meta && (!validMeta(value) || !sameMeta(b.meta, value)))) return;
            }
            for (const b of buckets.values()) if (b.kind === kind) b.revision++;
            // v287: refresh changed summaries on next explicit view entry; no idle body refetch.
          }, () => { if (stamp === epoch) invalidate('permission_denied', true); });
        }
      }
    } catch (_) { invalidate('network'); }
  }
  async function loadBucket(b, stamp) {
    if (!roles[b.kind].includes(access.role) || (b.archived && access.role !== 'owner')) {
      b.available = b.complete = false; b.authorized = false; b.rows.clear(); b.mode = 'denied'; b.error = error('permission_denied'); emit(b.kind, b.archived); return;
    }
    if(b.paged){
      const append=b.nextPage&&b.available&&b.pageCursor;b.nextPage=false;
      const meta=await read(b.kind+'/_meta',stamp);if(!validMeta(meta))throw error('index_not_ready');
      let query='&orderBy='+encodeURIComponent(JSON.stringify('date'))+'&limitToLast=21';
      if(append)query+='&endAt='+encodeURIComponent(JSON.stringify(b.pageCursor.date)+','+JSON.stringify(b.pageCursor.id));
      const value=await read(b.kind+(b.archived?'/archived':'/active'),stamp,ROOT,query);assertSession(stamp);
      if(value!==null&&(typeof value!=='object'||Array.isArray(value)))throw error('schema_mismatch');
      let page=Object.entries(value||{}).map(([id,raw])=>{const row=summary(raw,id);if(!row||raw.schemaVersion!==1||raw.id!==id||!!row.archivedAt!==b.archived)throw error('schema_mismatch');return row;}).sort((a,b)=>a.date.localeCompare(b.date)||(a.id<b.id?-1:a.id>b.id?1:0));
      if(append)page=page.filter(row=>row.date<b.pageCursor.date||row.date===b.pageCursor.date&&row.id<b.pageCursor.id);
      b.hasMore=page.length>20||!!append&&page.length===20;page=page.slice(-20);
      const merged=append?new Map(b.sourceRows||b.rows):new Map();for(const row of page)merged.set(row.id,row);
      if(page.length)b.pageCursor={date:page[0].date,id:page[0].id};else if(!append)b.pageCursor=null;
      applyRows(b,merged,meta,'paged');return;
    }
    let meta = null;
    if (atomicSnapshots) {
      const retained = retainedMeta(b);
      // Reloads and periodic freshness checks need only the small metadata when
      // a complete body is already cached. SDK metadata is never proof, but a
      // different observed revision can skip this check and fetch its envelope.
      if (retained && (!validMeta(b.observedMeta) || sameMeta(retained, b.observedMeta))) {
        meta = await read(b.kind + '/_meta', stamp);
        if (!validMeta(meta)) throw error('index_not_ready');
        const saved = cachedRows(b, meta);
        if (saved) { applyRows(b, saved, meta, 'cache'); return; }
      }
      // The server writes this role-scoped envelope in the same transaction as
      // rows + metadata. One authenticated read therefore proves a complete
      // revision; no second metadata round trip or parent/archived read is needed.
      const envelope = await read(b.kind + '/snapshots/' + (b.archived ? 'archived' : 'active'), stamp);
      if (envelope !== null) {
        if (envelope.schemaVersion !== 1 || envelope.protocolVersion !== 218 || !validMeta(envelope.meta)) throw error('index_not_ready');
        const rows = parseRows(envelope.rows ?? null, envelope.meta, b.archived); assertSession(stamp);
        persist(b, envelope.meta, rows); applyRows(b, rows, envelope.meta, 'live'); return;
      }
      // During a staged rollout only an absent envelope uses the old protocol.
      // Permission/network/schema failures must not try a more permissive path.
    }
    if (!meta) meta = await read(b.kind + '/_meta', stamp);
    if (!validMeta(meta)) throw error('index_not_ready');
    const saved = cachedRows(b, meta);
    if (saved) { applyRows(b, saved, meta, 'cache'); return; }
    for (let attempt = 0; attempt < 2; attempt++) {
      const value = await read(b.kind + (b.archived ? '/archived' : '/active'), stamp);
      const checked = await read(b.kind + '/_meta', stamp);
      if (!validMeta(checked)) throw error('index_not_ready');
      if (meta.generation !== checked.generation || meta.reconciledAt !== checked.reconciledAt ||
        meta.activeCount !== checked.activeCount || meta.archivedCount !== checked.archivedCount) { meta = checked; continue; }
      const rows = parseRows(value, meta, b.archived); assertSession(stamp);
      persist(b, meta, rows); applyRows(b, rows, meta, 'live'); return;
    }
    throw error('index_incomplete');
  }
  function bindSession() {
    if (sessionUnsubscribe || !window.AiselAuth?.subscribe) return;
    sessionUnsubscribe = window.AiselAuth.subscribe(() => {
      invalidate('auth_changed', !canonical(), true); scheduleRefresh();
    });
  }
  function authFailure(code) { return ['permission_denied', 'lease_expired', 'auth_changed', 'offline'].includes(code); }
  function handleFailure(cause, stamp, targets) {
    if (stamp !== epoch) return;
    const code = cause?.code || 'network';
    if (authFailure(code)) { invalidate(code, code === 'permission_denied' || code === 'lease_expired'); return; }
    for (const b of targets) failBucket(b, code);
  }
  async function proveAccess(stamp, force = false, allowEnrollment = true) {
    if (!force && !accessNeedsRefresh && hasAuthority('references')) return access;
    const flight = allowEnrollment ? accessFlight : strictAccessFlight;
    if (flight) return flight;
    const proof = ++proofSequence;
    const task = (async () => {
      const value = await readAccess(stamp, allowEnrollment); assertSession(stamp);
      if (proof < acceptedProof) return access;
      acceptedProof = proof;
      const previousRole = access?.role, wasRefreshing = accessNeedsRefresh;
      access = value; accessProved = true; accessProvedAt = now(); accessNeedsRefresh = false;
      provenUids.add(uid);
      clearTimeout(leaseTimer); clearTimeout(authorityTimer);
      if(!native)leaseTimer = setTimeout(() => { if (stamp === epoch) invalidate('lease_expired', true); }, Math.max(0, Math.min(2147483647, number(access.expiresAt) - now())));
      authorityTimer = native ? null : setTimeout(() => {
        authorityTimer = null;
        if (stamp === epoch) warm(null, { authorityOnly: true }).catch(() => {});
      }, native ? RECHECK_MS : Math.max(1000, Math.min(RECHECK_MS, number(access.expiresAt) - now() - 1000)));
      attachListeners(stamp); assertSession(stamp);
      // Publish role restrictions before any collection request can complete.
      for (const b of buckets.values()) if (!hasAuthority(b.kind, b.archived)) {
        b.available = b.complete = false; b.authorized = false; b.rows.clear(); b.sourceRows = null; b.meta = null;
        b.mode = 'denied'; b.error = error('permission_denied'); emit(b.kind, b.archived);
      } else if ((previousRole !== access.role || wasRefreshing) && b.available) emit(b.kind, b.archived);
      return value;
    })().catch(cause => {
      // A slower enrollment/list proof cannot replace a newer strict proof.
      if (stamp === epoch && proof < acceptedProof && accessProved) return access;
      if (stamp === epoch) accessNeedsRefresh = true; throw cause;
    }).finally(() => {
      if (accessFlight === task) accessFlight = null;
      if (strictAccessFlight === task) strictAccessFlight = null;
    });
    if (allowEnrollment) accessFlight = task; else strictAccessFlight = task;
    return task;
  }
  function refreshBucket(b, stamp) {
    if (b.flight) return b.flight;
    const revision = b.revision;
    const task = loadBucket(b, stamp).then(() => {
      assertSession(stamp); b.loadedRevision = revision; b.confirmedAt = now(); b.retryAt = b.retryCount = 0;
      void restoreConfirmed(b.kind, stamp).catch(cause => handleFailure(cause, stamp, [b]));
    }).catch(cause => handleFailure(cause, stamp, [b])).finally(() => {
      if (b.flight === task) b.flight = null;
      // An SDK invalidation arriving during REST must not disappear when that
      // request finishes. Coalesce one follow-up for this collection only.
      if (stamp === epoch && b.revision !== revision && !b.error) scheduleRefresh(b.kind, b.archived);
      if (stamp === epoch) retryLater();
    });
    b.flight = task; return task;
  }
  async function warm(kind, options = {}) {
    if (!enabled) return kind ? snapshot(kind, options) : null;
    if (kind) bucket(kind, options.archived === true);
    else KINDS.forEach(item => bucket(item));
    bindSession();
    const user = canonical();
    if (!user?.uid || !user.emailVerified) { invalidate('permission_denied', true, true); return null; }
    if (!online()) { invalidate('offline'); return null; }
    if (user.uid !== uid || window.AiselAuth?.generation !== sessionGeneration || String(user.email || '').toLowerCase() !== email) {
      invalidate('auth_changed', false, true); uid = user.uid; email = String(user.email || '').toLowerCase();
      sessionGeneration = window.AiselAuth?.generation; app = matchingApp(user);
    }
    if (!app) app = matchingApp(user);
    if (!app) { invalidate('auth_unavailable'); return null; }
    if (accessProved && !native && number(access?.expiresAt) <= now()) invalidate('lease_expired', true);
    const stamp = epoch;
    const targets = kind ? [bucket(kind, options.archived === true)] : [...buckets.values()];
    for(const b of targets){
      if(options.all===true&&b.paged&&b.flight){await b.flight;assertSession(stamp);}
      if(options.all===true&&b.paged){b.paged=false;b.available=false;b.sourceRows=null;b.meta=null;b.pageCursor=null;b.hasMore=false;}
      else if(options.paged===true&&!b.available)b.paged=true;
      if(options.more&&b.paged){b.nextPage=true;options.refresh=true;}
    }
    if (options.preferCache && !options.refresh && targets.every(b => hasAuthority(b.kind, b.archived) && b.available)) {
      for (const b of targets) if (accessNeedsRefresh || b.error || b.loadedRevision !== b.revision || now() - b.confirmedAt >= RECHECK_MS) {
        if (!b.retryAt || b.retryAt <= now()) scheduleRefresh(b.kind, b.archived);
      }
      return kind ? snapshot(kind, options) : null;
    }
    try {
      await proveAccess(stamp, !options.preferCache, options.noEnrollment !== true); assertSession(stamp);
      if (!options.authorityOnly) await Promise.all(targets.map(b => {
        if (options.preferCache && b.retryAt > now()) return null;
        return refreshBucket(b, stamp);
      }));
      return stamp === epoch && kind ? snapshot(kind, options) : null;
    } catch (cause) { handleFailure(cause, stamp, targets); return null; }
  }
  function start() {
    if (!enabled) return Promise.resolve(null);
    const first = !started;
    if (first) {
      started = true;
      window.addEventListener('offline', () => invalidate('offline'));
      window.addEventListener('online', scheduleRefresh);
      window.addEventListener('aisel-session-change', () => {
        if (canonical()?.uid !== uid || window.AiselAuth?.generation !== sessionGeneration) invalidate('auth_changed', !canonical(), true);
        bindSession(); scheduleRefresh();
      });
    }
    return warm(null, native ? {authorityOnly:true,preferCache:true} : { preferCache: !first });
  }
  function detailGrant(kind) {
    if (!hasAuthority(kind)) throw error('permission_denied');
    return { uid, role: access.role, accountKey: email, email, generation: sessionGeneration,
      permissions: { canCreate: true, canManage: access.role === 'owner', automaticReview: true,
        referenceDetailVersion: 196, referenceDesignerVersion: 212, noteCategoriesVersion: 203, referenceJudgmentVersion: 203 } };
  }
  async function authorize(kind) {
    validKind(kind);
    if (!enabled) throw error('detail_unavailable');
    // Native sessions reuse only this page's recent REST proof, while the ACL
    // listener invalidates revocation/role changes immediately. Each subsequent
    // record request/write still passes Firebase's current membership rules.
    // No persistent cache, initial SDK event, or enrollment receipt grants access.
    const user = canonical(), generation = window.AiselAuth?.generation;
    if (!user?.uid || !user.emailVerified) throw error('permission_denied');
    if (!online()) throw error('offline');
    const age = now() - accessProvedAt;
    if (native && age >= 0 && age < RECHECK_MS && hasAuthority(kind) && !accessNeedsRefresh &&
        !accessFlight && !strictAccessFlight && listenerUid === uid + '|' + access.role) return detailGrant(kind);
    await warm(kind, { authorityOnly: true, noEnrollment: true });
    if (canonical()?.uid !== user.uid || window.AiselAuth?.generation !== generation) throw error('auth_changed');
    if (!hasAuthority(kind) || accessNeedsRefresh) {
      const state = snapshot(kind);
      throw error(state.error?.code || (state.authorized === false ? 'permission_denied' : 'network'));
    }
    return detailGrant(kind);
  }
  function referenceDetail(value, id, grant) {
    if (value == null) throw error('detail_unavailable');
    const record = value?.record;
    if (value.deleted === true) throw Object.assign(Error('삭제된 레퍼런스입니다. 목록을 다시 확인해주세요.'), { code: 'detail_deleted' });
    if (value.schemaVersion !== 1 || value.detailProtocolVersion !== 213 || value.id !== id ||
        !record || Array.isArray(record) || record.id !== id || !Number.isSafeInteger(record.version) || record.version < 1 ||
        value.version !== record.version || value.updatedAt !== record.updatedAt || !Number.isFinite(Date.parse(record.updatedAt)) ||
        !Number.isSafeInteger(value.publicationVersion) || value.publicationVersion < 1) throw error('detail_stale');
    if (record.archivedAt && grant.role !== 'owner') throw error('permission_denied');
    const known = [bucket('references').rows.get(id), bucket('references', true).rows.get(id), overlays.get('references')?.get(id)?.row].filter(Boolean);
    if (known.some(row => number(row.version) > record.version || number(row.version) === record.version &&
        number(row.updatedAt) > Date.parse(record.updatedAt))) throw error('detail_stale');
    return { ...record, permissions: { canEdit: grant.role === 'owner' || String(record.creator || '').toLowerCase() === grant.email,
      canArchive: grant.role === 'owner' } };
  }
  async function detail(kind, id, options = {}) {
    validKind(kind);
    if (typeof id !== 'string' || !/^[-\w]{1,128}$/.test(id)) throw error('detail_unavailable');
    const user = canonical(), key = String(user?.uid || '') + '|' + window.AiselAuth?.generation + '|' + kind + '|' + id;
    if (!options.force && detailFlights.has(key)) return detailFlights.get(key);
    const task = (async () => {
      const grant = await authorize(kind), stamp = epoch;
      try {
        const canonicalReference = kind === 'references' && window.AiselCollectionWrites?.enabled === true;
        const value = kind === 'references' ? await read((canonicalReference ? 'referenceRecords/' : 'referenceDetails/') + id, stamp) : await read('moodboardRefs/' + id, stamp, '');
        assertSession(stamp);
        if (!hasAuthority(kind) || accessNeedsRefresh || access.role !== grant.role) throw error('permission_denied');
        let record;
        if (canonicalReference) {
          record = await window.AiselCollectionWrites.normalizeReference(value, id, grant);
          assertSession(stamp);
          if (!hasAuthority(kind) || accessNeedsRefresh || access.role !== grant.role) throw error('permission_denied');
          const known = [bucket('references').rows.get(id), bucket('references', true).rows.get(id), overlays.get('references')?.get(id)?.row].filter(Boolean);
          if (known.some(row => number(row.version) > record.version)) throw error('detail_stale');
        } else if (kind === 'references') record = referenceDetail(value, id, grant);
        else {
          if (!value || typeof value !== 'object' || Array.isArray(value) || value.designMeeting !== true) throw error('detail_unavailable');
          if (value.designMeetingDeletedAt && grant.role !== 'owner') throw error('permission_denied');
          record = { ...value, id };
        }
        return { ...grant, record, source: 'firebase', detailProtocolVersion: canonicalReference ? 214 : 213 };
      } catch (cause) {
        if (stamp === epoch && authFailure(cause?.code)) handleFailure(cause, stamp, []);
        throw cause;
      }
    })().finally(() => { if (detailFlights.get(key) === task) detailFlights.delete(key); });
    detailFlights.set(key, task); return task;
  }
  window.AiselGalleryIndex = Object.freeze({ enabled, start, warm, snapshot, subscribe, remember, authorize, detail, preview, canPreview, imageSource });
})();
