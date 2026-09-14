'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const start = main.indexOf('async function fetchEarningsSnapshot');
const end = main.indexOf('\nfunction createWindow', start);
const fetchSource = main.slice(start, end);

function invokeWarmPath({ wait = false } = {}) {
  const stale = { ok: true, checkedAt: '2026-09-14T20:00:00.000Z', rows: [{ txsDaily: 12 }] };
  const fresh = { ok: true, checkedAt: '2026-09-14T20:01:00.000Z', rows: [{ txsDaily: 16 }], earningsAggregateCache: { status: 'fresh' } };
  const calls = { read: 0, refresh: 0, heavy: 0 };
  const cache = {
    sourceKey: 'source-key',
    read: () => { calls.read += 1; return { snapshot: stale, projectedAtMs: Date.now() - 1000 }; },
    write: () => { throw new Error('warm path must not write synchronously'); },
  };
  const scope = {
    normalizeSettings: (value) => value,
    normalizeFaction: (value) => value,
    getEarningsAggregateSqliteCache: () => cache,
    startEarningsAggregateRefresh: () => { calls.refresh += 1; return Promise.resolve(fresh); },
    decorateEarningsAggregateSnapshot: (snapshot, metadata) => ({ ...snapshot, earningsAggregateCache: metadata }),
    readSettings: async () => ({}),
    fetchProfileFleets: async () => { calls.heavy += 1; throw new Error('heavy projection started'); },
    earningsAggregateRefreshes: new Map(),
    Promise, Date, Math, String, Boolean, Array, Object, Error,
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
  assert.deepEqual(calls, { read: 1, refresh: 1, heavy: 0 });
});

test('renderer follow-up can await the coalesced aggregate refresh', async () => {
  const { result, calls } = await invokeWarmPath({ wait: true });
  assert.equal(result.rows[0].txsDaily, 16);
  assert.equal(result.earningsAggregateCache.status, 'fresh');
  assert.deepEqual(calls, { read: 1, refresh: 1, heavy: 0 });
});

test('production cache is profile/faction/scope keyed and refreshes partial results fail closed', () => {
  const aggregateRegion = main.slice(main.indexOf('const EARNINGS_AGGREGATE_PROJECTION_VERSION'), start);
  assert.match(aggregateRegion, /profile: getSelectedPlayerProfile\(settings\)/);
  assert.match(aggregateRegion, /faction: normalizeFaction\(settings\.faction\)/);
  assert.match(aggregateRegion, /scope: snapshotScope \|\| 'total'/);
  assert.match(aggregateRegion, /rawCargoCostError/);
  assert.match(renderer, /freshResult\.earningsAggregateCache\?\.status !== 'fresh'/);
});
