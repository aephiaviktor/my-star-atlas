'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  joinCanonicalCostsWithOperationalRows,
  operationalCargoDigest,
  canonicalOperationalSection,
} = require('../electron/cargo-table-projection');
const { cargoFleetAccountFromCycleId } = require('../electron/influx-data');

const cost = (overrides = {}) => ({
  isoDate: '2026-08-05', faction: 'MUD', instance: 'MUD', fleetAccount: 'fleet-a', fleet: 'fleet-a',
  allocationKey: 'fleet:fleet-a', allocationStatus: 'scoped', sourceMode: 'canonical_raw',
  burnedFuelExact: '12.5', burnedFuel: 12.5, txFeeLamports: '5001', txCostSolExact: '0.000005001',
  txCostSol: 0.000005001, txsDaily: 3,
  fuelValuation: { status: 'complete', amountATLExact: '1.25', amountATL: 1.25, eventDay: '2026-08-05', priceDay: '2026-08-05' },
  solValuation: { status: 'complete', amountATLExact: '0.5', amountATL: 0.5, eventDay: '2026-08-05', priceDay: '2026-08-05' },
  sourceIds: ['a', 'b'], ...overrides,
});
const op = (overrides = {}) => ({
  isoDate: '2026-08-05', faction: 'MUD', instance: 'MUD', fleetAccount: 'fleet-a', fleet: 'CF-05|01',
  assignment: 'Transport', txsDaily: 318, completedCycleIds: Array.from({ length: 29 }, (_, i) => `c${i + 1}`),
  cargoCycles: 29, cargoLegs: 58, starbases: ['MRZ-5'], travelTimeByMode: { warp: 100, subwarp: 50 },
  cargoVolume: 1140512, fleetCargoCapacity: 39332, ...overrides,
});

const scannerNames = ['Baleen Whale Fleet', 'EMPIRIA-F4-1', 'SF01-OPOD', 'SF02-RANGER', 'SF03-RAYFARM', 'SF04-CHI', 'SF05-CHI', 'SF08-RANGER'];

test('authoritative fleet account is extracted from immutable cycle identity', () => {
  assert.equal(cargoFleetAccountFromCycleId('2jLH4L71cSTRRBzCLpshhsfPTJAmVaYHmNZ1AK3wZsBp:2,-23:1785886870821'), '2jLH4L71cSTRRBzCLpshhsfPTJAmVaYHmNZ1AK3wZsBp');
  assert.equal(cargoFleetAccountFromCycleId('CF-05|01'), null);
});

test('canonical stored SLYA assignments map to exactly one operational section', () => {
  assert.equal(canonicalOperationalSection('Scan'), 'scanning');
  assert.equal(canonicalOperationalSection('Mine'), 'mining');
  assert.equal(canonicalOperationalSection('Transport'), 'cargo');
  assert.equal(canonicalOperationalSection('Supply Chain'), 'cargo');
  assert.equal(canonicalOperationalSection('Cargo'), 'cargo');
  assert.equal(canonicalOperationalSection(''), null);
});

test('transaction or rental cost alone cannot create a Cargo row and Unallocated remains reconciliation-only', () => {
  const rows = joinCanonicalCostsWithOperationalRows({
    costRows: [
      cost({ fleetAccount: 'tx-only', fleet: 'Tx Only', txsDaily: 99 }),
      cost({ fleetAccount: 'rental-only', fleet: 'Rental Only', rentalRateAtlasPerDay: 12 }),
      cost({ fleetAccount: '', fleet: null, allocationKey: 'unallocated:v1:MUD:MUD:2026-08-05:sol_fee', allocationStatus: 'unallocated' }),
    ],
    operationalRows: [],
  });
  assert.deepEqual(rows, []);
});

test('all eight USTUR2 scanners and mining fleets are absent regardless of transactions or costs', () => {
  const operationalRows = [
    ...scannerNames.map((fleet, i) => op({ faction: 'UST', instance: 'USTUR2', fleetAccount: `scanner-${i}`, fleet, assignment: 'Scan' })),
    op({ fleetAccount: 'miner', fleet: 'MF-01', assignment: 'Mine' }),
  ];
  const costRows = operationalRows.map((row) => cost({ faction: row.faction, instance: row.instance, fleetAccount: row.fleetAccount, fleet: row.fleet, txsDaily: 50 }));
  assert.deepEqual(joinCanonicalCostsWithOperationalRows({ costRows, operationalRows }), []);
});

test('Cargo/Transport authoritative row is included once and fully populated', () => {
  const rows = joinCanonicalCostsWithOperationalRows({ costRows: [cost()], operationalRows: [op()] });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.fleet, 'CF-05|01');
  assert.equal(row.assignment, 'Transport');
  assert.equal(row.txsDaily, 3);
  assert.equal(row.cargoCycles, 29);
  assert.equal(row.cargoLegs, 58);
  assert.deepEqual(row.starbases, ['MRZ-5']);
  assert.equal(row.cargoVolume, 1140512);
  assert.equal(row.fleetCargoCapacity, 39332);
  assert.equal(row.burnedFuelExact, '12.5');
  assert.equal(row.operationalStatus, 'joined');
});

test('operational Cargo row without cost still renders deterministic numeric zero costs', () => {
  const [row] = joinCanonicalCostsWithOperationalRows({ operationalRows: [op()] });
  assert.equal(row.sourceMode, 'canonical_raw');
  assert.equal(row.txsDaily, 318);
  assert.equal(row.burnedFuel, 0);
  assert.equal(row.txFeeLamports, '0');
  assert.equal(row.fuelValuation.amountATL, 0);
  assert.equal(row.solValuation.amountATL, 0);
});

test('historical assignment changes apply by fleet-day without rewriting another date', () => {
  const operationalRows = [
    op({ isoDate: '2026-08-04', assignment: 'Scan' }),
    op({ isoDate: '2026-08-05', assignment: 'Transport' }),
  ];
  const rows = joinCanonicalCostsWithOperationalRows({
    costRows: [cost({ isoDate: '2026-08-04' }), cost({ isoDate: '2026-08-05' })], operationalRows,
  });
  assert.deepEqual(rows.map((row) => [row.isoDate, row.assignment]), [['2026-08-05', 'Transport']]);
});

test('multiple operational fragments become one fleet-day and rental/cost data is attached once', () => {
  const a = op({ completedCycleIds: ['c1'], cargoCycles: 1, cargoLegs: 2, travelTimeByMode: { warp: 20, subwarp: 0 }, cargoVolume: 500 });
  const b = op({ completedCycleIds: ['c2'], cargoCycles: 1, cargoLegs: 2, travelTimeByMode: { warp: 30, subwarp: 0 }, cargoVolume: 600 });
  const priced = cost({ rentalRateAtlasPerDay: 17 });
  const forward = joinCanonicalCostsWithOperationalRows({ costRows: [priced], operationalRows: [a, b] });
  const reverse = joinCanonicalCostsWithOperationalRows({ costRows: [priced], operationalRows: [b, a] });
  assert.equal(forward.length, 1);
  assert.equal(forward[0].cargoCycles, 2);
  assert.equal(forward[0].cargoLegs, 4);
  assert.equal(forward[0].cargoVolume, 1100);
  assert.equal(forward[0].rentalRateAtlasPerDay, 17);
  assert.deepEqual(forward, reverse);
  assert.equal(operationalCargoDigest(forward), operationalCargoDigest(reverse));
});

test('CF-05|01 preserves the B3.9-2D reference operational values', () => {
  const [row] = joinCanonicalCostsWithOperationalRows({ costRows: [cost({ txsDaily: 318 })], operationalRows: [op()] });
  assert.deepEqual({ assignment: row.assignment, txsDaily: row.txsDaily, cargoCycles: row.cargoCycles, cargoLegs: row.cargoLegs, starbase: row.starbases[0], cargoVolume: row.cargoVolume, cargoCapacity: row.fleetCargoCapacity * row.cargoLegs }, {
    assignment: 'Transport', txsDaily: 318, cargoCycles: 29, cargoLegs: 58, starbase: 'MRZ-5', cargoVolume: 1140512, cargoCapacity: 2281256,
  });
  assert.ok(Math.abs((row.cargoVolume / (row.fleetCargoCapacity * row.cargoLegs)) * 100 - 49.9949) < 0.0001);
});

test('Cargo UI keeps all 15 columns, shows zero, cycle legs, and no valuation badges or placeholders', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
  const columns = ['Date', 'Fleet', 'Txs Daily', 'Cycles Daily', 'Assignment', 'Travel Mode (time)', 'Starbase', 'Fuel Costs', 'Rental Costs', 'Txs Costs', 'Total Costs', 'Txs Costs Pct', 'Cargo Volume', 'Cargo Capacity', 'Cargo Efficiency'];
  for (const column of columns) assert.match(html, new RegExp(`<th scope="col">${column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/th>`));
  assert.match(renderer, /entry\.cargoCycles[\s\S]*entry\.cargoLegs[\s\S]*cycles \/[\s\S]*legs/);
  assert.doesNotMatch(renderer, /incomplete-valuation-indicator|provisional-valuation-indicator|Incomplete valuation|fallback price day/);
  assert.match(renderer, /value == null \? '--' : formatter\(value\)/);
});

test('join/projection adds no RPC, timer, polling, pricing, or refresh behavior', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'cargo-table-projection.js'), 'utf8');
  assert.doesNotMatch(source, /Connection\(|getAccountInfo|fetch\(|setInterval|setTimeout|poll|refresh|priceATL/i);
});
