'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const compat = require('../electron/marketplace-trade-compat');
const gmAccounting = require('../electron/gm-marketplace-accounting');
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
    'normalizeMarketplaceV1Row', 'normalizeMarketplaceV2Row', 'deriveMarketplaceUnionKey', 'dedupeMarketplaceRows',
    'MARKETPLACE_HISTORY_CUTOVER_ISO', 'MARKETPLACE_FACTION_MEASUREMENT',
    `${scopeSource}\n${newestSource}\n${tradesSource}\nreturn { fetchNewestMarketplaceTradeMs, fetchMarketplaceTradesFromInflux };`
  );
  return factory(
    queryImpl, (text) => JSON.parse(text), (settings) => settings.playerProfile, (value) => String(value).toUpperCase(),
    (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"'), 'USTUR',
    compat.normalizeMarketplaceV1Row, compat.normalizeMarketplaceV2Row, compat.deriveMarketplaceUnionKey, compat.dedupeMarketplaceRows,
    gmAccounting.MARKETPLACE_HISTORY_CUTOVER_ISO, gmAccounting.MARKETPLACE_FACTION_MEASUREMENT
  );
}
const settings = { influxBucket: 'Bucket A', playerProfile: 'PlayerKey', faction: 'USTUR' };
const id = point.deriveMarketplaceTradeId({ market: 'LM', faction: 'USTUR', profileScope: 'USTUR', executionSignature: 'sig', rawMint: 'mint', side: 'buy', quantity: 2 });
const v2 = { _time: '2026-08-01T00:00:00Z', market: 'LM', faction: 'USTUR', profile: 'USTUR', executionSignature: 'sig', rawMint: 'mint', side: 'buy', tradeId: id, fallbackQuantity: 2, fallbackSettledAtlas: 20, fallbackGrossAtlas: 20, fallbackMarketplaceFeeAtlas: 1, fallbackNetAtlas: 19, fallbackUnitPriceAtlas: 10, fallbackWallet: 'wallet', fallbackStarbase: 'star', fallbackAsset: 'asset', fallbackCertificateMint: 'cert' };

function routed({ v2Rows = [], failV2 = false, newestRows = null } = {}) {
  const calls = [];
  const api = harness(async (_settings, flux) => {
    calls.push(flux);
    if (flux.includes('_measurement == "marketplace_v2"')) {
      if (failV2) throw new Error('v2_missing');
      return JSON.stringify(newestRows ?? v2Rows);
    }
    return '[]';
  });
  return { api, calls };
}

const scope = 'r.faction == "USTUR" and (not exists r.profile or r.profile == "USTUR" or r.profile == "PlayerKey")';

test('trade reads only clean post-cutover LM and faction GM measurements', async () => {
  const { api, calls } = routed({ v2Rows: [v2] });
  const result = await api.fetchMarketplaceTradesFromInflux(settings);
  assert.equal(result.trades.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], `from(bucket: "Bucket A")\n  |> range(start: time(v: "2026-08-29T00:00:00.000Z"))\n  |> filter(fn: (r) => r._measurement == "marketplace_v2")\n  |> filter(fn: (r) => ${scope})\n  |> pivot(rowKey: ["_time", "market", "faction", "profile", "executionSignature", "rawMint", "side", "tradeId"], columnKey: ["_field"], valueColumn: "_value")\n  |> sort(columns: ["_time"], desc: true)`);
  assert.match(calls[1], /_measurement == "marketplace_faction_v2"/);
  assert.match(calls[1], /r\.faction == "USTUR"/);
  assert.match(calls.join('\n'), /2026-08-29T00:00:00\.000Z/);
  assert.doesNotMatch(calls.join('\n'), /marketplace_reconciliation_test_v1|r\.faction == "GLOBAL"/);
  assert.doesNotMatch(calls[0], /_measurement == "marketplace"(?:\s|and|\))/);
  assert.ok(calls[0].indexOf('|> filter(fn: (r) =>') < calls[0].indexOf('|> pivot'));
});

test('v2 values are retained and a missing v2 measurement is surfaced', async () => {
  const modern = await routed({ v2Rows: [v2] }).api.fetchMarketplaceTradesFromInflux(settings);
  assert.equal(modern.error, '');
  assert.equal(modern.trades.length, 1);
  assert.equal(modern.trades[0].id, id);
  assert.equal(modern.trades[0].grossAtlas, 20);
  const missing = await routed({ failV2: true }).api.fetchMarketplaceTradesFromInflux(settings);
  assert.equal(missing.trades.length, 0);
  assert.match(missing.error, /v2_missing/);
});

test('newest Marketplace anchor queries only v2 fallback and enriched quantity fields', async () => {
  const rows = [{ _time: '2026-08-01T00:00:00Z' }, { _time: '2026-07-01T00:00:00Z' }];
  const { api, calls } = routed({ newestRows: rows });
  assert.equal(await api.fetchNewestMarketplaceTradeMs(settings), Date.parse(rows[0]._time));
  assert.equal(calls.length, 1);
  assert.equal(calls[0], `from(bucket: "Bucket A")\n  |> range(start: -40d)\n  |> filter(fn: (r) => r._measurement == "marketplace_v2" and (r._field == "fallbackQuantity" or r._field == "enrichedQuantity"))\n  |> filter(fn: (r) => ${scope})\n  |> group()\n  |> sort(columns: ["_time"], desc: false)\n  |> last(column: "_time")\n  |> keep(columns: ["_time"])`);
  assert.doesNotMatch(calls[0], /union\(|\bv1\s*=/);
});

test('scope is exact and clean read path excludes every legacy measurement and mutation', () => {
  assert.match(main, /not exists r\.profile or r\.profile == "\$\{escapeFluxString\(profileName\)\}" or r\.profile == "\$\{escapeFluxString\(profile\)\}"/);
  assert.doesNotMatch(tradesSource, /r\.faction == "GLOBAL"|r\.profile == "GLOBAL"/);
  assert.match(tradesSource, /MARKETPLACE_FACTION_MEASUREMENT/);
  assert.match(tradesSource, /MARKETPLACE_HISTORY_CUTOVER_ISO/);
  assert.doesNotMatch(tradesSource, /marketplace_reconciliation_test_v1|normalizeMarketplaceV1Row/);
  assert.match(tradesSource, /dedupeMarketplaceRows/);
  for (const forbidden of ['writeInflux', 'marketplace-outbox', 'publication-coordinator', 'saveMarketplace', 'cursor', 'checkpoint', 'fetchMarketplaceAssetFlowsFromInflux']) assert.doesNotMatch(tradesSource, new RegExp(forbidden));
});

test('v2 timestamp order remains newest-first with deterministic identity tie break', async () => {
  const olderIdentity = { market: 'LM', faction: 'USTUR', profileScope: 'USTUR', executionSignature: 'older', rawMint: 'mint', side: 'buy', quantity: 2 };
  const older = { ...v2, _time: '2026-07-01T00:00:00Z', executionSignature: 'older', tradeId: point.deriveMarketplaceTradeId(olderIdentity) };
  const result = await routed({ v2Rows: [older, v2] }).api.fetchMarketplaceTradesFromInflux(settings);
  assert.deepEqual(result.trades.map((row) => row.timestamp), [v2._time, older._time]);
  assert.match(tradesSource, /deriveMarketplaceUnionKey\(a\)\.localeCompare\(deriveMarketplaceUnionKey\(b\)\)/);
});
