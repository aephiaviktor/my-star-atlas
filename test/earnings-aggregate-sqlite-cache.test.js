'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  buildEarningsAggregateCacheSourceKey,
  createEarningsAggregateSqliteCache,
} = require('../electron/earnings-aggregate-sqlite-cache');

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-earnings-aggregate-cache-'));
  return { directory, filePath: path.join(directory, 'earnings-history-v1.sqlite') };
}

const source = {
  influxUrl: 'https://influx.example/api/v2/query?org=Aephia',
  influxOrganization: 'Aephia',
  influxBucket: 'SLYAssistant',
  rpcUrl: 'https://rpc.example',
  profile: 'profile-public-key',
  faction: 'USTUR',
  scope: 'crafting',
  projectionVersion: 1,
};

test('aggregate source identity excludes credentials and covers projection inputs', () => {
  const baseline = buildEarningsAggregateCacheSourceKey({ ...source, influxAuthToken: 'secret-a' });
  assert.equal(baseline, buildEarningsAggregateCacheSourceKey({ ...source, influxAuthToken: 'secret-b' }));
  assert.notEqual(baseline, buildEarningsAggregateCacheSourceKey({ ...source, faction: 'ONI' }));
  assert.notEqual(baseline, buildEarningsAggregateCacheSourceKey({ ...source, profile: 'other-profile' }));
  assert.notEqual(baseline, buildEarningsAggregateCacheSourceKey({ ...source, scope: 'breakeven' }));
  assert.notEqual(baseline, buildEarningsAggregateCacheSourceKey({ ...source, projectionVersion: 2 }));
  assert.doesNotMatch(baseline, /secret/);
});

test('daily aggregate snapshot survives reopen with integrity metadata', () => {
  const { directory, filePath } = temporaryDatabase();
  const snapshot = { ok: true, checkedAt: '2026-09-14T20:00:00.000Z', rows: [{ isoDate: '2026-09-14', fleet: 'MF-01', txsDaily: 48 }] };
  try {
    let cache = createEarningsAggregateSqliteCache({ filePath, source, now: () => 1234 });
    assert.equal(cache.read(), null);
    const written = cache.write(snapshot);
    assert.equal(written.projectedAtMs, 1234);
    cache.close();

    cache = createEarningsAggregateSqliteCache({ filePath, source });
    const restored = cache.read();
    assert.deepEqual(restored.snapshot, snapshot);
    assert.equal(restored.projectedAtMs, 1234);
    assert.equal(restored.digest.length, 64);
    cache.close();
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cache rejects unsuccessful snapshots and preserves last-good data', () => {
  const { directory, filePath } = temporaryDatabase();
  try {
    const cache = createEarningsAggregateSqliteCache({ filePath, source });
    const good = { ok: true, rows: [{ txsDaily: 12 }] };
    cache.write(good);
    assert.throws(() => cache.write({ ok: false, error: 'failed' }), /successful_snapshot_required/);
    assert.deepEqual(cache.read().snapshot, good);
    cache.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('corrupt aggregate payload self-deletes instead of serving data', () => {
  const { directory, filePath } = temporaryDatabase();
  try {
    const cache = createEarningsAggregateSqliteCache({ filePath, source });
    cache.write({ ok: true, rows: [] });
    const database = new DatabaseSync(filePath);
    database.prepare('UPDATE earnings_daily_aggregates SET payload = ? WHERE source_key = ?')
      .run(Buffer.from('not-gzip'), cache.sourceKey);
    database.close();
    assert.equal(cache.read(), null);
    assert.equal(cache.read(), null);
    cache.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
