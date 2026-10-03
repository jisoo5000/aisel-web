import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTRACT, main } from '../scripts/sync-sales.mjs';
import { PUBLISH_CONTRACT } from '../scripts/publish-sales.mjs';

const WALL_NOW = Date.parse('2026-10-02T21:00:00.000Z'); // October 3, 06:00 KST.
const fakeEnv = () => ({
  AISEL_SALES_SYNC_URL: `${CONTRACT.allowedOrigin}${CONTRACT.jobsPath}`,
  AISEL_SITES_BYPASS_TOKEN: 'test-only-bypass', AISEL_SALES_SYNC_SECRET: 'test-only-sync-key',
  AISEL_FIREBASE_API_KEY: 'test-api-key', AISEL_FIREBASE_REFRESH_TOKEN: 'test-refresh-token',
  AISEL_FIREBASE_MACHINE_UID: 'test-machine-uid',
});
const job = (status = 'queued', extra = {}) => ({
  jobId: 'test-job_123', revision: 0, status, phase: 'test', retryAfterSeconds: 5,
  coverage: { complete: status === 'ready' }, resultAvailable: status === 'ready',
  errorCode: null, published: false, storageTarget: 'private_site', ...extra,
});
const snapshot = () => ({
  schemaVersion: 1, generatedAt: '2026-10-02T20:59:30.000Z',
  period: { start: '2026-09-19', end: '2026-10-02', timeZone: 'Asia/Seoul' },
  source: 'cafe24', status: 'ready', items: {
    'AS-26F-TEST': { productNos: [123], netQty: 9, netRevenue: 250_000, canceledQty: 1, returnedQty: 0,
      rank: 1, gauge: 88, status: 'good', reason: 'aggregate fixture' },
  }, coverage: { complete: true, orderCount: 10, runtimePages: 4 },
});
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});

async function run(fetchImpl, { env = fakeEnv(), ...runtime } = {}) {
  const logs = [];
  let milliseconds = 0;
  const code = await main({ env, fetchImpl, log: (line) => logs.push(line),
    now: () => milliseconds, wallNow: () => WALL_NOW,
    sleep: async (ms) => { milliseconds += ms; }, ...runtime,
  });
  return { code, logs, output: logs.filter((line) => !line.startsWith('::add-mask::')).join('\n') };
}

function integrationServer({ startReady = false, override } = {}) {
  const requests = [];
  let saved = null;
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    const endpoint = new URL(url);
    const headers = new Headers(options.headers);
    if (endpoint.origin === CONTRACT.allowedOrigin) {
      assert.equal(headers.get('OAI-Sites-Authorization'), `Bearer ${fakeEnv().AISEL_SITES_BYPASS_TOKEN}`);
      assert.equal(headers.get('Authorization'), `Bearer ${fakeEnv().AISEL_SALES_SYNC_SECRET}`);
      assert.ok(!JSON.stringify(options).includes(fakeEnv().AISEL_FIREBASE_REFRESH_TOKEN));
    } else {
      assert.equal(headers.get('OAI-Sites-Authorization'), null);
      assert.equal(headers.get('Authorization'), null);
      assert.ok(!JSON.stringify(options).includes(fakeEnv().AISEL_SALES_SYNC_SECRET));
      assert.ok(!JSON.stringify(options).includes(fakeEnv().AISEL_SITES_BYPASS_TOKEN));
    }
    const replacement = await override?.({ url, options, endpoint, requests });
    if (replacement !== undefined) return replacement;
    if (endpoint.origin === CONTRACT.allowedOrigin) {
      if (endpoint.pathname === CONTRACT.jobsPath) {
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), {});
        return json(job(startReady ? 'ready' : 'queued'), 202);
      }
      if (endpoint.pathname.endsWith('/advance')) {
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), { expectedRevision: 1 });
        return json(job('ready', { revision: 2 }));
      }
      if (endpoint.pathname.endsWith('/result')) {
        assert.equal(options.method, 'GET');
        assert.equal(options.body, undefined);
        return json(snapshot());
      }
      assert.equal(options.method, 'GET');
      return json(job('running', { revision: 1 }));
    }
    if (endpoint.origin === 'https://securetoken.googleapis.com') {
      assert.equal(options.method, 'POST');
      assert.equal(new URLSearchParams(options.body).get('refresh_token'), fakeEnv().AISEL_FIREBASE_REFRESH_TOKEN);
      return json({ id_token: 'test-id-token', refresh_token: fakeEnv().AISEL_FIREBASE_REFRESH_TOKEN,
        token_type: 'Bearer', user_id: fakeEnv().AISEL_FIREBASE_MACHINE_UID });
    }
    assert.equal(endpoint.origin, PUBLISH_CONTRACT.databaseOrigin);
    assert.equal(endpoint.pathname, PUBLISH_CONTRACT.snapshotPath);
    assert.equal(endpoint.searchParams.get('auth'), 'test-id-token');
    if (options.method === 'PUT') {
      assert.equal(headers.get('If-Match'), '"fixture-etag"');
      saved = JSON.parse(options.body);
      assert.equal(saved.coverage.runtimePages, undefined);
      return json(saved);
    }
    assert.equal(options.method, 'GET');
    return json(saved, 200, { ETag: '"fixture-etag"' });
  };
  return { requests, fetchImpl, saved: () => saved };
}

test('queued → running → ready → private result → conditional publish → readback logs booleans only', async () => {
  const server = integrationServer();
  const result = await run(server.fetchImpl);
  assert.equal(result.code, 0);
  assert.equal(server.requests.length, 8);
  assert.deepEqual(result.logs.slice(0, 6), Object.values(fakeEnv()).map((value) => `::add-mask::${value}`));
  assert.equal(result.output, 'Sales sync: {"success":true,"published":true,"verified":true,"unchanged":false,"credentialRotationObserved":false}');
  assert.ok(!result.output.includes('250000'));
  assert.ok(!result.output.includes('orderCount'));
  assert.ok(!result.output.includes('AS-26F'));
  assert.equal(server.saved().items['AS-26F-TEST'].netQty, 9);
});

test('idempotent start already ready fetches and publishes without advancing or polling', async () => {
  const server = integrationServer({ startReady: true });
  const result = await run(server.fetchImpl);
  assert.equal(result.code, 0);
  assert.equal(server.requests.length, 6);
  assert.ok(!server.requests.some(({ url }) => url.endsWith('/advance')));
});

test('start leaves the period server-controlled by sending an empty body at either end of the Korean day', async () => {
  const bodies = [];
  for (const timestamp of ['2026-10-02T15:00:00Z', '2026-10-03T14:59:59Z']) {
    await run(async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return json(job('blocked'));
    }, { wallNow: () => Date.parse(timestamp) });
  }
  assert.deepEqual(bodies, [{}, {}]);
});

test('rejects stale incoming period even if it is a complete fourteen-day private result', async () => {
  const server = integrationServer({ startReady: true, override: ({ endpoint }) => endpoint.pathname.endsWith('/result')
    ? json({ ...snapshot(), period: { start: '2026-09-18', end: '2026-10-01', timeZone: 'Asia/Seoul' } })
    : undefined });
  const result = await run(server.fetchImpl);
  assert.equal(result.code, 1);
  assert.equal(result.output, 'Sales sync failed: UNEXPECTED_SALES_PERIOD');
  assert.equal(server.requests.length, 2);
});

test('a run crossing Korean midnight preserves its initial requested period end', async () => {
  const server = integrationServer();
  const result = await run(server.fetchImpl, {
    wallNow: () => Date.parse(server.requests.length === 0 ? '2026-10-03T14:59:59Z' : '2026-10-03T15:00:01Z'),
  });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(server.requests[0].options.body), {});
  assert.equal(server.saved().period.end, '2026-10-02');
});

for (const endpoint of [
  'https://example.invalid/api/workorder-sales/jobs',
  'http://cafe24-weekly-insights.spaceit-aisel.chatgpt.site/api/workorder-sales/jobs',
  `${CONTRACT.allowedOrigin}.example.invalid/api/workorder-sales/jobs`,
  'https://user:password@cafe24-weekly-insights.spaceit-aisel.chatgpt.site/api/workorder-sales/jobs',
  `${CONTRACT.allowedOrigin}:444/api/workorder-sales/jobs`,
  `${CONTRACT.allowedOrigin}${CONTRACT.jobsPath}#fragment`,
  `${CONTRACT.allowedOrigin}${CONTRACT.jobsPath}?redirect=example.invalid`,
  `${CONTRACT.allowedOrigin}/different-endpoint`,
]) {
  test(`blocks invalid endpoint before any request: ${endpoint}`, async () => {
    let calls = 0;
    const result = await run(async () => { calls++; return json(job()); }, {
      env: { ...fakeEnv(), AISEL_SALES_SYNC_URL: endpoint },
    });
    assert.equal(calls, 0);
    assert.equal(result.code, 1);
    assert.equal(result.output, 'Sales sync failed: ENDPOINT_NOT_ALLOWED');
  });
}

for (const stage of [1, 2, 3, 4]) {
  for (const status of [302, 307, 308]) {
    test(`blocks redirect on Site request ${stage}, status ${status}`, async () => {
      const server = integrationServer({ override: ({ requests }) => requests.length === stage
        ? new Response(null, { status, headers: { Location: 'https://example.invalid/steal' } }) : undefined });
      const result = await run(server.fetchImpl);
      assert.equal(result.code, 1);
      assert.equal(server.requests.length, stage);
      assert.equal(result.output, `Sales sync failed: REDIRECT_BLOCKED (HTTP ${status})`);
    });
  }
  test(`uncertain Site request ${stage} is never retried and no payload is logged`, async () => {
    const server = integrationServer({ override: ({ requests }) => {
      if (requests.length === stage) throw new Error('private-token response-body');
    } });
    const result = await run(server.fetchImpl);
    assert.equal(result.code, 1);
    assert.equal(server.requests.length, stage);
    assert.equal(result.output, 'Sales sync failed: NETWORK_OR_TIMEOUT_FAILURE');
  });
  test(`HTTP 400 on Site request ${stage} reports only its safe stage and stops without retry`, async () => {
    const server = integrationServer({ override: ({ requests }) => requests.length === stage
      ? json({ error: 'private-body' }, 400) : undefined });
    const result = await run(server.fetchImpl);
    assert.equal(result.code, 1);
    assert.equal(server.requests.length, stage);
    assert.equal(result.output, `Sales sync failed: HTTP_FAILURE [stage: ${['start', 'status', 'advance', 'result'][stage - 1]}] (HTTP 400)`);
  });
}

test('ignores response-supplied poll and result URLs', async () => {
  const server = integrationServer({ override: ({ requests }) => requests.length === 1
    ? json(job('ready', { pollUrl: 'https://example.invalid/poll', resultUrl: 'https://example.invalid/result' })) : undefined });
  const result = await run(server.fetchImpl);
  assert.equal(result.code, 0);
  assert.ok(server.requests.every(({ url }) => !url.includes('example.invalid')));
  assert.equal(server.requests[1].url, `${fakeEnv().AISEL_SALES_SYNC_URL}/test-job_123/result`);
});

for (const jobId of [undefined, null, 123, '', '..', '../escape', '%2fescape', '//example.invalid',
  'https://example.invalid', 'id?x=y', 'id#fragment', 'id\r\ninjection', 'x'.repeat(129)]) {
  test(`rejects unsafe or missing job ID: ${JSON.stringify(jobId)}`, async () => {
    let calls = 0;
    const result = await run(async () => { calls++; return json(job('queued', { jobId })); });
    assert.equal(calls, 1);
    assert.equal(result.code, 1);
    assert.equal(result.output, 'Sales sync failed: INVALID_JOB_ID');
  });
}

for (const revision of [undefined, null, -1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects invalid revision: ${String(revision)}`, async () => {
    const result = await run(async () => json(job('queued', { revision })));
    assert.equal(result.code, 1);
    assert.equal(result.output, 'Sales sync failed: INVALID_JOB_REVISION');
  });
}

for (const requestNumber of [2, 3]) {
  test(`rejects job ID mismatch on status/advance response ${requestNumber}`, async () => {
    const server = integrationServer({ override: ({ requests }) => requests.length === requestNumber
      ? json(job('ready', { jobId: 'other-job', revision: 2 })) : undefined });
    const result = await run(server.fetchImpl);
    assert.equal(result.code, 1);
    assert.equal(server.requests.length, requestNumber);
    assert.equal(result.output, 'Sales sync failed: JOB_ID_MISMATCH');
  });
}

test('rejects a regressed revision before advancing', async () => {
  let requests = 0;
  const result = await run(async () => json(job('running', { revision: ++requests === 1 ? 3 : 2 })));
  assert.equal(requests, 2);
  assert.equal(result.code, 1);
  assert.equal(result.output, 'Sales sync failed: JOB_REVISION_REGRESSED');
});

for (const status of ['blocked', 'failed', 'completed', 'succeeded', 'unknown', undefined]) {
  test(`fails closed for blocked or unrecognized backend state: ${status}`, async () => {
    const result = await run(async () => json(job(status, { status })));
    assert.equal(result.code, 1);
    assert.match(result.output, /^Sales sync failed:/u);
  });
}

for (const errorCode of [
  'RATE_LIMITED', 'UPSTREAM_TEMPORARY', 'MAX_ATTEMPTS_REACHED', 'INCOMPLETE_COLLECTION',
  'COLLECTION_UNVERIFIED', 'CATALOG_LIMIT_REACHED', 'ORDER_LIMIT_REACHED', 'CLAIM_RECONCILIATION_REQUIRED',
  'EXCHANGE_LINEAGE_UNPROVEN', 'MAPPING_UNVERIFIED', 'INVALID_STEP_OUTCOME', 'JOB_EXPIRED',
  'GRANT_REVOKED', 'GRANT_ROTATED',
]) {
  test(`reports only the reviewed backend enum ${errorCode} for a blocked job`, async () => {
    let calls = 0;
    const result = await run(async () => {
      calls++;
      return json(job('blocked', { errorCode, errorText: 'private diagnostic', customer: 'private-order-data' }));
    });
    assert.equal(calls, 1);
    assert.equal(result.code, 1);
    assert.equal(result.output, `Sales sync failed: BACKEND_REPORTED_FAILURE [backend: ${errorCode}]`);
  });
}

test('unrecognized backend error codes and free-form diagnostic fields remain hidden', async () => {
  for (const errorCode of ['unknown-private-code', 'RATE_LIMITED: token=test-secret', 'TOKEN=test-secret\n::warning::private',
    { message: 'private-order-data' }, null]) {
    let calls = 0;
    const result = await run(async () => {
      calls++;
      return json(job('blocked', { errorCode, errorText: 'private detail', error: 'token and order data' }));
    });
    assert.equal(calls, 1);
    assert.equal(result.code, 1);
    assert.equal(result.output, 'Sales sync failed: BACKEND_REPORTED_FAILURE');
  }
});

for (const incomplete of [{ coverage: { complete: false } }, { coverage: {} }, { resultAvailable: false },
  { resultAvailable: 'true' }]) {
  test(`ready requires complete coverage and available result: ${JSON.stringify(incomplete)}`, async () => {
    let calls = 0;
    const result = await run(async () => { calls++; return json(job('ready', incomplete)); });
    assert.equal(calls, 1);
    assert.equal(result.code, 1);
    assert.equal(result.output, 'Sales sync failed: PRIVATE_RESULT_INCOMPLETE');
  });
}

test('private result validation failure never authenticates or writes to Firebase', async () => {
  const server = integrationServer({ startReady: true, override: ({ endpoint }) => endpoint.pathname.endsWith('/result')
    ? json({ ...snapshot(), orders: [{ customer: 'private' }] }) : undefined });
  const result = await run(server.fetchImpl);
  assert.equal(result.code, 1);
  assert.equal(server.requests.length, 2);
  assert.equal(result.output, 'Sales sync failed: INVALID_SALES_SCHEMA');
});

test('failed authenticated readback never logs a published success', async () => {
  const server = integrationServer({ override: ({ requests }) => requests.length === 8 ? json(null) : undefined });
  const result = await run(server.fetchImpl);
  assert.equal(result.code, 1);
  assert.equal(result.output, 'Sales sync failed: FIREBASE_VERIFY_MISMATCH');
});

test('publishes successfully after more than forty bounded checkpoints', async () => {
  let checkpoints = 0;
  const server = integrationServer({ override: ({ endpoint, options }) => {
    if (endpoint.origin !== CONTRACT.allowedOrigin || endpoint.pathname.endsWith('/result')) return undefined;
    if (endpoint.pathname === CONTRACT.jobsPath) return json(job('queued'));
    if (endpoint.pathname.endsWith('/advance')) {
      assert.deepEqual(JSON.parse(options.body), { expectedRevision: checkpoints });
      checkpoints++;
      return json(job(checkpoints === 81 ? 'ready' : 'running', { revision: checkpoints }));
    }
    return json(job('running', { revision: checkpoints }));
  } });
  const result = await run(server.fetchImpl);
  assert.equal(result.code, 0);
  assert.equal(checkpoints, 81);
  assert.ok(server.saved());
  assert.equal(server.requests.filter(({ url }) => url === fakeEnv().AISEL_SALES_SYNC_URL).length, 1);
});

for (const retryAfterSeconds of [0, 0.25, 1, 5, 300]) {
  test(`honors bounded retryAfterSeconds ${retryAfterSeconds} with a five-second minimum`, async () => {
    const waits = [];
    let milliseconds = 0;
    const server = integrationServer({ override: ({ requests, endpoint }) => {
      if (requests.length === 1) return json(job('queued', { retryAfterSeconds }));
      if (endpoint.origin === CONTRACT.allowedOrigin && !endpoint.pathname.endsWith('/result')) return json(job('ready'));
    } });
    const result = await run(server.fetchImpl, { now: () => milliseconds,
      sleep: async (ms) => { waits.push(ms); milliseconds += ms; } });
    assert.equal(result.code, 0);
    assert.deepEqual(waits, [Math.max(5_000, retryAfterSeconds * 1_000)]);
  });
}

for (const retryAfterSeconds of [-1, 301, null, '5', true, {}]) {
  test(`rejects invalid or excessive retryAfterSeconds: ${JSON.stringify(retryAfterSeconds)}`, async () => {
    let requests = 0;
    const result = await run(async () => { requests++; return json(job('queued', { retryAfterSeconds })); });
    assert.equal(result.code, 1);
    assert.equal(requests, 1);
    assert.equal(result.output, 'Sales sync failed: INVALID_RETRY_AFTER');
  });
}

test('uses the longer status or advance delay for the next cycle', async () => {
  const waits = [];
  let milliseconds = 0;
  let advanced = false;
  const server = integrationServer({ override: ({ endpoint }) => {
    if (endpoint.origin !== CONTRACT.allowedOrigin || endpoint.pathname === CONTRACT.jobsPath
      || endpoint.pathname.endsWith('/result')) return undefined;
    if (endpoint.pathname.endsWith('/advance')) {
      advanced = true;
      return json(job('running', { revision: 2, retryAfterSeconds: 300 }));
    }
    return json(job(advanced ? 'ready' : 'running', { revision: advanced ? 2 : 1, retryAfterSeconds: 10 }));
  } });
  const result = await run(server.fetchImpl, { now: () => milliseconds,
    sleep: async (ms) => { waits.push(ms); milliseconds += ms; } });
  assert.equal(result.code, 0);
  assert.deepEqual(waits, [5_000, 300_000]);
});

test('stops without sleeping or polling if the requested server delay does not fit the remaining budget', async () => {
  let milliseconds = 0;
  let requests = 0;
  const result = await run(async () => {
    requests++;
    milliseconds = CONTRACT.overallTimeoutMs - 299_999;
    return json(job('queued', { retryAfterSeconds: 300 }));
  }, { now: () => milliseconds, sleep: async () => assert.fail('must not sleep beyond budget') });
  assert.equal(result.code, 1);
  assert.equal(requests, 1);
  assert.equal(result.output, 'Sales sync failed: OVERALL_TIMEOUT');
});

test('stops after 300 polls without starting another job', async () => {
  const requests = [];
  const result = await run(async (url, options) => {
    requests.push({ url, method: options.method });
    return json(job('running', { revision: requests.length }));
  }, { now: () => 0, sleep: async () => {} });
  assert.equal(result.code, 1);
  assert.equal(result.output, 'Sales sync failed: POLL_LIMIT_REACHED');
  assert.equal(requests.filter(({ url }) => url === fakeEnv().AISEL_SALES_SYNC_URL).length, 1);
  assert.equal(requests.filter(({ method }) => method === 'GET').length, 300);
  assert.equal(requests.filter(({ url }) => url.endsWith('/advance')).length, 300);
});

test('enforces thirty-five-minute deadline even if a late response claims ready', async () => {
  let milliseconds = 0;
  let calls = 0;
  const result = await run(async () => {
    if (++calls === 1) return json(job());
    milliseconds = CONTRACT.overallTimeoutMs + 1;
    return json(job('ready'));
  }, { now: () => milliseconds, sleep: async (ms) => { milliseconds += ms; } });
  assert.equal(calls, 2);
  assert.equal(result.code, 1);
  assert.equal(result.output, 'Sales sync failed: OVERALL_TIMEOUT');
});

test('publisher shares the same overall deadline and does not claim late success', async () => {
  let milliseconds = 0;
  const server = integrationServer({ override: ({ requests }) => {
    if (requests.length === 8) milliseconds = CONTRACT.overallTimeoutMs + 1;
  } });
  const result = await run(server.fetchImpl, { now: () => milliseconds, sleep: async (ms) => { milliseconds += ms; } });
  assert.equal(result.code, 1);
  assert.equal(result.output, 'Sales sync failed: FIREBASE_PUBLISH_TIMEOUT');
});

test('fails on malformed JSON without printing response data', async () => {
  const result = await run(async () => new Response('<html>private sign-in page</html>'));
  assert.equal(result.code, 1);
  assert.equal(result.output, 'Sales sync failed: INVALID_JSON_RESPONSE');
});

test('bounds job response size', async () => {
  const result = await run(async () => json({ privateData: 'x'.repeat(CONTRACT.maximumResponseBytes) }));
  assert.equal(result.code, 1);
  assert.equal(result.output, 'Sales sync failed: RESPONSE_TOO_LARGE');
});

test('missing publisher credentials fail before starting a backend job', async () => {
  const env = fakeEnv();
  delete env.AISEL_FIREBASE_REFRESH_TOKEN;
  let calls = 0;
  const result = await run(async () => { calls++; return json(job()); }, { env });
  assert.equal(calls, 0);
  assert.equal(result.code, 1);
  assert.equal(result.output, 'Sales sync failed: MISSING_CONFIGURATION');
});

test('escapes masks and rejects multiline credentials before any request', async () => {
  const result = await run(async () => assert.fail('must not request'), {
    env: { ...fakeEnv(), AISEL_SALES_SYNC_SECRET: 'test%value\r\n::warning::injection' },
  });
  assert.equal(result.logs[2], '::add-mask::test%25value%0D%0A::warning::injection');
  assert.equal(result.code, 1);
  assert.equal(result.output, 'Sales sync failed: INVALID_CONFIGURATION');
});
