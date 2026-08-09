'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCostLedgerResult } = require('../electron/production-ledger-events');
const { buildCraftingBasisByDay, enrichCraftingEarningsRows } = require('../electron/crafting-cost-basis');

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

test('automatic prefetch requests ledger-backed Crafting snapshot through IPC and renderer fails margin closed', () => {
  assert.match(renderer, /api\.getEarningsSnapshot\(\{ \.\.\.settings, earningsSubtab: 'crafting' \}\)/);
  assert.match(main, /needsInventoryLedger = \['breakeven', 'crafting', 'upgrading'\]\.includes\(snapshotScope\)/);
  assert.match(renderer, /columnId === 'profitMargin'\) return createTextCell\(entry\.profitMarginPercent == null \? '--'/);
});
