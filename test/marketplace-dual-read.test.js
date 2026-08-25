'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const compat = require('../electron/marketplace-trade-compat');
const point = require('../electron/marketplace-v2-point');
const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

function declaration(name, nextName) {
  const prefixes = [`function ${name}`, `async function ${name}`];
  const start = Math.min(...prefixes.map((prefix) => { const at = main.indexOf(prefix); return at < 0 ? Infinity : at; }));
  const nextPrefixes = [`function ${nextName}`, `async function ${nextName}`];
  const end = Math.min(...nextPrefixes.map((prefix) => { const at = main.indexOf(prefix, start + 1); return at < 0 ? Infinity : at; }));
  assert.ok(Number.isFinite(start) && Number.isFinite(end), `extract ${name}`);
  return main.slice(start, end);
}
const scopeSource = declaration('marketplaceScopeFlux', 'fetchNewestMarketplaceTradeMs');
const newestSource = declaration('fetchNewestMarketplaceTradeMs', 'fetchMarketplaceTradesFromInflux');
const tradesSource = declaration('fetchMarketplaceTradesFromInflux', 'fetchMarketplaceAssetFlowsFromInflux');

function harness(queryImpl) {
  const factory = new Function(
    'queryInfluxFlux', 'parseInfluxCsv', 'getSelectedPlayerProfile', 'normalizeFaction', 'escapeFluxString', 'profileName',
    'normalizeMarketplaceV1Row', 'normalizeMarketplaceV2Row', 'dedupeMarketplaceRows', 'deriveMarketplaceUnionKey',
    `${scopeSource}\n${newestSource}\n${tradesSource}\nreturn { fetchNewestMarketplaceTradeMs, fetchMarketplaceTradesFromInflux };`
  );
  return factory(
    queryImpl, (text) => JSON.parse(text), (settings) => settings.playerProfile, (value) => String(value).toUpperCase(),
    (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"'), 'USTUR',
    compat.normalizeMarketplaceV1Row, compat.normalizeMarketplaceV2Row, compat.dedupeMarketplaceRows, compat.deriveMarketplaceUnionKey
  );
}
const settings = { influxBucket: 'Bucket A', playerProfile: 'PlayerKey', faction: 'USTUR' };
const v1 = { _time: '2026-08-01T00:00:00Z', tradeId: 'legacy', market: 'LM', faction: 'USTUR', profile: 'PlayerKey', signature: 'sig', rawMint: 'mint', side: 'buy', quantity: 2, settledAtlas: 20, grossAtlas: 20, marketplaceFeeAtlas: 1, netAtlas: 19, unitPriceAtlas: 10, wallet: 'wallet', starbase: 'star', asset: 'asset', certificateMint: 'cert' };
const id = point.deriveMarketplaceTradeId({ market: 'LM', faction: 'USTUR', profileScope: 'PlayerKey', executionSignature: 'sig', rawMint: 'mint', side: 'buy', quantity: 2 });
const v2 = { _time: '2026-08-01T00:00:00Z', market: 'LM', faction: 'USTUR', profile: 'PlayerKey', executionSignature: 'sig', rawMint: 'mint', side: 'buy', tradeId: id, fallbackQuantity: 2, fallbackSettledAtlas: 20, fallbackGrossAtlas: 20, fallbackMarketplaceFeeAtlas: 1, fallbackNetAtlas: 19, fallbackUnitPriceAtlas: 10, fallbackWallet: 'wallet', fallbackStarbase: 'star', fallbackAsset: 'asset', fallbackCertificateMint: 'cert' };

function routed({ v1Rows = [], v2Rows = [], failV1 = false, failV2 = false, newestRows = null } = {}) {
  const calls = [];
  const api = harness(async (_settings, flux) => {
    calls.push(flux);
    if (newestRows) return JSON.stringify(newestRows);
    const isV2 = flux.includes('_measurement == "marketplace_v2"');
    if (isV2 && failV2) throw new Error('v2_missing');
    if (!isV2 && failV1) throw new Error('v1_missing');
    return JSON.stringify(isV2 ? v2Rows : v1Rows);
  });
  return { api, calls };
}

test('trade dual-read uses separate exact v1 and v2 Flux branches and point-identity pivots', async () => {
  const { api, calls } = routed({ v1Rows: [v1], v2Rows: [v2] });
  await api.fetchMarketplaceTradesFromInflux(settings);
  assert.equal(calls.length, 2);
  const scope = '(r.faction == "USTUR" and (not exists r.profile or r.profile == "USTUR" or r.profile == "PlayerKey")) or (r.market == "GM" and r.faction == "GLOBAL" and r.profile == "GLOBAL")';
  const v2Scope = '(r.faction == "USTUR" and r.profile == "PlayerKey") or (r.market == "GM" and r.faction == "GLOBAL" and r.profile == "GLOBAL")';
  assert.equal(calls[0], `from(bucket: "Bucket A")\n  |> range(start: -40d)\n  |> filter(fn: (r) => r._measurement == "marketplace")\n  |> filter(fn: (r) => ${scope})\n  |> pivot(rowKey: ["_time", "tradeId"], columnKey: ["_field"], valueColumn: "_value")\n  |> sort(columns: ["_time"], desc: true)`);
  assert.equal(calls[1], `from(bucket: "Bucket A")\n  |> range(start: -40d)\n  |> filter(fn: (r) => r._measurement == "marketplace_v2")\n  |> filter(fn: (r) => ${v2Scope})\n  |> pivot(rowKey: ["_time", "market", "faction", "profile", "executionSignature", "rawMint", "side", "tradeId"], columnKey: ["_field"], valueColumn: "_value")\n  |> sort(columns: ["_time"], desc: true)`);
  for (const flux of calls) assert.ok(flux.indexOf('|> filter(fn: (r) =>') < flux.indexOf('|> pivot'));
});

test('historical-only and v2-only reads retain consumer values', async () => {
  const old = await routed({ v1Rows: [v1] }).api.fetchMarketplaceTradesFromInflux(settings);
  assert.equal(old.error, ''); assert.equal(old.trades.length, 1); assert.equal(old.trades[0].id, 'legacy'); assert.equal(old.trades[0].grossAtlas, 20);
  const modern = await routed({ v2Rows: [v2] }).api.fetchMarketplaceTradesFromInflux(settings);
  assert.equal(modern.error, ''); assert.equal(modern.trades.length, 1); assert.equal(modern.trades[0].id, id); assert.equal(modern.trades[0].grossAtlas, 20);
});

test('mixed cross-version duplicate collapses while profile, faction, and market stay separate', async () => {
  const enrichedV1 = { ...v1, orderId: 'order' };
  const otherProfile = { ...v1, tradeId: 'other', profile: 'OtherPlayer', asset: 'other-profile' };
  const result = await routed({ v1Rows: [enrichedV1, otherProfile], v2Rows: [v2] }).api.fetchMarketplaceTradesFromInflux(settings);
  assert.equal(result.trades.length, 2);
  assert.equal(result.trades.find((row) => row.tradeId === id).orderId, 'order');
  assert.ok(result.trades.some((row) => row.asset === 'other-profile' && row.representationRank === 'identity_uncertain'));
});

test('a missing measurement does not suppress the available generation', async () => {
  assert.equal((await routed({ v1Rows: [v1], failV2: true }).api.fetchMarketplaceTradesFromInflux(settings)).trades.length, 1);
  assert.equal((await routed({ v2Rows: [v2], failV1: true }).api.fetchMarketplaceTradesFromInflux(settings)).trades.length, 1);
  assert.notEqual((await routed({ failV1: true, failV2: true }).api.fetchMarketplaceTradesFromInflux(settings)).error, '');
});

test('existing newest empty behavior and v1-only, v2-only, mixed maxima are preserved', async () => {
  for (const rows of [
    [],
    [{ _time: '2026-07-01T00:00:00Z' }],
    [{ _time: '2026-08-01T00:00:00Z' }, { _time: '2026-06-01T00:00:00Z' }, { _time: '2026-07-01T00:00:00Z' }],
  ]) {
    const { api, calls } = routed({ newestRows: rows });
    const value = await api.fetchNewestMarketplaceTradeMs(settings);
    assert.equal(value, rows.length ? Math.max(...rows.map((row) => Date.parse(row._time))) : null);
    assert.equal(calls.length, 1);
    const scope = '(r.faction == "USTUR" and (not exists r.profile or r.profile == "USTUR" or r.profile == "PlayerKey")) or (r.market == "GM" and r.faction == "GLOBAL" and r.profile == "GLOBAL")';
    const v2Scope = '(r.faction == "USTUR" and r.profile == "PlayerKey") or (r.market == "GM" and r.faction == "GLOBAL" and r.profile == "GLOBAL")';
    assert.equal(calls[0], `v1 = from(bucket: "Bucket A")\n  |> range(start: -40d)\n  |> filter(fn: (r) => r._measurement == "marketplace" and r._field == "quantity")\n  |> filter(fn: (r) => ${scope})\nv2 = from(bucket: "Bucket A")\n  |> range(start: -40d)\n  |> filter(fn: (r) => r._measurement == "marketplace_v2" and (r._field == "fallbackQuantity" or r._field == "enrichedQuantity"))\n  |> filter(fn: (r) => ${v2Scope})\nunion(tables: [v1, v2])\n  |> group()\n  |> sort(columns: ["_time"], desc: false)\n  |> last(column: "_time")\n  |> keep(columns: ["_time"])`);
    assert.match(calls[0], /union\(tables: \[v1, v2\]\)[\s\S]*\|> group\(\)[\s\S]*\|> sort\(columns: \["_time"\], desc: false\)[\s\S]*\|> last\(column: "_time"\)/);
    assert.doesNotMatch(calls[0], /\|> last\(\)/);
  }
});

test('scope is exact and read path contains no mutation or adjacent integration', () => {
  assert.match(main, /not exists r\.profile or r\.profile == "\$\{escapeFluxString\(profileName\)\}" or r\.profile == "\$\{escapeFluxString\(profile\)\}"/);
  assert.match(main, /r\.faction == "\$\{escapeFluxString\(faction\)\}" and r\.profile == "\$\{escapeFluxString\(profile\)\}"/);
  assert.match(main, /r\.market == "GM" and r\.faction == "GLOBAL" and r\.profile == "GLOBAL"/);
  for (const forbidden of ['writeInflux', 'marketplace-outbox', 'publication-coordinator', 'saveMarketplace', 'cursor', 'checkpoint', 'fetchMarketplaceAssetFlowsFromInflux']) assert.doesNotMatch(tradesSource, new RegExp(forbidden));
});

test('existing timestamp order remains newest-first with deterministic union-key tie break', async () => {
  const older = { ...v1, _time: '2026-07-01T00:00:00Z', signature: 'older', tradeId: 'older' };
  const result = await routed({ v1Rows: [older, v1] }).api.fetchMarketplaceTradesFromInflux(settings);
  assert.deepEqual(result.trades.map((row) => row.timestamp), [v1._time, older._time]);
  assert.match(tradesSource, /deriveMarketplaceUnionKey\(a\)\.localeCompare\(deriveMarketplaceUnionKey\(b\)\)/);
});
