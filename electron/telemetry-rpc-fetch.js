'use strict';

const { getTelemetryContext, normalizeMethod, runLogicalOperation, recordTelemetryCounter, getTelemetryRecorder } = require('./telemetry-context');

const MAX_BATCH_ELEMENTS = 1000;

function inspectRpcMethod(init) {
  try {
    const parsed = JSON.parse(String(init?.body || ''));
    if (Array.isArray(parsed)) return { method: 'batch', batchElements: Math.min(MAX_BATCH_ELEMENTS, parsed.length) };
    return { method: normalizeMethod(parsed?.method), batchElements: 0 };
  } catch (_) { return { method: 'unknown', batchElements: 0 }; }
}

function safeRecord(event) { try { getTelemetryRecorder()?.record(event); } catch (_) { /* inert */ } }

function createTelemetryFetch(fetchImpl, { providerRole = 'unknown', fallback = false, admit } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  return async function telemetryFetch(info, init) {
    const inspected = inspectRpcMethod(init);
    const active = getTelemetryContext();
    const invoke = async () => {
      const context = { ...getTelemetryContext(), providerRole, rpcMethod: inspected.method };
      if (typeof admit === 'function') {
        try { await admit({ method: inspected.method, provider: providerRole, fallback }); }
        catch (error) {
          recordTelemetryCounter(error?.name === 'MarketplaceRpcBudgetExhaustedError' ? 'budgetStops' : 'limiterStops', 1, context);
          throw error;
        }
      }
      const attempts = activeAttempts.get(context.logicalOperationId) || Object.create(null);
      const prior = Number(attempts[providerRole] || 0); attempts[providerRole] = prior + 1;
      if (context.logicalOperationId) {
        activeAttempts.set(context.logicalOperationId, attempts);
        if (activeAttempts.size > 4096) activeAttempts.delete(activeAttempts.keys().next().value);
      }
      const startedAt = Date.now();
      safeRecord({ type: 'wire-start', at: startedAt, retry: prior > 0, fallback: fallback === true, batchElements: inspected.batchElements, context });
      try {
        const result = await fetchImpl(info, init);
        safeRecord({
          type: 'wire-complete', at: Date.now(), durationMs: Date.now() - startedAt,
          outcome: result?.ok === false ? 'failure' : 'success', context,
        });
        return result;
      } catch (error) {
        safeRecord({ type: 'wire-complete', at: Date.now(), durationMs: Date.now() - startedAt, outcome: 'failure', context });
        throw error;
      }
    };
    if (active.logicalOperationId) return invoke();
    return runLogicalOperation({ rpcMethod: inspected.method }, invoke);
  };
}

const activeAttempts = new Map();

function wrapRpcConnection(connection) {
  if (!connection || typeof connection !== 'object') return connection;
  return new Proxy(connection, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const method = normalizeMethod(typeof prop === 'string' ? prop : 'unknown');
      if (method === 'unknown') return value.bind(target);
      return (...args) => {
        const active = getTelemetryContext();
        if (active.logicalOperationId) return value.apply(target, args);
        return runLogicalOperation({ rpcMethod: method }, () => value.apply(target, args));
      };
    },
  });
}

function rawAttemptHooks({ providerRole = 'unknown', fallback = false } = {}) {
  return {
    onAttemptStart({ attempt, init } = {}) {
      const inspected = inspectRpcMethod(init);
      const context = { ...getTelemetryContext(), providerRole, rpcMethod: inspected.method };
      const startedAt = Date.now();
      safeRecord({ type: 'wire-start', at: startedAt, retry: Number(attempt) > 0, fallback, batchElements: inspected.batchElements, context });
      return startedAt;
    },
    onAttemptFinish({ token, outcome } = {}) {
      safeRecord({ type: 'wire-complete', at: Date.now(), durationMs: Math.max(0, Date.now() - Number(token || Date.now())), outcome: outcome === 'success' ? 'success' : 'failure', context: { ...getTelemetryContext(), providerRole } });
    },
  };
}

module.exports = { MAX_BATCH_ELEMENTS, inspectRpcMethod, createTelemetryFetch, wrapRpcConnection, rawAttemptHooks };
