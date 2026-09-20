'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { enrichCargoAllocationFleetDetails } = require('../electron/cargo-allocation-renderer');
const row = { fleetAccount: 'account', isoDate: '2026-09-20', fleet: 'Same name', ships: [], totalRequiredCrew: null, amount: 42, totalCostsAtlas: 17 };
const fleet = { ...row, ships: [{ name: 'Ship', amount: 2 }], totalRequiredCrew: 8, ownership: 'Owned', shipTypes: 1, amount: 999, totalCostsAtlas: 900 };
test('cached allocation rows reuse exact fleet-day display metadata without changing costs or source rows', () => {
  const [result] = enrichCargoAllocationFleetDetails([row], [fleet]);
  assert.deepEqual(result.ships, fleet.ships);
  assert.equal(result.totalRequiredCrew, 8);
  assert.equal(result.ownership, 'Owned');
  assert.equal(result.amount, 42);
  assert.equal(result.totalCostsAtlas, 17);
  assert.deepEqual(row.ships, []);
});
test('metadata never crosses fleet accounts, UTC days, or ambiguous matches', () => {
  for (const candidates of [[{ ...fleet, fleetAccount: 'other' }], [{ ...fleet, isoDate: '2026-09-19' }], [fleet, { ...fleet, totalRequiredCrew: 9 }], []]) {
    assert.deepEqual(enrichCargoAllocationFleetDetails([row], candidates), [row]);
  }
  assert.deepEqual(enrichCargoAllocationFleetDetails([{ ...row, fleetAccount: '' }], [fleet]), [{ ...row, fleetAccount: '' }]);
});
test('zero crew is preserved and multiple allocation assets reuse metadata independently', () => {
  const results = enrichCargoAllocationFleetDetails([row, { ...row, asset: 'Fuel' }], [{ ...fleet, totalRequiredCrew: 0 }]);
  assert.deepEqual(results.map(r => r.totalRequiredCrew), [0, 0]);
});
test('both data arrival orders refresh Allocation using current scoped Earnings metadata', () => {
  const source = fs.readFileSync(require.resolve('../electron/renderer.js'), 'utf8');
  const cargo = source.slice(source.indexOf('function renderEarningsCargo(result)'), source.indexOf('function renderEarningsCargoAllocations('));
  assert.match(cargo, /renderEarningsCargoAllocations\(latestCargoAllocationResult, result\)/);
  const allocation = source.slice(source.indexOf('function renderEarningsCargoAllocations('), source.indexOf('// Singleton in-flight guard'));
  assert.match(allocation, /fleetResult = latestEarningsResult/);
  assert.match(allocation, /enrichCargoAllocationFleetDetails/);
  assert.match(allocation, /fleetResult\?\.ok/);
});
