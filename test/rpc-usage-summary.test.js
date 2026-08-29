'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTelemetryLedger } = require('../electron/telemetry-ledger');
const {
  validateUtcDate,
  aggregateRpcUsageDay,
  readRpcUsageDay,
  createRpcUsageReader,
} = require('../electron/telemetry-day-summary');

async function temporary() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'msa-rpc-usage-'));
}

test('RPC Usage validates real UTC calendar dates', () => {
  assert.equal(validateUtcDate('2026-08-04'), '2026-08-04');
  for (const value of ['', '2026-8-4', '2026-02-30', '../2026-08-04', '2026-08-04T00:00:00Z']) {
    assert.throws(() => validateUtcDate(value), /invalid_utc_date/);
  }
});

test('wire attempts aggregate once while retry, fallback and batch counters remain subsets', () => {
  const counters = (overrides = {}) => ({ wireAttempts: 0, retries: 0, fallbackAttempts: 0, batchElements: 0, ...overrides });
  const day = { minutes: { '12:00': { rows: [
    { dimensions: { faction: 'MUD', feature: 'EA', suboperation: 'scanning', rpcMethod: 'getTransaction', providerRole: 'main' }, counters: counters({ wireAttempts: 1 }) },
    { dimensions: { faction: 'MUD', feature: 'EA', suboperation: 'scanning', rpcMethod: 'getTransaction', providerRole: 'fallback' }, counters: counters({ wireAttempts: 1, retries: 1, fallbackAttempts: 1 }) },
    { dimensions: { faction: 'global', feature: 'EA', suboperation: 'marketplace', rpcMethod: 'batch', providerRole: 'direct' }, counters: counters({ wireAttempts: 1, batchElements: 20 }) },
    { dimensions: { faction: 'unknown', rpcMethod: 'getAccountInfo', providerRole: 'unknown' }, counters: counters({ wireAttempts: 1 }) },
  ] } } };
  const result = aggregateRpcUsageDay(day);
  assert.deepEqual(result.totals, { requests: 4, retries: 1, fallbackAttempts: 1, batchElements: 20 });
  assert.equal(result.reconciliation.factionsMatch, true);
  assert.equal(result.reconciliation.providersMatch, true);
  assert.equal(result.reconciliation.menusMatch, true);
  assert.equal(result.menus.find((item) => item.key === 'EA').requests, 3);
  assert.equal(result.factions.find((item) => item.key === 'global').requests, 1);
  assert.equal(result.factions.find((item) => item.key === 'unknown').requests, 1);
});

test('legacy internal Earnings operations remain visible as unattributed and reconcile with tab All', () => {
  const counters = { wireAttempts: 2, retries: 0, fallbackAttempts: 0, batchElements: 0 };
  const result = aggregateRpcUsageDay({ minutes: { '12:00': { rows: [
    { dimensions: { faction: 'MUD', feature: 'Earnings', suboperation: 'fleet-discovery', rpcMethod: 'getAccountInfo', providerRole: 'main' }, counters },
  ] } } });
  assert.equal(result.rows[0].menu, 'EA');
  assert.equal(result.rows[0].tab, 'unattributed');
  assert.equal(result.menus.find((item) => item.key === 'EA').requests, 2);
});

test('UTC-day summaries split at midnight and reading them performs zero network calls', async (t) => {
  const userDataPath = await temporary();
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-08-03T23:59:30Z');
  const ledger = createTelemetryLedger({ userDataPath, profile: 'USTUR', now: () => now, flushIntervalMs: 0 });
  await ledger.start();
  ledger.record({ type: 'wire-start', at: now, context: { faction: 'MUD', rpcMethod: 'getTransaction', providerRole: 'main', url: 'https://secret.invalid', wallet: 'secret-wallet' } });
  now = Date.parse('2026-08-04T00:00:30Z');
  ledger.record({ type: 'wire-start', at: now, retry: true, fallback: true, context: { faction: 'GLOBAL', rpcMethod: 'getSignaturesForAddress', providerRole: 'fallback' } });

  let networkCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => { networkCalls += 1; throw new Error('network must not be called'); };
  t.after(() => { global.fetch = originalFetch; });
  const read = createRpcUsageReader({ ledger, userDataPath, now: () => now });
  const first = await read('2026-08-03');
  const second = await read('2026-08-04');
  assert.equal(networkCalls, 0);
  assert.equal(first.totalRequests, 1);
  assert.equal(second.totalRequests, 1);
  assert.equal(second.periodLabel, 'UTC day in progress');
  assert.equal(second.factions.find((item) => item.key === 'global').requests, 1);
  assert.equal(JSON.stringify(first).includes('secret.invalid'), false);
  assert.equal(JSON.stringify(first).includes('secret-wallet'), false);
});

test('missing and corrupt telemetry days are unavailable rather than zero', async (t) => {
  const userDataPath = await temporary();
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  const installationId = 'a'.repeat(32);
  const missing = await readRpcUsageDay({ userDataPath, installationId, utcDate: '2026-08-01' });
  assert.equal(missing.available, false);
  assert.equal(missing.reason, 'missing');
  assert.equal(missing.totalRequests, null);
  const activityRoot = path.join(userDataPath, 'telemetry', 'rpc-activity-v1');
  await fs.mkdir(activityRoot, { recursive: true });
  await fs.writeFile(path.join(activityRoot, '2026-08-02.json'), '{');
  const corrupt = await readRpcUsageDay({ userDataPath, installationId, utcDate: '2026-08-02' });
  assert.equal(corrupt.available, false);
  assert.equal(corrupt.reason, 'corrupt');
  assert.equal(corrupt.totalRequests, null);
});
