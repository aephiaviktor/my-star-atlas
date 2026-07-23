const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const {
  calculateFleetCargoCapacity,
  calculateCargoEfficiency,
  buildCargoVolumeByFleetDayAssignment,
} = require('../electron/earnings-math');

test('fleet cargo capacity sums ship capacity across quantities and rejects partial mappings', () => {
  assert.equal(calculateFleetCargoCapacity([
    { amount: 2, cargoCapacity: 1000 },
    { amount: 1, cargoCapacity: 500 },
  ]), 2500);
  assert.equal(calculateFleetCargoCapacity([
    { amount: 2, cargoCapacity: 1000 },
    { amount: 1, cargoCapacity: null },
  ]), null);
});

test('cargo efficiency counts every movement leg as a capacity opportunity', () => {
  const result = calculateCargoEfficiency({
    cargoVolume: 1000,
    fleetCargoCapacity: 1000,
    cargoLegs: 2,
  });

  assert.deepEqual(result, {
    cargoCapacity: 2000,
    cargoEfficiencyPercent: 50,
  });
});

test('cargo efficiency returns null when fleet capacity or legs are unavailable', () => {
  assert.deepEqual(
    calculateCargoEfficiency({ cargoVolume: 1000, fleetCargoCapacity: null, cargoLegs: 2 }),
    { cargoCapacity: null, cargoEfficiencyPercent: null }
  );
  assert.deepEqual(
    calculateCargoEfficiency({ cargoVolume: 1000, fleetCargoCapacity: 1000, cargoLegs: 0 }),
    { cargoCapacity: null, cargoEfficiencyPercent: null }
  );
});

test('cargo volume is summed by UTC date, fleet, and assignment', () => {
  const totals = buildCargoVolumeByFleetDayAssignment([
    { isoDate: '2026-07-24', fleet: 'Freight One', assignment: 'Transport', cargoVolume: 600 },
    { isoDate: '2026-07-24', fleet: 'Freight One', assignment: 'Transport', cargoVolume: 400 },
    { isoDate: '2026-07-24', fleet: 'Freight One', assignment: 'Supply Chain', cargoVolume: 250 },
    { isoDate: '2026-07-25', fleet: 'Freight One', assignment: 'Transport', cargoVolume: 300 },
  ]);

  assert.equal(totals.get('2026-07-24\nfreight one\nTransport'), 1000);
  assert.equal(totals.get('2026-07-24\nfreight one\nSupply Chain'), 250);
  assert.equal(totals.get('2026-07-25\nfreight one\nTransport'), 300);
});

test('Cargo Earnings exposes volume, leg capacity, and efficiency columns', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const renderer = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  const html = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');

  assert.match(main, /totalCargoCapacity/);
  assert.match(main, /cargoLegs: Number\(cargoRow\.txsDaily\) \|\| 0/);
  assert.match(main, /buildCargoVolumeByFleetDayAssignment\(cargoAllocations\)/);
  assert.match(main, /row\.cargoEfficiencyPercent = efficiency\.cargoEfficiencyPercent/);
  assert.match(renderer, /id: 'cargoVolume', label: 'Cargo Volume'/);
  assert.match(renderer, /id: 'cargoCapacity', label: 'Cargo Capacity'/);
  assert.match(renderer, /id: 'cargoEfficiency', label: 'Cargo Efficiency'/);
  assert.match(html, /<th scope="col">Cargo Volume<\/th>\s*<th scope="col">Cargo Capacity<\/th>\s*<th scope="col">Cargo Efficiency<\/th>/);
});

test('Breakeven labels represented landed cost as Total Cost per unit', () => {
  const renderer = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  const html = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');

  assert.match(renderer, /id: 'landedCost', label: 'Total Cost \/ Unit'/);
  assert.match(html, /<th>Total Cost \/ Unit<\/th>/);
  assert.doesNotMatch(renderer, /Landed Cost/);
  assert.doesNotMatch(html, /Landed Cost/);
});
