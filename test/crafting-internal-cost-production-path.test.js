'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCostLedgerResult } = require('../electron/production-ledger-events');
const { InventoryCostLedger } = require('../electron/inventory-cost-ledger');
const { buildCraftingBasisByDay, buildCurrentInventoryCraftingBasisByDay, enrichCraftingEarningsRows } = require('../electron/crafting-cost-basis');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');

function craftRow(overrides = {}) {
  return {
    isoDate: '2026-08-08', timestamp: '2026-08-08T12:00:00.000Z', starbase: 'ONI-1', output: 'Framework', crafted: 2,
    ingredients: [{ input: 'Carbon', amount: 10 }], feeAmount: 1, txCostSol: 0.02, crew: 3, txsDaily: 1,
    ...overrides,
  };
}

function appliedFor({ totalCost = 50, openingUncosted = false, duplicate = false } = {}) {
  const craftingRows = [{ ...craftRow(), feeCostsAtlas: 1, txsCostsAtlas: 2 }];
  const options = openingUncosted
    ? { openingInventoryRows: [{ timestamp: '2026-08-07T00:00:00.000Z', starbase: 'ONI-1', asset: 'Carbon', quantity: 10 }], craftingRows }
    : { miningRows: [{ isoDate: '2026-08-07', starbase: 'ONI-1', rawMaterial: 'Carbon', mined: 10, totalCostsAtlas: totalCost }], craftingRows: duplicate ? [...craftingRows, ...craftingRows] : craftingRows };
  return buildCostLedgerResult(options).appliedEventResults;
}

const resolvePrice = (asset) => ({ Framework: 40, Carbon: 5 }[asset] ?? null);

test('populated internal ingredient basis drives every dependent Crafting formula', () => {
  const basis = buildCraftingBasisByDay(appliedFor());
  const [row] = enrichCraftingEarningsRows({ craftingRows: [craftRow()], craftingBasisByDay: basis, resolvePrice, atlasPerSol: 100 });
  assert.deepEqual({ ingredient: row.ingCostsAtlas, total: row.totalCostsAtlas, net: row.netProfitAtlas, perCrew: row.netProfitPerCrew, perUnit: row.costsPerUnitAtlas, margin: row.profitMarginPercent }, {
    ingredient: 50, total: 53, net: 27, perCrew: 9, perUnit: 26.5, margin: 33.75,
  });
});

test('uncosted ingredient evidence propagates unavailable through all dependent fields', () => {
  const basis = buildCraftingBasisByDay(appliedFor({ openingUncosted: true }));
  const [row] = enrichCraftingEarningsRows({ craftingRows: [craftRow()], craftingBasisByDay: basis, resolvePrice, atlasPerSol: 100 });
  for (const field of ['ingCostsAtlas', 'totalCostsAtlas', 'netProfitAtlas', 'netProfitPerCrew', 'costsPerUnitAtlas', 'profitMarginPercent']) assert.equal(row[field], null);
});

test('observed zero basis remains numeric zero rather than missing', () => {
  const basis = buildCraftingBasisByDay(appliedFor({ totalCost: 0 }));
  const [row] = enrichCraftingEarningsRows({ craftingRows: [craftRow({ feeAmount: 0, txCostSol: 0 })], craftingBasisByDay: basis, resolvePrice, atlasPerSol: 100 });
  assert.equal(row.ingCostsAtlas, 0);
  assert.equal(row.totalCostsAtlas, 0);
  assert.equal(row.netProfitAtlas, 80);
  assert.equal(row.profitMarginPercent, 100);
});

test('recipe identity is exact by UTC day, starbase, and output symbol', () => {
  const basis = buildCraftingBasisByDay(appliedFor());
  for (const changed of [
    craftRow({ isoDate: '2026-08-07' }), craftRow({ starbase: 'ONI-2' }), craftRow({ output: 'Framework Mint' }),
  ]) {
    const [row] = enrichCraftingEarningsRows({ craftingRows: [changed], craftingBasisByDay: basis, resolvePrice, atlasPerSol: 100 });
    assert.equal(row.ingCostsAtlas, null);
  }
});

test('faction-isolated inputs and replayed crafting events cannot duplicate basis', () => {
  const once = buildCraftingBasisByDay(appliedFor());
  const duplicated = buildCraftingBasisByDay(appliedFor({ duplicate: true }));
  assert.equal(once.get('2026-08-08\nONI-1\nFramework').basis, 50);
  assert.equal(duplicated.get('2026-08-08\nONI-1\nFramework').basis, 50);
  assert.equal(once.has('2026-08-08\nMUD-1\nFramework'), false);
});

test('temporary 30-day internal basis values historical ingredients from current same-starbase inventory basis', () => {
  const basis = buildCurrentInventoryCraftingBasisByDay({
    craftingRows: [
      craftRow({ isoDate: '2026-08-07', starbase: 'MRZ-18', output: 'Food', ingredients: [{ input: 'Biomass', amount: 1000 }] }),
      craftRow({ isoDate: '2026-08-08', starbase: 'MRZ-18', output: 'Food', ingredients: [{ input: 'Biomass', amount: 2000 }] }),
    ],
    inventoryRows: [{ location: 'MRZ-18', asset: 'Biomass', quantity: 258569622, uncostedQuantity: 0, totalCostPerUnit: 0.00017987791641945792 }],
  });
  assert.equal(basis.get('2026-08-07\nMRZ-18\nFood').basis, 0.17987791641945792);
  assert.equal(basis.get('2026-08-08\nMRZ-18\nFood').basis, 0.35975583283891584);
});

test('current inventory basis remains unavailable across starbases or with uncosted inventory', () => {
  const rows = [craftRow({ starbase: 'MRZ-20', ingredients: [{ input: 'Biomass', amount: 1000 }] })];
  assert.equal(buildCurrentInventoryCraftingBasisByDay({
    craftingRows: rows,
    inventoryRows: [{ location: 'MRZ-18', asset: 'Biomass', quantity: 1000, uncostedQuantity: 0, totalCostPerUnit: 1 }],
  }).get('2026-08-08\nMRZ-20\nFramework').uncosted, true);
  assert.equal(buildCurrentInventoryCraftingBasisByDay({
    craftingRows: rows,
    inventoryRows: [{ location: 'MRZ-20', asset: 'Biomass', quantity: 1000, uncostedQuantity: 1, totalCostPerUnit: 1 }],
  }).get('2026-08-08\nMRZ-20\nFramework').uncosted, true);
});

test('crafting price resolvers receive the historical row date for assets and SOL', () => {
  const seen = [];
  const [row] = enrichCraftingEarningsRows({
    craftingRows: [craftRow({ isoDate: '2026-08-30', txCostSol: 0.01 })],
    craftingBasisByDay: new Map(),
    resolvePrice: (asset, date) => { seen.push(`${asset}:${date}`); return asset === 'Framework' ? 4 : 2; },
    resolveSolPrice: (date) => { seen.push(`SOL:${date}`); return 100; },
  });
  assert.ok(seen.every((entry) => entry.endsWith(':2026-08-30')));
  assert.equal(row.outputPriceAtl, 4);
  assert.equal(row.txsCostsAtlas, 1);
});

test('chronological WIP combines purchased and immediately crafted ingredients without ending inventory', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'ONI-1', asset: 'Copper Ore', quantity: 10, source: 'mining', totalCost: 20 });
  ledger.acquire({ location: 'ONI-1', asset: 'Copper', quantity: 2, source: 'lm', totalCost: 6 });
  const result = buildCostLedgerResult({
    initialLedger: ledger,
    craftingRows: [
      craftRow({ timestamp: '2026-08-08T10:00:00Z', output: 'Copper', crafted: 10, ingredients: [{ input: 'Copper Ore', amount: 10 }], feeCostsAtlas: 2, txsCostsAtlas: 0 }),
      craftRow({ timestamp: '2026-08-08T11:00:00Z', output: 'Ammunition', crafted: 5, ingredients: [{ input: 'Copper', amount: 12 }], feeCostsAtlas: 1, txsCostsAtlas: 0 }),
    ],
  });
  const basis = buildCraftingBasisByDay(result.appliedEventResults);
  assert.equal(result.rejectedEvents.length, 0);
  assert.equal(result.ledger.get('ONI-1', 'Copper').quantity, 0);
  assert.equal(basis.get('2026-08-08\nONI-1\nAmmunition').basis, 28);
  assert.equal(result.ledger.get('ONI-1', 'Ammunition').costs.lm, 6);
  assert.equal(result.ledger.get('ONI-1', 'Ammunition').costs.mining, 20);
  assert.equal(result.ledger.get('ONI-1', 'Ammunition').costs.crafting, 3);
});

test('upgrading consumes the carried basis of a component crafted immediately beforehand', () => {
  const result = buildCostLedgerResult({
    miningRows: [{ isoDate: '2026-08-07', starbase: 'ONI-1', rawMaterial: 'Carbon', mined: 10, totalCostsAtlas: 20 }],
    craftingRows: [craftRow({ timestamp: '2026-08-08T10:00:00Z', output: 'Framework', crafted: 1, ingredients: [{ input: 'Carbon', amount: 10 }], feeCostsAtlas: 2, txsCostsAtlas: 0 })],
    upgradingRows: [{ timestamp: '2026-08-08T11:00:00Z', isoDate: '2026-08-08', starbase: 'ONI-1', asset: 'Framework', installed: 1 }],
  });
  const consumed = result.appliedEventResults.find(({ event }) => event.type === 'consume' && event.purpose === 'upgrading');
  assert.ok(consumed);
  assert.equal(consumed.result.costs.mining, 20);
  assert.equal(consumed.result.costs.crafting, 2);
  assert.equal(consumed.result.uncostedQuantity, 0);
});

test('automatic prefetch requests ledger-backed Crafting snapshot through IPC and renderer fails margin closed', () => {
  assert.match(renderer, /api\.getEarningsSnapshot\(\{ \.\.\.settings, earningsSubtab: 'crafting' \}\)/);
  assert.match(main, /needsInventoryLedger = \['breakeven', 'crafting', 'upgrading'\]\.includes\(snapshotScope\)/);
  assert.match(main, /buildCraftingBasisByDay\(inventoryCostLedgerAppliedEventResults\)/);
  assert.match(renderer, /columnId === 'profitMargin'\) return createTextCell\(entry\.profitMarginPercent == null \? '--'/);
});
