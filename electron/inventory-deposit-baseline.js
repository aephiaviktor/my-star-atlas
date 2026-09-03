'use strict';

const { canonicalAssetName } = require('./asset-name');

const MAX_DEPOSIT_BASELINE_SCOPES = 128;

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

module.exports = {
  MAX_DEPOSIT_BASELINE_SCOPES,
  buildInventoryDepositBaselineQuery,
  projectInventoryDepositBaselineRows,
};
