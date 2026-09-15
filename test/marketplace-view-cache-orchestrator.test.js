'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMarketplaceViewCacheOrchestrator,
} = require('../electron/marketplace-view-cache-orchestrator');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness({ cached = null, writeError = null } = {}) {
  let stored = cached;
  let builds = 0;
  let writes = 0;
  let closes = 0;
  const buildGate = deferred();
  const orchestrator = createMarketplaceViewCacheOrchestrator({
    sourceForSettings: (settings) => ({ sourceKey: `${settings.faction}:${settings.profile}` }),
    openCache: () => ({
      read: () => (stored ? { snapshot: stored, materializedAtMs: 100 } : null),
      write: (snapshot) => {
        if (writeError) throw writeError;
        stored = snapshot;
        writes += 1;
        return { materializedAtMs: 200 };
      },
      close: () => { closes += 1; },
    }),
    buildSnapshot: async (settings) => {
      builds += 1;
      return buildGate.promise.then((snapshot) => ({ ...snapshot, faction: settings.faction }));
    },
  });
  return {
    orchestrator,
    buildGate,
    get builds() { return builds; },
    get writes() { return writes; },
    get closes() { return closes; },
    get stored() { return stored; },
  };
}

const cachedSnapshot = { ok: true, checkedAt: '2026-09-15T06:00:00.000Z', rows: ['cached'] };
const freshSnapshot = { ok: true, checkedAt: '2026-09-15T07:00:00.000Z', rows: ['fresh'] };

test('cached Marketplace view returns immediately and starts one coalesced background refresh', async () => {
  const subject = harness({ cached: cachedSnapshot });
  const first = await subject.orchestrator.load({ faction: 'USTUR', profile: 'profile' });
  const second = await subject.orchestrator.load({ faction: 'USTUR', profile: 'profile' });
  assert.deepEqual(first.rows, ['cached']);
  assert.equal(first.marketplaceViewCache.status, 'stale');
  assert.equal(second.marketplaceViewCache.status, 'stale');
  assert.equal(subject.builds, 1);

  subject.buildGate.resolve(freshSnapshot);
  const refreshed = await subject.orchestrator.load(
    { faction: 'USTUR', profile: 'profile' },
    { waitForRefresh: true },
  );
  assert.deepEqual(refreshed.rows, ['fresh']);
  assert.equal(refreshed.marketplaceViewCache.status, 'fresh');
  assert.equal(subject.builds, 1);
  assert.equal(subject.writes, 1);
});

test('cache miss waits for a fresh Marketplace view and persists it', async () => {
  const subject = harness();
  const loading = subject.orchestrator.load({ faction: 'MUD', profile: 'profile' });
  assert.equal(subject.builds, 1);
  subject.buildGate.resolve(freshSnapshot);
  const result = await loading;
  assert.deepEqual(result.rows, ['fresh']);
  assert.equal(result.marketplaceViewCache.status, 'fresh');
  assert.equal(subject.writes, 1);
  assert.equal(subject.closes, 2);
});

test('forced Marketplace refresh bypasses cached return and still coalesces callers', async () => {
  const subject = harness({ cached: cachedSnapshot });
  const first = subject.orchestrator.load({ faction: 'ONI', profile: 'profile' }, { forceRefresh: true });
  const second = subject.orchestrator.load({ faction: 'ONI', profile: 'profile' }, { forceRefresh: true });
  assert.equal(subject.builds, 1);
  subject.buildGate.resolve(freshSnapshot);
  assert.deepEqual(await first, await second);
  assert.equal(subject.writes, 1);
});

test('forced Marketplace refresh waits for an older background build and then rebuilds again', async () => {
  let stored = cachedSnapshot;
  const gates = [];
  let builds = 0;
  const orchestrator = createMarketplaceViewCacheOrchestrator({
    sourceForSettings: () => ({ sourceKey: 'USTUR:profile' }),
    openCache: () => ({
      read: () => ({ snapshot: stored, materializedAtMs: 100 }),
      write: (snapshot) => { stored = snapshot; return { materializedAtMs: 200 + builds }; },
      close: () => {},
    }),
    buildSnapshot: async () => {
      builds += 1;
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    },
  });

  await orchestrator.load({ faction: 'USTUR', profile: 'profile' });
  const forced = orchestrator.load({ faction: 'USTUR', profile: 'profile' }, { forceRefresh: true });
  assert.equal(builds, 1);
  gates[0].resolve({ ...freshSnapshot, rows: ['background'] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(builds, 2);
  gates[1].resolve({ ...freshSnapshot, rows: ['forced'] });
  assert.deepEqual((await forced).rows, ['forced']);
  assert.deepEqual(stored.rows, ['forced']);
});

test('failed background refresh preserves and continues serving last-good Marketplace view', async () => {
  const subject = harness({ cached: cachedSnapshot });
  const cached = await subject.orchestrator.load({ faction: 'USTUR', profile: 'profile' });
  subject.buildGate.reject(new Error('Influx unavailable'));
  await assert.rejects(
    subject.orchestrator.load({ faction: 'USTUR', profile: 'profile' }, { waitForRefresh: true }),
    /Influx unavailable/,
  );
  const afterFailure = await subject.orchestrator.load(
    { faction: 'USTUR', profile: 'profile' },
    { startBackgroundRefresh: false },
  );
  assert.deepEqual(cached.rows, ['cached']);
  assert.deepEqual(afterFailure.rows, ['cached']);
  assert.equal(subject.writes, 0);
});

test('uncacheable refresh result is returned without replacing last-good Marketplace view', async () => {
  const subject = harness({
    cached: cachedSnapshot,
    writeError: new TypeError('marketplace_view_cache_complete_snapshot_required'),
  });
  await subject.orchestrator.load({ faction: 'USTUR', profile: 'profile' });
  subject.buildGate.resolve({ ok: false, rows: ['partial'] });
  const result = await subject.orchestrator.load(
    { faction: 'USTUR', profile: 'profile' },
    { waitForRefresh: true },
  );
  assert.deepEqual(result.rows, ['partial']);
  assert.equal(result.marketplaceViewCache.status, 'rejected');
  assert.deepEqual(subject.stored.rows, ['cached']);
  assert.equal(subject.writes, 0);
});
