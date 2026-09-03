'use strict';

const { canonicalAssetName } = require('./asset-name');
const { projectInventoryBasisSnapshotRows } = require('./inventory-basis-snapshot');

function escapeFluxString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeFaction(value) {
  const faction = String(value || '').trim().toUpperCase();
  return faction === 'UST' ? 'USTUR' : faction;
}

function buildInventoryBasisSnapshotFlux(bucket, scope = null) {
  const scopeFilter = scope ? `
  |> filter(fn: (r) => r.faction == "${escapeFluxString(normalizeFaction(scope.faction))}"
    and r.starbase == "${escapeFluxString(scope.starbase)}" and r.asset == "${escapeFluxString(scope.asset)}")` : '';
  return `from(bucket: "${escapeFluxString(bucket)}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "inventory_basis_snapshot")${scopeFilter}
  |> pivot(rowKey: ["_time", "snapshotId", "faction", "starbase", "asset"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ["_time", "snapshotId", "faction", "starbase", "asset", "eventId", "quantity", "knownQuantity", "uncostedQuantity", "knownInventoryValueAtlas", "weightedAveragePriceAtlas", "scanningCostAtlas", "miningCostAtlas", "craftingCostAtlas", "lmCostAtlas", "gmCostAtlas", "cargoCostAtlas"])
  |> sort(columns: ["_time", "snapshotId"])`;
}

function inventoryBasisScopesFromEvents(events = []) {
  const scopes = new Map();
  for (const event of events || []) {
    if (String(event?.eventType || '').toLowerCase() !== 'withdraw') continue;
    const faction = normalizeFaction(event?.faction);
    const starbase = String(event?.starbase || '').trim();
    const asset = canonicalAssetName(event?.asset);
    if (!faction || !starbase || !asset) continue;
    scopes.set(`${faction}\n${starbase}\n${asset}`, { faction, starbase, asset });
  }
  return [...scopes.values()].sort((left, right) => left.faction.localeCompare(right.faction)
    || left.starbase.localeCompare(right.starbase) || left.asset.localeCompare(right.asset));
}

function inventoryBasisScopesFromAssetFlows(flows = []) {
  const scopes = new Map();
  for (const flow of flows || []) {
    const faction = normalizeFaction(flow?.faction);
    const starbase = String(flow?.starbase || '').trim();
    const asset = canonicalAssetName(flow?.asset);
    if (!faction || !starbase || !asset) continue;
    scopes.set(`${faction}\n${starbase}\n${asset}`, { faction, starbase, asset });
  }
  return [...scopes.values()].sort((left, right) => left.faction.localeCompare(right.faction)
    || left.starbase.localeCompare(right.starbase) || left.asset.localeCompare(right.asset));
}

async function readInventoryBasisSnapshots({ bucket, query, scopes = null } = {}) {
  if (!String(bucket || '').trim() || typeof query !== 'function') return [];
  const selectedScopes = Array.isArray(scopes) ? scopes : null;
  if (selectedScopes && !selectedScopes.length) return [];
  if (!selectedScopes) return projectInventoryBasisSnapshotRows(await query(buildInventoryBasisSnapshotFlux(bucket)));
  const rows = [];
  for (const scope of selectedScopes) rows.push(...await query(buildInventoryBasisSnapshotFlux(bucket, scope)));
  return projectInventoryBasisSnapshotRows(rows);
}

module.exports = {
  buildInventoryBasisSnapshotFlux, inventoryBasisScopesFromEvents, inventoryBasisScopesFromAssetFlows,
  readInventoryBasisSnapshots,
};
