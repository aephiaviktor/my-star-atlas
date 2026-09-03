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

test('uncosted opening quantity is consumed before the costed weighted-average pool', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'ONI-1', asset: 'Iron', quantity: 80 });
  ledger.acquire({ location: 'ONI-1', asset: 'Iron', quantity: 20, source: 'mining', totalCost: 10 });

  const consumed = ledger.consume({ location: 'ONI-1', asset: 'Iron', quantity: 50 });
  close(consumed.uncostedQuantity, 50);
  close(consumed.costs.mining, 0);
  const remaining = ledger.get('ONI-1', 'Iron');
  close(remaining.quantity, 50);
  close(remaining.uncostedQuantity, 30);
  close(remaining.costs.mining, 10);
});

test('known-cost inventory grows and stabilizes its weighted average while uncosted stock depletes first', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({ location: 'MUD-PHANTOM', asset: 'Framework', quantity: 900 });
  ledger.acquire({ location: 'MUD-PHANTOM', asset: 'Framework', quantity: 100, source: 'crafting', totalCost: 100 });
  ledger.consume({ location: 'MUD-PHANTOM', asset: 'Framework', quantity: 200 });
  ledger.acquire({ location: 'MUD-PHANTOM', asset: 'Framework', quantity: 100, source: 'lm', totalCost: 200 });

  const framework = ledger.get('MUD-PHANTOM', 'Framework');
  assert.equal(framework.quantity, 900);
  assert.equal(framework.uncostedQuantity, 700);
  assert.equal(framework.quantity - framework.uncostedQuantity, 200);
  assert.equal(framework.costs.crafting, 100);
  assert.equal(framework.costs.lm, 200);
  close((framework.costs.crafting + framework.costs.lm) / 200, 1.5);
});

test('partial known costs remain attached to an entirely uncosted lot during depletion', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquireLot({
    location: 'MUD-1', asset: 'Framework', quantity: 10, uncostedQuantity: 10,
    costs: { crafting: 5 }, cargoCost: 2,
  });
  const consumed = ledger.consume({ location: 'MUD-1', asset: 'Framework', quantity: 4 });
  close(consumed.costs.crafting, 2);
  close(consumed.uncostedCosts.crafting, 2);
  close(consumed.cargoCost, 0.8);
  const remaining = ledger.get('MUD-1', 'Framework');
  close(remaining.costs.crafting, 3);
  close(remaining.uncostedCosts.crafting, 3);
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

test('inventory reconciliation resets stale pooled basis before a later exact deposit', () => {
  const ledger = new InventoryCostLedger();
  ledger.applyEvents([
    { type: 'acquire', timestamp: '2026-09-01T06:00:00Z', location: 'MUD-1', asset: 'Ammunition', quantity: 10_646_326, source: 'gm', totalCost: 8_465.74 },
    { type: 'reconcile', timestamp: '2026-09-03T06:59:59Z', location: 'MUD-1', asset: 'Ammunition', quantity: 0 },
    { type: 'acquire-lot', timestamp: '2026-09-03T07:00:00Z', location: 'MUD-1', asset: 'Ammunition', quantity: 5_000_000, costs: { gm: 5_011.45 } },
    { type: 'consume', timestamp: '2026-09-03T08:00:00Z', location: 'MUD-1', asset: 'Ammunition', quantity: 1_374_668 },
  ]);

  const ammunition = ledger.get('MUD-1', 'Ammunition');
  assert.equal(ammunition.quantity, 3_625_332);
  assert.equal(ammunition.uncostedQuantity, 0);
  close(ammunition.knownCosts.gm, 3_625_332 * 0.00100229);
  close(ammunition.totalCostPerUnit, 0.00100229);
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
