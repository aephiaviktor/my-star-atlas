'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InventoryCostLedger } = require('../electron/inventory-cost-ledger');
const { buildCostLedgerResult, eventFingerprint } = require('../electron/production-ledger-events');

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} != ${expected}`);
const costs = (overrides = {}) => ({ scanning: 0, mining: 0, crafting: 0, lm: 0, gm: 0, ...overrides });
function assertLot(row, expected) {
  close(row.quantity, expected.quantity, 'quantity');
  close(row.uncostedQuantity, expected.uncostedQuantity || 0, 'uncostedQuantity');
  for (const source of Object.keys(costs())) close(row.costs[source], expected.costs[source], `${source} cost`);
  close(row.cargoCost, expected.cargoCost, 'cargo cost');
  const known = row.quantity - row.uncostedQuantity;
  const base = known > 0 ? Object.values(row.costs).reduce((a, b) => a + b, 0) / known : null;
  const cargo = known > 0 ? row.cargoCost / known : null;
  assert.equal(base == null, expected.baseCostPerUnit == null);
  if (base != null) close(base, expected.baseCostPerUnit, 'base/unit');
  if (cargo != null) close(cargo, expected.cargoCostPerUnit, 'cargo/unit');
  const total = base == null ? null : base + cargo;
  assert.equal(total == null, expected.totalCostPerUnit == null);
  if (total != null) close(total, expected.totalCostPerUnit, 'total/unit');
  assert.equal(expected.status, row.uncostedQuantity > 0 ? 'Incomplete' : 'Complete');
}

test('golden 1 — scanned SDU production', () => {
  const r = buildCostLedgerResult({ scanningRows: [{ isoDate: '2026-08-01', sduFound: 100, totalCostsAtlas: 5, productionByStarbase: [{ starbase: 'UST-1', quantity: 100 }] }] });
  assertLot(r.ledger.get('UST-1', 'Survey Data Unit'), { quantity: 100, costs: costs({ scanning: 5 }), cargoCost: 0, baseCostPerUnit: .05, cargoCostPerUnit: 0, totalCostPerUnit: .05, status: 'Complete' });
});

test('golden 2 — multi-resource mining allocates one shared cost pool exactly once', () => {
  const l = new InventoryCostLedger(); l.acquire({ location: 'UST-1', asset: 'Carbon', quantity: 60, source: 'mining', totalCost: 6 }); l.acquire({ location: 'UST-1', asset: 'Iron Ore', quantity: 40, source: 'mining', totalCost: 4 });
  assertLot(l.get('UST-1', 'Carbon'), { quantity: 60, costs: costs({ mining: 6 }), cargoCost: 0, baseCostPerUnit: .1, cargoCostPerUnit: 0, totalCostPerUnit: .1, status: 'Complete' });
  assertLot(l.get('UST-1', 'Iron Ore'), { quantity: 40, costs: costs({ mining: 4 }), cargoCost: 0, baseCostPerUnit: .1, cargoCostPerUnit: 0, totalCostPerUnit: .1, status: 'Complete' });
  close(l.get('UST-1', 'Carbon').costs.mining + l.get('UST-1', 'Iron Ore').costs.mining, 10, 'shared pool');
});

test('golden 3 — LM purchase includes price, marketplace fee, and transaction fee once', () => {
  const l = new InventoryCostLedger(); l.acquire({ location: 'UST-1', asset: 'Food', quantity: 10, source: 'lm', totalCost: 12.3 });
  assertLot(l.get('UST-1', 'Food'), { quantity: 10, costs: costs({ lm: 12.3 }), cargoCost: 0, baseCostPerUnit: 1.23, cargoCostPerUnit: 0, totalCostPerUnit: 1.23, status: 'Complete' });
});

test('golden 4 — pending GM purchase remains at wallet and is not faction basis', () => {
  const l = new InventoryCostLedger(); l.acquire({ location: 'wallet:gm', asset: 'Fuel', quantity: 20, source: 'gm', totalCost: 8 });
  assertLot(l.get('wallet:gm', 'Fuel'), { quantity: 20, costs: costs({ gm: 8 }), cargoCost: 0, baseCostPerUnit: .4, cargoCostPerUnit: 0, totalCostPerUnit: .4, status: 'Complete' });
  assert.equal(l.get('UST-1', 'Fuel').quantity, 0);
});

test('golden 5 — GM lot supports whole and split proven destination attribution', () => {
  const l = new InventoryCostLedger(); l.acquire({ location: 'wallet:gm', asset: 'Fuel', quantity: 30, source: 'gm', totalCost: 12 }); l.transfer({ origin: 'wallet:gm', destination: 'MUD-1', asset: 'Fuel', quantity: 10 }); l.transfer({ origin: 'wallet:gm', destination: 'UST-1', asset: 'Fuel', quantity: 20 });
  assertLot(l.get('MUD-1', 'Fuel'), { quantity: 10, costs: costs({ gm: 4 }), cargoCost: 0, baseCostPerUnit: .4, cargoCostPerUnit: 0, totalCostPerUnit: .4, status: 'Complete' });
  assertLot(l.get('UST-1', 'Fuel'), { quantity: 20, costs: costs({ gm: 8 }), cargoCost: 0, baseCostPerUnit: .4, cargoCostPerUnit: 0, totalCostPerUnit: .4, status: 'Complete' });
});

test('golden 6 — crafting carries ingredient basis and adds conversion basis', () => {
  const l = new InventoryCostLedger(); l.acquire({ location: 'UST-1', asset: 'Carbon', quantity: 10, source: 'mining', totalCost: 5 }); l.craft({ location: 'UST-1', outputAsset: 'Framework', outputQuantity: 2, ingredients: [{ asset: 'Carbon', quantity: 10 }], craftingCost: 3 });
  assertLot(l.get('UST-1', 'Framework'), { quantity: 2, costs: costs({ mining: 5, crafting: 3 }), cargoCost: 0, baseCostPerUnit: 4, cargoCostPerUnit: 0, totalCostPerUnit: 4, status: 'Complete' });
});

test('golden 7 — cargo transfer carries basis and adds Fuel/Rental/TXS once', () => {
  const l = new InventoryCostLedger(); l.acquire({ location: 'UST-1', asset: 'Carbon', quantity: 100, source: 'mining', totalCost: 20 }); l.transfer({ origin: 'UST-1', destination: 'UST-2', asset: 'Carbon', quantity: 40, cargoCost: 4 });
  assertLot(l.get('UST-2', 'Carbon'), { quantity: 40, costs: costs({ mining: 8 }), cargoCost: 4, baseCostPerUnit: .2, cargoCostPerUnit: .1, totalCostPerUnit: .3, status: 'Complete' });
});

test('golden 8 — sale consumes weighted inventory basis and yields COGS', () => {
  const l = new InventoryCostLedger(); l.acquire({ location: 'UST-1', asset: 'Food', quantity: 10, source: 'lm', totalCost: 20 }); const cogs = l.consume({ location: 'UST-1', asset: 'Food', quantity: 4 });
  close(cogs.costs.lm, 8, 'COGS base'); close(cogs.cargoCost, 0, 'COGS cargo');
  assertLot(l.get('UST-1', 'Food'), { quantity: 6, costs: costs({ lm: 12 }), cargoCost: 0, baseCostPerUnit: 2, cargoCostPerUnit: 0, totalCostPerUnit: 2, status: 'Complete' });
});

test('golden 9 — missing opening history is Incomplete, never zero cost', () => {
  const l = new InventoryCostLedger(); l.acquire({ location: 'UST-1', asset: 'Biomass', quantity: 7 });
  assertLot(l.get('UST-1', 'Biomass'), { quantity: 7, uncostedQuantity: 7, costs: costs(), cargoCost: 0, baseCostPerUnit: null, cargoCostPerUnit: null, totalCostPerUnit: null, status: 'Incomplete' });
});

test('golden 10 — quantity and basis reconcile across split transfer and consume', () => {
  const l = new InventoryCostLedger(); l.acquire({ location: 'A', asset: 'X', quantity: 10, source: 'mining', totalCost: 5 }); l.transfer({ origin: 'A', destination: 'B', asset: 'X', quantity: 4, cargoCost: 1 }); const used = l.consume({ location: 'B', asset: 'X', quantity: 1 });
  close(l.get('A', 'X').quantity + l.get('B', 'X').quantity + used.quantity, 10, 'quantity reconciliation'); close(l.get('A', 'X').costs.mining + l.get('B', 'X').costs.mining + used.costs.mining, 5, 'basis reconciliation');
});

test('golden 11 — tiny nonzero basis remains distinct from genuine zero', () => {
  const l = new InventoryCostLedger(); l.acquire({ location: 'A', asset: 'Tiny', quantity: 2, source: 'mining', totalCost: 0.00000002 }); l.acquire({ location: 'A', asset: 'Zero', quantity: 2, source: 'mining', totalCost: 0 });
  close(l.get('A', 'Tiny').baseCostPerUnit, 0.00000001, 'tiny'); assert.equal(l.get('A', 'Zero').baseCostPerUnit, 0);
});

test('golden 12 — replay fingerprint rejects an already checkpointed source event', () => {
  const row = { isoDate: '2026-08-01', starbase: 'UST-1', rawMaterial: 'Carbon', mined: 5, totalCostsAtlas: 2 }; const first = buildCostLedgerResult({ miningRows: [row] }); const second = buildCostLedgerResult({ initialLedger: first.ledger, eventFingerprintCounts: first.eventFingerprintCounts, miningRows: [row] });
  assert.equal(second.skippedDuplicateEvents.length, 1); assert.equal(second.appliedEvents.length, 0); assert.equal(second.ledger.get('UST-1', 'Carbon').quantity, 5); assert.equal(eventFingerprint(first.events[0]), first.seenEventFingerprints[0]);
});
