'use strict';

const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

const DEFAULT_SAMPLE_LIMIT = 50;
const MAX_SAMPLE_LIMIT = 100;
const COUNTER_KEYS = Object.freeze([
  'logicalOperations', 'rpcAttempts', 'retries', 'fallbackCalls', 'cacheHits', 'cacheMisses',
]);

function createCounters() {
  return Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0]));
}

function normalizeOperation(value) {
  return value === 'LM' || value === 'GM' ? value : 'UNKNOWN';
}

function normalizeMethod(value) {
  const method = String(value || 'unknown');
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(method) ? method : 'unknown';
}

function normalizeProvider(value) {
  return value === 'main' || value === 'fallback' ? value : 'unknown';
}

function normalizeRunId(value) {
  const runId = String(value || '');
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(runId)
    ? runId
    : `marketplace-${crypto.randomUUID()}`;
}

function cloneCounters(value) {
  return Object.fromEntries(COUNTER_KEYS.map((key) => [key, Number(value?.[key] || 0)]));
}

function createMarketplaceRpcTelemetry({ runId, maxSamples = DEFAULT_SAMPLE_LIMIT, now = Date.now } = {}) {
  const startedMs = Number(now());
  const resolvedRunId = normalizeRunId(runId);
  const sampleLimit = Math.min(MAX_SAMPLE_LIMIT, Math.max(0, Math.floor(Number(maxSamples) || 0)));
  const totals = createCounters();
  const operations = Object.create(null);
  const samples = [];
  let samplesDropped = 0;
  let completedMs = null;

  function getMethodCounters(operation, method) {
    operations[operation] ||= { ...createCounters(), methods: Object.create(null) };
    operations[operation].methods[method] ||= createCounters();
    return operations[operation].methods[method];
  }

  function increment(operation, method, keys) {
    const methodCounters = getMethodCounters(operation, method);
    for (const key of keys) {
      totals[key] += 1;
      operations[operation][key] += 1;
      methodCounters[key] += 1;
    }
  }

  function sample(value) {
    if (samples.length < sampleLimit) samples.push(value);
    else samplesDropped += 1;
  }

  function recordLogical({ operation, method } = {}) {
    if (completedMs != null) return;
    const safeOperation = normalizeOperation(operation);
    const safeMethod = normalizeMethod(method);
    increment(safeOperation, safeMethod, ['logicalOperations']);
    sample({ type: 'logical', operation: safeOperation, method: safeMethod });
  }

  function recordAttempt({ operation, method, provider, retry = false, fallback = false } = {}) {
    if (completedMs != null) return;
    const safeOperation = normalizeOperation(operation);
    const safeMethod = normalizeMethod(method);
    const keys = ['rpcAttempts'];
    if (retry === true) keys.push('retries');
    if (fallback === true) keys.push('fallbackCalls');
    increment(safeOperation, safeMethod, keys);
    sample({
      type: 'attempt', operation: safeOperation, method: safeMethod,
      provider: normalizeProvider(provider), retry: retry === true, fallback: fallback === true,
    });
  }

  function recordCache({ operation, method, hit } = {}) {
    if (completedMs != null) return;
    const safeOperation = normalizeOperation(operation);
    const safeMethod = normalizeMethod(method);
    increment(safeOperation, safeMethod, [hit === true ? 'cacheHits' : 'cacheMisses']);
    sample({ type: 'cache', operation: safeOperation, method: safeMethod, hit: hit === true });
  }

  function buildSnapshot() {
    const endMs = completedMs ?? Number(now());
    return {
      runId: resolvedRunId,
      coverage: 'marketplace_only',
      startedAt: new Date(startedMs).toISOString(),
      completedAt: completedMs == null ? null : new Date(completedMs).toISOString(),
      durationMs: Math.max(0, endMs - startedMs),
      totals: cloneCounters(totals),
      operations: Object.fromEntries(Object.entries(operations).map(([operation, value]) => [operation, {
        ...cloneCounters(value),
        methods: Object.fromEntries(Object.entries(value.methods).map(([method, counters]) => [method, cloneCounters(counters)])),
      }])),
      samples: samples.map((entry) => ({ ...entry })),
      sampleLimit,
      samplesDropped,
    };
  }

  return {
    recordLogical,
    recordAttempt,
    recordCache,
    snapshot: buildSnapshot,
    finish() {
      if (completedMs == null) completedMs = Number(now());
      return buildSnapshot();
    },
  };
}

function createMarketplaceRpcInstrumentation(telemetry) {
  if (!telemetry || typeof telemetry.recordLogical !== 'function' || typeof telemetry.recordAttempt !== 'function') {
    throw new TypeError('Marketplace RPC telemetry collector is required.');
  }
  const callContext = new AsyncLocalStorage();

  function runLogical({ operation, method } = {}, callback) {
    if (typeof callback !== 'function') throw new TypeError('Marketplace RPC callback is required.');
    const safeOperation = normalizeOperation(operation);
    telemetry.recordLogical({ operation: safeOperation, method });
    return callContext.run({ operation: safeOperation, attempts: Object.create(null) }, callback);
  }

  function recordAttempt({ method, provider, fallback = false } = {}) {
    const active = callContext.getStore();
    const safeProvider = normalizeProvider(provider);
    const priorAttempts = Number(active?.attempts?.[safeProvider] || 0);
    if (active) active.attempts[safeProvider] = priorAttempts + 1;
    telemetry.recordAttempt({
      operation: active?.operation || 'UNKNOWN',
      method,
      provider: safeProvider,
      retry: priorAttempts > 0,
      fallback: fallback === true,
    });
  }

  return { runLogical, recordAttempt };
}

function wrapMarketplaceConnection(connection, { instrumentation, operation } = {}) {
  if (!connection || typeof connection !== 'object') throw new TypeError('Marketplace Connection is required.');
  if (!instrumentation || typeof instrumentation.runLogical !== 'function') {
    throw new TypeError('Marketplace RPC instrumentation is required.');
  }
  return new Proxy(connection, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const method = typeof prop === 'string' ? prop : 'unknown';
      return (...args) => instrumentation.runLogical(
        { operation, method },
        () => value.apply(target, args),
      );
    },
  });
}

module.exports = {
  createMarketplaceRpcTelemetry,
  createMarketplaceRpcInstrumentation,
  wrapMarketplaceConnection,
  DEFAULT_SAMPLE_LIMIT,
  MAX_SAMPLE_LIMIT,
};
