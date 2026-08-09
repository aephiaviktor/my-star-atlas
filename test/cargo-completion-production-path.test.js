'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/cargo-cf22-completed-cycle.json');
const {
  buildCargoAllocationRecords,
  mergeCargoRowsWithCompletedAllocations,
} = require('../electron/influx-data');
const { filterCargoAllocationsToCompletedCycles, calculateCargoEfficiency } = require('../electron/earnings-math');

const includedDays = new Set(['2026-07-25', '2026-12-31', '2027-01-01']);
const allocations = () => buildCargoAllocationRecords(fixture.allocationRows, includedDays);
function automaticPath(movementRows, completionRows = fixture.completionRows, allocationRows = allocations()) {
  const cargoRows = mergeCargoRowsWithCompletedAllocations({ movementRows, completionRows, allocationRows, includedDays });
  const cargoAllocationRows = filterCargoAllocationsToCompletedCycles(allocationRows, cargoRows);
  const filteredCargo = cargoRows.filter(() => true); // All Dates / All Fleets
  const filteredAllocations = cargoAllocationRows.filter(() => true); // All Dates / All Fleets / All Assets
  return { cargoRows: filteredCargo, cargoAllocationRows: filteredAllocations, cargoAllocationError: '' };
}

test('fulfilled-empty automatic path reconstructs the preserved completed cycle', () => {
  const result = automaticPath([]);
  assert.equal(result.cargoRows.length, 1);
  assert.equal(result.cargoAllocationRows.length, 1);
  assert.equal(result.cargoRows[0].burnedFuel, 17835.494841372823);
  assert.equal(result.cargoRows[0].txCostSol, 0.000003750409485994295);
  assert.equal(result.cargoRows[0].cargoVolume, 93888);
});

test('healthy movement is preserved without reconstructed cost duplication', () => {
  const cycleId = fixture.completionRows[0].cycleId;
  const healthy = [{ fleet:'CF-22|01b', assignment:'Supply Chain', timestamp:'2026-07-25T01:00:00Z', isoDate:'07/25', burnedFuel:10, txCostSol:2, cargoVolume:7, cargoCycles:1, cargoLegs:3, completedCycleIds:[cycleId], movementCycleIds:[cycleId] }];
  const result = automaticPath(healthy);
  assert.equal(result.cargoRows.length, 1);
  assert.equal(result.cargoRows[0].isoDate, '2026-07-25');
  assert.equal(result.cargoRows[0].burnedFuel, 10);
  assert.equal(result.cargoRows[0].txCostSol, 2);
  assert.equal(result.cargoRows[0].cargoCycles, 1);
  assert.equal(result.cargoRows[0].cargoLegs, 3);
});

test('partial movement reconstructs only the absent exact completed cycle', () => {
  const otherCycle = `${fixture.completionRows[0].cycleId.split(':')[0]}:35,16:1784963236894`;
  const completionRows = [...fixture.completionRows, {...fixture.completionRows[0], cycleId:otherCycle, _value:'2'}];
  const extra = fixture.allocationRows.map((row) => ({...row, cycleId:otherCycle, allocationIndex:'1', _value: row._field === 'allocatedFuel' ? '5' : row._field === 'allocatedTxCostSol' ? '1' : row._value}));
  const allAllocations = buildCargoAllocationRecords([...fixture.allocationRows, ...extra], includedDays);
  const movement = [{ fleet:'CF-22|01b', fleetAccount:fixture.completionRows[0].cycleId.split(':')[0], assignment:'Supply Chain', timestamp:'2026-07-25T01:00:00Z', burnedFuel:10, txCostSol:2, cargoVolume:7, cargoCycles:1, cargoLegs:3, completedCycleIds:[fixture.completionRows[0].cycleId], movementCycleIds:[fixture.completionRows[0].cycleId] }];
  const result = automaticPath(movement, completionRows, allAllocations);
  assert.equal(result.cargoRows.length, 1);
  assert.equal(result.cargoRows[0].burnedFuel, 15);
  assert.equal(result.cargoRows[0].txCostSol, 3);
  assert.equal(result.cargoRows[0].cargoCycles, 2);
  assert.equal(result.cargoRows[0].cargoLegs, 5);
});

test('canonical timestamp wins over locale label and handles UTC year boundary', () => {
  const cycle = fixture.completionRows[0].cycleId;
  const rows = mergeCargoRowsWithCompletedAllocations({ movementRows:[
    {fleet:'Big Bois', assignment:'Transport', timestamp:'2026-12-31T23:59:59Z', isoDate:'12/31', label:'12/31', burnedFuel:1, movementCycleIds:[cycle]},
    {fleet:'Big Bois', assignment:'Transport', timestamp:'2027-01-01T00:00:01Z', isoDate:'2026-12-31', label:'2026-12-31', burnedFuel:2, movementCycleIds:[cycle]},
  ], completionRows:[], allocationRows:[], includedDays });
  assert.deepEqual(rows.map((row) => row.isoDate), ['2026-12-31','2027-01-01']);
});

test('repeated completion and allocation evidence is replay-safe', () => {
  const result = automaticPath([], [...fixture.completionRows, ...fixture.completionRows], buildCargoAllocationRecords([...fixture.allocationRows, ...fixture.allocationRows], includedDays));
  assert.equal(result.cargoRows.length, 1);
  assert.equal(result.cargoRows[0].cargoCycles, 1);
  assert.equal(result.cargoRows[0].burnedFuel, 17835.494841372823);
});

test('formula outputs remain populated and exact after reconstruction', () => {
  const result = automaticPath([]);
  const row = result.cargoRows[0];
  const fuelCostsAtlas = row.burnedFuel * 0.01;
  const txsCostsAtlas = row.txCostSol * 100;
  const totalCostsAtlas = fuelCostsAtlas + txsCostsAtlas;
  const txsCostsPercent = txsCostsAtlas / totalCostsAtlas * 100;
  const efficiency = calculateCargoEfficiency({cargoVolume:row.cargoVolume,fleetCargoCapacity:100000,cargoLegs:row.cargoLegs});
  assert.ok(fuelCostsAtlas > 0); assert.ok(txsCostsAtlas > 0);
  assert.equal(txsCostsPercent, txsCostsAtlas / totalCostsAtlas * 100);
  assert.equal(efficiency.cargoEfficiencyPercent, 93888 / 300000 * 100);
});
