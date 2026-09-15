'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  buildMarketplaceViewCacheSourceKey,
  createMarketplaceViewSqliteCache,
  isCompleteMarketplaceViewSnapshot,
} = require('../electron/marketplace-view-sqlite-cache');

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-marketplace-view-cache-'));
  return { directory, filePath: path.join(directory, 'marketplace-transactions-v1.sqlite') };
}

const source = {
  influxUrl: 'https://influx.example/api/v2/query?org=Aephia',
  influxOrganization: 'Aephia',
  influxBucket: 'SLYAssistant',
  profile: 'profile-public-key',
  faction: 'USTUR',
  scope: 'marketplace-complete',
  projectionVersion: 1,
  marketplaceHistoryCutoverIso: '2026-08-01T00:00:00.000Z',
};

function completeSnapshot(overrides = {}) {
  return {
    ok: true,
    marketplaceRawData: [{ signature: 'raw-a' }],
    marketplaceRawDataCount: 1,
    marketplaceRawDataError: '',
    marketplaceRawDataCoverage: { total: 1, complete: 1, pending: 0, sources: [] },
    marketplaceRawDataCoverageError: '',
    marketplaceEvents: [{ signature: 'raw-a', eventType: 'sale' }],
    marketplaceEventCount: 1,
    marketplaceTrades: [{ signature: 'raw-a', side: 'buy' }],
    marketplaceTradeCount: 1,
    marketplaceGlobalLedgerRows: [{ signature: 'raw-a', direction: 'in' }],
    marketplaceGlobalLedgerCount: 1,
    marketplaceGameLedgerRows: [{ signature: 'raw-a', direction: 'deposit' }],
    marketplaceGameLedgerCount: 1,
    marketplaceEventsError: '',
    marketplaceAssetFlowError: '',
    marketplaceBreakevenBasisError: '',
    marketplaceInventoryBasisError: '',
    localMarketTrades: [{ signature: 'local-a' }],
    localMarketTradeCount: 1,
    localMarketError: '',
    checkedAt: '2026-09-15T06:30:00.000Z',
    ...overrides,
  };
}

test('Marketplace view source identity excludes credentials and covers projection inputs', () => {
  const baseline = buildMarketplaceViewCacheSourceKey({ ...source, influxAuthToken: 'secret-a', rpcApiKey: 'rpc-secret-a' });
  assert.equal(baseline, buildMarketplaceViewCacheSourceKey({ ...source, influxAuthToken: 'secret-b', rpcApiKey: 'rpc-secret-b' }));
  assert.notEqual(baseline, buildMarketplaceViewCacheSourceKey({ ...source, faction: 'ONI' }));
  assert.notEqual(baseline, buildMarketplaceViewCacheSourceKey({ ...source, profile: 'other-profile' }));
  assert.notEqual(baseline, buildMarketplaceViewCacheSourceKey({ ...source, projectionVersion: 2 }));
  assert.notEqual(baseline, buildMarketplaceViewCacheSourceKey({ ...source, marketplaceHistoryCutoverIso: '2026-09-01T00:00:00.000Z' }));
  assert.doesNotMatch(baseline, /secret/);
});

test('complete Marketplace view validation requires every render collection, matching counts, and no source errors', () => {
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot()), true);
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot({ ok: false })), false);
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot({ marketplaceRawDataCount: 2 })), false);
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot({ marketplaceEvents: undefined })), false);
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot({ marketplaceRawDataCoverage: [] })), false);
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot({ marketplaceRawDataCoverage: { total: 1, complete: 0, pending: 1, sources: [] } })), false);
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot({ marketplaceRawDataCoverageError: 'coverage failed' })), false);
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot({ marketplaceAssetFlowError: 'flows failed' })), false);
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot({ marketplaceBreakevenBasisError: 'basis history failed' })), false);
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot({ marketplaceInventoryBasisError: 'basis failed' })), false);
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot({ checkedAt: 'not-a-date' })), false);
  assert.equal(isCompleteMarketplaceViewSnapshot(completeSnapshot({ checkedAt: 1_789_000_000_000 })), false);
});

test('complete Marketplace view survives reopen with integrity metadata and restricted permissions', () => {
  const { directory, filePath } = temporaryDatabase();
  const snapshot = completeSnapshot();
  try {
    let cache = createMarketplaceViewSqliteCache({ filePath, source, now: () => 1_234 });
    assert.equal(cache.read(), null);
    const written = cache.write(snapshot);
    assert.equal(written.materializedAtMs, 1_234);
    assert.equal(written.byteCount > 0, true);
    assert.equal(written.digest.length, 64);
    cache.close();

    cache = createMarketplaceViewSqliteCache({ filePath, source });
    assert.deepEqual(cache.read().snapshot, snapshot);
    cache.close();
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('partial, failed, and oversized writes preserve the last-good Marketplace view', () => {
  const { directory, filePath } = temporaryDatabase();
  try {
    const cache = createMarketplaceViewSqliteCache({ filePath, source, maxSnapshotBytes: 1_024 });
    const good = completeSnapshot();
    cache.write(good);
    assert.throws(() => cache.write(completeSnapshot({ marketplaceEventsError: 'query failed' })), /complete_snapshot_required/);
    assert.throws(() => cache.write(completeSnapshot({ marketplaceTradeCount: 99 })), /complete_snapshot_required/);
    assert.throws(() => cache.write(completeSnapshot({ extra: 'x'.repeat(2_000) })), /snapshot_too_large/);
    assert.deepEqual(cache.read().snapshot, good);
    cache.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('corrupt Marketplace view payload self-deletes and fails open', () => {
  const { directory, filePath } = temporaryDatabase();
  try {
    const cache = createMarketplaceViewSqliteCache({ filePath, source });
    cache.write(completeSnapshot());
    const database = new DatabaseSync(filePath);
    database.prepare('UPDATE marketplace_materialized_views SET payload = ? WHERE source_key = ?')
      .run(Buffer.from('not-gzip'), cache.sourceKey);
    database.close();
    assert.equal(cache.read(), null);
    assert.equal(cache.read(), null);
    cache.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
