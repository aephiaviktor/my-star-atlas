'use strict';

const { projectInventoryBasisSnapshotRows } = require('./inventory-basis-snapshot');

function escapeFluxString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildInventoryBasisSnapshotFlux(bucket) {
  return `from(bucket: "${escapeFluxString(bucket)}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "inventory_basis_snapshot")
  |> pivot(rowKey: ["_time", "snapshotId", "faction", "starbase", "asset"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ["_time", "snapshotId", "faction", "starbase", "asset", "eventId", "quantity", "knownQuantity", "uncostedQuantity", "knownInventoryValueAtlas", "weightedAveragePriceAtlas", "scanningCostAtlas", "miningCostAtlas", "craftingCostAtlas", "lmCostAtlas", "gmCostAtlas", "cargoCostAtlas"])
  |> sort(columns: ["_time", "snapshotId"])`;
}

async function readInventoryBasisSnapshots({ bucket, query } = {}) {
  if (!String(bucket || '').trim() || typeof query !== 'function') return [];
  const rows = await query(buildInventoryBasisSnapshotFlux(bucket));
  return projectInventoryBasisSnapshotRows(rows);
}

module.exports = { buildInventoryBasisSnapshotFlux, readInventoryBasisSnapshots };
