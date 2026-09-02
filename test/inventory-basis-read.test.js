'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInventoryBasisSnapshotFlux, readInventoryBasisSnapshots, inventoryBasisScopesFromEvents,
  inventoryBasisScopesFromAssetFlows,
} = require('../electron/inventory-basis-read');
const { createInventoryBasisSnapshot } = require('../electron/inventory-basis-snapshot');

test('basis read is one bounded read-only 30-day measurement query', async () => {
  const flux = buildInventoryBasisSnapshotFlux('slya');
  assert.match(flux, /range\(start: -30d\)/);
  assert.match(flux, /_measurement == "inventory_basis_snapshot"/);
  assert.equal((flux.match(/from\(/g) || []).length, 1);
  assert.doesNotMatch(flux, /api\/v2\/write|to\(|http\./);
  let calls = 0;
  const rows = await readInventoryBasisSnapshots({ bucket: 'slya', query: async (actual) => { calls += 1; assert.equal(actual, flux); return []; } });
  assert.equal(calls, 1);
  assert.deepEqual(rows, []);
});

test('basis read accepts only canonical snapshot rows', async () => {
  const snapshot = createInventoryBasisSnapshot({ faction: 'MUD', starbase: 'MUD-1', asset: 'Carbon', timestamp: '2026-08-01T00:00:00.000Z', eventId: 'event-1', quantity: 10, uncostedQuantity: 0, costs: { mining: 5 }, cargoCost: 0 });
  const valid = { _time: snapshot.timestamp, snapshotId: snapshot.snapshotId, faction: snapshot.faction, starbase: snapshot.starbase, asset: snapshot.asset, eventId: snapshot.eventId, quantity: '10', knownQuantity: '10', uncostedQuantity: '0', knownInventoryValueAtlas: '5', weightedAveragePriceAtlas: '0.5' };
  const rows = await readInventoryBasisSnapshots({ bucket: 'slya', query: async () => [valid, { ...valid, snapshotId: 'bad' }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].weightedAveragePriceAtlas, 0.5);
});

test('Marketplace basis reads are independently scoped to exact withdrawal faction, starbase, and asset', async () => {
  const scopes = inventoryBasisScopesFromEvents([
    { eventType: 'withdraw', faction: 'UST', starbase: 'UST-1', asset: 'Iron Ore' },
    { eventType: 'withdraw', faction: 'USTUR', starbase: 'UST-1', asset: 'Iron Ore' },
    { eventType: 'gm', faction: 'USTUR', starbase: 'UST-1', asset: 'Ammo' },
  ]);
  assert.deepEqual(scopes, [{ faction: 'USTUR', starbase: 'UST-1', asset: 'Iron Ore' }]);
  const queries = [];
  await readInventoryBasisSnapshots({ bucket: 'slya', scopes, query: async (flux) => { queries.push(flux); return []; } });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /r\.faction == "USTUR"/);
  assert.match(queries[0], /r\.starbase == "UST-1"/);
  assert.match(queries[0], /r\.asset == "Iron Ore"/);
});

test('Inventory Ledger basis reads are scoped to exact custody-flow locations', () => {
  assert.deepEqual(inventoryBasisScopesFromAssetFlows([
    { faction: 'UST', starbase: 'UST-1', asset: 'Iron Ore' },
    { faction: 'USTUR', starbase: 'UST-1', asset: 'Iron Ore' },
    { faction: 'ONI', starbase: 'ONI-1', asset: 'Ammo' },
    { faction: '', starbase: 'ONI-1', asset: 'Food' },
  ]), [
    { faction: 'ONI', starbase: 'ONI-1', asset: 'Ammo' },
    { faction: 'USTUR', starbase: 'UST-1', asset: 'Iron Ore' },
  ]);
});
