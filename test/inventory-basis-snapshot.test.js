'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInventoryBasisSnapshot,
  formatInventoryBasisSnapshotInfluxLine,
  projectInventoryBasisSnapshotRows,
} = require('../electron/inventory-basis-snapshot');

test('inventory basis snapshot derives known weighted basis for one faction starbase asset pool', () => {
  const snapshot = createInventoryBasisSnapshot({
    faction: 'UST', starbase: 'UST-1', asset: 'Electronics', timestamp: '2026-08-01T00:00:00Z', eventId: 'event-1',
    quantity: 100, uncostedQuantity: 20, costs: { mining: 80, gm: 40 }, cargoCost: 20,
  });
  assert.deepEqual(snapshot, {
    snapshotId: snapshot.snapshotId,
    faction: 'USTUR', starbase: 'UST-1', asset: 'Electronics', timestamp: '2026-08-01T00:00:00.000Z', eventId: 'event-1',
    quantity: 100, knownQuantity: 80, uncostedQuantity: 20, knownInventoryValueAtlas: 140, weightedAveragePriceAtlas: 1.75,
  });
  assert.match(snapshot.snapshotId, /^[a-f0-9]{64}$/);
});

test('inventory basis line and Influx projection preserve the canonical pool observation', () => {
  const snapshot = createInventoryBasisSnapshot({
    faction: 'MUD', starbase: 'MRZ-20', asset: 'Carbon', timestamp: '2026-08-02T03:04:05Z', eventId: 'event-2',
    quantity: 50, uncostedQuantity: 0, costs: { mining: 25 }, cargoCost: 5,
  });
  const line = formatInventoryBasisSnapshotInfluxLine(snapshot);
  assert.match(line, /^inventory_basis_snapshot,snapshotId=[a-f0-9]{64},faction=MUD,starbase=MRZ-20,asset=Carbon /);
  assert.match(line, /quantity=50,knownQuantity=50,uncostedQuantity=0,knownInventoryValueAtlas=30,weightedAveragePriceAtlas=0\.6,eventId="event-2"/);
  const projected = projectInventoryBasisSnapshotRows([{
    _time: snapshot.timestamp, snapshotId: snapshot.snapshotId, faction: 'MUD', starbase: 'MRZ-20', asset: 'Carbon',
    eventId: 'event-2', quantity: '50', knownQuantity: '50', uncostedQuantity: '0', knownInventoryValueAtlas: '30', weightedAveragePriceAtlas: '0.6',
  }]);
  assert.deepEqual(projected, [snapshot]);
});

test('invalid or empty known basis is rejected instead of publishing misleading price', () => {
  assert.equal(createInventoryBasisSnapshot({ faction: 'ONI', starbase: 'ONI-1', asset: 'Food', timestamp: 'bad', eventId: 'x', quantity: 1 }), null);
  assert.equal(createInventoryBasisSnapshot({ faction: 'ONI', starbase: 'ONI-1', asset: 'Food', timestamp: '2026-08-01T00:00:00Z', eventId: 'x', quantity: 10, uncostedQuantity: 10, costs: {}, cargoCost: 0 }), null);
  assert.deepEqual(projectInventoryBasisSnapshotRows([{ _time: 'bad' }]), []);
});
