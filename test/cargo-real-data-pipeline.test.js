'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/cargo-cf22-completed-cycle.json');
const {
  buildCargoAllocationRecords,
  buildCargoRowsFromCompletedAllocations,
} = require('../electron/influx-data');
const { filterCargoAllocationsToCompletedCycles, calculateCargoEfficiency } = require('../electron/earnings-math');

test('production-shaped completed UST allocation survives when the movement query is unavailable', () => {
  const includedDays = new Set(['2026-07-25']);
  const allocations = buildCargoAllocationRecords(fixture.allocationRows, includedDays);

  // This is the live 0.6.143 loss: a failed movement query leaves no fleet
  // labels, so the otherwise valid completed allocation is scoped to zero.
  const movementCargoRows = [];
  const scopedByMovement = allocations.filter((row) => new Set(
    movementCargoRows.map((cargo) => String(cargo.fleet || '').trim().toLowerCase())
  ).has(String(row.fleet || '').trim().toLowerCase()));
  assert.equal(scopedByMovement.length, 0);

  const cargoRows = buildCargoRowsFromCompletedAllocations({
    completionRows: fixture.completionRows,
    allocationRows: allocations,
    includedDays,
  });
  const completedAllocations = filterCargoAllocationsToCompletedCycles(allocations, cargoRows);

  assert.equal(cargoRows.length, 1);
  assert.equal(completedAllocations.length, 1);
  assert.equal(cargoRows[0].fleet, 'CF-22|01b');
  assert.equal(cargoRows[0].assignment, 'Supply Chain');
  assert.equal(cargoRows[0].burnedFuel, 17835.494841372823);
  assert.equal(cargoRows[0].txCostSol, 0.000003750409485994295);
  assert.equal(cargoRows[0].cargoVolume, 93888);
  assert.deepEqual(cargoRows[0].completedCycleIds, [fixture.completionRows[0].cycleId]);

  const fuelCostsAtlas = cargoRows[0].burnedFuel * 0.01;
  const txsCostsAtlas = cargoRows[0].txCostSol * 100;
  const totalCostsAtlas = fuelCostsAtlas + txsCostsAtlas;
  const txsCostsPercent = (txsCostsAtlas / totalCostsAtlas) * 100;
  const efficiency = calculateCargoEfficiency({
    cargoVolume: cargoRows[0].cargoVolume,
    fleetCargoCapacity: 100000,
    cargoLegs: cargoRows[0].cargoLegs,
  });
  const ipcResult = {
    cargoRows: [{ ...cargoRows[0], fuelCostsAtlas, txsCostsAtlas, totalCostsAtlas, txsCostsPercent, ...efficiency }],
    cargoAllocationRows: completedAllocations,
  };

  assert.equal(ipcResult.cargoRows.length, 1);
  assert.equal(ipcResult.cargoAllocationRows.length, 1);
  assert.ok(ipcResult.cargoRows[0].fuelCostsAtlas > 0);
  assert.ok(ipcResult.cargoRows[0].txsCostsAtlas > 0);
  assert.equal(ipcResult.cargoRows[0].txsCostsPercent, (ipcResult.cargoRows[0].txsCostsAtlas / ipcResult.cargoRows[0].totalCostsAtlas) * 100);
  assert.equal(ipcResult.cargoRows[0].cargoEfficiencyPercent, (93888 / 300000) * 100);
});
