'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCargoAllocationSource, buildCargoAllocationPivotFlux } = require('../electron/cargo-allocation-source');

const NOW = new Date('2026-08-10T16:00:00.000Z');
const SETTINGS = { faction: 'MUD', playerProfile: 'mud-profile', influxBucket: 'slya' };
function pivotRow(overrides = {}) {
  return { _time: '2026-08-10T02:00:00.000Z', fleet: 'Fleet', rss: 'Fuel', assignment: 'Transport', originStarbase: 'A', deliveryStarbase: 'B', cycleId: `${'1'.repeat(44)}:0,0:1`, allocationIndex: '0', amount: '2', cargoVolume: '4', allocatedFuel: '1', allocatedTxCostSol: '0.01', ...overrides };
}
function csv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return [`,result,table,${keys.join(',')}`, ...rows.map((row) => `,,0,${keys.map((key) => row[key]).join(',')}`)].join('\n');
}
function source(overrides = {}) {
  let calls = 0;
  const instance = createCargoAllocationSource({
    now: () => NOW,
    queryBatch: async () => { calls += 1; return csv(calls === 6 ? [pivotRow()] : []); },
    parseCsv: require('../electron/influx-data').parseInfluxCsv,
    projectRows: async (_settings, rows) => ({ rows }),
    ...overrides,
  });
  return { instance, calls: () => calls };
}

test('optimized Allocation query pivots complete records inside a bounded UTC batch', () => {
  const query = buildCargoAllocationPivotFlux('slya', '  |> filter(fn: (r) => r.faction == "MUD")', { start: '2026-08-06T00:00:00.000Z', stop: '2026-08-11T00:00:00.000Z' });
  assert.match(query, /range\(start: time\(v: "2026-08-06/);
  assert.match(query, /pivot\(rowKey: \["_time", "cycleId", "allocationIndex"\]/);
  assert.match(query, /exists r\.amount and exists r\.cargoVolume and exists r\.allocatedFuel and exists r\.allocatedTxCostSol/);
});

test('six sequential batches produce a complete nonzero on-demand result', async () => {
  const { instance, calls } = source();
  const result = await instance.load(SETTINGS);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.diagnostics.batchCount, 6);
  assert.deepEqual(result.diagnostics.batchRecordCounts, [0, 0, 0, 0, 0, 1]);
  assert.equal(calls(), 6);
});

test('one failed batch fails closed without partial rows', async () => {
  let calls = 0;
  const { instance } = source({ queryBatch: async () => { calls += 1; if (calls === 4) throw new Error('batch-four-failed'); return csv([pivotRow({ allocationIndex: String(calls) })]); } });
  const result = await instance.load(SETTINGS);
  assert.equal(result.ok, false);
  assert.equal(result.availability, 'unavailable');
  assert.deepEqual(result.rows, []);
  assert.match(result.error, /batch-four-failed/);
});

test('batch timeout is Allocation-only and bounded', async () => {
  const { instance } = source({ batchTimeoutMs: 5, workerTimeoutMs: 100, queryBatch: () => new Promise(() => {}) });
  const result = await instance.load(SETTINGS);
  assert.equal(result.ok, false);
  assert.match(result.error, /cargo_allocation_query_timeout_5ms/);
});

test('repeated tab openings share one flight then use successful cache', async () => {
  let release;
  let calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const { instance } = source({ queryBatch: async () => { calls += 1; await gate; return calls === 6 ? csv([pivotRow()]) : ''; } });
  const first = instance.load(SETTINGS);
  const second = instance.load(SETTINGS);
  assert.equal(first, second);
  release();
  await first;
  const cached = await instance.load(SETTINGS);
  assert.equal(cached.cacheHit, true);
  assert.equal(calls, 6);
});

test('expired last-good allocation remains available when background refresh fails', async () => {
  let clock = 0;
  let fail = false;
  let calls = 0;
  const { instance } = source({
    cacheTtlMs: 10,
    clock: () => clock,
    queryBatch: async () => {
      calls += 1;
      if (fail) throw new Error('influx-temporary-failure');
      return calls === 6 ? csv([pivotRow()]) : '';
    },
  });
  const initial = await instance.load(SETTINGS);
  assert.equal(initial.rows.length, 1);

  clock = 11;
  fail = true;
  const stale = await instance.load(SETTINGS);
  assert.equal(stale.ok, true);
  assert.equal(stale.availability, 'stale');
  assert.equal(stale.rows.length, 1);
  assert.equal(stale.stale, true);
  assert.match(stale.refreshError, /influx-temporary-failure/);
});

test('faction switch cancels stale flight and never reuses its cache key', async () => {
  const { instance } = source({ queryBatch: () => new Promise(() => {}) });
  const mud = instance.load(SETTINGS);
  instance.cancelExcept({ ...SETTINGS, faction: 'ONI', playerProfile: 'oni-profile' });
  const result = await mud;
  assert.equal(result.availability, 'cancelled');
  assert.equal(instance.cache.size, 0);
});

test('upstream-positive downstream-zero is a bounded processing error', async () => {
  const { instance } = source({ projectRows: async () => ({ rows: [], diagnostics: { completedCycleMatchedCount: 0 } }) });
  const result = await instance.load(SETTINGS);
  assert.equal(result.ok, false);
  assert.match(result.error, /^cargo_allocation_processing_zero:/);
  assert.ok(result.error.length <= 240);
});
