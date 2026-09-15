'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const { earningsAggregateReadScopes } = require('../electron/earnings-aggregate-sqlite-cache');
const start = main.indexOf('async function fetchEarningsSnapshot');
const end = main.indexOf('\nfunction createWindow', start);
const fetchSource = main.slice(start, end);

function invokeWarmPath({ wait = false, completeFirst = false } = {}) {
  const stale = { ok: true, checkedAt: '2026-09-14T20:00:00.000Z', rows: [{ txsDaily: 12 }] };
  const fresh = { ok: true, checkedAt: '2026-09-14T20:01:00.000Z', rows: [{ txsDaily: 16 }], earningsAggregateCache: { status: 'fresh' } };
  const calls = { read: 0, completeRead: 0, primaryRead: 0, refresh: 0, refreshKey: '', heavy: 0 };
  const cache = {
    sourceKey: 'source-key',
    read: () => {
      calls.read += 1;
      calls.primaryRead += 1;
      return completeFirst ? null : { snapshot: stale, projectedAtMs: Date.now() - 1000 };
    },
    write: () => { throw new Error('warm path must not write synchronously'); },
  };
  const completeCache = {
    sourceKey: 'ledger-complete-key',
    read: () => {
      calls.read += 1;
      calls.completeRead += 1;
      return { snapshot: stale, projectedAtMs: Date.now() - 1000 };
    },
    write: () => { throw new Error('warm path must not write synchronously'); },
  };
  const scope = {
    normalizeSettings: (value) => value,
    normalizeFaction: (value) => value,
    earningsAggregateReadScopes,
    getEarningsAggregateSqliteCache: (_settings, requestedScope) => (
      completeFirst && requestedScope === 'ledger-complete' ? completeCache : cache
    ),
    startEarningsAggregateRefresh: (sourceKey) => {
      calls.refresh += 1;
      calls.refreshKey = sourceKey;
      return Promise.resolve(fresh);
    },
    decorateEarningsAggregateSnapshot: (snapshot, metadata) => ({ ...snapshot, earningsAggregateCache: metadata }),
    readSettings: async () => ({}),
    fetchProfileFleets: async () => { calls.heavy += 1; throw new Error('heavy projection started'); },
    earningsAggregateRefreshes: new Map(),
    Promise, Date, Math, String, Boolean, Array, Object, Error, Set,
  };
  const globals = new Proxy(scope, {
    has: (_target, key) => !['scope', 'payload', 'diagnosticContext', 'fn'].includes(String(key)),
    get(target, key) {
      if (key === Symbol.unscopables) return undefined;
      if (key in target) return target[key];
      return () => null;
    },
  });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const invoke = new AsyncFunction('scope', 'payload', `with (scope) { const fn = ${fetchSource}; return fn(payload, null); }`);
  return invoke(globals, { faction: 'MUD', earningsSubtab: 'crafting', waitForEarningsAggregateRefresh: wait })
    .then((result) => ({ result, calls }));
}

test('warm Earnings request returns the persisted daily aggregate before heavy projection', async () => {
  const { result, calls } = await invokeWarmPath();
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].txsDaily, 12);
  assert.equal(result.earningsAggregateCache.status, 'stale');
  assert.equal(result.earningsAggregateCache.refreshPending, true);
  assert.equal(result.earningsAggregateCache.source, 'sqlite');
  assert.equal(result.earningsAggregateCache.scope, 'ledger-complete');
  assert.equal(result.earningsAggregateCache.persisted, true);
  assert.equal(Number.isFinite(result.earningsAggregateCache.readDurationMs), true);
  assert.equal(calls.read, 1);
  assert.equal(calls.refresh, 1);
  assert.equal(calls.heavy, 0);
});

test('renderer follow-up can await the coalesced aggregate refresh', async () => {
  const { result, calls } = await invokeWarmPath({ wait: true });
  assert.equal(result.rows[0].txsDaily, 16);
  assert.equal(result.earningsAggregateCache.status, 'fresh');
  assert.equal(calls.read, 1);
  assert.equal(calls.refresh, 1);
  assert.equal(calls.heavy, 0);
});

test('lighter Earnings requests prefer the complete snapshot without reading their partial cache', async () => {
  const { result, calls } = await invokeWarmPath({ completeFirst: true });
  assert.equal(result.rows[0].txsDaily, 12);
  assert.equal(calls.completeRead, 1);
  assert.equal(calls.primaryRead, 0);
  assert.equal(calls.refreshKey, 'ledger-complete-key');
  assert.equal(calls.heavy, 0);
});

test('production cache is profile/faction/scope keyed and refreshes partial results fail closed', () => {
  const aggregateRegion = main.slice(main.indexOf('const EARNINGS_AGGREGATE_PROJECTION_VERSION'), start);
  assert.match(aggregateRegion, /profile: getSelectedPlayerProfile\(settings\)/);
  assert.match(aggregateRegion, /faction: normalizeFaction\(settings\.faction\)/);
  assert.match(aggregateRegion, /scope: normalizeEarningsAggregateScope\(snapshotScope\)/);
  assert.match(aggregateRegion, /rawCargoCostError/);
  assert.match(renderer, /freshResult\.earningsAggregateCache\?\.status !== 'fresh'/);
  assert.match(main, /projectionDurationMs/);
  assert.match(main, /writeDurationMs/);
  assert.match(renderer, /formatEarningsAggregateCacheStatus/);
});

test('Upgrading and Inventory Ledger display shared aggregate cache timing', () => {
  const sourceStart = renderer.indexOf('function formatEarningsAggregateCacheStatus');
  const sourceEnd = renderer.indexOf('function renderEarningsBreakevenEmpty', sourceStart);
  assert.ok(sourceStart >= 0 && sourceEnd > sourceStart);
  const vm = require('node:vm');
  const context = { formatWholeNumber: (value) => String(value) };
  vm.runInNewContext(`${renderer.slice(sourceStart, sourceEnd)}\nthis.formatStatus = formatEarningsAggregateCacheStatus;`, context);
  assert.equal(context.formatStatus({ earningsAggregateCache: {
    source: 'sqlite', scope: 'ledger-complete', readDurationMs: 18.7, ageMs: 125_000, refreshPending: true,
  } }), ' · SQLite ledger-complete 19 ms · age 2 min · refreshing');
  assert.equal(context.formatStatus({ earningsAggregateCache: {
    source: 'projection', projectionDurationMs: 181_234, writeDurationMs: 92.2, persisted: true,
  } }), ' · rebuilt 181234 ms · saved 92 ms');
});
