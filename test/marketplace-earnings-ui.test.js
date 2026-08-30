'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('Marketplace earnings tab sits between Mining and Cargo with a BUY/SELL switch and side-specific unit column', () => {
  assert.match(html, /data-earnings-subtab="mining"[\s\S]*data-earnings-subtab="marketplace"[\s\S]*data-earnings-subtab="cargo"/);
  assert.match(html, /id="earnings-marketplace-side-switch"[\s\S]*data-marketplace-side="buy"[^>]*>BUY<[\s\S]*data-marketplace-side="sell"[^>]*>SELL</);
  assert.doesNotMatch(html, /data-marketplace-side="(?:buy|sell)"[^>]*>\s*(?:BUY|SELL)\s*\(/);
  const panel = html.match(/data-earnings-panel="marketplace"[\s\S]*?<\/div>\s*<div class="earnings-panel" data-earnings-panel="cargo"/)?.[0] || '';
  for (const label of ['Timestamp \\(UTC\\)', 'Deposit Cargo to Game Signature', 'Marketplace', 'Starbase', 'Asset', 'Amount', 'Purchase Value', 'Price', 'Marketplace Fee', 'Txs Fee', 'ATLAS Paid', 'Cost / Unit', 'GM Trading Signatures']) {
    assert.match(panel, new RegExp(label));
  }
  assert.doesNotMatch(panel, /<th>Side<\/th>|<th>Order ID<\/th>/);
  assert.match(panel, /id="earnings-marketplace-unit-header"/);
  assert.ok(panel.indexOf('ATLAS Paid') < panel.indexOf('Cost / Unit'));
  assert.ok(panel.indexOf('Cost / Unit') < panel.indexOf('Deposit Cargo to Game Signature'));
  assert.ok(panel.indexOf('Deposit Cargo to Game Signature') < panel.indexOf('GM Trading Signatures'));
});

test('Marketplace exposes every table column in the persistent Earnings sidebar selector', () => {
  assert.match(renderer, /const marketplaceEarningsOptionalColumns = Object\.freeze/);
  assert.match(renderer, /marketplace: marketplaceEarningsOptionalColumns/);
  assert.match(renderer, /marketplace: new Set\(marketplaceEarningsOptionalColumns\.map\(\(column\) => column\.id\)\)/);
  assert.match(renderer, /getVisibleEarningsColumns\('marketplace'\)/);
  assert.match(renderer, /renderMarketplaceHeader\(visibleColumns\)/);
  assert.match(renderer, /createMarketplaceEarningsCell\(entry, column\.id/);
  assert.match(renderer, /subtab === 'marketplace'[\s\S]*renderEarningsMarketplace\(latestMarketplaceResult\)/);
});

test('Marketplace renderer uses side-specific value labels and buyer-paid accounting', () => {
  assert.match(renderer, /let earningsMarketplaceSide = 'buy'/);
  assert.match(renderer, /entry\.side === earningsMarketplaceSide/);
  assert.match(renderer, /earningsMarketplaceSide === 'buy' \? 'Purchase Value' : 'Sale Value'/);
  assert.match(renderer, /earningsMarketplaceSide === 'buy' \? 'ATLAS Paid' : 'ATLAS Received'/);
  assert.match(renderer, /earningsMarketplaceSide === 'buy' \? 'Cost \/ Unit' : 'Income \/ Unit'/);
  assert.match(renderer, /earningsMarketplaceSide === 'buy'[\s\S]*gross \+ txFee[\s\S]*\(gross \+ txFee\) \/ quantity[\s\S]*net \/ quantity/);
  assert.match(renderer, /earningsMarketplaceSide === 'buy' \? 'Seller-paid'/);
  assert.match(renderer, /earningsMarketplaceSide !== 'sell'[\s\S]*reordered\.splice\(custodyIndex, 0, trading\)/);
  assert.match(renderer, /formatMarketplaceAtlas\(calculated\.txFee, 2\)/);
  assert.match(renderer, /formatMarketplaceAtlas\(calculated\.net, 2\)/);
});

test('Update shares a row with Refresh data while the BUY SELL switch stays below', () => {
  assert.match(html, /class="update-action-stack"[\s\S]*class="top-action-row"[\s\S]*id="refresh-data-btn"[\s\S]*id="update-btn"[\s\S]*id="earnings-marketplace-side-switch"/);
});

test('Marketplace renderer exposes LM scan errors and links custody plus GM trading signatures', () => {
  assert.match(renderer, /function renderEarningsMarketplace\(/);
  assert.match(renderer, /localMarketError/);
  assert.match(renderer, /entry\.custodySignatures \|\| \[\]/);
  assert.match(renderer, /entry\.executionSignatures \|\| \[\]/);
  assert.doesNotMatch(renderer, /entry\.executionSignatures\?\.length \? entry\.executionSignatures : \[entry\.signature\]/);
  assert.match(renderer, /https:\/\/solscan\.io\/tx\/\$\{encodeURIComponent\(transactionSignature\)\}/);
  assert.match(renderer, /signatures\.length === 1 \? transactionSignature : String\(index \+ 1\)/);
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
  assert.match(snapshot, /needsInventoryLedger\s*\? await fetchMarketplaceTradesFromInflux\(settings\)/);
  assert.match(snapshot, /inventoryBasisFaction: ledgerFaction/);
  assert.match(snapshot, /pendingInventoryBasisSnapshots/);
  assert.doesNotMatch(snapshot, /syncMarketplaceFromChain\(/);
  assert.match(renderer, /earningsSubtab: 'crafting'/);
  assert.match(renderer, /renderEarningsMarketplaceLoading\('Loading Marketplace data\.\.\.'\)/);
});

test('Marketplace loader uses profile-scoped cached snapshots on tab and faction activation', () => {
  assert.match(main, /fetchMarketplaceAssetFlowsFromInflux\(settings\)/);
  assert.match(main, /readInventoryBasisSnapshots\(\{[\s\S]*?bucket: settings\.influxBucket,[\s\S]*?query: async \(flux\) => parseInfluxCsv\(await queryInfluxFlux\(settings, flux\)\),[\s\S]*?\}\)/);
  assert.match(main, /enrichGmTradesWithInventoryBasis\(result\.trades, accounting\.appliedEventResults, \{ inventoryBasisObservations \}\)/);
  assert.match(renderer, /function renderEarningsMarketplaceLoading/);
  assert.match(renderer, /renderEarningsMarketplaceLoading\(sync \? 'Syncing Marketplace data\.\.\.' : 'Loading Marketplace data\.\.\.'\)/);
  assert.match(renderer, /if \(subtab === 'marketplace'\) \{\s*refreshMarketplace\(\{ sync: false \}\);/);
  assert.match(renderer, /currentEarningsSubtab === 'marketplace' \? refreshMarketplace\(\{ sync: false \}\) : refreshEarnings\(\)/);
});

test('Marketplace sync surfaces faction-v2 write counts and failures', () => {
  assert.match(main, /marketplaceFactionV2Write: shadowWrite/);
  assert.match(main, /\[publication\.error, shadowWrite\.error\]\.filter\(Boolean\)\.join\('; '\)/);
  assert.match(main, /marketplaceFactionV2Write: global\.marketplaceFactionV2Write/);
  assert.match(renderer, /syncResult = await api\.syncMarketplace\(settings\)/);
  assert.match(renderer, /Marketplace faction-v2 write failed:/);
  assert.match(renderer, /Marketplace faction-v2: no qualifying rows/);
  assert.match(renderer, /Marketplace faction-v2: .* written/);
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

test('Marketplace reads only clean post-cutover LM and faction GM measurements without Influx SQL', () => {
  const start = main.indexOf('async function fetchMarketplaceTradesFromInflux');
  const end = main.indexOf('async function fetchMarketplaceAssetFlowsFromInflux', start);
  const reader = main.slice(start, end);
  assert.match(reader, /_measurement == "marketplace_v2"/);
  assert.match(reader, /MARKETPLACE_FACTION_MEASUREMENT/);
  assert.match(reader, /MARKETPLACE_HISTORY_CUTOVER_ISO/);
  assert.doesNotMatch(reader, /marketplace_reconciliation_test_v1|_measurement == "marketplace" and r\.market == "GM"/);
  assert.match(reader, /pivot\(rowKey: \["_time", "market", "faction", "profile", "executionSignature", "rawMint", "side", "tradeId"\]/);
  assert.match(reader, /dedupeMarketplaceRows/);
  assert.doesNotMatch(main, /queryInfluxSql|type:\s*['"]sql['"]/);
});

test('Marketplace rescans order history for sell recovery without replaying high-volume wallet history', () => {
  assert.match(main, /checkpoint\.tradeEnrichmentVersion < 2/);
  assert.match(main, /loadLocalMarketHistoricalOrderIds\(faction, startIso\)/);
  assert.match(main, /event\.event === 'FILLED'/);
  assert.match(main, /historicalOrderIds,/);
  assert.match(main, /marketplaceCursorSnapshot\(\s*migrationWalletCursors,\s*needsTradeEnrichment \? \{\} : checkpoint\.orderCursors/);
  assert.match(main, /needsTradeEnrichment \? checkpoint\.orders\.map\(\(order\) => String\(order\.orderId\)\)/);
  assert.match(main, /pendingWalletCursors/);
  assert.match(main, /tradeEnrichmentVersionNext[\s\S]*\? 2 : checkpoint\.tradeEnrichmentVersion/);
  assert.match(main, /prior\.signature === trade\.signature/);
});

test('GM raw sync scans configured trading wallets and narrow CSS/token scopes without broad profile-wallet history', () => {
  assert.match(html, /name="gmTradingWallets"/);
  assert.match(renderer, /gmTradingWallets: String\(data\.get\('gmTradingWallets'\)/);
  assert.match(main, /profileWalletsByFaction\[faction\] = decodePlayerProfileWallets\(accountInfo\)/);
  assert.match(main, /const profileWallets = Object\.values\(profileWalletsByFaction\)\.flat\(\)/);
  assert.match(main, /const executionWallets = Array\.from\(new Set\(extraWallets\)\)/);
  assert.match(main, /const trackedWallets = Array\.from\(new Set\(extraWallets\)\)/);
  assert.match(main, /syncMarketplaceRawData\(settings, connection/);
  assert.match(main, /deriveCssStarbasePlayer/);
  assert.match(main, /discoverPlayerTokenAccounts/);
  assert.doesNotMatch(main, /const executionWallets = Array\.from\(new Set\(\[\.\.\.profileWallets/);
  assert.doesNotMatch(main, /const trackedWallets = Array\.from\(new Set\(\[\.\.\.marketplaceWallets/);
  assert.match(main, /getMultipleAccountsInfo\(profileKeys, 'confirmed'\)/);
  assert.match(main, /maxPages: 1/);
  assert.equal((main.match(/const startIso = MARKETPLACE_HISTORY_CUTOVER_ISO;/g) || []).length, 2);
  assert.match(main, /startIso,\s*addressFactory:[\s\S]*decodeAssetFlows/);
  assert.doesNotMatch(main, /gm_trading_wallet_not_configured/);
  assert.match(main, /fetchOpenLocalMarketOrderIds\(connection, executionWallets\)/);
  assert.match(main, /executionWallets,/);
  assert.match(main, /faction: 'GLOBAL', profile: 'GLOBAL', market: 'GM'/);
  assert.match(main, /quoteMint: ATLAS_MINT/);
  assert.match(main, /fetchMarketplaceAssetFlowsFromInflux/);
});

test('Marketplace Influx read includes selected profile rows and clean faction GM deposits but excludes GLOBAL and legacy rows', () => {
  assert.match(main, /r\.profile == "\$\{escapeFluxString\(profileName\)\}" or r\.profile == "\$\{escapeFluxString\(profile\)\}"/);
  assert.match(main, /MARKETPLACE_FACTION_MEASUREMENT/);
  const reader = main.slice(main.indexOf('function marketplaceScopeFlux'), main.indexOf('async function fetchMarketplaceAssetFlowsFromInflux'));
  assert.doesNotMatch(reader, /r\.faction == "GLOBAL"|r\.profile == "GLOBAL"|marketplace_reconciliation_test_v1/);
});

test('ONI and MUD earnings accept second-instance SDU tags', () => {
  assert.match(main, /instance: \['ONI', 'ONI2'\]/);
  assert.match(main, /instance: \['MUD', 'MUD2'\]/);
});

test('Marketplace activation uses cache while background and manual refresh sync through the guard', async () => {
  assert.match(renderer, /if \(subtab === 'marketplace'\) \{\s*refreshMarketplace\(\{ sync: false \}\);/);
  assert.match(renderer, /currentEarningsSubtab === 'marketplace' \? refreshMarketplace\(\{ sync: false \}\) : refreshEarnings\(\)/);
  assert.match(renderer, /function refreshCurrentVisibleData\([\s\S]*currentEarningsSubtab === 'marketplace'\) return refreshMarketplace\(\{ sync: true \}\)/);
  assert.match(renderer, /refreshDataButton\?\.addEventListener\('click'[\s\S]*await refreshCurrentVisibleData\(\)/);

  const sourceStart = renderer.indexOf('const marketplaceRefreshInFlight = new Map();');
  const sourceEnd = renderer.indexOf('async function refreshEarnings()', sourceStart);
  const snapshotPayloads = [];
  let syncCalls = 0;
  let snapshotCalls = 0;
  const context = {
    latestSettings: { faction: 'MUD', playerProfiles: { MUD: 'profile' } },
    getFormPayload: () => ({}),
    normalizeFaction: (value) => value,
    getActivePlayerProfile: () => 'profile',
    renderEarningsMarketplaceLoading: () => {},
    setText: () => {},
    earningsMarketplaceSyncStatus: {},
    api: {
      syncMarketplace: async () => { syncCalls += 1; return { ok: true }; },
      getMarketplaceSnapshot: async (settings) => {
        snapshotCalls += 1;
        snapshotPayloads.push(settings);
        return { ok: true, faction: settings.faction, localMarketTrades: [{ id: `cached-${snapshotCalls}` }] };
      },
    },
    latestEarningsResult: null,
    renderEarningsMarketplace: () => {},
    console: { error: () => {} },
    Promise,
  };
  vm.runInNewContext(`${renderer.slice(sourceStart, sourceEnd)}\nthis.refreshMarketplace = refreshMarketplace; this.runMarketplaceBackgroundSync = runMarketplaceBackgroundSync;`, context);

  await context.refreshMarketplace({ sync: false });
  await context.refreshMarketplace({ sync: false });
  assert.equal(syncCalls, 0);
  assert.equal(snapshotCalls, 1);
  assert.deepEqual(snapshotPayloads.map((settings) => settings.faction), ['MUD']);

  let releaseSync;
  const syncGate = new Promise((resolve) => { releaseSync = resolve; });
  context.api.syncMarketplace = async () => { syncCalls += 1; await syncGate; return { ok: true }; };
  const startupBackground = context.runMarketplaceBackgroundSync();
  const scheduledTick = context.runMarketplaceBackgroundSync();
  const manualRefresh = context.refreshMarketplace({ sync: true });
  const factionRefresh = context.refreshMarketplace({ sync: true });
  assert.equal(syncCalls, 1);
  releaseSync();
  await Promise.all([startupBackground, scheduledTick, manualRefresh, factionRefresh]);
  assert.equal(syncCalls, 1);
  assert.equal(snapshotCalls, 2);
});

test('Marketplace skipped cross-faction sync still loads and uses the requested faction snapshot', async () => {
  const sourceStart = renderer.indexOf('const marketplaceRefreshInFlight = new Map();');
  const sourceEnd = renderer.indexOf('async function refreshEarnings()', sourceStart);
  const rendered = [];
  const syncPayloads = [];
  const snapshotPayloads = [];
  const oniSettings = { faction: 'ONI', playerProfiles: { ONI: 'oni-profile' } };
  const oniSnapshot = { ok: true, faction: 'ONI', localMarketTrades: [{ id: 'oni-cached' }] };
  const context = {
    latestSettings: oniSettings,
    getFormPayload: () => ({}),
    normalizeFaction: (value) => value,
    getActivePlayerProfile: () => 'oni-profile',
    renderEarningsMarketplaceLoading: () => {},
    setText: () => {},
    earningsMarketplaceSyncStatus: {},
    api: {
      syncMarketplace: async (settings) => {
        syncPayloads.push(settings);
        return {
          ok: true,
          skipped: true,
          faction: 'ONI',
          marketplaceSyncAttempt: {
            disposition: 'skipped', requestedFaction: 'ONI', activeFaction: 'MUD', runId: 'mud-run',
          },
        };
      },
      getMarketplaceSnapshot: async (settings) => {
        snapshotPayloads.push(settings);
        return oniSnapshot;
      },
    },
    latestEarningsResult: null,
    renderEarningsMarketplace: (result) => rendered.push(result),
    console: { error: () => {} },
    Promise,
  };
  vm.runInNewContext(`${renderer.slice(sourceStart, sourceEnd)}\nthis.refreshMarketplace = refreshMarketplace;`, context);

  const result = await context.refreshMarketplace({ sync: true });
  assert.equal(syncPayloads.length, 1);
  assert.equal(syncPayloads[0].faction, 'ONI');
  assert.equal(snapshotPayloads.length, 1);
  assert.equal(snapshotPayloads[0].faction, 'ONI');
  assert.equal(result, oniSnapshot);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].faction, 'ONI');
  assert.equal(rendered[0].localMarketTrades[0].id, 'oni-cached');
  assert.equal(JSON.stringify(rendered).includes('MUD'), false);
});

test('Marketplace scheduler uses hourly guarded background synchronization', () => {
  assert.match(renderer, /const MARKETPLACE_SYNC_INTERVAL_MS = 60 \* 60 \* 1000;/);
  assert.doesNotMatch(renderer, /const MARKETPLACE_SYNC_INTERVAL_MS = 5 \* 60 \* 1000;/);
  assert.match(renderer, /void loadVisibleThenPrefetch\(refreshVisibleFactionViews\)\.then\(runMarketplaceBackgroundSync\);/);
  assert.match(renderer, /setInterval\(runMarketplaceBackgroundSync, MARKETPLACE_SYNC_INTERVAL_MS\)/);
  assert.match(renderer, /function runMarketplaceBackgroundSync\(\) \{\s*if \(!latestSettings \|\| !getActivePlayerProfile\(latestSettings\)\) return Promise\.resolve\(\);\s*return refreshMarketplace\(\{ sync: true \}\);\s*\}/);
});

test('Marketplace budget exhaustion still loads only the requested cached snapshot', async () => {
  const sourceStart = renderer.indexOf('const marketplaceRefreshInFlight = new Map();');
  const sourceEnd = renderer.indexOf('async function refreshEarnings()', sourceStart);
  const rendered = [];
  let snapshotCalls = 0;
  const context = {
    latestSettings: { faction: 'ONI', playerProfiles: { ONI: 'oni-profile' } },
    getFormPayload: () => ({}), normalizeFaction: (value) => value,
    getActivePlayerProfile: () => 'oni-profile', renderEarningsMarketplaceLoading: () => {},
    setText: () => {}, earningsMarketplaceSyncStatus: {},
    api: {
      syncMarketplace: async () => ({
        ok: true, status: 'budget_exhausted', resumable: true, partial: true,
        faction: 'ONI', marketplaceRpcBudget: { status: 'exhausted', limit: 300, used: 300, operation: 'LM', method: 'getParsedTransaction' },
      }),
      getMarketplaceSnapshot: async (settings) => {
        snapshotCalls += 1;
        return { ok: true, faction: settings.faction, localMarketTrades: [{ id: 'oni-cached' }] };
      },
    },
    latestEarningsResult: null, renderEarningsMarketplace: (result) => rendered.push(result),
    console: { error: () => {} }, Promise,
  };
  vm.runInNewContext(`${renderer.slice(sourceStart, sourceEnd)}\nthis.refreshMarketplace = refreshMarketplace;`, context);

  await context.refreshMarketplace({ sync: true });
  assert.equal(snapshotCalls, 1);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].faction, 'ONI');
  assert.equal(rendered[0].localMarketTrades[0].id, 'oni-cached');
  assert.match(renderer, /const MARKETPLACE_SYNC_INTERVAL_MS = 60 \* 60 \* 1000/);
  assert.match(renderer, /refreshMarketplace\(\{ sync: false \}\)/);
});
