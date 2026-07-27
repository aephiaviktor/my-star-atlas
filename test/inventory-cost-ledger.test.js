const test = require('node:test');
const assert = require('node:assert/strict');
const { InventoryCostLedger, COST_SOURCES } = require('../electron/inventory-cost-ledger');

function close(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be close to ${expected}`);
}

test('acquisitions blend source contributions into a weighted-average cost basis', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'MUD-1', asset: 'Carbon', quantity: 100, source: 'mining', totalCost: 20 });
  ledger.acquire({ location: 'MUD-1', asset: 'Carbon', quantity: 50, source: 'lm', totalCost: 20 });

  const carbon = ledger.get('MUD-1', 'Carbon');
  assert.equal(carbon.quantity, 150);
  close(carbon.costPerUnit.mining, 20 / 150);
  close(carbon.costPerUnit.lm, 20 / 150);
  close(carbon.baseCostPerUnit, 40 / 150);
  close(carbon.totalCostPerUnit, 40 / 150);
});

test('partial transfer preserves every base-source contribution and adds cargo cost', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'MUD-1', asset: 'Carbon', quantity: 100, source: 'mining', totalCost: 20 });
  ledger.acquire({ location: 'MUD-1', asset: 'Carbon', quantity: 100, source: 'gm', totalCost: 40 });
  ledger.transfer({ origin: 'MUD-1', destination: 'MUD-2', asset: 'Carbon', quantity: 50, cargoCost: 5 });

  const origin = ledger.get('MUD-1', 'Carbon');
  const destination = ledger.get('MUD-2', 'Carbon');
  assert.equal(origin.quantity, 150);
  assert.equal(destination.quantity, 50);
  close(destination.costPerUnit.mining, 0.1);
  close(destination.costPerUnit.gm, 0.2);
  close(destination.baseCostPerUnit, 0.3);
  close(destination.cargoCostPerUnit, 0.1);
  close(destination.totalCostPerUnit, 0.4);
});

test('crafting carries upstream source and cargo costs and adds only direct conversion cost to Crafting', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'CSS', asset: 'Carbon', quantity: 100, source: 'mining', totalCost: 10, cargoCost: 2 });
  ledger.acquire({ location: 'CSS', asset: 'Steel', quantity: 50, source: 'lm', totalCost: 20 });

  ledger.craft({
    location: 'CSS',
    outputAsset: 'Framework',
    outputQuantity: 10,
    ingredients: [
      { asset: 'Carbon', quantity: 20 },
      { asset: 'Steel', quantity: 10 },
    ],
    craftingCost: 3,
  });

  const framework = ledger.get('CSS', 'Framework');
  assert.equal(framework.quantity, 10);
  close(framework.costPerUnit.mining, 0.2);
  close(framework.costPerUnit.lm, 0.4);
  close(framework.costPerUnit.crafting, 0.3);
  close(framework.baseCostPerUnit, 0.9);
  close(framework.cargoCostPerUnit, 0.04);
  close(framework.totalCostPerUnit, 0.94);
});

test('uncosted opening quantity remains explicit and is consumed proportionally', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'ONI-1', asset: 'Iron', quantity: 80 });
  ledger.acquire({ location: 'ONI-1', asset: 'Iron', quantity: 20, source: 'mining', totalCost: 10 });

  const consumed = ledger.consume({ location: 'ONI-1', asset: 'Iron', quantity: 50 });
  close(consumed.uncostedQuantity, 40);
  close(consumed.costs.mining, 5);
  const remaining = ledger.get('ONI-1', 'Iron');
  close(remaining.uncostedQuantity, 40);
  close(remaining.costs.mining, 5);
});

test('a crafted batch is fully marked uncosted when any consumed ingredient lacks basis', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'CSS', asset: 'Carbon', quantity: 10 });
  ledger.acquire({ location: 'CSS', asset: 'Steel', quantity: 10, source: 'mining', totalCost: 5 });
  ledger.craft({
    location: 'CSS',
    outputAsset: 'Framework',
    outputQuantity: 4,
    ingredients: [{ asset: 'Carbon', quantity: 2 }, { asset: 'Steel', quantity: 2 }],
    craftingCost: 1,
  });
  assert.equal(ledger.get('CSS', 'Framework').uncostedQuantity, 4);
});

test('failed crafting validates all ingredients before mutating inventory', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'CSS', asset: 'Carbon', quantity: 10, source: 'mining', totalCost: 5 });
  assert.throws(
    () => ledger.craft({
      location: 'CSS',
      outputAsset: 'Framework',
      outputQuantity: 1,
      ingredients: [{ asset: 'Carbon', quantity: 2 }, { asset: 'Steel', quantity: 1 }],
      craftingCost: 1,
    }),
    /insufficient inventory/,
  );
  assert.equal(ledger.get('CSS', 'Carbon').quantity, 10);
  assert.equal(ledger.get('CSS', 'Framework').quantity, 0);
});

test('events are applied chronologically rather than in input order', () => {
  const ledger = new InventoryCostLedger();
  ledger.applyEvents([
    { type: 'transfer', timestamp: '2026-07-25T10:10:00Z', origin: 'MUD-1', destination: 'MUD-2', asset: 'Fuel', quantity: 5, cargoCost: 1 },
    { type: 'acquire', timestamp: '2026-07-25T10:00:00Z', location: 'MUD-1', asset: 'Fuel', quantity: 10, source: 'gm', totalCost: 20 },
  ]);

  assert.equal(ledger.get('MUD-1', 'Fuel').quantity, 5);
  assert.equal(ledger.get('MUD-2', 'Fuel').quantity, 5);
  close(ledger.get('MUD-2', 'Fuel').totalCostPerUnit, 2.2);
});

test('ledger snapshots restore exact quantities and weighted basis', () => {
  const original = new InventoryCostLedger();
  original.acquire({ location: 'MUD-1', asset: 'Carbon', quantity: 8 });
  original.acquire({ location: 'MUD-1', asset: 'Carbon', quantity: 2, source: 'mining', totalCost: 3, cargoCost: 1 });
  const restored = InventoryCostLedger.fromSnapshot(original.snapshot());
  assert.deepEqual(restored.snapshot(), original.snapshot());
});

test('ledger snapshot restore rejects malformed or inconsistent rows', () => {
  assert.throws(() => InventoryCostLedger.fromSnapshot([{ location: 'MUD-1', asset: 'Carbon', quantity: -1, uncostedQuantity: 0, costs: {}, cargoCost: 0 }]), /quantity/);
  assert.throws(() => InventoryCostLedger.fromSnapshot([{ location: 'MUD-1', asset: 'Carbon', quantity: 1, uncostedQuantity: 2, costs: {}, cargoCost: 0 }]), /uncostedQuantity/);
});

test('invalid sources and overdrafts fail instead of silently corrupting the ledger', () => {
  const ledger = new InventoryCostLedger();
  assert.deepEqual(COST_SOURCES, ['scanning', 'mining', 'crafting', 'lm', 'gm']);
  assert.throws(
    () => ledger.acquire({ location: 'MUD-1', asset: 'Iron', quantity: 1, source: 'cargo', totalCost: 1 }),
    /invalid cost source/,
  );
  ledger.acquire({ location: 'MUD-1', asset: 'Iron', quantity: 1, source: 'mining', totalCost: 1 });
  assert.throws(
    () => ledger.consume({ location: 'MUD-1', asset: 'Iron', quantity: 2 }),
    /insufficient inventory/,
  );
});
