import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLISH_CONTRACT, PublishError, publishSalesSnapshot, validateSalesSnapshot } from '../scripts/publish-sales.mjs';

const NOW = Date.parse('2026-10-03T00:00:00.000Z');
const env = () => ({
  AISEL_FIREBASE_API_KEY: 'test-api-key', AISEL_FIREBASE_REFRESH_TOKEN: 'test-refresh-token',
  AISEL_FIREBASE_MACHINE_UID: 'test-machine-uid',
});
const snapshot = (overrides = {}) => ({
  schemaVersion: 1, generatedAt: '2026-10-02T22:00:00.000Z',
  period: { start: '2026-09-19', end: '2026-10-02', timeZone: 'Asia/Seoul' },
  source: 'cafe24', status: 'ready',
  items: { 'AS-26F-TEST': { productNos: [123], netQty: 10, netRevenue: 25_000,
    canceledQty: 1, returnedQty: 0, rank: 1, gauge: 85, status: 'good', reason: 'test aggregate' } },
  coverage: { complete: true, orderCount: 12 }, ...overrides,
});
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});
// Realtime Database removes null properties and empty containers when storing JSON.
function firebaseStored(value) {
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.length ? value.map(firebaseStored) : undefined;
  if (value && typeof value === 'object') {
    const pairs = Object.entries(value).map(([key, item]) => [key, firebaseStored(item)])
      .filter(([, item]) => item !== undefined);
    return pairs.length ? Object.fromEntries(pairs) : undefined;
  }
  return value;
}

function server({ current = null, identity = 'test-machine-uid', rotated = false,
  faultAt, faultStatus = 503, networkAt, conflict = false, badReadback = false, missingEtag = false } = {}) {
  const calls = [];
  let stored = current;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    if (calls.length === networkAt) throw new Error('sensitive-token private URL financial body');
    if (calls.length === faultAt) {
      return faultStatus >= 300 && faultStatus < 400
        ? new Response(null, { status: faultStatus, headers: { Location: 'https://example.invalid/steal' } })
        : json({ private: 'never-log-this' }, faultStatus);
    }
    if (calls.length === 1) {
      const endpoint = new URL(url);
      assert.equal(endpoint.origin, 'https://securetoken.googleapis.com');
      assert.equal(endpoint.pathname, '/v1/token');
      assert.equal(endpoint.searchParams.get('key'), env().AISEL_FIREBASE_API_KEY);
      assert.equal(options.method, 'POST');
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('refresh_token'), env().AISEL_FIREBASE_REFRESH_TOKEN);
      return json({ id_token: 'test-new-id-token', refresh_token: rotated ? 'test-rotated-refresh' : 'test-refresh-token',
        token_type: 'Bearer', user_id: identity });
    }
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, PUBLISH_CONTRACT.databaseOrigin);
    assert.equal(endpoint.pathname, '/salesPerformance/current.json');
    assert.equal(endpoint.searchParams.get('auth'), 'test-new-id-token');
    assert.equal(endpoint.searchParams.size, 1);
    if (options.method === 'PUT') {
      assert.equal(options.headers['If-Match'], '"test-etag"');
      if (conflict) return json({ private: 'other snapshot' }, 412);
      stored = firebaseStored(JSON.parse(options.body));
      return json(stored);
    }
    assert.equal(options.method, 'GET');
    if (calls.length === 2) {
      assert.equal(options.headers['X-Firebase-ETag'], 'true');
      return json(stored, 200, missingEtag ? {} : { ETag: '"test-etag"' });
    }
    return json(badReadback ? { ...stored, generatedAt: '2026-10-02T23:00:00.000Z' } : stored);
  };
  return { calls, fetchImpl, stored: () => stored };
}

async function publish(input = snapshot(), options = {}) {
  const logs = [];
  const mock = server(options);
  const result = await publishSalesSnapshot(input, {
    env: env(), fetchImpl: mock.fetchImpl, log: (line) => logs.push(line), nowMs: NOW,
  });
  return { result, logs, mock };
}

test('refreshes the expected identity, conditionally writes the exact path, and verifies by reading back', async () => {
  const { result, logs, mock } = await publish();
  assert.deepEqual(result, { published: true, verified: true, unchanged: false, credentialRotationObserved: false });
  assert.deepEqual(mock.calls.map(({ options }) => options.method), ['POST', 'GET', 'PUT', 'GET']);
  assert.ok(logs.every((line) => line.startsWith('::add-mask::')));
  assert.ok(!JSON.stringify(result).includes('25000'));
  assert.ok(!JSON.stringify(result).includes('AS-26F'));
});

test('same canonical snapshot is idempotent and avoids a PUT', async () => {
  const current = firebaseStored(validateSalesSnapshot(snapshot(), { nowMs: NOW }));
  const { result, mock } = await publish(snapshot(), { current });
  assert.equal(result.unchanged, true);
  assert.equal(result.verified, true);
  assert.equal(mock.calls.length, 2);
});

test('Firebase null removal, empty product arrays and optional fields do not break verification', async () => {
  const input = snapshot();
  input.items['AS-26F-TEST'] = { productNos: [], netQty: null, netRevenue: null, canceledQty: null,
    returnedQty: null, rank: null, gauge: null, status: 'unmatched', reason: 'not mapped' };
  const { result } = await publish(input);
  assert.equal(result.verified, true);
  const empty = await publish(snapshot({ items: {} }));
  assert.equal(empty.result.verified, true);
});

test('drops unknown operational coverage metadata while preserving approved counts', async () => {
  const input = snapshot({ coverage: { complete: true, orderCount: 12, runtimePages: 5, phaseNotes: 'private runtime metadata' } });
  const { mock } = await publish(input);
  assert.deepEqual(mock.stored().coverage, { complete: true, orderCount: 12 });
});

for (const mutate of [
  (value) => { value.orders = [{ customer: 'private' }]; },
  (value) => { value.items['AS-26F-TEST'].customerEmail = 'private@example.invalid'; },
  (value) => { value.coverage.customers = []; },
  (value) => { value.coverage.complete = false; },
  (value) => { value.schemaVersion = 2; },
  (value) => { value.source = 'other'; },
  (value) => { value.status = 'partial'; },
  (value) => { value.items['../unsafe'] = value.items['AS-26F-TEST']; },
  (value) => { value.items['AS-26F-TEST'].netQty = '10'; },
  (value) => { value.items['AS-26F-TEST'].netRevenue = Infinity; },
  (value) => { value.items['AS-26F-TEST'].rank = 1.5; },
  (value) => { value.items['AS-26F-TEST'].gauge = 101; },
  (value) => { value.items['AS-26F-TEST'].reason = 'x'.repeat(1001); },
  (value) => { value.period.start = '2026-09-18'; },
  (value) => { value.period.end = '2026-10-03'; value.period.start = '2026-09-20'; },
  (value) => { value.period.end = '2026-02-30'; },
  (value) => { value.generatedAt = '2026-10-03T01:00:00Z'; },
  (value) => { value.items = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`AS-TEST-${index}`, value.items['AS-26F-TEST']])); },
]) {
  test(`rejects invalid or sensitive schema before any HTTP request: ${mutate.toString().slice(13, 85)}`, async () => {
    const input = snapshot();
    mutate(input);
    let calls = 0;
    await assert.rejects(publishSalesSnapshot(input, {
      env: env(), nowMs: NOW, fetchImpl: async () => { calls++; throw new Error('must not call'); },
    }), PublishError);
    assert.equal(calls, 0);
  });
}

for (const current of [
  snapshot({ generatedAt: '2026-10-02T23:00:00Z' }),
  snapshot({ generatedAt: '2026-10-02T22:00:00.000Z', items: {} }),
]) {
  test('does not overwrite a newer snapshot or different data at the same generation time', async () => {
    const mock = server({ current });
    await assert.rejects(publishSalesSnapshot(snapshot(), { env: env(), fetchImpl: mock.fetchImpl, nowMs: NOW }),
      (error) => error.code === 'STALE_SALES_SNAPSHOT');
    assert.equal(mock.calls.length, 2);
    assert.deepEqual(mock.stored(), current);
  });
}

test('does not replace a later reporting period even with a newer generatedAt', async () => {
  const olderPeriod = snapshot({ period: { start: '2026-09-18', end: '2026-10-01', timeZone: 'Asia/Seoul' },
    generatedAt: '2026-10-02T23:00:00Z' });
  const mock = server({ current: snapshot() });
  await assert.rejects(publishSalesSnapshot(olderPeriod, { env: env(), fetchImpl: mock.fetchImpl, nowMs: NOW,
    expectedPeriodEnd: '2026-10-01' }),
    (error) => error.code === 'STALE_SALES_SNAPSHOT');
  assert.equal(mock.calls.length, 2);
});

test('rejects an incoming fourteen-day result ending before the requested day before any HTTP request', async () => {
  const incoming = snapshot({ period: { start: '2026-09-18', end: '2026-10-01', timeZone: 'Asia/Seoul' } });
  const mock = server();
  await assert.rejects(publishSalesSnapshot(incoming, { env: env(), fetchImpl: mock.fetchImpl, nowMs: NOW,
    expectedPeriodEnd: '2026-10-02' }), (error) => error.code === 'UNEXPECTED_SALES_PERIOD');
  assert.equal(mock.calls.length, 0);
});

test('defaults an independently called publisher to yesterday in Korea', async () => {
  const incoming = snapshot({ period: { start: '2026-09-18', end: '2026-10-01', timeZone: 'Asia/Seoul' } });
  const mock = server();
  await assert.rejects(publishSalesSnapshot(incoming, { env: env(), fetchImpl: mock.fetchImpl, nowMs: NOW }),
    (error) => error.code === 'UNEXPECTED_SALES_PERIOD');
  assert.equal(mock.calls.length, 0);
});

test('an older existing reporting period remains valid and can be replaced by the requested current period', async () => {
  const current = snapshot({ period: { start: '2026-09-18', end: '2026-10-01', timeZone: 'Asia/Seoul' },
    generatedAt: '2026-10-02T21:00:00Z' });
  const { result, mock } = await publish(snapshot(), { current });
  assert.equal(result.published, true);
  assert.equal(mock.stored().period.end, '2026-10-02');
});

test('refuses a different machine identity before accessing Firebase', async () => {
  const mock = server({ identity: 'wrong-machine' });
  await assert.rejects(publishSalesSnapshot(snapshot(), { env: env(), fetchImpl: mock.fetchImpl, nowMs: NOW }),
    (error) => error.code === 'FIREBASE_IDENTITY_MISMATCH');
  assert.equal(mock.calls.length, 1);
});

test('requires an ETag before writing', async () => {
  const mock = server({ missingEtag: true });
  await assert.rejects(publishSalesSnapshot(snapshot(), { env: env(), fetchImpl: mock.fetchImpl, nowMs: NOW }),
    (error) => error.code === 'FIREBASE_ETAG_MISSING');
  assert.equal(mock.calls.length, 2);
});

test('ETag conflict preserves current data and is not retried', async () => {
  const current = snapshot({ generatedAt: '2026-10-02T21:00:00Z' });
  const mock = server({ current, conflict: true });
  await assert.rejects(publishSalesSnapshot(snapshot(), { env: env(), fetchImpl: mock.fetchImpl, nowMs: NOW }),
    (error) => error.code === 'FIREBASE_WRITE_CONFLICT');
  assert.equal(mock.calls.length, 3);
  assert.deepEqual(mock.stored(), current);
});

for (const faultAt of [1, 2, 3, 4]) {
  test(`blocks redirects at request ${faultAt} without contacting the destination`, async () => {
    const mock = server({ faultAt, faultStatus: 307 });
    await assert.rejects(publishSalesSnapshot(snapshot(), { env: env(), fetchImpl: mock.fetchImpl, nowMs: NOW }),
      (error) => error.code === 'FIREBASE_REDIRECT_BLOCKED');
    assert.equal(mock.calls.length, faultAt);
  });
  test(`HTTP failure at request ${faultAt} never retries or reveals the response`, async () => {
    const mock = server({ faultAt });
    await assert.rejects(publishSalesSnapshot(snapshot(), { env: env(), fetchImpl: mock.fetchImpl, nowMs: NOW }),
      (error) => error instanceof PublishError && !error.message.includes('never-log'));
    assert.equal(mock.calls.length, faultAt);
  });
  test(`uncertain network result at request ${faultAt} never retries or reveals details`, async () => {
    const mock = server({ networkAt: faultAt });
    await assert.rejects(publishSalesSnapshot(snapshot(), { env: env(), fetchImpl: mock.fetchImpl, nowMs: NOW }),
      (error) => error instanceof PublishError && !error.message.includes('sensitive-token'));
    assert.equal(mock.calls.length, faultAt);
  });
}

test('readback mismatch cannot become a published success and never triggers a blind rollback', async () => {
  const mock = server({ badReadback: true });
  await assert.rejects(publishSalesSnapshot(snapshot(), { env: env(), fetchImpl: mock.fetchImpl, nowMs: NOW }),
    (error) => error.code === 'FIREBASE_VERIFY_MISMATCH');
  assert.equal(mock.calls.length, 4);
});

test('rotated refresh credentials are masked and only a safe flag is returned', async () => {
  const { result, logs } = await publish(snapshot(), { rotated: true });
  assert.equal(result.credentialRotationObserved, true);
  assert.ok(logs.includes('::add-mask::test-rotated-refresh'));
  assert.ok(!JSON.stringify(result).includes('test-rotated-refresh'));
});

test('an exhausted budget fails before authentication', async () => {
  let calls = 0;
  await assert.rejects(publishSalesSnapshot(snapshot(), { env: env(), nowMs: NOW, budgetMs: 0,
    fetchImpl: async () => { calls++; throw new Error('must not call'); } }),
  (error) => error.code === 'FIREBASE_PUBLISH_TIMEOUT');
  assert.equal(calls, 0);
});
