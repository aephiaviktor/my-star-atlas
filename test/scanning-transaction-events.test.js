'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { aggregateScanningTransactionEvents } = require('../electron/scanning-transaction-events');

function point(measurement, field, value, extra = {}) {
  return {
    _measurement: measurement,
    _field: field,
    _value: String(value),
    _time: '2026-09-13T07:00:00.000Z',
    fleet: 'SF01-OPOD',
    assignment: measurement === 'movement' ? 'Scan' : '',
    ...extra,
  };
}

test('scanning transaction aggregation combines scan and Scan movement counts and fees', () => {
  const rows = aggregateScanningTransactionEvents([
    point('sdu', 'txCostSol', 0.000005002),
    point('sdu', 'txCount', 1),
    point('movement', 'txCostSol', 0.000010002, { _time: '2026-09-13T07:01:00.000Z' }),
    point('movement', 'txCount', 2, { _time: '2026-09-13T07:01:00.000Z' }),
  ]);
  assert.deepEqual(rows, [{ isoDate: '2026-09-13', fleet: 'SF01-OPOD', txCostSol: 0.000015004, txsDaily: 3 }]);
});

test('legacy fee-only points count as one event and non-Scan movement is excluded', () => {
  const rows = aggregateScanningTransactionEvents([
    point('sdu', 'txCostSol', 0.000005),
    point('movement', 'txCostSol', 0.000005, { assignment: 'Transport', _time: '2026-09-13T07:01:00.000Z' }),
    point('movement', 'txCount', 2, { assignment: 'Transport', _time: '2026-09-13T07:01:00.000Z' }),
  ]);
  assert.equal(rows[0].txsDaily, 1);
  assert.equal(rows[0].txCostSol, 0.000005);
});

test('scanning query and UI expose Txs Daily in the requested position', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  const scanning = main.slice(main.indexOf('async function fetchScanningEarningsRows'), main.indexOf('async function fetchMiningEarningsRows'));
  assert.match(scanning, /r\._measurement == "sdu" or r\._measurement == "movement"/);
  assert.match(scanning, /r\._field == "txCostSol" or r\._field == "txCount"/);
  assert.match(scanning, /r\.assignment == "Scan"/);
  assert.match(scanning, /map\(fn: \(r\) => \(\{ r with _value: float\(v: r\._value\) \}\)\)/);
  assert.match(scanning, /txsDaily: 0/);
  assert.match(scanning, /aggregateScanningTransactionEvents/);
  assert.match(renderer, /id: 'atlasPerScan', label: 'Atlas \/ Scan' \}\),\s*Object\.freeze\(\{ id: 'txsDaily', label: 'Txs Daily' \}\),\s*Object\.freeze\(\{ id: 'scanAttempts', label: 'Scan Attempts'/);
  assert.match(renderer, /subtab === 'scanning'[\s\S]*'txsDaily'/);
  assert.match(renderer, /subtab === 'scanning' && Number\(saved\.schemaVersion \|\| 1\) < 5\) restoredIds\.push\('txsDaily'\)/);
  assert.match(renderer, /schemaVersion: 5/);
});
