'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('Marketplace earnings tab sits between Mining and Cargo with a BUY/SELL switch and side-specific unit column', () => {
  assert.match(html, /data-earnings-subtab="mining"[\s\S]*data-earnings-subtab="marketplace"[\s\S]*data-earnings-subtab="cargo"/);
  assert.match(html, /id="earnings-marketplace-side-switch"[\s\S]*data-marketplace-side="buy"[^>]*>BUY<[\s\S]*data-marketplace-side="sell"[^>]*>SELL</);
  assert.doesNotMatch(html, /data-marketplace-side="(?:buy|sell)"[^>]*>\s*(?:BUY|SELL)\s*\(/);
  const panel = html.match(/data-earnings-panel="marketplace"[\s\S]*?<\/div>\s*<div class="earnings-panel" data-earnings-panel="cargo"/)?.[0] || '';
  for (const label of ['Timestamp \\(UTC\\)', 'Marketplace', 'Starbase', 'Asset', 'Amount', 'Gross ATLAS', 'Price', 'Marketplace Fee', 'Txs Fee', 'Net ATLAS', 'Cost / Unit', 'Order ID', 'Signature']) {
    assert.match(panel, new RegExp(label));
  }
  assert.doesNotMatch(panel, /<th>Side<\/th>/);
  assert.match(panel, /id="earnings-marketplace-unit-header"/);
  assert.ok(panel.indexOf('Net ATLAS') < panel.indexOf('Cost / Unit'));
  assert.ok(panel.indexOf('Cost / Unit') < panel.indexOf('Order ID'));
  assert.ok(panel.indexOf('Order ID') < panel.indexOf('Signature'));
});

test('Marketplace renderer filters rows by selected side and swaps the unit metric', () => {
  assert.match(renderer, /let earningsMarketplaceSide = 'buy'/);
  assert.match(renderer, /entry\.side === earningsMarketplaceSide/);
  assert.match(renderer, /earningsMarketplaceSide === 'buy' \? 'Cost \/ Unit' : 'Income \/ Unit'/);
  assert.match(renderer, /earningsMarketplaceSide === 'buy'[\s\S]*\(gross \+ txFee\) \/ quantity[\s\S]*net \/ quantity/);
  assert.match(renderer, /formatMarketplaceAtlas\(txFee, 2\)/);
  assert.match(renderer, /formatMarketplaceAtlas\(net, 2\)/);
});

test('Update shares a row with Refresh data while the BUY SELL switch stays below', () => {
  assert.match(html, /class="update-action-stack"[\s\S]*class="top-action-row"[\s\S]*id="refresh-data-btn"[\s\S]*id="update-btn"[\s\S]*id="earnings-marketplace-side-switch"/);
});

test('Marketplace renderer exposes LM scan errors and links execution signatures', () => {
  assert.match(renderer, /function renderEarningsMarketplace\(/);
  assert.match(renderer, /localMarketError/);
  assert.match(renderer, /https:\/\/solscan\.io\/tx\//);
  assert.match(main, /localMarketTrades: localMarketResult\.trades/);
  assert.match(renderer, /'en-US'/);
  assert.match(renderer, /toISOString/);
});

test('LM scanner resolves the configured profile through the existing settings helper', () => {
  assert.doesNotMatch(main, /getConfiguredPlayerProfile\(/);
  assert.match(main, /const profile = getSelectedPlayerProfile\(settings\);/);
});

test('Earnings snapshot stays on the fast path and leaves Marketplace to its own loader', () => {
  const snapshotStart = main.indexOf('async function fetchEarningsSnapshot');
  const snapshot = main.slice(snapshotStart, main.indexOf("handleTrustedIpc('app:get-profile-name'", snapshotStart));
  assert.doesNotMatch(snapshot, /fetchLocalMarketTrades\(/);
  assert.match(snapshot, /needsInventoryLedger/);
  assert.match(snapshot, /const localMarketResult = \{ trades: \[\], error: '' \}/);
  assert.match(renderer, /earningsSubtab: currentEarningsSubtab/);
  assert.match(renderer, /renderEarningsMarketplaceLoading\('Loading Marketplace data\.\.\.'\)/);
});

test('Marketplace loader shows loading state and runs sync when the tab is opened or faction-switched', () => {
  assert.match(renderer, /function renderEarningsMarketplaceLoading/);
  assert.match(renderer, /renderEarningsMarketplaceLoading\(sync \? 'Syncing Marketplace data\.\.\.' : 'Loading Marketplace data\.\.\.'\)/);
  assert.match(renderer, /currentEarningsSubtab === 'marketplace' \? refreshMarketplace\(\{ sync: true \}\) : refreshEarnings\(\)/);
  assert.match(renderer, /if \(subtab === 'marketplace'\) \{\s*refreshMarketplace\(\{ sync: true \}\);/);
});

test('Marketplace chain synchronization is exposed separately and runs in the background', () => {
  assert.match(main, /handleTrustedIpc\('marketplace:sync'/);
  assert.match(main, /handleTrustedIpc\('marketplace:snapshot'/);
  assert.match(renderer, /api\.syncMarketplace/);
  assert.match(renderer, /setInterval\(runMarketplaceBackgroundSync, MARKETPLACE_SYNC_INTERVAL_MS\)/);
  assert.match(renderer, /currentEarningsSubtab === 'marketplace'[\s\S]*refreshMarketplace/);
});

test('Marketplace sync discovers current player orders and persists incremental cursors', () => {
  assert.match(main, /getOpenOrdersForPlayer/);
  assert.match(main, /fetchOpenLocalMarketOrderIds\(connection, trackedWallets\)/);
  assert.match(main, /walletCursors: scanned\.walletCursors/);
  assert.match(main, /orderCursors: scanned\.orderCursors/);
  assert.match(main, /activeOrderIds: scanned\.activeOrderIds/);
  assert.match(main, /archivedOrderIds: scanned\.archivedOrderIds/);
  assert.match(main, /schemaVersion: 2/);
});

test('Marketplace reads use supported Flux queries instead of Influx SQL', () => {
  assert.match(main, /_measurement == "marketplace"/);
  assert.match(main, /pivot\(rowKey: \["_time", "tradeId"\]/);
  assert.doesNotMatch(main, /queryInfluxSql|type:\s*['"]sql['"]/);
});

test('legacy Marketplace rows are rescanned once and enriched rows replace fallback duplicates', () => {
  assert.match(main, /tradeEnrichmentVersion/);
  assert.match(main, /needsTradeEnrichment \? \{\} : checkpoint\.walletCursors/);
  assert.match(main, /prior\.signature === trade\.signature/);
  assert.match(main, /!current\.orderId && trade\.orderId/);
});

test('GM sync includes handler and additional wallets while remaining global and ATLAS-only', () => {
  assert.match(html, /name="gmTradingWallets"/);
  assert.match(renderer, /gmTradingWallets: String\(data\.get\('gmTradingWallets'\)/);
  assert.match(main, /decodePlayerProfileHandlerWallets/);
  assert.match(main, /\.\.\.decodePlayerProfileHandlerWallets\(accountInfo\), \.\.\.extraWallets/);
  assert.match(main, /faction: 'GLOBAL', profile: 'GLOBAL', market: 'GM'/);
  assert.match(main, /quoteMint: ATLAS_MINT/);
  assert.match(main, /fetchMarketplaceAssetFlowsFromInflux/);
});

test('Marketplace Influx read includes selected profile pubkey rows and global GM rows', () => {
  assert.match(main, /r\.profile == "\$\{escapeFluxString\(profileName\)\}" or r\.profile == "\$\{escapeFluxString\(profile\)\}"/);
  assert.match(main, /or r\.faction == "GLOBAL"/);
});

test('ONI and MUD earnings accept second-instance SDU tags', () => {
  assert.match(main, /instance: \['ONI', 'ONI2'\]/);
  assert.match(main, /instance: \['MUD', 'MUD2'\]/);
});
