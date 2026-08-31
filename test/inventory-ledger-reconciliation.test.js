'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InventoryCostLedger } = require('../electron/inventory-cost-ledger');
const { reconcileInventoryLedger } = require('../electron/inventory-ledger-reconciliation');
const { buildCostLedgerResult } = require('../electron/production-ledger-events');

function pool(ledger) {
  return ledger.get('MUD-PHANTOM', 'Framework');
}

test('current inventory surplus becomes explicit uncosted quantity', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'MUD-PHANTOM', asset: 'Framework', quantity: 1_067, source: 'crafting', totalCost: 1.5 });
  const adjustments = reconcileInventoryLedger({
    ledger,
    inventoryRows: [{ starbase: 'MUD-PHANTOM', asset: 'Framework', quantity: 95_926_496, lastDate: '2026-08-31T20:00:00Z' }],
  });
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].quantity, 95_925_429);
  assert.equal(pool(ledger).quantity, 95_926_496);
  assert.equal(pool(ledger).uncostedQuantity, 95_925_429);
  assert.equal(pool(ledger).costs.crafting, 1.5);
});

test('later inventory consumption depletes reconciled uncosted stock before known basis', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'MUD-PHANTOM', asset: 'Framework', quantity: 1_067, source: 'crafting', totalCost: 1.5 });
  reconcileInventoryLedger({ ledger, inventoryRows: [{ starbase: 'MUD-PHANTOM', asset: 'Framework', quantity: 95_926_496 }] });
  reconcileInventoryLedger({ ledger, inventoryRows: [{ starbase: 'MUD-PHANTOM', asset: 'Framework', quantity: 95_925_592 }] });
  assert.equal(pool(ledger).quantity, 95_925_592);
  assert.equal(pool(ledger).uncostedQuantity, 95_924_525);
  assert.equal(pool(ledger).quantity - pool(ledger).uncostedQuantity, 1_067);
  assert.equal(pool(ledger).costs.crafting, 1.5);
});

test('chronological upgrading consumes reconciled uncosted stock before known component basis', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'MUD-PHANTOM', asset: 'Framework', quantity: 1_067, source: 'crafting', totalCost: 1.5 });
  reconcileInventoryLedger({ ledger, inventoryRows: [{ starbase: 'MUD-PHANTOM', asset: 'Framework', quantity: 95_926_496 }] });
  const result = buildCostLedgerResult({
    initialLedger: ledger,
    upgradingRows: [{ timestamp: '2026-08-31T21:00:00Z', starbase: 'MUD-PHANTOM', asset: 'Framework', installed: 904 }],
  });
  const consumed = result.appliedEventResults.find(({ event }) => event.purpose === 'upgrading');
  assert.equal(consumed.result.uncostedQuantity, 904);
  assert.equal(consumed.result.costs.crafting, 0);
  assert.equal(result.ledger.get('MUD-PHANTOM', 'Framework').quantity - result.ledger.get('MUD-PHANTOM', 'Framework').uncostedQuantity, 1_067);
  assert.equal(result.ledger.get('MUD-PHANTOM', 'Framework').costs.crafting, 1.5);
});

test('explicit zero inventory reconciles the pool to empty in uncosted-first order', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'MUD-PHANTOM', asset: 'Framework', quantity: 90 });
  ledger.acquire({ location: 'MUD-PHANTOM', asset: 'Framework', quantity: 10, source: 'crafting', totalCost: 5 });
  const [adjustment] = reconcileInventoryLedger({ ledger, inventoryRows: [{ starbase: 'MUD-PHANTOM', asset: 'Framework', quantity: 0 }] });
  assert.equal(adjustment.result.uncostedQuantity, 90);
  assert.equal(adjustment.result.costs.crafting, 5);
  assert.equal(pool(ledger).quantity, 0);
  assert.equal(pool(ledger).uncostedQuantity, 0);
  assert.equal(pool(ledger).costs.crafting, 0);
});

test('new known inventory grows the costed pool after reconciliation', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'MUD-PHANTOM', asset: 'Framework', quantity: 100, source: 'crafting', totalCost: 100 });
  reconcileInventoryLedger({ ledger, inventoryRows: [{ starbase: 'MUD-PHANTOM', asset: 'Framework', quantity: 1_000 }] });
  ledger.acquire({ location: 'MUD-PHANTOM', asset: 'Framework', quantity: 100, source: 'lm', totalCost: 200 });
  assert.equal(pool(ledger).quantity, 1_100);
  assert.equal(pool(ledger).uncostedQuantity, 900);
  assert.equal(pool(ledger).quantity - pool(ledger).uncostedQuantity, 200);
  assert.equal(pool(ledger).totalCostPerUnit, 300 / 200);
});
