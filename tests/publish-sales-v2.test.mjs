import assert from 'node:assert/strict';
import test from 'node:test';
import { publishSalesSnapshot, validateSalesSnapshot } from '../scripts/publish-sales.mjs';
import { v2Snapshot } from './sales-v2-fixture.mjs';

const NOW = Date.parse('2026-10-03T00:00:00Z');
const ENV = { AISEL_FIREBASE_API_KEY: 'fixture', AISEL_FIREBASE_REFRESH_TOKEN: 'fixture', AISEL_FIREBASE_MACHINE_UID: 'fixture' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ETag: '"fixture"' } });
function stored(value) {
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.length ? value.map(stored) : undefined;
  if (typeof value === 'object') {
    const pairs = Object.entries(value).map(([key, item]) => [key, stored(item)]).filter(([, item]) => item !== undefined);
    return pairs.length ? Object.fromEntries(pairs) : undefined;
  }
  return value;
}
function server(seed = {}, fault = () => undefined) {
  const data = structuredClone(seed), calls = [];
  return { data, calls, fetchImpl: async (url, options) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname, method: options.method });
    assert.equal(options.redirect, 'manual');
    const failure = fault(pathname, options, calls);
    if (failure) return failure;
    if (pathname === '/v1/token') return json({ id_token: 'fixture-id', token_type: 'Bearer', user_id: 'fixture' });
    assert.ok(['/salesPerformance/current.json', '/salesPerformance/daily/2026-10-02.json'].includes(pathname));
    if (options.method === 'PUT') {
      assert.equal(options.headers['If-Match'], '"fixture"');
      data[pathname] = stored(JSON.parse(options.body));
    }
    return json(data[pathname] ?? null);
  } };
}
const publish = (mock, input = v2Snapshot()) => publishSalesSnapshot(input, { env: ENV, nowMs: NOW, fetchImpl: mock.fetchImpl });

test('v2 retains a verified date snapshot before updating current and preserves older history', async () => {
  const mock = server({ '/salesPerformance/daily/2026-10-01.json': { retained: true } });
  const result = await publish(mock);
  assert.equal(result.verified, true);
  assert.deepEqual(mock.calls.map((call) => [call.pathname, call.method]), [
    ['/v1/token', 'POST'], ['/salesPerformance/current.json', 'GET'],
    ['/salesPerformance/daily/2026-10-02.json', 'GET'], ['/salesPerformance/daily/2026-10-02.json', 'PUT'],
    ['/salesPerformance/daily/2026-10-02.json', 'GET'], ['/salesPerformance/current.json', 'PUT'],
    ['/salesPerformance/current.json', 'GET'],
  ]);
  assert.deepEqual(mock.data['/salesPerformance/daily/2026-10-01.json'], { retained: true });
  assert.deepEqual(mock.data['/salesPerformance/current.json'], mock.data['/salesPerformance/daily/2026-10-02.json']);
  mock.calls.length = 0;
  assert.equal((await publish(mock)).unchanged, true);
  assert.equal(mock.calls.filter((call) => call.method === 'PUT').length, 0);
});

test('verified current with missing daily history repairs only the missing date', async () => {
  const mock = server({ '/salesPerformance/current.json': stored(validateSalesSnapshot(v2Snapshot(), { nowMs: NOW })) });
  assert.equal((await publish(mock)).unchanged, true);
  assert.deepEqual(mock.calls.filter((call) => call.method === 'PUT').map((call) => call.pathname), ['/salesPerformance/daily/2026-10-02.json']);
});

test('legacy current remains readable and can be upgraded without rewriting its old reporting period', async () => {
  const old = { schemaVersion: 1, generatedAt: '2026-10-02T19:00:00Z', source: 'cafe24', status: 'ready',
    period: { start: '2026-09-19', end: '2026-10-02', timeZone: 'Asia/Seoul' }, items: {}, coverage: { complete: true } };
  const mock = server({ '/salesPerformance/current.json': old });
  assert.equal((await publish(mock)).verified, true);
  assert.equal(mock.data['/salesPerformance/current.json'].schemaVersion, 2);
});

test('a history write conflict prevents current mutation and is never retried', async () => {
  const old = v2Snapshot({ generatedAt: '2026-10-02T19:00:00Z' });
  const mock = server({ '/salesPerformance/current.json': old }, (path, options) => path.includes('/daily/') && options.method === 'PUT' ? json({}, 412) : undefined);
  await assert.rejects(publish(mock), (error) => error.code === 'FIREBASE_WRITE_CONFLICT');
  assert.deepEqual(mock.data['/salesPerformance/current.json'], old);
  assert.equal(mock.calls.filter((call) => call.method === 'PUT').length, 1);
});

test('a failed history readback prevents current mutation and never rolls history back', async () => {
  let writes = 0;
  const mock = server({}, (path, options) => {
    if (options.method === 'PUT') writes++;
    return path.includes('/daily/') && options.method === 'GET' && writes ? json({}) : undefined;
  });
  await assert.rejects(publish(mock), (error) => error.code === 'FIREBASE_HISTORY_VERIFY_MISMATCH');
  assert.equal(mock.data['/salesPerformance/current.json'], undefined);
  assert.equal(writes, 1);
});

test('unknown old day remains null only in periods that include it; Firebase null removal roundtrips', async () => {
  const input = v2Snapshot(), item = input.items['AS-26F-TEST'];
  item.daily[0].netQty = null; item.recent28NetQty = null;
  const mock = server();
  await publish(mock, input);
  const read = validateSalesSnapshot(mock.data['/salesPerformance/current.json'], { nowMs: NOW, readback: true });
  assert.equal(read.items['AS-26F-TEST'].netQty, 9);
  assert.equal(read.items['AS-26F-TEST'].recent28NetQty, null);
});

for (const [name, mutate] of [
  ['comparison gap', (v) => { v.comparisonPeriod.end = '2026-09-24'; }],
  ['wrong trend', (v) => { v.trendPeriod.start = '2026-09-06'; }],
  ['missing daily day', (v) => { v.items['AS-26F-TEST'].daily.pop(); }],
  ['duplicate daily day', (v) => { v.items['AS-26F-TEST'].daily[1].date = '2026-09-05'; }],
  ['raw daily customer', (v) => { v.items['AS-26F-TEST'].daily[1].customer = 'private'; }],
  ['wrong current sum', (v) => { v.items['AS-26F-TEST'].netQty = 1; }],
  ['wrong prior sum', (v) => { v.items['AS-26F-TEST'].previousNetQty = 1; }],
  ['wrong trend sum', (v) => { v.items['AS-26F-TEST'].recent28NetQty = 1; }],
  ['wrong revenue sum', (v) => { v.items['AS-26F-TEST'].netRevenue = 1; }],
  ['unpropagated null', (v) => { v.items['AS-26F-TEST'].daily[27].netQty = null; }],
]) test(`rejects ${name} before authentication`, async () => {
  const input = v2Snapshot(); mutate(input); const mock = server();
  await assert.rejects(publish(mock, input));
  assert.equal(mock.calls.length, 0);
});
