import { createHash } from 'node:crypto';

export const PUBLISH_CONTRACT = Object.freeze({
  databaseOrigin: 'https://aisel-workorder-default-rtdb.asia-southeast1.firebasedatabase.app',
  snapshotPath: '/salesPerformance/current.json',
  tokenEndpoint: 'https://securetoken.googleapis.com/v1/token',
  maximumProducts: 500,
  maximumBytes: 2_000_000,
  requestTimeoutMs: 20_000,
  overallTimeoutMs: 100_000,
  periodDays: 14,
});

export class PublishError extends Error {
  constructor(code, httpStatus) {
    super(code);
    this.name = 'PublishError';
    this.code = code;
    if (Number.isInteger(httpStatus)) this.httpStatus = httpStatus;
  }
}

const ROOT_FIELDS = ['schemaVersion', 'generatedAt', 'period', 'source', 'status', 'items', 'coverage'];
const ITEM_FIELDS = ['productNos', 'netQty', 'netRevenue', 'canceledQty', 'returnedQty', 'rank', 'gauge',
  'status', 'reason', 'revenueReason', 'previousNetQty'];
const COVERAGE_FIELDS = ['complete', 'orderCount', 'itemCount', 'matchedCount', 'unmatchedCount',
  'productCount', 'skippedCount', 'errorCount', 'cancellationCount', 'returnCount'];
const ITEM_STATES = ['good', 'normal', 'poor', 'pending', 'unmatched'];
const DAY_MS = 86_400_000;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactFields(value, fields) {
  if (!object(value) || Object.keys(value).some((key) => !fields.includes(key))) {
    throw new PublishError('INVALID_SALES_SCHEMA');
  }
}

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new PublishError('INVALID_SALES_PERIOD');
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new PublishError('INVALID_SALES_PERIOD');
  }
  return parsed;
}

function nullableNumber(value, { readback, nonnegative = false, integer = false } = {}) {
  if (value === null || (readback && value === undefined)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER
    || (nonnegative && value < 0) || (integer && !Number.isSafeInteger(value))) {
    throw new PublishError('INVALID_SALES_VALUE');
  }
  return value;
}

function reason(value, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > 1_000) throw new PublishError('INVALID_SALES_REASON');
  return value;
}

// Only these aggregate fields can reach Firebase. Unknown fields are rejected,
// including raw orders or customer records anywhere in the accepted structure.
export function validateSalesSnapshot(value, { nowMs = Date.now(), readback = false, expectedPeriodEnd } = {}) {
  exactFields(value, ROOT_FIELDS);
  if (value.schemaVersion !== 1 || value.source !== 'cafe24' || value.status !== 'ready') {
    throw new PublishError('INVALID_SALES_SCHEMA');
  }
  if (typeof value.generatedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+09:00)$/u.test(value.generatedAt)
    || !Number.isFinite(Date.parse(value.generatedAt)) || Date.parse(value.generatedAt) > nowMs) {
    throw new PublishError('INVALID_GENERATION_TIME');
  }
  exactFields(value.period, ['start', 'end', 'timeZone']);
  const start = dateOnly(value.period.start);
  const end = dateOnly(value.period.end);
  const todayKst = dateOnly(new Date(nowMs + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10));
  if (value.period.timeZone !== 'Asia/Seoul' || end - start !== (PUBLISH_CONTRACT.periodDays - 1) * DAY_MS
    || end >= todayKst || Date.parse(value.generatedAt) < end) {
    throw new PublishError('INVALID_SALES_PERIOD');
  }
  if (expectedPeriodEnd !== undefined) {
    dateOnly(expectedPeriodEnd);
    if (value.period.end !== expectedPeriodEnd) throw new PublishError('UNEXPECTED_SALES_PERIOD');
  }
  const sourceItems = readback && value.items === undefined ? {} : value.items;
  if (!object(sourceItems) || Object.keys(sourceItems).length > PUBLISH_CONTRACT.maximumProducts) {
    throw new PublishError('INVALID_SALES_ITEMS');
  }
  const items = {};
  for (const [code, item] of Object.entries(sourceItems)) {
    if (!/^AS-[A-Za-z0-9-]{1,100}$/u.test(code)) throw new PublishError('INVALID_PRODUCT_CODE');
    exactFields(item, ITEM_FIELDS);
    const productNos = readback && item.productNos === undefined ? [] : item.productNos;
    if (!Array.isArray(productNos) || productNos.length > 500
      || productNos.some((number) => !Number.isSafeInteger(number) || number <= 0)
      || new Set(productNos).size !== productNos.length || !ITEM_STATES.includes(item.status)) {
      throw new PublishError('INVALID_SALES_ITEM');
    }
    const rank = nullableNumber(item.rank, { readback, nonnegative: true, integer: true });
    const gauge = nullableNumber(item.gauge, { readback, nonnegative: true });
    if ((rank !== null && (rank < 1 || rank > PUBLISH_CONTRACT.maximumProducts))
      || (gauge !== null && gauge > 100)) throw new PublishError('INVALID_SALES_VALUE');
    items[code] = {
      productNos: [...productNos],
      netQty: nullableNumber(item.netQty, { readback }),
      netRevenue: nullableNumber(item.netRevenue, { readback }),
      canceledQty: nullableNumber(item.canceledQty, { readback, nonnegative: true }),
      returnedQty: nullableNumber(item.returnedQty, { readback, nonnegative: true }),
      rank, gauge, status: item.status, reason: reason(item.reason),
      revenueReason: reason(item.revenueReason, true),
      previousNetQty: nullableNumber(item.previousNetQty ?? null, { readback }),
    };
  }
  if (!object(value.coverage) || value.coverage.complete !== true) throw new PublishError('INCOMPLETE_SALES_COVERAGE');
  if (Object.keys(value.coverage).some((key) => /^(?:rawOrders?|orders?|customers?|customer.*|buyer.*|payer.*|recipient.*|email.*|address.*|phone.*)$/iu.test(key))) {
    throw new PublishError('INVALID_SALES_SCHEMA');
  }
  // Runtime coverage metadata may expand. Only approved counts are copied;
  // unknown coverage fields are dropped, while raw customer/order fields fail.
  const coverage = { complete: true };
  for (const field of COVERAGE_FIELDS.slice(1)) {
    if (Object.hasOwn(value.coverage, field)) {
      const count = value.coverage[field];
      if (!Number.isSafeInteger(count) || count < 0) throw new PublishError('INVALID_COVERAGE_COUNT');
      coverage[field] = count;
    }
  }
  const snapshot = {
    schemaVersion: 1, generatedAt: value.generatedAt,
    period: { start: value.period.start, end: value.period.end, timeZone: 'Asia/Seoul' },
    source: 'cafe24', status: 'ready', items, coverage,
  };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > PUBLISH_CONTRACT.maximumBytes) {
    throw new PublishError('SALES_SNAPSHOT_TOO_LARGE');
  }
  return snapshot;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function snapshotHash(snapshot) {
  return createHash('sha256').update(canonical(snapshot)).digest('hex');
}

function mask(value, log) {
  if (typeof value === 'string' && value) {
    log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
  }
}

function configuration(env, log) {
  for (const field of ['AISEL_FIREBASE_API_KEY', 'AISEL_FIREBASE_REFRESH_TOKEN', 'AISEL_FIREBASE_MACHINE_UID']) {
    mask(env[field], log);
  }
  const config = {
    apiKey: env.AISEL_FIREBASE_API_KEY,
    refreshToken: env.AISEL_FIREBASE_REFRESH_TOKEN,
    machineUid: env.AISEL_FIREBASE_MACHINE_UID,
  };
  if (Object.values(config).some((value) => typeof value !== 'string' || !value
    || value !== value.trim() || /[\r\n]/u.test(value))) throw new PublishError('INVALID_FIREBASE_CONFIGURATION');
  return config;
}

async function readJson(response, maximumBytes) {
  if (response.status === 204) return null;
  if (!response.body) throw new PublishError('FIREBASE_EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new PublishError('FIREBASE_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new PublishError('FIREBASE_INVALID_JSON'); }
  } finally { reader.releaseLock(); }
}

export async function publishSalesSnapshot(input, {
  env = process.env, fetchImpl = globalThis.fetch, log = () => {}, nowMs = Date.now(),
  now = () => performance.now(), budgetMs = PUBLISH_CONTRACT.overallTimeoutMs,
  expectedPeriodEnd,
} = {}) {
  const config = configuration(env, log);
  const targetPeriodEnd = expectedPeriodEnd === undefined
    ? new Date(nowMs + 9 * 60 * 60 * 1_000 - DAY_MS).toISOString().slice(0, 10)
    : expectedPeriodEnd;
  // Only incoming data must match this run's exact date. Older existing snapshots
  // remain valid for monotonic comparison and replacement below.
  const snapshot = validateSalesSnapshot(input, { nowMs, expectedPeriodEnd: targetPeriodEnd });
  const deadline = now() + Math.min(budgetMs, PUBLISH_CONTRACT.overallTimeoutMs);
  const remaining = () => {
    const value = deadline - now();
    if (!Number.isFinite(value) || value <= 0) throw new PublishError('FIREBASE_PUBLISH_TIMEOUT');
    return Math.max(1, Math.floor(Math.min(value, PUBLISH_CONTRACT.requestTimeoutMs)));
  };
  const request = async (url, options, stage, maximumBytes = PUBLISH_CONTRACT.maximumBytes) => {
    let response;
    try {
      response = await fetchImpl(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(remaining()) });
      if (response.status >= 300 && response.status < 400) throw new PublishError('FIREBASE_REDIRECT_BLOCKED');
      if (response.status === 412) throw new PublishError('FIREBASE_WRITE_CONFLICT', 412);
      if (!response.ok) throw new PublishError(`${stage}_HTTP_FAILURE`, response.status);
      const data = await readJson(response, maximumBytes);
      remaining();
      return { data, etag: response.headers.get('etag') };
    } catch (error) {
      await response?.body?.cancel().catch(() => {});
      if (error instanceof PublishError) throw error;
      throw new PublishError(`${stage}_NETWORK_OR_RESPONSE_FAILURE`);
    }
  };

  const tokenUrl = new URL(PUBLISH_CONTRACT.tokenEndpoint);
  tokenUrl.searchParams.set('key', config.apiKey);
  const { data: auth } = await request(tokenUrl.href, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.refreshToken }).toString(),
  }, 'FIREBASE_AUTH', 32_768);
  mask(auth?.id_token, log);
  mask(auth?.refresh_token, log);
  if (!object(auth) || typeof auth.id_token !== 'string' || !auth.id_token || /[\r\n]/u.test(auth.id_token)
    || auth.user_id !== config.machineUid || auth.token_type !== 'Bearer') {
    throw new PublishError('FIREBASE_IDENTITY_MISMATCH');
  }
  const credentialRotationObserved = typeof auth.refresh_token === 'string'
    && auth.refresh_token !== config.refreshToken;
  const databaseUrl = new URL(PUBLISH_CONTRACT.snapshotPath, PUBLISH_CONTRACT.databaseOrigin);
  databaseUrl.searchParams.set('auth', auth.id_token);
  const headers = { Accept: 'application/json' };
  const current = await request(databaseUrl.href, {
    method: 'GET', headers: { ...headers, 'X-Firebase-ETag': 'true' },
  }, 'FIREBASE_READ');
  if (typeof current.etag !== 'string' || !current.etag || current.etag.length > 512 || /[\r\n]/u.test(current.etag)) {
    throw new PublishError('FIREBASE_ETAG_MISSING');
  }
  const expectedHash = snapshotHash(snapshot);
  if (current.data !== null) {
    const previous = validateSalesSnapshot(current.data, { nowMs, readback: true });
    if (snapshotHash(previous) === expectedHash) {
      return { published: true, verified: true, unchanged: true, credentialRotationObserved };
    }
    if (snapshot.period.end < previous.period.end
      || Date.parse(snapshot.generatedAt) <= Date.parse(previous.generatedAt)) {
      throw new PublishError('STALE_SALES_SNAPSHOT');
    }
  }

  // Exact single-location conditional replacement. Never retry an uncertain PUT.
  await request(databaseUrl.href, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json', 'If-Match': current.etag },
    body: JSON.stringify(snapshot),
  }, 'FIREBASE_WRITE');
  const saved = await request(databaseUrl.href, { method: 'GET', headers }, 'FIREBASE_VERIFY');
  let verified;
  try { verified = validateSalesSnapshot(saved.data, { nowMs, readback: true }); }
  catch { throw new PublishError('FIREBASE_VERIFY_MISMATCH'); }
  if (verified.generatedAt !== snapshot.generatedAt || snapshotHash(verified) !== expectedHash) {
    throw new PublishError('FIREBASE_VERIFY_MISMATCH');
  }
  return { published: true, verified: true, unchanged: false, credentialRotationObserved };
}
