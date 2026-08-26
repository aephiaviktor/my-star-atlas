'use strict';

const { formatInventoryBasisSnapshotInfluxLine } = require('./inventory-basis-snapshot');

async function publishInventoryBasisSnapshots(snapshots, { writeLines, batchSize = 64 } = {}) {
  const unique = Array.from(new Map((snapshots || []).map((snapshot) => [snapshot?.snapshotId, snapshot])).values());
  if (!unique.length) return { confirmedSnapshotIds: [], pendingSnapshots: [], error: '' };
  if (typeof writeLines !== 'function') return { confirmedSnapshotIds: [], pendingSnapshots: unique, error: 'inventory_basis_writer_not_configured' };
  const size = Number.isInteger(batchSize) && batchSize > 0 ? Math.min(batchSize, 128) : 64;
  const confirmedSnapshotIds = [];
  for (let index = 0; index < unique.length; index += size) {
    const batch = unique.slice(index, index + size);
    const lines = batch.map(formatInventoryBasisSnapshotInfluxLine);
    if (lines.some((line) => !line)) {
      return { confirmedSnapshotIds, pendingSnapshots: unique.slice(index), error: 'invalid_inventory_basis_snapshot' };
    }
    try {
      await writeLines(lines.join('\n'));
      confirmedSnapshotIds.push(...batch.map((snapshot) => snapshot.snapshotId));
    } catch (error) {
      return {
        confirmedSnapshotIds,
        pendingSnapshots: unique.slice(index),
        error: String(error?.message || error || 'inventory_basis_publication_failed').slice(0, 240),
      };
    }
  }
  return { confirmedSnapshotIds, pendingSnapshots: [], error: '' };
}

module.exports = { publishInventoryBasisSnapshots };
