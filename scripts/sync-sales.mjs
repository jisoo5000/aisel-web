import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PUBLISH_CONTRACT, PublishError, publishSalesSnapshot } from './publish-sales.mjs';

// Exact private Sites job contract. The separate publisher owns Firebase writes.
export const CONTRACT = Object.freeze({
  allowedOrigin: 'https://cafe24-weekly-insights.spaceit-aisel.chatgpt.site',
  jobsPath: '/api/workorder-sales/jobs',
  secretHeader: 'Authorization',
  overallTimeoutMs: 35 * 60 * 1_000,
  requestTimeoutMs: 30_000,
  pollIntervalMs: 5_000,
  maximumPolls: 300,
  maximumRetryAfterSeconds: 300,
  maximumResponseBytes: 32_768,
  jobIdField: 'jobId',
  stateField: 'status',
  privateResultField: 'resultAvailable',
  pendingStates: Object.freeze(['queued', 'running']),
  completedStates: Object.freeze(['ready']),
  failedStates: Object.freeze(['blocked']),
  successFlagFields: Object.freeze(['success', 'ok']),
});

const ENV_FIELDS = Object.freeze([
  'AISEL_SALES_SYNC_URL',
  'AISEL_SITES_BYPASS_TOKEN',
  'AISEL_SALES_SYNC_SECRET',
  'AISEL_FIREBASE_API_KEY',
  'AISEL_FIREBASE_REFRESH_TOKEN',
  'AISEL_FIREBASE_MACHINE_UID',
]);

class SyncError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'SyncError';
    this.code = code;
    this.status = status;
  }
}

function maskWorkflowValue(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

export function maskSecrets(env, log) {
  for (const field of ENV_FIELDS) {
    if (typeof env[field] === 'string' && env[field].length > 0) {
      log(`::add-mask::${maskWorkflowValue(env[field])}`);
    }
  }
}

export function readConfiguration(env) {
  for (const field of ENV_FIELDS) {
    const value = env[field];
    if (typeof value !== 'string' || !value.trim()) throw new SyncError('MISSING_CONFIGURATION');
    if (value !== value.trim() || /[\r\n]/u.test(value)) throw new SyncError('INVALID_CONFIGURATION');
  }

  let url;
  try {
    url = new URL(env.AISEL_SALES_SYNC_URL);
  } catch {
    throw new SyncError('INVALID_ENDPOINT');
  }
  if (url.origin !== CONTRACT.allowedOrigin || url.username || url.password || url.hash || url.search
    || url.pathname !== CONTRACT.jobsPath) {
    throw new SyncError('ENDPOINT_NOT_ALLOWED');
  }
  return {
    url: url.href,
    bypassToken: env.AISEL_SITES_BYPASS_TOKEN,
    syncSecret: env.AISEL_SALES_SYNC_SECRET,
  };
}

async function readSummaryBody(response, maximumBytes) {
  if (!response.body) throw new SyncError('EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new SyncError('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SyncError('INVALID_JSON_RESPONSE');
  }
}

function readJob(payload, expectedJobId, minimumRevision = 0) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SyncError('INVALID_SUMMARY');
  }

  const confirmations = CONTRACT.successFlagFields
    .filter((field) => Object.hasOwn(payload, field))
    .map((field) => payload[field]);
  if (confirmations.some((value) => typeof value !== 'boolean')) throw new SyncError('INVALID_CONFIRMATION');
  if (confirmations.some((value) => value === false)) throw new SyncError('BACKEND_REPORTED_FAILURE');

  const jobId = payload[CONTRACT.jobIdField];
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(jobId)) {
    throw new SyncError('INVALID_JOB_ID');
  }
  if (expectedJobId !== undefined && jobId !== expectedJobId) throw new SyncError('JOB_ID_MISMATCH');
  if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) throw new SyncError('INVALID_JOB_REVISION');
  if (payload.revision < minimumRevision) throw new SyncError('JOB_REVISION_REGRESSED');
  let pollDelayMs = CONTRACT.pollIntervalMs;
  if (Object.hasOwn(payload, 'retryAfterSeconds')) {
    const seconds = payload.retryAfterSeconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)
      || seconds < 0 || seconds > CONTRACT.maximumRetryAfterSeconds) {
      throw new SyncError('INVALID_RETRY_AFTER');
    }
    pollDelayMs = Math.max(pollDelayMs, Math.ceil(seconds * 1_000));
  }
  const state = payload[CONTRACT.stateField];
  if (CONTRACT.failedStates.includes(state)) throw new SyncError('BACKEND_REPORTED_FAILURE');
  if (!CONTRACT.pendingStates.includes(state) && !CONTRACT.completedStates.includes(state)) {
    throw new SyncError('UNKNOWN_JOB_STATE');
  }
  return { jobId, state, revision: payload.revision, pollDelayMs, payload };
}

async function requestSummary(config, url, method, fetchImpl, timeoutMs, body,
  maximumBytes = CONTRACT.maximumResponseBytes) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'OAI-Sites-Authorization': `Bearer ${config.bypassToken}`,
        [CONTRACT.secretHeader]: `Bearer ${config.syncSecret}`,
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // Never print a raw exception: it can contain the endpoint, headers or response data.
    throw new SyncError('NETWORK_OR_TIMEOUT_FAILURE');
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw new SyncError('REDIRECT_BLOCKED', response.status);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new SyncError('HTTP_FAILURE', response.status);
  }

  try {
    return await readSummaryBody(response, maximumBytes);
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError('RESPONSE_READ_FAILURE');
  }
}

export async function synchronizeSales(config, {
  env = process.env,
  log = () => {},
  fetchImpl = globalThis.fetch,
  now = () => performance.now(),
  wallNow = () => Date.now(),
  sleep = (ms, signal) => delay(ms, undefined, { signal }),
} = {}) {
  const deadline = now() + CONTRACT.overallTimeoutMs;
  const remaining = () => {
    const ms = deadline - now();
    if (ms <= 0) throw new SyncError('OVERALL_TIMEOUT');
    return ms;
  };
  // Exactly one start request. An uncertain POST result must never trigger a retry.
  const runDate = new Date(wallNow() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  // Freeze the reporting date now; a run crossing Korean midnight keeps its period.
  const expectedPeriodEnd = new Date(Date.parse(`${runDate}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  const started = readJob(await requestSummary(config, config.url, 'POST', fetchImpl,
    Math.min(CONTRACT.requestTimeoutMs, remaining()), { runDate }));
  remaining();
  // Never use a URL from the response. Only a validated opaque job ID enters this URL.
  const pollUrl = new URL(`${CONTRACT.jobsPath}/${encodeURIComponent(started.jobId)}`, CONTRACT.allowedOrigin).href;
  const publishReadyJob = async (job) => {
    if (job.payload[CONTRACT.privateResultField] !== true || job.payload.coverage?.complete !== true) {
      throw new SyncError('PRIVATE_RESULT_INCOMPLETE');
    }
    // Sites published:false describes private storage; only our verified Firebase
    // write below may declare live publication. No response-supplied URL is used.
    const snapshot = await requestSummary(config, `${pollUrl}/result`, 'GET', fetchImpl,
      Math.min(CONTRACT.requestTimeoutMs, remaining()), undefined, PUBLISH_CONTRACT.maximumBytes);
    const result = await publishSalesSnapshot(snapshot, {
      env, fetchImpl, log, now, nowMs: wallNow(), budgetMs: remaining(), expectedPeriodEnd,
    });
    remaining();
    if (result.published !== true || result.verified !== true) throw new SyncError('PUBLICATION_NOT_VERIFIED');
    return { success: true, published: true, verified: true, unchanged: result.unchanged === true,
      credentialRotationObserved: result.credentialRotationObserved === true };
  };
  if (CONTRACT.completedStates.includes(started.state)) return publishReadyJob(started);
  let lastRevision = started.revision;
  let pollDelayMs = started.pollDelayMs;

  for (let poll = 0; poll < CONTRACT.maximumPolls; poll++) {
    const budget = remaining();
    if (budget <= pollDelayMs) throw new SyncError('OVERALL_TIMEOUT');
    try {
      await sleep(pollDelayMs, AbortSignal.timeout(Math.max(1, Math.floor(budget))));
    } catch {
      throw new SyncError('OVERALL_TIMEOUT');
    }
    const current = readJob(await requestSummary(config, pollUrl, 'GET', fetchImpl,
      Math.min(CONTRACT.requestTimeoutMs, remaining())), started.jobId, lastRevision);
    remaining();
    if (CONTRACT.completedStates.includes(current.state)) return publishReadyJob(current);
    // A successful advance processes the next bounded page/checkpoint. This is not a
    // retry: if any advance has an unclear result, requestSummary throws and we stop.
    const advanced = readJob(await requestSummary(config, `${pollUrl}/advance`, 'POST', fetchImpl,
      Math.min(CONTRACT.requestTimeoutMs, remaining()), { expectedRevision: current.revision }),
    started.jobId, current.revision);
    remaining();
    if (CONTRACT.completedStates.includes(advanced.state)) return publishReadyJob(advanced);
    lastRevision = advanced.revision;
    pollDelayMs = Math.max(current.pollDelayMs, advanced.pollDelayMs);
  }
  throw new SyncError('POLL_LIMIT_REACHED');
}

export async function main({ env = process.env, log = console.log, ...runtime } = {}) {
  // Mask all supplied values before validation, requests or diagnostic output.
  maskSecrets(env, log);
  try {
    const config = readConfiguration(env);
    const summary = await synchronizeSales(config, { ...runtime, env, log });
    log(`Sales sync: ${JSON.stringify(summary)}`);
    return 0;
  } catch (error) {
    const knownError = error instanceof SyncError || error instanceof PublishError;
    const code = knownError ? error.code : 'UNEXPECTED_FAILURE';
    const httpStatus = error instanceof SyncError ? error.status : error instanceof PublishError ? error.httpStatus : undefined;
    const status = Number.isInteger(httpStatus)
      ? ` (HTTP ${httpStatus})`
      : '';
    log(`Sales sync failed: ${code}${status}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
