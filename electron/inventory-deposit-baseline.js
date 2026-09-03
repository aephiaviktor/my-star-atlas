'use strict';

const { canonicalAssetName } = require('./asset-name');

const MAX_DEPOSIT_BASELINE_SCOPES = 128;
const COST_SOURCES = Object.freeze(['scanning', 'mining', 'crafting', 'lm', 'gm']);

function fluxString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function depositBaselineScopes(depositEvents = []) {
  const scopes = [];
  for (const event of depositEvents || []) {
    if (event?.type !== 'acquire-lot' || event?.basisSource !== 'marketplace-game-deposit') continue;
    const timestamp = new Date(event.timestamp);
    const location = String(event.location || '').trim();
    const asset = canonicalAssetName(event.asset);
    const flowId = String(event.flowId || '').trim();
    if (Number.isNaN(timestamp.getTime()) || !location || !asset || !flowId) continue;
    scopes.push({ index: scopes.length, timestamp: timestamp.toISOString(), location, asset, flowId });
  }
  if (scopes.length > MAX_DEPOSIT_BASELINE_SCOPES) {
    throw new Error(`inventory deposit baseline supports at most ${MAX_DEPOSIT_BASELINE_SCOPES} scopes`);
  }
  return scopes;
}

function assetFilter(asset) {
  if (canonicalAssetName(asset) === 'Ammunition') return '(r.rss == "Ammunition" or r.rss == "Ammo")';
  return `r.rss == "${fluxString(asset)}"`;
}

function buildInventoryDepositBaselineQuery({ bucket, depositEvents = [] } = {}) {
  const scopes = depositBaselineScopes(depositEvents);
  if (!scopes.length) return { flux: '', scopes };
  const tables = scopes.map((scope) => `from(bucket: "${fluxString(bucket)}")
    |> range(start: 0, stop: time(v: "${fluxString(scope.timestamp)}"))
    |> filter(fn: (r) => r._measurement == "starbase" and r._field == "curAmount")
    |> filter(fn: (r) => r.starbase == "${fluxString(scope.location)}" and ${assetFilter(scope.asset)})
    |> group()
    |> last()
    |> keep(columns: ["rss", "starbase", "_value", "_time"])
    |> set(key: "baselineIndex", value: "${scope.index}")`);
  return { flux: `union(tables: [\n${tables.join(',\n')}\n])`, scopes };
}

function projectInventoryDepositBaselineRows({ scopes = [], rows = [] } = {}) {
  const byIndex = new Map((scopes || []).map((scope) => [String(scope.index), scope]));
  const result = [];
  for (const row of rows || []) {
    const scope = byIndex.get(String(row?.baselineIndex ?? ''));
    const timestamp = new Date(row?._time);
    const quantity = Number(row?._value);
    if (!scope || Number.isNaN(timestamp.getTime()) || timestamp.getTime() >= Date.parse(scope.timestamp)
      || !Number.isFinite(quantity) || quantity < 0) continue;
    result.push({
      timestamp: timestamp.toISOString(), starbase: scope.location, asset: scope.asset, quantity,
      depositFlowId: scope.flowId,
    });
  }
  return result.sort((left, right) => left.timestamp.localeCompare(right.timestamp)
    || left.depositFlowId.localeCompare(right.depositFlowId));
}

function projectAuthoritativeDepositPoolBasisRows({ depositEvents = [], baselineRows = [] } = {}) {
  const baselineByFlowId = new Map((baselineRows || []).map((row) => [String(row?.depositFlowId || ''), row]));
  const latestDepositOrderKeyByPool = new Map();
  for (const event of depositEvents || []) {
    if (event?.basisSource !== 'marketplace-game-deposit') continue;
    const location = String(event?.location || '').trim();
    const asset = canonicalAssetName(event?.asset);
    const timestamp = new Date(event?.timestamp);
    if (!location || !asset || Number.isNaN(timestamp.getTime())) continue;
    const poolKey = `${location}\n${asset}`;
    const orderKey = `${timestamp.toISOString()}\n${String(event?.flowId || '')}`;
    if (orderKey > (latestDepositOrderKeyByPool.get(poolKey) || '')) {
      latestDepositOrderKeyByPool.set(poolKey, orderKey);
    }
  }
  const latestByPool = new Map();
  for (const event of depositEvents || []) {
    const baseline = baselineByFlowId.get(String(event?.flowId || ''));
    const quantity = Number(event?.quantity);
    const baselineQuantity = Number(baseline?.quantity);
    const timestamp = new Date(event?.timestamp);
    const location = String(event?.location || '').trim();
    const asset = canonicalAssetName(event?.asset);
    if (event?.basisSource !== 'marketplace-game-deposit' || !(quantity > 0)
      || !Number.isFinite(baselineQuantity) || baselineQuantity < 0 || baselineQuantity > 1
      || Number.isNaN(timestamp.getTime()) || !location || !asset) continue;
    const unitCosts = Object.fromEntries(COST_SOURCES.map((source) => {
      const cost = Number(event?.costs?.[source] || 0);
      return [source, Number.isFinite(cost) && cost >= 0 ? cost / quantity : 0];
    }));
    const cargoCost = Number(event?.cargoCost || 0);
    const row = {
      location, asset, timestamp: timestamp.toISOString(), unitCosts,
      cargoCostPerUnit: Number.isFinite(cargoCost) && cargoCost >= 0 ? cargoCost / quantity : 0,
      basisSource: 'marketplace-game-deposit',
    };
    const poolKey = `${location}\n${asset}`;
    const orderKey = `${row.timestamp}\n${String(event?.flowId || '')}`;
    if (orderKey !== latestDepositOrderKeyByPool.get(poolKey)) continue;
    const previous = latestByPool.get(poolKey);
    if (!previous || row.timestamp > previous.timestamp) latestByPool.set(poolKey, row);
  }
  return [...latestByPool.values()].sort((left, right) => left.location.localeCompare(right.location)
    || left.asset.localeCompare(right.asset));
}

module.exports = {
  MAX_DEPOSIT_BASELINE_SCOPES,
  buildInventoryDepositBaselineQuery,
  projectInventoryDepositBaselineRows,
  projectAuthoritativeDepositPoolBasisRows,
};
