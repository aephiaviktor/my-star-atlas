'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectInventoryCostLedgerRows } = require('../electron/inventory-cost-ledger-view');

function ledgerRow(overrides = {}) {
  return {
    location: 'MUD-PHANTOM', asset: 'Electronics', quantity: 105, uncostedQuantity: 0,
    costs: { scanning: 0, mining: 0.04, crafting: 0.03, lm: 0, gm: 0 }, cargoCost: 0.09,
    ...overrides,
  };
}

test('positive inventory surplus is shown as uncosted without inventing basis', () => {
  const [row] = projectInventoryCostLedgerRows({
    ledgerRows: [ledgerRow()],
    valuationRows: [{
      starbase: 'MUD-PHANTOM', asset: 'Electronics', inventory: 16_509_526,
      ledgerQuantity: 105, knownCostQuantity: 105, reconciliationStatus: 'surplus',
    }],
  });
  assert.equal(row.quantity, 16_509_526);
  assert.equal(row.knownCostQuantity, 105);
  assert.equal(row.uncostedQuantity, 16_509_421);
  assert.deepEqual(row.costs, { scanning: 0, mining: 0.04, crafting: 0.03, lm: 0, gm: 0 });
  assert.equal(row.cargoCost, 0.09);
  assert.equal(row.totalCostPerUnit, 0.16 / 105);
});

test('current inventory with no ledger evidence is entirely uncosted', () => {
  const [row] = projectInventoryCostLedgerRows({
    valuationRows: [{ starbase: 'MUD-PHANTOM', asset: 'Framework', inventory: 95_926_496, reconciliationStatus: 'surplus' }],
  });
  assert.equal(row.quantity, 95_926_496);
  assert.equal(row.knownCostQuantity, 0);
  assert.equal(row.uncostedQuantity, 95_926_496);
  assert.equal(row.totalCostPerUnit, null);
});

test('inventory shortfall preserves weighted coverage and unit basis', () => {
  const [row] = projectInventoryCostLedgerRows({
    ledgerRows: [ledgerRow({ quantity: 100, uncostedQuantity: 20, costs: { scanning: 0, mining: 40, crafting: 0, lm: 0, gm: 0 }, cargoCost: 0 })],
    valuationRows: [{ starbase: 'MUD-PHANTOM', asset: 'Electronics', inventory: 50, reconciliationStatus: 'shortfall' }],
  });
  assert.equal(row.quantity, 50);
  assert.equal(row.knownCostQuantity, 40);
  assert.equal(row.uncostedQuantity, 10);
  assert.equal(row.costs.mining, 20);
  assert.equal(row.totalCostPerUnit, 0.5);
});
