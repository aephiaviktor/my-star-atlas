'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInventoryBasisSnapshot } = require('../electron/inventory-basis-snapshot');
const { publishInventoryBasisSnapshots } = require('../electron/inventory-basis-publication');

function snapshot(index) {
  return createInventoryBasisSnapshot({ faction: 'MUD', starbase: 'MUD-1', asset: 'Carbon', timestamp: `2026-08-01T00:00:0${index}Z`, eventId: `event-${index}`, quantity: 10, uncostedQuantity: 0, costs: { mining: 5 }, cargoCost: 0 });
}

test('basis publisher writes deterministic batches and confirms only successful snapshot IDs', async () => {
  const calls = [];
  const rows = [snapshot(1), snapshot(2), snapshot(3)];
  const result = await publishInventoryBasisSnapshots(rows, { batchSize: 2, writeLines: async (lines) => { calls.push(lines); if (calls.length === 2) throw new Error('later batch failed'); } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].split('\n').length, 2);
  assert.deepEqual(result.confirmedSnapshotIds, rows.slice(0, 2).map((row) => row.snapshotId));
  assert.deepEqual(result.pendingSnapshots, [rows[2]]);
  assert.equal(result.error, 'later batch failed');
});

test('basis publisher deduplicates replay and performs no write for empty input', async () => {
  let writes = 0;
  const row = snapshot(1);
  const result = await publishInventoryBasisSnapshots([row, row], { writeLines: async () => { writes += 1; } });
  assert.equal(writes, 1);
  assert.deepEqual(result.confirmedSnapshotIds, [row.snapshotId]);
  const empty = await publishInventoryBasisSnapshots([], { writeLines: async () => { writes += 1; } });
  assert.deepEqual(empty, { confirmedSnapshotIds: [], pendingSnapshots: [], error: '' });
  assert.equal(writes, 1);
});
