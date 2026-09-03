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

test('known pool unit basis prices the complete authoritative inventory quantity', () => {
  const [row] = projectInventoryCostLedgerRows({
    ledgerRows: [ledgerRow()],
    valuationRows: [{
      starbase: 'MUD-PHANTOM', asset: 'Electronics', inventory: 16_509_526,
      ledgerQuantity: 105, knownCostQuantity: 105, reconciliationStatus: 'surplus',
    }],
  });
  assert.equal(row.quantity, 16_509_526);
  assert.equal(row.knownCostQuantity, 16_509_526);
  assert.equal(row.uncostedQuantity, 0);
  assert.ok(Math.abs(row.costs.mining - 16_509_526 * 0.04 / 105) < 1e-9);
  assert.ok(Math.abs(row.costs.crafting - 16_509_526 * 0.03 / 105) < 1e-9);
  assert.ok(Math.abs(row.cargoCost - 16_509_526 * 0.09 / 105) < 1e-9);
  assert.ok(Math.abs(row.totalCostPerUnit - 0.16 / 105) < 1e-12);
  assert.equal(row.basisStatus, 'estimated');
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

test('inventory shortfall changes quantity without changing the known pool unit basis', () => {
  const [row] = projectInventoryCostLedgerRows({
    ledgerRows: [ledgerRow({ quantity: 100, uncostedQuantity: 20, costs: { scanning: 0, mining: 40, crafting: 0, lm: 0, gm: 0 }, cargoCost: 0 })],
    valuationRows: [{ starbase: 'MUD-PHANTOM', asset: 'Electronics', inventory: 50, reconciliationStatus: 'shortfall' }],
  });
  assert.equal(row.quantity, 50);
  assert.equal(row.knownCostQuantity, 50);
  assert.equal(row.uncostedQuantity, 0);
  assert.equal(row.costs.mining, 25);
  assert.equal(row.totalCostPerUnit, 0.5);
});

test('authoritative deposit basis prices every current unit independently of stale ledger coverage', () => {
  const [row] = projectInventoryCostLedgerRows({
    ledgerRows: [ledgerRow({ location: 'MUD-1', asset: 'Ammunition', quantity: 3_167_109,
      uncostedQuantity: 1_558_772, costs: { scanning: 0, mining: 0, crafting: 0, lm: 0, gm: 1_222.38 }, cargoCost: 3.92 })],
    valuationRows: [{ starbase: 'MUD-1', asset: 'Ammunition', inventory: 3_167_109, reconciliationStatus: 'reconciled' }],
    poolBasisRows: [{ location: 'MUD-1', asset: 'Ammunition', timestamp: '2026-09-03T07:00:00Z',
      unitCosts: { scanning: 0, mining: 0, crafting: 0, lm: 0, gm: 0.00100229 }, cargoCostPerUnit: 0 }],
  });
  assert.equal(row.knownCostQuantity, 3_167_109);
  assert.equal(row.uncostedQuantity, 0);
  assert.equal(row.costs.gm, 3_167_109 * 0.00100229);
  assert.equal(row.totalCostPerUnit, 0.00100229);
  assert.equal(row.basisStatus, 'priced');
});

test('multiple priced deposits average only their costed evidence then price the complete inventory', () => {
  const [row] = projectInventoryCostLedgerRows({
    ledgerRows: [ledgerRow({
      location: 'MUD-1', asset: 'Electronics', quantity: 12_000_000, uncostedQuantity: 10_000_000,
      costs: { scanning: 0, mining: 0, crafting: 0, lm: 0, gm: 9_000 }, cargoCost: 0,
    })],
    valuationRows: [{ starbase: 'MUD-1', asset: 'Electronics', inventory: 12_000_000, reconciliationStatus: 'reconciled' }],
  });
  assert.equal(row.knownCostQuantity, 12_000_000);
  assert.equal(row.uncostedQuantity, 0);
  assert.ok(Math.abs(row.totalCostPerUnit - 0.0045) < 1e-12);
  assert.ok(Math.abs(row.costs.gm - 54_000) < 1e-9);
  assert.equal(row.basisStatus, 'estimated');
});
