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

test('Marketplace loader uses cached snapshots on tab activation while faction refresh still syncs', () => {
  assert.match(renderer, /function renderEarningsMarketplaceLoading/);
  assert.match(renderer, /renderEarningsMarketplaceLoading\(sync \? 'Syncing Marketplace data\.\.\.' : 'Loading Marketplace data\.\.\.'\)/);
  assert.match(renderer, /if \(subtab === 'marketplace'\) \{\s*refreshMarketplace\(\{ sync: false \}\);/);
  assert.match(renderer, /currentEarningsSubtab === 'marketplace' \? refreshMarketplace\(\{ sync: true \}\) : refreshEarnings\(\)/);
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

test('Marketplace reads use separate supported v1 and v2 Flux queries instead of Influx SQL', () => {
  assert.match(main, /_measurement == "marketplace"/);
  assert.match(main, /_measurement == "marketplace_v2"/);
  assert.match(main, /pivot\(rowKey: \["_time", "tradeId"\]/);
  assert.match(main, /pivot\(rowKey: \["_time", "market", "faction", "profile", "executionSignature", "rawMint", "side", "tradeId"\]/);
  assert.doesNotMatch(main, /queryInfluxSql|type:\s*['"]sql['"]/);
});

test('legacy Marketplace rows are rescanned once and compatibility dedupe replaces fallback duplicates', () => {
  assert.match(main, /tradeEnrichmentVersion/);
  assert.match(main, /needsTradeEnrichment \? \{\} : checkpoint\.walletCursors/);
  assert.match(main, /prior\.signature === trade\.signature/);
  assert.match(main, /dedupeMarketplaceRows/);
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
  assert.match(main, /r\.market == "GM" and r\.faction == "GLOBAL" and r\.profile == "GLOBAL"/);
});

test('ONI and MUD earnings accept second-instance SDU tags', () => {
  assert.match(main, /instance: \['ONI', 'ONI2'\]/);
  assert.match(main, /instance: \['MUD', 'MUD2'\]/);
});

test('Marketplace activation loads snapshots while background, faction refresh, and manual refresh sync through the guard', async () => {
  assert.match(renderer, /if \(subtab === 'marketplace'\) \{\s*refreshMarketplace\(\{ sync: false \}\);/);
  assert.match(renderer, /currentEarningsSubtab === 'marketplace' \? refreshMarketplace\(\{ sync: true \}\) : refreshEarnings\(\)/);
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
  assert.equal(snapshotCalls, 2);
  assert.deepEqual(snapshotPayloads.map((settings) => settings.faction), ['MUD', 'MUD']);

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
  assert.equal(snapshotCalls, 3);
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
  assert.match(renderer, /void runMarketplaceBackgroundSync\(\);/);
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
