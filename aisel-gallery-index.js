/* AISEL gallery summary reader. Enable only after the index and read rules are deployed.
 * This module never writes Firebase or turns a summary into an editable detail record.
 * SDK events invalidate; fresh authenticated REST responses establish authority/data.
 */
(function () {
  'use strict';
  const enabled = window.AISEL_GALLERY_INDEX_ENABLED === true;
  const ROOT = 'aiselGallery/v1', KINDS = ['references', 'meetings'];
  const roles = { references: ['owner', 'designer', 'md'], meetings: ['owner', 'designer'] };
  const CACHE = 'aisel.gallery.v1:', REQUEST_MS = 12000;
  const buckets = new Map(), subscribers = new Map();
  let epoch = 0, uid = '', email = '', app = null, access = null, accessProved = false;
  let started = false, flight = null, leaseTimer = null, refreshTimer = null, retryTimer = null;
  let sessionUnsubscribe = null, listeners = [], listenerUid = '', sessionGeneration;
  const overlays = new Map();
  const bucketKey = (kind, archived) => kind + (archived ? ':archived' : ':active');
  const validKind = kind => { if (!KINDS.includes(kind)) throw Error('Unknown gallery kind'); return kind; };
  const error = code => Object.assign(Error(code), { code });
  const canonical = () => window.AiselAuth?.currentUser?.() || null;
  const now = () => Date.now();
  const online = () => window.navigator?.onLine !== false;
  const text = (value, max = 500) => typeof value === 'string' ? value.slice(0, max) : '';
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  function bucket(kind, archived = false) {
    validKind(kind); const key = bucketKey(kind, archived);
    if (!buckets.has(key)) buckets.set(key, { kind, archived, rows: new Map(), meta: null, available: false,
      authorized: null, complete: false, mode: enabled ? 'unavailable' : 'disabled', error: null });
    return buckets.get(key);
  }
  function hasAuthority(kind, archived = false) {
    const user = canonical();
    return !!(accessProved && online() && user?.uid === uid && user.emailVerified &&
      String(user.email || '').toLowerCase() === email && window.AiselAuth?.generation === sessionGeneration &&
      access?.active === true && number(access.expiresAt) > now() && roles[kind].includes(access.role) && (!archived || access.role === 'owner'));
  }
  function snapshot(kind, options = {}) {
    const b = bucket(kind, options.archived === true), trusted = enabled && hasAuthority(kind, b.archived);
    return { available: trusted && b.available, authorized: b.authorized === false ? false : (trusted ? true : null),
      complete: trusted && b.complete, mode: enabled ? b.mode : 'disabled',
      records: trusted && b.available ? [...b.rows.values()].map(row => ({ ...row })) : [],
      uid: enabled ? uid || null : null, role: trusted ? access.role : '', error: b.error ? { code: b.error.code } : null };
  }
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
    clearTimeout(leaseTimer); clearTimeout(refreshTimer); clearTimeout(retryTimer);
    leaseTimer = refreshTimer = retryTimer = null;
    for (const stop of listeners.splice(0)) { try { stop(); } catch (_) {} }
    listenerUid = '';
  }
  function invalidate(code, denied = false, clearAccount = false) {
    epoch++; accessProved = false; access = null; detach(); flight = null;
    if ((clearAccount || denied) && uid && app) {
      for (const kind of KINDS) for (const archived of [false, true]) {
        try { window.localStorage.removeItem(cacheKey(kind, archived)); } catch (_) {}
      }
    }
    if (clearAccount) { overlays.clear(); uid = ''; email = ''; app = null; }
    for (const b of buckets.values()) {
      b.available = b.complete = false; b.authorized = denied ? false : null;
      b.mode = denied ? 'denied' : 'unavailable'; b.error = error(code); b.rows.clear(); b.meta = null;
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
  async function read(path, stamp) {
    assertSession(stamp); const user = canonical(), token = await user.getIdToken(); assertSession(stamp);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), REQUEST_MS);
    let response;
    try {
      const base = app.options.databaseURL.replace(/\/$/, '');
      response = await fetch(base + '/' + ROOT + '/' + path + '.json?auth=' + encodeURIComponent(token), {
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
      ['owner', 'designer', 'md'].includes(value.role) && number(value.expiresAt) > now();
  }
  function validMeta(value) {
    return value?.schemaVersion === 1 && value.ready === true &&
      Number.isInteger(value.activeCount) && value.activeCount >= 0 &&
      Number.isInteger(value.archivedCount) && value.archivedCount >= 0 &&
      (typeof value.generation === 'string' || Number.isFinite(value.generation)) &&
      String(value.generation) !== '' && number(value.reconciledAt) > 0;
  }
  function summary(row, id) {
    if (!row || typeof row !== 'object' || !id || /[.#$\[\]/]/.test(id)) return null;
    const result = { schemaVersion: 1, id, title: text(row.title), date: /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') ? row.date : '',
      designer: text(row.designer, 100), category: text(row.category, 50), contentType: text(row.contentType, 50),
      status: text(row.status, 60), reviewStatus: text(row.reviewStatus, 60), decision: text(row.decision, 60), convertedCode: text(row.convertedCode, 100),
      thumbnail: /^https:\/\//i.test(row.thumbnail || '') ? text(row.thumbnail, 4096) : '',
      version: number(row.version), createdAt: number(row.createdAt), updatedAt: number(row.updatedAt),
      archivedAt: number(row.archivedAt), publicationVersion: number(row.publicationVersion) };
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
  function cachedRows(b, meta) {
    try {
      const saved = JSON.parse(window.localStorage.getItem(cacheKey(b.kind, b.archived)) || 'null');
      if (!saved || saved.uid !== uid || saved.email !== email || saved.meta?.generation !== meta.generation ||
        saved.meta?.reconciledAt !== meta.reconciledAt) return null;
      return parseRows(saved.records, meta, b.archived);
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
    const merged = new Map(rows), pending = overlays.get(kind);
    for (const [id, local] of pending || []) {
      const server = rows.get(id);
      const newer = server && isAtLeast(server, local.row) && !isAtLeast(local.row, server);
      const acknowledged = server && isAtLeast(server, local.row) && !!server.archivedAt === local.archived && !local.deleted;
      const removalPublished = !server && (local.deleted || local.archived !== archived) &&
        local.row.publicationVersion > 0 && number(meta?.generation) >= local.row.publicationVersion;
      if (authoritative && (newer || acknowledged || removalPublished)) { pending.delete(id); continue; }
      if (local.deleted || local.archived !== archived) merged.delete(id);
      else merged.set(id, { ...local.row });
    }
    return merged;
  }
  function applyRows(b, rows, meta, mode) {
    if (!hasAuthority(b.kind, b.archived)) return;
    b.rows = mergeRemembered(b.kind, rows, b.archived, true, meta); b.meta = meta;
    b.available = b.complete = true; b.authorized = true; b.mode = mode; b.error = null; emit(b.kind, b.archived);
  }
  function remember(kind, row, options = {}) {
    validKind(kind); if (!enabled || !hasAuthority(kind)) return false;
    const clean = summary(row, String(row?.id || '')); if (!clean) return false;
    if (!overlays.has(kind)) overlays.set(kind, new Map());
    const pending = overlays.get(kind), existing = pending.get(clean.id);
    if (existing && !isAtLeast(clean, existing.row)) return false;
    const archived = options.archived === true || clean.archivedAt > 0;
    pending.set(clean.id, { row: clean, archived, deleted: options.deleted === true });
    for (const b of buckets.values()) if (b.kind === kind && b.available) {
      b.rows = mergeRemembered(kind, b.rows, b.archived, false); emit(kind, b.archived);
    }
    return true;
  }
  function scheduleRefresh() {
    if (!enabled || !started || refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = null; warm().catch(() => {}); }, 180);
  }
  function watch(ref, update, cancel) {
    ref.on('value', update, cancel); listeners.push(() => ref.off('value', update));
  }
  function attachListeners(stamp) {
    const listenerKey = uid + '|' + access.role;
    if (listenerUid === listenerKey) return;
    for (const stop of listeners.splice(0)) { try { stop(); } catch (_) {} }
    listenerUid = listenerKey;
    try {
      const db = app.database();
      watch(db.ref(ROOT + '/access/' + uid), snap => {
        if (stamp !== epoch) return;
        const value = snap.val();
        // A cached SDK value may revoke conservatively; it can never grant or extend a lease.
        if (!validAccess(value)) { invalidate('permission_denied', true); return; }
        if (value.role !== access?.role || number(value.updatedAt) > number(access?.updatedAt)) scheduleRefresh();
      }, () => { if (stamp === epoch) invalidate('permission_denied', true); });
      for (const kind of KINDS) if (roles[kind].includes(access.role)) {
        const paths = ['meta/' + kind, kind + '/active'];
        if (access.role === 'owner') paths.push(kind + '/archived');
        for (const path of paths) {
          let first = true;
          watch(db.ref(ROOT + '/' + path), () => {
            if (stamp !== epoch) return;
            if (first) { first = false; return; } // Initial data is covered by the fresh REST snapshot.
            scheduleRefresh();
          }, () => { if (stamp === epoch) invalidate('permission_denied', true); });
        }
      }
    } catch (_) { invalidate('network'); }
  }
  async function loadBucket(b, stamp) {
    if (!roles[b.kind].includes(access.role) || (b.archived && access.role !== 'owner')) {
      b.available = b.complete = false; b.authorized = false; b.rows.clear(); b.mode = 'denied'; b.error = error('permission_denied'); emit(b.kind, b.archived); return;
    }
    let meta = await read('meta/' + b.kind, stamp);
    if (!validMeta(meta)) {
      b.available = b.complete = false; b.authorized = true; b.rows.clear(); b.mode = 'unavailable'; b.error = error('index_not_ready'); emit(b.kind, b.archived); return;
    }
    const saved = cachedRows(b, meta); if (saved) applyRows(b, saved, meta, 'cache');
    for (let attempt = 0; attempt < 2; attempt++) {
      const value = await read(b.kind + (b.archived ? '/archived' : '/active'), stamp);
      const checked = await read('meta/' + b.kind, stamp);
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
    if (flight) return flight;
    const stamp = epoch;
    const task = (async () => {
      const value = await read('access/' + encodeURIComponent(uid), stamp);
      if (!validAccess(value)) throw error('permission_denied');
      access = value; accessProved = true;
      clearTimeout(leaseTimer);
      leaseTimer = setTimeout(() => { if (stamp === epoch) invalidate('lease_expired', true); }, Math.max(0, Math.min(2147483647, number(access.expiresAt) - now())));
      attachListeners(stamp); assertSession(stamp);
      const results = await Promise.allSettled([...buckets.values()].map(b => loadBucket(b, stamp)));
      assertSession(stamp);
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { retryTimer = null; warm().catch(() => {}); }, Math.max(1000, Math.min(60000, number(access.expiresAt) - now() - 1000)));
      return kind ? snapshot(kind, options) : null;
    })().catch(cause => {
      if (stamp !== epoch) return null;
      const code = cause?.code || 'network'; invalidate(code, code === 'permission_denied' || code === 'lease_expired'); return null;
    }).finally(() => { if (flight === task) flight = null; });
    flight = task; return task;
  }
  function start() {
    if (!enabled) return Promise.resolve(null);
    if (!started) {
      started = true;
      window.addEventListener('offline', () => invalidate('offline'));
      window.addEventListener('online', scheduleRefresh);
      window.addEventListener('aisel-session-change', () => {
        if (canonical()?.uid !== uid || window.AiselAuth?.generation !== sessionGeneration) invalidate('auth_changed', !canonical(), true);
        bindSession(); scheduleRefresh();
      });
    }
    return warm();
  }
  window.AiselGalleryIndex = Object.freeze({ enabled, start, warm, snapshot, subscribe, remember });
})();
