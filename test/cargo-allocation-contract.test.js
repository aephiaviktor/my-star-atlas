'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatAllocationNumber, getCargoAllocationVisibleColumns, buildCargoAllocationRenderedColumns } = require('../electron/cargo-allocation-renderer');
const { createCargoAllocationProjector } = require('../electron/cargo-allocation-projector');
const { groupCargoAllocationRows } = require('../electron/influx-data');

const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

function projector(overrides = {}) {
  const allocation = {
    isoDate: '2026-08-10', timestamp: '2026-08-10T01:00:00Z', fleet: 'Fleet', fleetAccount: 'fleet',
    cycleId: 'fleet:0,0:1', asset: 'Fuel', amount: 2, cargoVolume: 4, allocatedFuel: 1, allocatedTxCostSol: 0.25,
  };
  const deps = {
    fetchCargoRows: async () => [{ fleetAccount: 'fleet', completedCycleIds: [allocation.cycleId] }],
    fetchCompletionRows: async () => [], fetchPrices: async () => ({ atlasPerSol: 4 }), fetchRawCosts: async () => ({ records: [], rejected: [] }),
    getIncludedDays: () => ['2026-08-10'], mergeCargoRows: ({ movementRows }) => movementRows,
    cargoFleetAccountFromCycleId: () => 'fleet', filterCompleted: (rows) => rows,
    exporterForFaction: () => null, selectCutover: () => ({ cutover: null, rawRecords: [] }), valueRawCosts: async () => [],
    resolvePrice: async (asset) => asset === 'Fuel' ? ({ status: 'complete', priceATL: 3 }) : ({ status: 'complete', priceATL: 4 }),
    requireFuelPrice: (value) => value, requireSameDatePrice: (value) => value, aggregateRawCosts: () => [], applyRawCosts: (rows) => rows,
    groupRows: (rows) => rows, valueNativeCost: () => null, formatDate: () => '10 Aug',
    ...overrides,
  };
  return { run: createCargoAllocationProjector(deps), allocation };
}

test('Allocation business columns match the approved contract and order', () => {
  const block = rendererSource.slice(rendererSource.indexOf('const cargoAllocationEarningsOptionalColumns'), rendererSource.indexOf('const craftingEarningsOptionalColumns'));
  const labels = [...block.matchAll(/label: '([^']+)'/g)].map((match) => match[1]).filter((label) => !['Color', 'Ownership', 'Ships', 'Required Crew', 'Assignment'].includes(label));
  assert.deepEqual(labels, ['Allocated Amount', 'Cargo Volume', 'Allocated Fuel', 'Fuel Costs', 'TXS Costs', 'Total Cargo Costs', 'Cargo Cost/Unit']);
  for (const forbidden of ['Rental Costs', 'Base Cost/Unit', 'Total Cost/Unit']) assert.doesNotMatch(block, new RegExp(forbidden));
  assert.match(rendererSource, /Fuel Costs \+ TXS Costs/);
  assert.match(html, /Allocated Amount[\s\S]*Cargo Volume[\s\S]*Allocated Fuel[\s\S]*Fuel Costs[\s\S]*TXS Costs[\s\S]*Total Cargo Costs[\s\S]*Cargo Cost\/Unit/);
});

test('Allocation-specific formatting preserves finite nonzero values and distinguishes zero/unavailable', () => {
  for (const value of [0.25, 0.23235428464052835, 0.00000000011215801893402239, -0.25]) {
    assert.notEqual(formatAllocationNumber(value), '0');
    assert.notEqual(formatAllocationNumber(value), '--');
  }
  assert.equal(formatAllocationNumber(0), '0');
  assert.equal(formatAllocationNumber(null), '--');
  assert.equal(formatAllocationNumber(undefined), '--');
  assert.equal(formatAllocationNumber(Number.NaN), '--');
});

test('rendered Allocation columns survive legacy persisted visibility and bind every approved value', () => {
  const legacySelected = new Set(['assignment', 'amount', 'cargoVolume']);
  const row = {
    amount: 12, cargoVolume: 24, allocatedFuel: 0.25,
    fuelCostsAtlas: null, txsCostsAtlas: 0,
    totalCostsAtlas: null, costsPerUnitAtlas: 0.00000000011215801893402239,
    rentalCostsAtlas: 99, baseCostsPerUnitAtlas: 88, landedCostsPerUnitAtlas: 77,
  };
  const rendered = buildCargoAllocationRenderedColumns(row);
  const visible = getCargoAllocationVisibleColumns(rendered, legacySelected);
  assert.deepEqual(visible.map(({ label }) => label), [
    'Allocated Amount', 'Cargo Volume', 'Allocated Fuel', 'Fuel Costs', 'TXS Costs', 'Total Cargo Costs', 'Cargo Cost/Unit',
  ]);
  assert.deepEqual(visible.map(({ text }) => text), ['12', '24', '0', '--', '0', '--', '0']);
  assert.equal(visible.some(({ label }) => ['Rental Costs', 'Base Cost/Unit', 'Total Cost/Unit'].includes(label)), false);
});

test('Allocation display rounds quantities and costs with the requested column precision', () => {
  const rendered = Object.fromEntries(buildCargoAllocationRenderedColumns({
    amount: 12.345, cargoVolume: 24.678, allocatedFuel: 167.958,
    fuelCostsAtlas: 10.6, txsCostsAtlas: 0.49,
    totalCostsAtlas: 11.09, costsPerUnitAtlas: 0.123456789,
  }).map(({ id, text }) => [id, text]));
  assert.equal(rendered.amount, formatAllocationNumber(12.345));
  assert.equal(rendered.cargoVolume, formatAllocationNumber(24.678));
  assert.equal(rendered.allocatedFuel, '168');
  assert.equal(rendered.fuelCosts, '11');
  assert.equal(rendered.txsCosts, '0');
  assert.equal(rendered.totalCosts, '11');
  assert.equal(rendered.costsPerUnit, '0.123457');
});

test('Allocation projector preserves independent component availability and exact aggregate formulas', async () => {
  const { run, allocation } = projector();
  const result = await run({ faction: 'MUD' }, [allocation], {}, new AbortController().signal);
  assert.equal(result.rows[0].fuelCostsAtlas, 3);
  assert.equal(result.rows[0].txsCostsAtlas, 1);
  assert.equal(result.rows[0].totalCostsAtlas, 4);
  assert.equal(result.rows[0].costsPerUnitAtlas, 2);
  assert.equal(result.rows[0].fuelCostStatus, 'available');
  assert.equal(result.rows[0].txsCostStatus, 'available');
});

test('missing canonical raw fleet/day evidence keeps quantities visible and costs unavailable with bounded diagnostics', async () => {
  const { run, allocation } = projector({
    exporterForFaction: () => ({ faction: 'MUD', instance: 'MUD' }),
    selectCutover: ({ legacyRows }) => ({ cutover: '2026-08-05T00:00:00Z', legacyRows, rawRecords: [] }),
    applyRawCosts: (rows) => rows.map((row) => ({
      ...row,
      allocatedFuel: null,
      allocatedTxCostSol: null,
      sourceMode: 'raw_missing',
      allocationCostStatus: 'unavailable',
      allocationCostReason: 'canonical_raw_cost_missing',
    })),
  });
  const result = await run({ faction: 'MUD' }, [allocation], {}, new AbortController().signal);
  const [row] = result.rows;
  assert.equal(row.amount, 2); assert.equal(row.cargoVolume, 4);
  assert.equal(row.fuelCostsAtlas, null); assert.equal(row.txsCostsAtlas, null);
  assert.equal(row.totalCostsAtlas, null); assert.equal(row.costsPerUnitAtlas, null);
  assert.equal(row.allocationCostReason, 'canonical_raw_cost_missing');
  assert.equal(result.diagnostics.unavailableRawCostCount, 1);
  assert.equal(result.diagnostics.unavailableFuelCostCount, 1);
  assert.equal(result.diagnostics.unavailableTxsCostCount, 1);
  assert.equal(Object.values(result.diagnostics).some((value) => String(value).includes('fleet')), false);
});

test('grouping preserves unavailable canonical allocation components as null', () => {
  const [row] = groupCargoAllocationRows([
    { isoDate: '2026-08-10', fleet: 'Fleet', asset: 'Fuel', origin: 'A', destination: 'B', assignment: 'Transport', amount: 2, cargoVolume: 4, allocatedFuel: null, allocatedTxCostSol: null, sourceMode: 'raw_missing', allocationCostStatus: 'unavailable', allocationCostReason: 'canonical_raw_cost_missing' },
  ]);
  assert.equal(row.amount, 2); assert.equal(row.cargoVolume, 4);
  assert.equal(row.allocatedFuel, null); assert.equal(row.allocatedTxCostSol, null);
  assert.equal(row.allocationCostReason, 'canonical_raw_cost_missing');
});

test('missing Fuel price only invalidates Fuel and aggregate fields', async () => {
  const { run, allocation } = projector({
    resolvePrice: async (asset) => asset === 'Fuel' ? ({ status: 'incomplete', priceATL: null }) : ({ status: 'complete', priceATL: 4 }),
  });
  const { rows: [row] } = await run({ faction: 'MUD' }, [allocation], {}, new AbortController().signal);
  assert.equal(row.fuelCostsAtlas, null); assert.equal(row.fuelCostStatus, 'unavailable');
  assert.equal(row.txsCostsAtlas, 1); assert.equal(row.txsCostStatus, 'available');
  assert.equal(row.totalCostsAtlas, null); assert.equal(row.costsPerUnitAtlas, null);
});

test('missing transaction valuation only invalidates TXS and aggregate fields', async () => {
  const { run, allocation } = projector({ fetchPrices: async () => ({ atlasPerSol: null }) });
  const { rows: [row] } = await run({ faction: 'MUD' }, [allocation], {}, new AbortController().signal);
  assert.equal(row.fuelCostsAtlas, 3); assert.equal(row.fuelCostStatus, 'available');
  assert.equal(row.txsCostsAtlas, null); assert.equal(row.txsCostStatus, 'unavailable');
  assert.equal(row.totalCostsAtlas, null); assert.equal(row.costsPerUnitAtlas, null);
});

test('zero or non-positive Allocated Amount makes Cargo Cost/Unit unavailable', async () => {
  for (const amount of [0, -1]) {
    const { run, allocation } = projector();
    const { rows: [row] } = await run({ faction: 'MUD' }, [{ ...allocation, amount }], {}, new AbortController().signal);
    assert.equal(row.totalCostsAtlas, 4);
    assert.equal(row.costsPerUnitAtlas, null);
  }
});

test('Allocation remains dedicated and constructs no Solana RPC path', () => {
  const shared = main.slice(main.indexOf('async function fetchEarningsSnapshot'), main.indexOf('function createWindow'));
  assert.doesNotMatch(shared, /cargoAllocation|fetchCargoAllocation|earnings:cargo-allocation/);
  for (const file of ['cargo-allocation-source.js', 'cargo-allocation-projector.js', 'cargo-allocation-ipc.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'electron', file), 'utf8');
    assert.doesNotMatch(source, /new Connection|getAccountInfo|getMultipleAccountsInfo|getSignaturesForAddress|@solana\/web3\.js/);
  }
});
