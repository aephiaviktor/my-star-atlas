'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createRawCostSqliteCache,
  buildRawCostCacheSourceKey,
} = require('../electron/raw-cost-sqlite-cache');

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-raw-cache-'));
  return { directory, filePath: path.join(directory, 'earnings-history-v1.sqlite') };
}

const source = {
  influxUrl: 'https://influx.example/api/v2/query?org=Aephia',
  influxOrganization: 'Aephia',
  influxBucket: 'SLYAssistant',
  faction: 'USTUR',
  scopes: [{ faction: 'UST', alternatives: [{ instance: 'USTUR1' }, { instance: 'USTUR2' }] }],
  sourceSchemaVersion: '1',
  cutoverManifestVersion: 1,
  projectorVersion: 1,
};

const window = {
  start: '2026-09-14T00:00:00.000Z',
  stop: '2026-09-14T06:00:00.000Z',
};

test('cache source identity excludes credentials but changes with source and projection semantics', () => {
  const baseline = buildRawCostCacheSourceKey({ ...source, influxAuthToken: 'secret-a' });
  assert.equal(baseline, buildRawCostCacheSourceKey({ ...source, influxAuthToken: 'secret-b' }));
  assert.notEqual(baseline, buildRawCostCacheSourceKey({ ...source, influxBucket: 'Other' }));
  assert.notEqual(baseline, buildRawCostCacheSourceKey({ ...source, projectorVersion: 2 }));
  assert.doesNotMatch(baseline, /secret/);
});

test('completed six-hour shards survive process-style reopen and preserve exact CSV bytes', () => {
  const { directory, filePath } = temporaryDatabase();
  const csv = ',result,table,_time\n,_result,0,2026-09-14T00:00:00Z\n';
  try {
    let cache = createRawCostSqliteCache({ filePath, source });
    assert.equal(cache.read(window), null);
    cache.write(window, csv);
    assert.equal(cache.read(window).csv, csv);
    cache.close();

    cache = createRawCostSqliteCache({ filePath, source });
    const restored = cache.read(window);
    assert.equal(restored.csv, csv);
    assert.equal(restored.start, window.start);
    assert.equal(restored.stop, window.stop);
    assert.equal(restored.digest.length, 64);
    cache.close();
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('failed replacement leaves the previous last-good shard intact', () => {
  const { directory, filePath } = temporaryDatabase();
  try {
    const cache = createRawCostSqliteCache({ filePath, source });
    cache.write(window, 'last-good');
    assert.throws(() => cache.write({ start: window.start, stop: 'invalid' }, 'replacement'), /invalid_cache_window/);
    assert.equal(cache.read(window).csv, 'last-good');
    cache.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('pruning removes only shards wholly outside the rolling history boundary', () => {
  const { directory, filePath } = temporaryDatabase();
  try {
    const cache = createRawCostSqliteCache({ filePath, source });
    const old = { start: '2026-08-13T00:00:00.000Z', stop: '2026-08-13T06:00:00.000Z' };
    const retained = { start: '2026-08-13T06:00:00.000Z', stop: '2026-08-13T12:00:00.000Z' };
    cache.write(old, 'old');
    cache.write(retained, 'retained');
    assert.equal(cache.pruneBefore('2026-08-13T06:00:00.000Z'), 1);
    assert.equal(cache.read(old), null);
    assert.equal(cache.read(retained).csv, 'retained');
    cache.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
