/* AISEL ERP operations domain. Pure functions only: no network, auth or storage.
 *
 * API contract (all inputs and results are JSON data; inputs are never mutated):
 * - normalizeCandidate({id, productKey, fit?, material?, rankEvidence?, judgment?, ...})
 *   preserves extra fields, evidence and representative decisions. judgment uses
 *   arrays: demand/supply/usp/counterEvidence/opportunityCost/nextCheck.
 *   Verified rank evidence requires {platform, category, period, window, rank,
 *   observedAt: ISO timestamp, sourceRef, verified:true}.
 * - sortCandidates(candidates, {rankScope?:{platform,category,period,window}}?)
 *   retains ALL candidates. Bootcut/flare first, then wide, then other fits.
 *   Rank is compared only within the explicit scope; otherwise stable input order.
 * - assessPurchaseReadiness(draft) -> {ready, missing:string[], errors:string[]}.
 *   This does NOT gate saving a draft and NEVER authorizes or executes payment.
 *   Missing business fields return ready:false; only unsafe/non-object input throws.
 *   Ready shape: {productKey, productRef, accountRef, paymentRef, shippingRef,
 *     options:[{productKey,optionKey,selectionEvidenceRef,quantity:positive integer}],
 *     budget:{amount,currency},
 *     quote:{total,currency,includesShipping:true,sourceRef,observedAt}}.
 *   UI free-text options / numeric budget may be saved as-is in a draft. They do
 *   not establish exact option identity, a currency, or a verified total quote.
 * - assessReturnRequest(draft) -> same assessment. Ready shape:
 *   {orderRef,accountRef,productKey,items:[{productKey,optionKey,returnQuantity,
 *     deliveredQuantity,alreadyReturnedQuantity,pendingReturnQuantity,quantityEvidenceRef}],
 *     reason:{code,description,truthful:true,evidenceRefs:[ref]},
 *     fees:{amount,currency,confirmed:true,policyRef}}.
 * - transitionReturnState({status,events?:[],...}, event) -> updated copy.
 *   event={type,eventId,confirmed:true,reference,at}; refund_settled additionally
 *   requires refund:{amount>0,currency,evidenceRef,paymentRef}. A submitted request
 *   is not an actual refund. Repeat event IDs must have exactly the same payload.
 * - buildJobKey({productKey,kind,season,sourceVersion}) -> RTDB-safe stable ID.
 *   All four identity parts are strings; season may be empty except season_change.
 * - deriveMdJobs(events) -> jobs, deduplicated by buildJobKey; conflicts throw.
 *   event={productKey,kind,season,sourceVersion,persisted:true,sourceRef,persistedAt,
 *     sourceInput:{productKey,...}}. kind is one of JOB_KINDS below.
 *   images_ready requires assetRefs:[ref]; season_change requires currentSeason,
 *   targetSeason===season,needsUpdate:true,changeRefs:[ref]; stock_received requires
 *   receipts:[{productKey,optionKey,quantity:positive integer,receiptRef}]; pdp_issue
 *   requires issueRefs:[ref]. Order events create preparation jobs, never stock.
 *   A job contains {id,productKey,kind,season,sourceVersion,sourceRef,sourceInput,
 *     triggeredAt,assigneeRole:'md',status:'open',action,title,completionRequirements}.
 *   Persisted-source verification, MD UID resolution and permissions belong to
 *   the caller; client-provided persisted:true is not sufficient authorization.
 * - assertNoSecrets(value) rejects credentials/card secrets recursively. Opaque
 *   accountRef/paymentRef/shippingRef are allowed. DomainError exposes .code.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AiselErpOperations = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var SECRET_FIELDS = new Set(['password', 'passwd', 'pwd', 'secret', 'clientsecret', 'apikey',
    'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authorization', 'cookie', 'cookies',
    'cardnumber', 'cardcvv', 'cvv', 'cvc', 'cardexpiry', 'pan', 'privatekey', 'credentials']);
  var JUDGMENT_FIELDS = ['demand', 'supply', 'usp', 'counterEvidence', 'opportunityCost', 'nextCheck'];
  var JOB_KINDS = ['order_saved', 'order_confirmed', 'images_ready', 'season_change', 'stock_received', 'pdp_issue'];
  var RETURN_STATES = ['draft', 'requested', 'authorized', 'shipped', 'received', 'refund_pending', 'refunded', 'rejected', 'cancelled'];

  function DomainError(code, message) {
    this.name = 'ErpOperationsError'; this.code = code; this.message = message || code;
    if (Error.captureStackTrace) Error.captureStackTrace(this, DomainError);
  }
  DomainError.prototype = Object.create(Error.prototype);
  DomainError.prototype.constructor = DomainError;
  function fail(code, message) { throw new DomainError(code, message); }
  function record(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function text(x) { return typeof x === 'string' ? x.trim() : ''; }
  function positiveInt(x) { return Number.isSafeInteger(x) && x > 0; }
  function nonnegativeInt(x) { return Number.isSafeInteger(x) && x >= 0; }
  function money(x) { return typeof x === 'number' && Number.isFinite(x) && x >= 0; }
  function currency(x) { return typeof x === 'string' && /^[A-Z]{3}$/.test(x); }
  function stamp(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x) && Number.isFinite(Date.parse(x)); }
  function ref(x) { return typeof x === 'string' && text(x).length > 0 && x.length <= 2048; }
  function assertNoSecrets(value) {
    var seen = new Set();
    function visit(x, depth) {
      if (depth > 30) fail('INVALID_INPUT', '입력 구조가 너무 깊습니다.');
      if (x === null || typeof x !== 'object') {
        if (typeof x === 'function' || typeof x === 'symbol' || typeof x === 'bigint' ||
            typeof x === 'number' && !Number.isFinite(x)) fail('INVALID_INPUT');
        return;
      }
      if (seen.has(x)) fail('INVALID_INPUT', '순환 참조는 저장할 수 없습니다.');
      var proto = Object.getPrototypeOf(x);
      if (!Array.isArray(x) && proto !== Object.prototype && proto !== null) fail('INVALID_INPUT');
      seen.add(x);
      Object.keys(x).forEach(function (key) {
        var normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
        if (SECRET_FIELDS.has(normalized) || ['__proto__', 'prototype', 'constructor'].includes(key))
          fail('SECRET_FIELD', '인증정보·결제정보 대신 저장된 참조 ID를 사용하세요.');
        visit(x[key], depth + 1);
      });
      seen.delete(x);
    }
    visit(value, 0); return true;
  }
  function clone(x) { assertNoSecrets(x); return JSON.parse(JSON.stringify(x)); }
  function canonical(x) {
    if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
    if (record(x)) return '{' + Object.keys(x).filter(function (k) { return x[k] !== undefined; }).sort().map(function (k) {
      return JSON.stringify(k) + ':' + canonical(x[k]);
    }).join(',') + '}';
    return JSON.stringify(x);
  }
  function exactIdentity(x, field) {
    var value = x && x[field];
    if (typeof value !== 'string' || !value.length || value !== value.trim() || value.length > 300)
      fail('INVALID_' + field.toUpperCase(), field + '의 정확한 연결값이 필요합니다.');
    return value;
  }

  function normalizeCandidate(input) {
    if (!record(input)) fail('INVALID_CANDIDATE');
    var result = clone(input);
    exactIdentity(result, 'id'); exactIdentity(result, 'productKey');
    if (result.rankEvidence !== undefined && !Array.isArray(result.rankEvidence)) fail('INVALID_RANK_EVIDENCE');
    result.rankEvidence = result.rankEvidence || [];
    result.rankEvidence.forEach(function (e) {
      if (!record(e) || e.rank !== undefined && e.rank !== null && !positiveInt(e.rank)) fail('INVALID_RANK_EVIDENCE');
      if (e.verified === true && (!text(e.platform) || !text(e.category) || !text(e.period) ||
          !text(e.window) || !stamp(e.observedAt) || !ref(e.sourceRef) || !positiveInt(e.rank))) fail('INVALID_RANK_EVIDENCE');
    });
    if (result.judgment !== undefined && !record(result.judgment)) fail('INVALID_JUDGMENT');
    result.judgment = result.judgment || {};
    JUDGMENT_FIELDS.forEach(function (key) {
      if (result.judgment[key] === undefined) result.judgment[key] = [];
      else if (!Array.isArray(result.judgment[key])) fail('INVALID_JUDGMENT', '판단 근거는 배열로 보관합니다.');
    });
    return result;
  }
  function fitPriority(value) {
    var fit = text(value).toLowerCase().replace(/[\s_-]/g, '');
    if (['bootcut', 'flare', '부츠컷', '플레어'].includes(fit)) return 0;
    if (['wide', '와이드', 'semiwide', '세미와이드'].includes(fit)) return 1;
    return 2;
  }
  function sortCandidates(candidates, options) {
    if (!Array.isArray(candidates)) fail('INVALID_CANDIDATES');
    assertNoSecrets(options || {});
    var scope = options && options.rankScope;
    if (scope && (!record(scope) || ['platform', 'category', 'period', 'window'].some(function (k) { return !text(scope[k]); })))
      fail('INVALID_RANK_SCOPE');
    function scopeRank(candidate) {
      if (!scope) return Infinity;
      var ranks = candidate.rankEvidence.filter(function (e) {
        return e.verified === true && positiveInt(e.rank) && ['platform', 'category', 'period', 'window'].every(function (k) { return e[k] === scope[k]; });
      }).map(function (e) { return e.rank; });
      // More than one observation in the same scope is ambiguous: do not select a convenient rank.
      return ranks.length === 1 ? ranks[0] : Infinity;
    }
    return candidates.map(function (value, index) { return {value: normalizeCandidate(value), index: index}; }).sort(function (a, b) {
      var fit = fitPriority(a.value.fit) - fitPriority(b.value.fit);
      if (fit) return fit;
      var ar = scopeRank(a.value), br = scopeRank(b.value);
      if (ar !== br) return ar < br ? -1 : 1;
      return a.index - b.index;
    }).map(function (x) { return x.value; });
  }

  function assessment(input) { if (!record(input)) fail('INVALID_INPUT'); assertNoSecrets(input); return {ready: false, missing: [], errors: []}; }
  function need(result, valid, field) { if (!valid) result.missing.push(field); }
  function done(result) { result.ready = result.missing.length === 0 && result.errors.length === 0; return result; }
  function assessPurchaseReadiness(input) {
    var result = assessment(input);
    ['productKey', 'productRef', 'accountRef', 'paymentRef', 'shippingRef'].forEach(function (k) { need(result, ref(input[k]), k); });
    need(result, Array.isArray(input.options) && input.options.length > 0, 'options');
    var keys = new Set();
    (Array.isArray(input.options) ? input.options : []).forEach(function (item, index) {
      if (!record(item) || !ref(item.optionKey) || !ref(item.selectionEvidenceRef) || !positiveInt(item.quantity)) {
        result.errors.push('options.' + index + '.exact_selection_required'); return;
      }
      if (keys.has(item.optionKey)) result.errors.push('options.' + index + '.duplicate_option');
      keys.add(item.optionKey);
      if (item.productKey !== input.productKey) result.errors.push('options.' + index + '.product_mismatch');
    });
    need(result, record(input.budget) && money(input.budget.amount) && currency(input.budget.currency), 'budget');
    need(result, record(input.quote) && money(input.quote.total) && currency(input.quote.currency) &&
      input.quote.includesShipping === true && ref(input.quote.sourceRef) && stamp(input.quote.observedAt), 'quote');
    if (record(input.budget) && record(input.quote)) {
      if (input.budget.currency !== input.quote.currency) result.errors.push('currency_mismatch');
      if (money(input.budget.amount) && money(input.quote.total) && input.quote.total > input.budget.amount) result.errors.push('budget_exceeded');
    }
    return done(result);
  }

  function assessReturnRequest(input) {
    var result = assessment(input);
    ['orderRef', 'accountRef', 'productKey'].forEach(function (k) { need(result, ref(input[k]), k); });
    need(result, Array.isArray(input.items) && input.items.length > 0, 'items');
    var keys = new Set();
    (Array.isArray(input.items) ? input.items : []).forEach(function (item, index) {
      if (!record(item) || !ref(item.optionKey) || !ref(item.quantityEvidenceRef) || !positiveInt(item.returnQuantity) ||
          !nonnegativeInt(item.deliveredQuantity) || !nonnegativeInt(item.alreadyReturnedQuantity) || !nonnegativeInt(item.pendingReturnQuantity)) {
        result.errors.push('items.' + index + '.verified_quantities_required'); return;
      }
      if (item.productKey !== input.productKey) result.errors.push('items.' + index + '.product_mismatch');
      if (keys.has(item.optionKey)) result.errors.push('items.' + index + '.duplicate_option');
      keys.add(item.optionKey);
      if (item.returnQuantity + item.alreadyReturnedQuantity + item.pendingReturnQuantity > item.deliveredQuantity)
        result.errors.push('items.' + index + '.return_quantity_exceeded');
    });
    need(result, record(input.reason) && text(input.reason.code) && text(input.reason.description) &&
      input.reason.truthful === true && Array.isArray(input.reason.evidenceRefs) && input.reason.evidenceRefs.length > 0 &&
      input.reason.evidenceRefs.every(ref), 'reason');
    need(result, record(input.fees) && money(input.fees.amount) && currency(input.fees.currency) &&
      input.fees.confirmed === true && ref(input.fees.policyRef), 'fees');
    return done(result);
  }

  var RETURN_TRANSITIONS = {
    request_submitted: {from: ['draft'], to: 'requested'},
    merchant_authorized: {from: ['requested'], to: 'authorized'},
    return_shipped: {from: ['authorized'], to: 'shipped'},
    return_received: {from: ['authorized', 'shipped'], to: 'received'},
    refund_pending: {from: ['requested', 'authorized', 'received'], to: 'refund_pending'},
    refund_settled: {from: ['requested', 'authorized', 'received', 'refund_pending'], to: 'refunded'},
    rejected: {from: ['requested', 'authorized'], to: 'rejected'},
    cancelled: {from: ['draft', 'requested', 'authorized'], to: 'cancelled'}
  };
  function transitionReturnState(current, event) {
    if (!record(current) || !record(event)) fail('INVALID_RETURN_EVENT');
    var result = clone(current), incoming = clone(event);
    if (!RETURN_STATES.includes(result.status)) fail('INVALID_RETURN_STATE');
    var rule = Object.prototype.hasOwnProperty.call(RETURN_TRANSITIONS, incoming.type) ? RETURN_TRANSITIONS[incoming.type] : null;
    if (!rule || !ref(incoming.eventId) || incoming.confirmed !== true || !ref(incoming.reference) || !stamp(incoming.at))
      fail('RETURN_CONFIRMATION_REQUIRED');
    if (result.events !== undefined && !Array.isArray(result.events)) fail('INVALID_RETURN_HISTORY');
    var history = result.events || [];
    if (history.some(function (e) { return !record(e) || !ref(e.eventId) || !stamp(e.at); })) fail('INVALID_RETURN_HISTORY');
    var prior = history.find(function (e) { return e.eventId === incoming.eventId; });
    if (prior) {
      if (canonical(prior) !== canonical(incoming)) fail('IDEMPOTENCY_CONFLICT');
      return result;
    }
    if (!rule.from.includes(result.status)) fail('INVALID_RETURN_TRANSITION');
    if (history.some(function (e) { return stamp(e.at) && Date.parse(e.at) > Date.parse(incoming.at); })) fail('STALE_RETURN_EVENT');
    if (incoming.type === 'refund_settled') {
      var refund = incoming.refund;
      if (!record(refund) || !money(refund.amount) || refund.amount <= 0 || !currency(refund.currency) ||
          !ref(refund.evidenceRef) || !ref(refund.paymentRef)) fail('REFUND_SETTLEMENT_REQUIRED');
      result.refund = clone(refund);
    }
    result.status = rule.to; result.events = history.concat([incoming]); result.updatedAt = incoming.at;
    return result;
  }

  function keyPart(value) {
    // Injective, RTDB-path-safe encoding. No lossy hash or delimiter collisions.
    return encodeURIComponent(value).replace(/[.!'()*~]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
  }
  function buildJobKey(event) {
    if (!record(event)) fail('INVALID_EVENT'); assertNoSecrets(event);
    var product = exactIdentity(event, 'productKey'), kind = exactIdentity(event, 'kind'), version = exactIdentity(event, 'sourceVersion');
    if (!JOB_KINDS.includes(kind)) fail('UNSUPPORTED_EVENT_KIND');
    if (typeof event.season !== 'string' || event.season !== event.season.trim() || event.season.length > 100) fail('INVALID_SEASON');
    var key = 'job_v1~' + [product, kind, event.season, version].map(keyPart).join('~');
    // RTDB keys are limited to 768 UTF-8 bytes. Encoded keys contain ASCII only.
    if (key.length > 768) fail('EVENT_KEY_TOO_LONG');
    return key;
  }
  function deriveMdJobs(events) {
    if (!Array.isArray(events)) fail('INVALID_EVENTS');
    var jobs = [], seen = new Map();
    events.forEach(function (raw) {
      if (!record(raw)) fail('INVALID_EVENT');
      var event = clone(raw), id = buildJobKey(event);
      if (event.persisted !== true || !ref(event.sourceRef) || !stamp(event.persistedAt) || !record(event.sourceInput)) fail('PERSISTED_EVENT_REQUIRED');
      if (event.sourceInput.productKey !== event.productKey) fail('EVENT_PRODUCT_MISMATCH');
      var signature = canonical(event);
      if (seen.has(id)) { if (seen.get(id) !== signature) fail('IDEMPOTENCY_CONFLICT'); return; }
      seen.set(id, signature);
      var job = {id: id, productKey: event.productKey, kind: event.kind, season: event.season,
        sourceVersion: event.sourceVersion, sourceRef: event.sourceRef, sourceInput: clone(event.sourceInput),
        triggeredAt: event.persistedAt, assigneeRole: 'md', status: 'open', completionRequirements: []};
      if (event.kind === 'order_saved' || event.kind === 'order_confirmed') {
        job.action = 'prepare_launch'; job.title = '출시 준비';
        job.completionRequirements = ['상품 연결 확인', '사진·상세 준비 항목 확인', '작업 담당과 일정 확인'];
      } else if (event.kind === 'images_ready') {
        if (!Array.isArray(event.sourceInput.assetRefs) || event.sourceInput.assetRefs.length === 0 || !event.sourceInput.assetRefs.every(ref)) fail('IMAGE_EVIDENCE_REQUIRED');
        job.action = 'review_and_publish_images'; job.title = '사진 검수 및 반영';
        job.completionRequirements = ['상품·컬러와 원본 사진 대조', '지정 이미지 등록', '고객 페이지 이미지 재조회'];
      } else if (event.kind === 'season_change') {
        if (!text(event.season) || !text(event.sourceInput.currentSeason) || !text(event.sourceInput.targetSeason) ||
            event.sourceInput.targetSeason !== event.season || event.sourceInput.needsUpdate !== true || !Array.isArray(event.sourceInput.changeRefs) ||
            event.sourceInput.changeRefs.length === 0 || !event.sourceInput.changeRefs.every(ref)) fail('SEASON_CHANGE_EVIDENCE_REQUIRED');
        job.action = 'refresh_seasonal_pdp'; job.title = '시즌 상세 업데이트';
        job.completionRequirements = ['변경할 사진·문구 확인', '대상 시즌 내용 반영', '고객 페이지 변경 결과 확인'];
      } else if (event.kind === 'stock_received') {
        var receipts = event.sourceInput.receipts;
        if (!Array.isArray(receipts) || receipts.length === 0 || receipts.some(function (item) {
          return !record(item) || item.productKey !== event.productKey || !ref(item.optionKey) || !positiveInt(item.quantity) || !ref(item.receiptRef);
        })) fail('STOCK_RECEIPT_EVIDENCE_REQUIRED');
        var receiptKeys = new Set();
        receipts.forEach(function (item) { var key = canonical([item.optionKey, item.receiptRef]); if (receiptKeys.has(key)) fail('DUPLICATE_STOCK_RECEIPT'); receiptKeys.add(key); });
        job.action = 'verify_launch_readiness'; job.title = '입고 옵션 판매 준비 확인';
        job.completionRequirements = ['실제 입고된 옵션·수량 확인', '사진·설명·옵션 준비 확인', '고객 페이지 판매 준비 확인'];
      } else if (event.kind === 'pdp_issue') {
        if (!Array.isArray(event.sourceInput.issueRefs) || event.sourceInput.issueRefs.length === 0 || !event.sourceInput.issueRefs.every(ref)) fail('PDP_ISSUE_EVIDENCE_REQUIRED');
        job.action = 'repair_pdp'; job.title = '상세페이지 수정';
        job.completionRequirements = ['확인된 문제 수정', '해당 고객 페이지 재조회', '수정 전후 근거 기록'];
      }
      jobs.push(job);
    });
    return jobs;
  }

  return Object.freeze({VERSION: VERSION, DomainError: DomainError, JOB_KINDS: Object.freeze(JOB_KINDS.slice()),
    RETURN_STATES: Object.freeze(RETURN_STATES.slice()), assertNoSecrets: assertNoSecrets,
    normalizeCandidate: normalizeCandidate, sortCandidates: sortCandidates,
    assessPurchaseReadiness: assessPurchaseReadiness, assessReturnRequest: assessReturnRequest,
    transitionReturnState: transitionReturnState, buildJobKey: buildJobKey, deriveMdJobs: deriveMdJobs});
}));
