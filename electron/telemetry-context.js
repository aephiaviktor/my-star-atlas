'use strict';

const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

const FEATURES = new Set(['MF', 'PC', 'EA', 'OP', 'Marketplace LM', 'Marketplace GM', 'Fleet discovery', 'Rental data', 'Earnings', 'Mining counts', 'Other']);
const TRIGGERS = new Set(['startup', 'background', 'navigation', 'manual', 'settings', 'unknown']);
const PROVIDERS = new Set(['main', 'fallback', 'direct', 'unknown']);
const FACTIONS = new Set(['MUD', 'ONI', 'USTUR', 'global', 'unknown']);
const METHODS = new Set([
  'getAccountInfo', 'getMultipleAccountsInfo', 'getProgramAccounts', 'getProgramAccountsV2',
  'getSignaturesForAddress', 'getParsedTransaction', 'batch', 'unknown',
]);
const SUBOPERATIONS = new Set(['none', 'fleets', 'rental', 'scanning', 'mining', 'marketplace', 'cargo', 'crafting', 'upgrading', 'breakeven', 'production', 'consumption', 'total', 'pct-charts', 'inventory', 'data', 'analytics', 'fleet-discovery', 'rental-data', 'marketplace-scan', 'marketplace-open-orders', 'unknown']);
const MENU_FEATURES = new Set(['MF', 'PC', 'EA', 'OP']);
const storage = new AsyncLocalStorage();
let recorder = null;

function choose(value, allowed, fallback) { return allowed.has(value) ? value : fallback; }
function normalizeFaction(value) {
  const faction = String(value || '').trim();
  const upper = faction.toUpperCase();
  if (upper === 'MUD' || upper === 'ONI' || upper === 'USTUR') return upper;
  if (upper === 'GLOBAL' || upper === 'SHARED' || upper === 'SHARED/GLOBAL') return 'global';
  return 'unknown';
}
function normalizeMethod(value) {
  const method = String(value || '').trim();
  return METHODS.has(method) || /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(method) ? method : 'unknown';
}
function normalizeContext(value = {}) {
  return Object.freeze({
    profile: /^[A-Za-z0-9_-]{1,32}$/.test(String(value.profile || '')) ? String(value.profile) : 'unknown',
    faction: normalizeFaction(value.faction),
    feature: choose(value.feature, FEATURES, 'Other'),
    suboperation: choose(value.suboperation, SUBOPERATIONS, 'none'),
    trigger: choose(value.trigger, TRIGGERS, 'unknown'),
    logicalOperationId: /^[a-f0-9]{32}$/.test(String(value.logicalOperationId || '')) ? value.logicalOperationId : null,
    parentOperationId: /^[a-f0-9]{32}$/.test(String(value.parentOperationId || '')) ? value.parentOperationId : null,
    providerRole: choose(value.providerRole, PROVIDERS, 'unknown'),
    rpcMethod: normalizeMethod(value.rpcMethod),
  });
}

function setTelemetryRecorder(value) { recorder = value && typeof value.record === 'function' ? value : null; }
function getTelemetryRecorder() { return recorder; }
function getTelemetryContext() { return storage.getStore() || normalizeContext(); }
function safeRecord(event) { try { recorder?.record(event); } catch (_) { /* telemetry is inert */ } }
function safeFlush() { try { return Promise.resolve(recorder?.flush?.()).catch(() => {}); } catch (_) { return Promise.resolve(); } }

function runWithTelemetryContext(overrides, callback) {
  if (typeof callback !== 'function') throw new TypeError('Telemetry callback is required.');
  const current = getTelemetryContext();
  const next = { ...overrides };
  if (MENU_FEATURES.has(current.feature)
      && !Object.prototype.hasOwnProperty.call(next, 'feature')
      && Object.prototype.hasOwnProperty.call(next, 'suboperation')) {
    delete next.suboperation;
  }
  return storage.run(normalizeContext({ ...current, ...next }), callback);
}

function runFeature(context, callback) {
  return runWithTelemetryContext({ ...context, logicalOperationId: null, parentOperationId: null, providerRole: 'unknown', rpcMethod: 'unknown' }, async () => {
    try { return await callback(); }
    finally { void safeFlush(); }
  });
}

async function runLogicalOperation({ rpcMethod, parentOperationId } = {}, callback) {
  if (typeof callback !== 'function') throw new TypeError('Logical RPC callback is required.');
  const current = getTelemetryContext();
  const logicalOperationId = crypto.randomBytes(16).toString('hex');
  const method = normalizeMethod(rpcMethod);
  const startedAt = Date.now();
  safeRecord({ type: 'logical-start', at: startedAt, context: normalizeContext({
    ...current, rpcMethod: method, logicalOperationId,
    parentOperationId: parentOperationId || current.logicalOperationId || current.parentOperationId,
  }) });
  return storage.run(normalizeContext({
    ...current, rpcMethod: method, logicalOperationId,
    parentOperationId: parentOperationId || current.logicalOperationId || current.parentOperationId,
  }), async () => {
    try {
      const result = await callback();
      safeRecord({ type: 'logical-complete', at: Date.now(), durationMs: Date.now() - startedAt, outcome: 'success', context: getTelemetryContext() });
      return result;
    } catch (error) {
      safeRecord({ type: 'logical-complete', at: Date.now(), durationMs: Date.now() - startedAt, outcome: 'failure', context: getTelemetryContext() });
      throw error;
    }
  });
}

function recordTelemetryCounter(counter, amount = 1, overrides = {}) {
  safeRecord({ type: 'counter', at: Date.now(), counter, amount, context: normalizeContext({ ...getTelemetryContext(), ...overrides }) });
}

module.exports = {
  FEATURES, TRIGGERS, PROVIDERS, METHODS, SUBOPERATIONS,
  normalizeContext, normalizeFaction, normalizeMethod, setTelemetryRecorder, getTelemetryRecorder,
  getTelemetryContext, runWithTelemetryContext, runFeature, runLogicalOperation,
  recordTelemetryCounter, safeFlush,
};
