'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLedgerBreakevenRows } = require('../electron/ledger-breakeven');

test('known weighted unit cost is extrapolated across uncosted inventory', () => {
  const [row] = buildLedgerBreakevenRows({
    ledgerRows: [{
      location: 'MRZ-17',
      asset: 'Survey Data Unit',
      quantity: 100,
      uncostedQuantity: 99,
      costs: { scanning: 0.0267 },
      cargoCost: 0,
    }],
    inventoryRows: [{ starbase: 'MRZ-17', asset: 'Survey Data Unit', quantity: 100 }],
  });

  assert.equal(row.knownCostQuantity, 1);
  assert.equal(row.estimatedPercent, 99);
  assert.equal(row.fullyTracked, false);
  assert.equal(row.scanningCostPerUnit, 0.0267);
  assert.equal(row.landedCostPerUnit, 0.0267);
  assert.equal(row.inventoryValue, 2.67);
});

test('fully reconciled and costed inventory is marked 100% tracked', () => {
  const [row] = buildLedgerBreakevenRows({
    ledgerRows: [{
      location: 'MUD-1', asset: 'Carbon', quantity: 20, uncostedQuantity: 0,
      costs: { mining: 4 }, cargoCost: 1,
    }],
    inventoryRows: [{ starbase: 'MUD-1', asset: 'Carbon', quantity: 20 }],
  });

  assert.equal(row.estimatedPercent, 0);
  assert.equal(row.fullyTracked, true);
  assert.equal(row.miningCostPerUnit, 0.2);
  assert.equal(row.cargoCostPerUnit, 0.05);
  assert.equal(row.landedCostPerUnit, 0.25);
  assert.equal(row.inventoryValue, 5);
});

test('zero known-cost quantity remains unpriced instead of inventing a basis', () => {
  const [row] = buildLedgerBreakevenRows({
    ledgerRows: [{
      location: 'UST-1', asset: 'Iron Ore', quantity: 10, uncostedQuantity: 10,
      costs: {}, cargoCost: 0,
    }],
    inventoryRows: [{ starbase: 'UST-1', asset: 'Iron Ore', quantity: 10 }],
  });

  assert.equal(row.knownCostQuantity, 0);
  assert.equal(row.estimatedPercent, 100);
  assert.equal(row.fullyTracked, false);
  assert.equal(row.baseCostPerUnit, null);
  assert.equal(row.landedCostPerUnit, null);
  assert.equal(row.inventoryValue, null);
});
