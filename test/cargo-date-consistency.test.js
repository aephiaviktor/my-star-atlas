'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectCargoFleetDateRows } = require('../electron/cargo-table-projection');
const { buildCargoVolumeByFleetDayAssignment } = require('../electron/earnings-math');
const { enrichCargoAllocationRows } = require('../electron/influx-data');
const { requireSameDateCargoPrice, requireCargoFuelPrice } = require('../electron/cargo-cost-source');

const row = (overrides = {}) => ({
  profile: 'Profile-A', faction: 'MUD', fleetAccount: 'account-a', fleetName: 'Hauler', fleet: 'Hauler',
  isoDate: '2026-08-05', timestamp: '2026-08-05T01:00:00.000Z', assignment: 'Transport',
  burnedFuel: 1, fuelCostsAtlas: 2, txCostSol: 0.1, txsCostsAtlas: 3, totalCostsAtlas: 5,
  txsDaily: 1, cargoCycles: 1, cargoLegs: 2, cargoVolume: 10, fleetCargoCapacity: 100,
  completedCycleIds: ['cycle-a'], starbases: ['MRZ-1'], ...overrides,
});

test('one authoritative fleet remains two rows across consecutive Cargo dates and All Dates', () => {
  const rows = projectCargoFleetDateRows([
    row({ isoDate: '2026-08-05', timestamp: '2026-08-05T23:59:00Z', burnedFuel: 5 }),
    row({ isoDate: '2026-08-06', timestamp: '2026-08-06T00:01:00Z', burnedFuel: 7 }),
  ], { profile: 'Profile-A', faction: 'MUD' });
  assert.deepEqual(rows.map((entry) => [entry.isoDate, entry.fleetAccount, entry.burnedFuel]), [
    ['2026-08-06', 'account-a', 7], ['2026-08-05', 'account-a', 5],
  ]);
});

test('differently timed measurements on one canonical Cargo date aggregate into one row', () => {
  const rows = projectCargoFleetDateRows([
    row({ timestamp: '2026-08-05T00:01:00Z', burnedFuel: 2, fuelCostsAtlas: 4, completedCycleIds: ['a'] }),
    row({ timestamp: '2026-08-05T23:59:59Z', burnedFuel: 3, fuelCostsAtlas: 6, completedCycleIds: ['b'] }),
  ], { profile: 'Profile-A', faction: 'MUD' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].burnedFuel, 5);
  assert.equal(rows[0].fuelCostsAtlas, 10);
  assert.deepEqual(rows[0].completedCycleIds, ['a', 'b']);
});

test('selected Cargo date includes only same-date evidence and never carries missing evidence', () => {
  const rows = projectCargoFleetDateRows([
    row({ isoDate: '2026-08-05', fuelCostsAtlas: 9, totalCostsAtlas: 9 }),
    row({ isoDate: '2026-08-06', timestamp: '2026-08-06T04:00:00Z', fuelCostsAtlas: null, totalCostsAtlas: null }),
  ], { profile: 'Profile-A', faction: 'MUD', selectedDate: '2026-08-06' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isoDate, '2026-08-06');
  assert.equal(rows[0].fuelCostsAtlas, null);
  assert.equal(rows[0].totalCostsAtlas, null);
});

test('Cargo valuation accepts a positive historical fallback without converting it to zero', () => {
  const fallback = { status: 'provisional', priceATL: 2, priceDay: '2026-08-05' };
  assert.equal(requireSameDateCargoPrice(fallback, '2026-08-06'), fallback);
  assert.equal(requireSameDateCargoPrice({ status: 'complete', priceATL: 3, priceDay: '2026-08-06' }, '2026-08-06').priceATL, 3);
});

test('Cargo Fuel accepts exact and resolver fallback prices for the effective event day', () => {
  const exact = { status: 'complete', priceATL: 2, priceDay: '2026-08-10', effectiveUtcDate: '2026-08-10', source: 'aephia_historical' };
  const provisional = { status: 'provisional', priceATL: 0.00102448, priceATLExact: '0.00102448', priceDay: '2026-08-04', effectiveUtcDate: '2026-08-10', source: 'provisional_seed_carry_forward' };
  assert.equal(requireCargoFuelPrice(exact, '2026-08-10'), exact);
  assert.equal(requireCargoFuelPrice(provisional, '2026-08-10'), provisional);
  for (const price of [
    { ...exact, effectiveUtcDate: '2026-08-09' },
    { ...provisional, effectiveUtcDate: '2026-08-09' },
    { ...provisional, priceATL: 0, priceATLExact: '0' },
    { ...provisional, priceATL: -1, priceATLExact: '-1' },
    { ...provisional, priceATL: NaN, priceATLExact: 'bad' },
  ]) assert.equal(requireCargoFuelPrice(price, '2026-08-10').status, 'incomplete');
});

test('reused display labels never merge distinct authoritative fleet accounts', () => {
  const rows = projectCargoFleetDateRows([
    row({ fleetAccount: 'account-a', fleetName: 'Hauler', burnedFuel: 2 }),
    row({ fleetAccount: 'account-b', fleetName: 'Hauler', burnedFuel: 3 }),
  ], { profile: 'Profile-A', faction: 'MUD' });
  assert.deepEqual(rows.map((entry) => [entry.fleetAccount, entry.burnedFuel]), [['account-a', 2], ['account-b', 3]]);
});

test('Cargo projection isolates profile and faction and orders date then account deterministically', () => {
  const input = [
    row({ profile: 'Profile-B', fleetAccount: 'account-z' }),
    row({ faction: 'ONI', fleetAccount: 'account-y' }),
    row({ isoDate: '2026-08-04', fleetAccount: 'account-c' }),
    row({ fleetAccount: 'account-b' }),
    row({ fleetAccount: 'account-a' }),
  ];
  const forward = projectCargoFleetDateRows(input, { profile: 'Profile-A', faction: 'MUD' });
  const reverse = projectCargoFleetDateRows([...input].reverse(), { profile: 'Profile-A', faction: 'MUD' });
  assert.deepEqual(forward.map((entry) => [entry.isoDate, entry.fleetAccount]), [
    ['2026-08-05', 'account-a'], ['2026-08-05', 'account-b'], ['2026-08-04', 'account-c'],
  ]);
  assert.deepEqual(forward, reverse);
});

test('Cargo allocation enrichment and volume join prefer account identity over reused labels', () => {
  const fleetA = { key: 'account-a', label: 'Hauler', ownership: 'owned' };
  const fleetB = { key: 'account-b', label: 'Hauler', ownership: 'managed' };
  const enriched = enrichCargoAllocationRows([
    { isoDate: '2026-08-05', fleet: 'Hauler', fleetAccount: 'account-b', assignment: 'Transport', cargoVolume: 30 },
  ], new Map([['hauler', fleetA]]), (value) => String(value).toLowerCase(), new Map([['account-a', fleetA], ['account-b', fleetB]]));
  assert.equal(enriched[0].fleetAccount, 'account-b');
  assert.equal(enriched[0].ownership, 'managed');
  const totals = buildCargoVolumeByFleetDayAssignment(enriched);
  assert.equal(totals.get('2026-08-05\naccount-b\nTransport'), 30);
  assert.equal(totals.has('2026-08-05\nhauler\nTransport'), false);
});

test('Cargo date consistency patch adds no RPC, fetch, timer, or background-refresh path', () => {
  const source = ['cargo-table-projection.js', 'influx-data.js', 'earnings-math.js'].map((file) => fs.readFileSync(path.join(__dirname, '..', 'electron', file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /Connection\(|getAccountInfo|fetch\(|setInterval|setTimeout|background.?refresh/i);
});
