'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildCargoAllocationCacheSourceKey,
  createCargoAllocationSqliteCache,
} = require('../electron/cargo-allocation-sqlite-cache');

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-cargo-allocation-cache-'));
  return { directory, filePath: path.join(directory, 'cargo-allocation-history-v1.sqlite') };
}

const source = {
  influxUrl: 'https://influx.example/api/v2/query?org=Aephia',
  influxOrganization: 'Aephia',
  influxBucket: 'SLYAssistant',
  faction: 'USTUR',
  playerProfile: 'profile',
  sourceSchemaVersion: '1',
  projectionVersion: 2,
};

const day = '2026-09-18';
const rows = [{ isoDate: day, fleetAccount: 'fleet', asset: 'Fuel', rentalCostsAtlas: 12.5 }];

test('Cargo Allocation cache identity excludes credentials and isolates faction, profile, source, and projection', () => {
  const baseline = buildCargoAllocationCacheSourceKey({ ...source, influxAuthToken: 'secret-a' });
  assert.equal(baseline, buildCargoAllocationCacheSourceKey({ ...source, influxAuthToken: 'secret-b' }));
  for (const changed of [
    { faction: 'MUD' }, { playerProfile: 'other' }, { influxBucket: 'other' },
    { influxOrganization: 'other' }, { influxUrl: 'https://other.example' },
    { sourceSchemaVersion: '2' }, { projectionVersion: 3 },
  ]) assert.notEqual(baseline, buildCargoAllocationCacheSourceKey({ ...source, ...changed }));
  assert.doesNotMatch(baseline, /secret/);
});

test('projected daily rows and explicit empty days survive reopen with integrity validation', () => {
  const { directory, filePath } = temporaryDatabase();
  try {
    let cache = createCargoAllocationSqliteCache({ filePath, source });
    assert.equal(cache.readDay(day), null);
    cache.writeDay(day, rows);
    cache.writeDay('2026-09-17', []);
    cache.close();

    cache = createCargoAllocationSqliteCache({ filePath, source });
    assert.deepEqual(cache.readDay(day).rows, rows);
    assert.deepEqual(cache.readDay('2026-09-17').rows, []);
    cache.close();
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cache rejects cross-day payloads and prunes only completed days before the cutoff', () => {
  const { directory, filePath } = temporaryDatabase();
  try {
    const cache = createCargoAllocationSqliteCache({ filePath, source });
    assert.throws(() => cache.writeDay(day, [{ ...rows[0], isoDate: '2026-09-19' }]), /row_day_mismatch/);
    cache.writeDay('2026-09-16', []);
    cache.writeDay('2026-09-17', []);
    assert.equal(cache.pruneBefore('2026-09-17'), 1);
    assert.equal(cache.readDay('2026-09-16'), null);
    assert.deepEqual(cache.readDay('2026-09-17').rows, []);
    cache.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
