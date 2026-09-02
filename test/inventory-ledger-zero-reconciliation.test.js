'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InventoryCostLedger } = require('../electron/inventory-cost-ledger');
const { reconcileInventoryLedger } = require('../electron/inventory-ledger-reconciliation');

test('reconciliation consumes ledger pools omitted from current zero inventory', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'UST-1', asset: 'Copper Wire', quantity: 100, costs: { crafting: 25 } });
  const adjustments = reconcileInventoryLedger({ ledger, inventoryRows: [] });
  assert.equal(adjustments.length, 1);
  assert.deepEqual({
    type: adjustments[0].type,
    purpose: adjustments[0].purpose,
    location: adjustments[0].location,
    asset: adjustments[0].asset,
    quantity: adjustments[0].quantity,
  }, {
    type: 'consume', purpose: 'inventory-reconciliation', location: 'UST-1', asset: 'Copper Wire', quantity: 100,
  });
  assert.equal(ledger.get('UST-1', 'Copper Wire').quantity, 0);
});
