'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateMiningTransactionEvents } = require('../electron/mining-transaction-events');

const includedDays = new Set(['2026-09-12']);

function point(field, value, overrides = {}) {
  return {
    _time: '2026-09-12T03:00:00.000Z',
    _field: field,
    _value: String(value),
    fleet: 'MF-01|Hydrogen',
    starbase: 'MRZ-5',
    rss: 'Hydrogen',
    ...overrides,
  };
}

test('new mining telemetry aggregates explicit start and stop transaction count with total fee', () => {
  const rows = aggregateMiningTransactionEvents([
    point('txCostSol', 0.00001),
    point('txCount', 2),
    point('txCostSol', 0.00002, { _time: '2026-09-12T08:00:00.000Z' }),
    point('txCount', 2, { _time: '2026-09-12T08:00:00.000Z' }),
  ], { includedDays });

  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], txCostSol: undefined }, {
    isoDate: '2026-09-12',
    fleet: 'MF-01|Hydrogen',
    starbase: 'MRZ-5',
    rawMaterial: 'Hydrogen',
    txCostSol: undefined,
    txsDaily: 4,
  });
  assert.ok(Math.abs(rows[0].txCostSol - 0.00003) < 1e-12);
});

test('legacy mining telemetry counts each observed fee point as one transaction', () => {
  const rows = aggregateMiningTransactionEvents([
    point('txCostSol', 0.000005),
    point('txCostSol', 0.000006, { _time: '2026-09-12T08:00:00.000Z' }),
  ], { includedDays });

  assert.equal(rows[0].txCostSol, 0.000011);
  assert.equal(rows[0].txsDaily, 2);
});

test('transaction totals stay attached to material rows instead of multiplying across a fleet day', () => {
  const rows = aggregateMiningTransactionEvents([
    point('txCostSol', 0.00001),
    point('txCount', 2),
    point('txCostSol', 0.00002, { _time: '2026-09-12T08:00:00.000Z', rss: 'Carbon' }),
    point('txCount', 2, { _time: '2026-09-12T08:00:00.000Z', rss: 'Carbon' }),
  ], { includedDays });

  assert.equal(rows.length, 2);
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.txCostSol, 0) - 0.00003) < 1e-12);
  assert.equal(rows.reduce((sum, row) => sum + row.txsDaily, 0), 4);
});

test('invalid, out-of-window, and unrelated fields are ignored', () => {
  const rows = aggregateMiningTransactionEvents([
    point('amount', 99),
    point('txCostSol', 0.5, { _time: '2026-09-11T03:00:00.000Z' }),
    point('txCostSol', 'not-a-number'),
    point('txCount', -1),
    point('txCount', 1.5),
  ], { includedDays });

  assert.deepEqual(rows, []);
});
