'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BREAKEVEN_CACHE_FRESHNESS_MS, createEarningsCacheState } = require('../electron/earnings-cache-state');

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('freshness constant and exact boundary use successful completion time', async () => {
  assert.equal(BREAKEVEN_CACHE_FRESHNESS_MS, 900000);
  let now = 1000;
  const cache = createEarningsCacheState({ now: () => now });
  const pending = deferred();
  const request = cache.ensureData('k', () => pending.promise);
  now = 5000; pending.resolve({ rows: [1] }); await request;
  let entry = cache.inspect('k');
  assert.equal(entry.fetchedAt, 5000); assert.equal(entry.staleAt, 905000); assert.equal(entry.status, 'ready');
  now = 904999; assert.equal(cache.inspect('k').status, 'ready');
  now = 905000; assert.equal(cache.inspect('k').status, 'stale');
});

test('single flight, fresh hits, forced refresh, and successful stale revalidation', async () => {
  let now = 0, calls = 0;
  const cache = createEarningsCacheState({ now: () => now });
  const first = deferred(); const loader = () => { calls++; return first.promise; };
  const a = cache.ensureData('k', loader); const b = cache.ensureData('k', loader);
  assert.strictEqual(a, b); await Promise.resolve(); assert.equal(calls, 1); assert.equal(cache.inspect('k').status, 'loading');
  first.resolve({ version: 1 }); await a;
  assert.deepEqual(await cache.ensureData('k', () => { calls++; return {}; }), cache.inspect('k'));
  assert.equal(calls, 1);
  const forced = deferred(); const c = cache.ensureData('k', () => { calls++; return forced.promise; }, { force: true });
  const d = cache.ensureData('k', () => { calls++; return Promise.resolve({}); }, { force: true });
  assert.strictEqual(c, d); await Promise.resolve(); assert.equal(calls, 2); assert.equal(cache.inspect('k').status, 'stale');
  now = 10; forced.resolve({ version: 2 }); await c;
  assert.equal(cache.inspect('k').status, 'ready'); assert.deepEqual(cache.inspect('k').value, { version: 2 });
});

test('stale data displays immediately and failed refresh preserves last good timestamps', async () => {
  let now = 0;
  const cache = createEarningsCacheState({ now: () => now });
  await cache.ensureData('k', () => Promise.resolve({ good: true }));
  const before = cache.inspect('k'); now = BREAKEVEN_CACHE_FRESHNESS_MS;
  assert.equal(cache.inspect('k').status, 'stale'); assert.deepEqual(cache.inspect('k').value, { good: true });
  const pending = deferred(); const request = cache.ensureData('k', () => pending.promise);
  assert.deepEqual(cache.inspect('k').lastGoodValue, { good: true });
  pending.reject(new Error('refresh failed')); await request;
  const after = cache.inspect('k');
  assert.equal(after.status, 'stale'); assert.deepEqual(after.value, { good: true }); assert.equal(after.error.message, 'refresh failed');
  assert.equal(after.fetchedAt, before.fetchedAt); assert.equal(after.staleAt, before.staleAt);
});

test('failed initial load enters error without data or freshness', async () => {
  const cache = createEarningsCacheState({ now: () => 7 });
  const result = await cache.ensureData('k', () => Promise.reject(new Error('nope')));
  assert.equal(result.status, 'error'); assert.equal(result.value, null); assert.equal(result.lastGoodValue, null);
  assert.equal(result.fetchedAt, null); assert.equal(result.staleAt, null); assert.equal(result.error.message, 'nope');
});

test('different keys isolate data and superseded generations cannot overwrite newer results', async () => {
  let now = 0;
  const cache = createEarningsCacheState({ now: () => now });
  await Promise.all([cache.ensureData('mud/a', () => Promise.resolve('A')), cache.ensureData('oni/a', () => Promise.resolve('B')), cache.ensureData('mud/b', () => Promise.resolve('C'))]);
  assert.equal(cache.inspect('mud/a').value, 'A'); assert.equal(cache.inspect('oni/a').value, 'B'); assert.equal(cache.inspect('mud/b').value, 'C');
  const old = deferred(); const oldRequest = cache.ensureData('same', () => old.promise);
  cache.invalidate('same');
  const newer = cache.ensureData('same', () => Promise.resolve('new')); await newer;
  old.resolve('old'); await oldRequest; await flush();
  assert.equal(cache.inspect('same').value, 'new'); assert.equal(cache.inspect('same').generation, 2);
});
