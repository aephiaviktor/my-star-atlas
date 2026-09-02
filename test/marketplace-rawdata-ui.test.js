'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'electron', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'electron', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'electron', 'renderer.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const raw = fs.readFileSync(path.join(root, 'electron', 'marketplace-rawdata.js'), 'utf8');

test('Marketplace Raw Data exposes only transaction filters, sortable facts, and payload details', () => {
  for (const id of ['raw-from', 'raw-to', 'raw-discovery-source']) assert.match(html, new RegExp(`id="earnings-marketplace-${id}"`));
  assert.doesNotMatch(html, /id="earnings-marketplace-raw-stream"/);
  for (const id of ['raw-record', 'raw-wallet', 'raw-event', 'raw-asset']) assert.doesNotMatch(html, new RegExp(`id="earnings-marketplace-${id}"`));
  assert.match(html, /id="earnings-marketplace-raw-coverage-summary"/);
  assert.match(html, /data-marketplace-raw-sort="timestamp"/);
  assert.match(html, /data-marketplace-raw-sort="success"/);
  assert.match(html, /data-marketplace-raw-sort="payloadHash"/);
  assert.match(renderer, /marketplaceRawSort = \{ column: 'timestamp', direction: 'desc' \}/);
  assert.match(renderer, /' ▲' : ' ▼'/);
  assert.match(renderer, /setAttribute\('aria-sort'/);
  assert.match(renderer, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(renderer, /className = 'marketplace-raw-payload'/);
});

test('Marketplace shows only the table belonging to the active global data or Trades subtab', () => {
  assert.match(html, /data-marketplace-panel="raw"/);
  assert.match(html, /data-marketplace-panel="events" hidden/);
  assert.match(html, /data-marketplace-panel="trades" hidden/);
  assert.match(html, /data-marketplace-subtab="trades"[^>]*>Trades</);
  assert.doesNotMatch(html, /data-marketplace-subtab="calculations"|>Calculations</);
  assert.match(renderer, /panel\.hidden = panel\.dataset\.marketplacePanel !== currentMarketplaceSubtab/);
  assert.match(css, /\[data-marketplace-panel\]\[hidden\]\s*\{\s*display:\s*none/);
});

test('Marketplace Decoded Events is a separate persisted event view linked to raw signatures', () => {
  assert.match(html, /data-marketplace-subtab="events"[^>]*>Decoded Events</);
  assert.match(html, /id="earnings-marketplace-raw-status"[^>]*>ALL FACTIONS/);
  assert.match(html, /id="earnings-marketplace-events-status"[^>]*>ALL FACTIONS/);
  assert.match(renderer, /ALL FACTIONS ·.*raw transactions/);
  assert.match(renderer, /ALL FACTIONS ·.*decoded events/);
  assert.match(html, /id="earnings-marketplace-events-table-body"/);
  assert.match(html, /id="earnings-marketplace-events-action"/);
  assert.match(renderer, /const earningsMarketplaceEventsAction = document\.querySelector\('#earnings-marketplace-events-action'\)/);
  assert.match(renderer, /updateMarketplaceRawFilterOptions\(earningsMarketplaceEventsAction, rows\.map\(\(entry\) => entry\.action\)\)/);
  assert.match(renderer, /entry\.action === earningsMarketplaceEventsAction\.value/);
  assert.match(main, /r\._measurement == "marketplace_events"/);
  assert.match(main, /decodedEvents\.rows\.filter\(\(event\) => rawSignatures\.has\(event\.signature\)\)/);
  assert.match(renderer, /function renderMarketplaceDecodedEvents\(result\)/);
  assert.match(renderer, /renderMarketplaceDecodedEvents\(result\)/);
  assert.match(renderer, /eventsReadFailed[\s\S]*marketplaceEvents: prior\.marketplaceEvents/);
  assert.match(main, /async function syncMarketplaceEventsFromRawData[\s\S]*fetchMarketplaceRawDataFromInflux\(settings\)/);
  assert.match(main, /deriveCustodyEventsFromRawRows\(rawData\.rows/);
  assert.match(main, /projectMarketplaceEventsFromRawRows\(rawData\.rows, 'LM', \{[\s\S]*marketAssetsByMint: localMarketAssetsByMint, faction: settings\.faction/);
  assert.match(main, /projectMarketplaceEventsFromRawRows\(rawData\.rows, 'GM'\)/);
  assert.match(main, /decodeLocalMarketTransactions\(transactions, assetMap\)/);
  assert.match(main, /action: 'order_cancelled'/);
  assert.doesNotMatch(main, /writeMarketplaceEvents\(settings, projectMarketplaceOrderAndExecutionEvents\(scanned/);
  assert.match(renderer, /const marketplaceEventColumns = Object\.freeze/);
  assert.match(renderer, /marketplaceEvents: new Set\(marketplaceEventColumns\.map/);
  assert.match(renderer, /currentMarketplaceSubtab === 'events'\) return 'marketplaceEvents'/);
  assert.match(renderer, /function renderMarketplaceEventsHeader\(visibleColumns\)/);
  assert.match(renderer, /dataset\.marketplaceEventsSort = column\.id/);
  assert.match(renderer, /compareMarketplaceEventValues/);
  for (const id of ['marketplaceFeeAtlas', 'transactionFeeSol', 'transactionFeeAtlas']) {
    assert.match(renderer, new RegExp(`id: '${id}'`));
  }
  assert.doesNotMatch(renderer, /id: 'transactionFeeLamports'/);
});

test('Global Ledger is all-wallet and Game Ledger is faction-specific and asymmetric', () => {
  assert.match(html, /data-marketplace-subtab="global"[^>]*>Global Ledger</);
  assert.match(html, /data-marketplace-panel="global" hidden/);
  assert.match(html, /ALL WALLETS · Awaiting global ledger events/);
  assert.match(html, /data-marketplace-subtab="game"[^>]*>Game Ledger</);
  assert.match(html, /data-marketplace-panel="game" hidden/);
  assert.match(html, /data-marketplace-game-direction="deposit"[^>]*>DEPOSITS</);
  assert.match(html, /data-marketplace-game-direction="withdraw"[^>]*>WITHDRAWALS</);
  assert.doesNotMatch(html.match(/data-marketplace-panel="game"[\s\S]*?<\/section>/)?.[0] || '', /ALL FACTIONS|Faction:/);
  assert.match(renderer, /function renderMarketplaceGlobalLedger\(result\)/);
  assert.match(renderer, /function renderMarketplaceGameLedger\(result\)/);
  assert.match(renderer, /result\?\.marketplaceGlobalLedgerRows/);
  assert.match(renderer, /result\?\.marketplaceGameLedgerRows/);
  assert.match(renderer, /marketplaceGameDirection = button\.dataset\.marketplaceGameDirection/);
  assert.match(main, /buildMarketplaceInventoryMovements\(marketplaceEvents, \{[\s\S]*inventoryBasisObservations, breakevenBasisStates/);
  assert.match(main, /projectGameLedgerRows\(marketplaceInventoryLedger\.rows, \{ faction: settings\.faction \}\)/);
});

test('Raw Data and Decoded Events share one reversible signature selector', () => {
  assert.match(html, /id="earnings-marketplace-raw-linked-signature"/);
  assert.match(html, /id="earnings-marketplace-events-linked-signature"/);
  assert.match(renderer, /let marketplaceLinkedSignature = ''/);
  assert.match(renderer, /function setMarketplaceLinkedSignature\(signature\)/);
  assert.match(renderer, /entry\.signature === marketplaceLinkedSignature/);
  assert.match(renderer, /!marketplaceLinkedSignature \|\| entry\.signature === marketplaceLinkedSignature/);
  assert.match(renderer, /renderMarketplaceRawData\(latestMarketplaceResult\)[\s\S]*renderMarketplaceDecodedEvents\(latestMarketplaceResult\)/);
  assert.match(renderer, /input\.checked = Boolean\(entry\.signature && entry\.signature === marketplaceLinkedSignature\)/);
  assert.match(css, /\.marketplace-selector-checkbox\s*\{[\s\S]*width:\s*14px;[\s\S]*height:\s*14px;/);
});

test('Marketplace Raw Data owns persistent sidebar controls for its seven raw transaction columns', () => {
  assert.match(html, /id="earnings-marketplace-raw-table-head"/);
  assert.match(renderer, /const marketplaceRawColumns = Object\.freeze/);
  for (const id of ['timestamp', 'discoverySource', 'slot', 'success', 'signature', 'payloadHash', 'payload']) {
    assert.match(renderer, new RegExp(`id: '${id}'`));
  }
  for (const id of ['record', 'eventType', 'decodedStatus', 'fromWallet', 'toWallet', 'asset', 'quantityRaw', 'atlasAmount', 'program', 'eventId']) {
    assert.doesNotMatch(renderer.match(/const marketplaceRawColumns = Object\.freeze\(\[[\s\S]*?\n\]\);/)?.[0] || '', new RegExp(`id: '${id}'`));
  }
  assert.match(renderer, /marketplaceRaw: new Set\(marketplaceRawColumns\.map/);
  assert.match(renderer, /currentMarketplaceSubtab === 'raw'\) return 'marketplaceRaw'/);
  assert.match(renderer, /renderMarketplaceRawHeader\(visibleColumns\)/);
  assert.match(renderer, /cell\.appendChild\(button\);[\s\S]*row\.appendChild\(cell\)/);
  assert.match(renderer, /for \(const column of visibleColumns\) tr\.appendChild\(createMarketplaceRawCell/);
  assert.match(renderer, /updateMarketplaceSubtab\(\);\s*renderEarningsColumnControls\(\)/);
});

test('Raw reader and writer are transaction-only with no decoded-event projection', () => {
  assert.match(main, /const MARKETPLACE_RAWDATA_CUTOVER_ISO = '2026-08-30T12:00:22\.000Z'/);
  assert.match(main, /const MARKETPLACE_RAWDATA_CUTOVER_SLOT = 442873938/);
  assert.match(main, /range\(start: time\(v: "\$\{MARKETPLACE_RAWDATA_CUTOVER_ISO\}"\)\)/);
  assert.match(main, /r\.discoverySource == "gm_wallet"[\s\S]*r\.discoverySource == "multiple"/);
  assert.match(main, /exists r\.slot and r\.slot >= \$\{MARKETPLACE_RAWDATA_CUTOVER_SLOT\}/);
  assert.match(main, /startIso: MARKETPLACE_RAWDATA_CUTOVER_ISO, startSlot: MARKETPLACE_RAWDATA_CUTOVER_SLOT/);
  assert.match(raw, /Number\(row\.slot\) < Number\(startSlot \|\| 0\)/);
  assert.match(main, /r\.record == "transaction"/);
  assert.match(main, /r\._field == "slot" or r\._field == "success" or r\._field == "payloadHash" or r\._field == "payload"/);
  const rawWriter = main.match(/async function writeMarketplaceRawRecords[\s\S]*?\n}\n/)?.[0] || '';
  assert.doesNotMatch(rawWriter, /streamsBySignature|eventType|fromWallet|quantityRaw/);
  assert.match(rawWriter, /lines\.push\(formatRawTransactionInfluxLine/);
  assert.doesNotMatch(main, /lines\.push\(formatRawEventInfluxLine/);
  assert.match(main, /return \{ transactions: \(records \|\| \[\]\)\.length, events: 0 \}/);
  assert.match(main, /marketplaceRawDataCoverage/);
});

test('Raw ingestion records factual discovery provenance without decoding event streams', () => {
  assert.match(raw, /scope\.kind === 'css' && hasCssCargoGameInstruction/);
  assert.match(raw, /discoverySources\.add\('css_account'\)/);
  assert.match(raw, /scope\.kind === 'gm' && hasGmProgramInstruction/);
  assert.match(raw, /scope\.kind === 'token' && hasTokenTransferInstruction/);
  assert.match(raw, /if \(innerIndex !== null\) return false/);
  assert.match(main, /\[\.\.\.playerWallets, \.\.\.gmWallets\]/);
  assert.match(main, /discoverPlayerTokenAccounts\(connection, tokenAccountOwners/);
  assert.match(main, /\[1, 2\]\.includes\(parsed\?\.schemaVersion\)/);
  assert.match(main, /schemaVersion: 2,[\s\S]*tokenAccountOwners: Array\.isArray\(parsed\.tokenAccountOwners\)/);
  assert.match(raw, /discoverySources: \['lm_scanner'\]/);
  assert.match(raw, /transactions\.filter\(hasTraderProgramInstruction\)/);
  assert.doesNotMatch(raw.match(/async function scanMarketplaceRawData[\s\S]*?return \{ records, cursors:/)?.[0] || '', /classifyCssCargoEvents|playerTransferEvents/);
  assert.doesNotMatch(main, /legacySource|chain: 'legacy_unknown'/);
  assert.match(html, />Discovery Source <select id="earnings-marketplace-raw-discovery-source"/);
});

test('Marketplace snapshot state is independent and retains raw rows after a failed refresh', () => {
  assert.match(renderer, /let latestMarketplaceResult = null/);
  assert.match(renderer, /latestMarketplaceResult = cached/);
  assert.match(renderer, /const rawReadFailed = Boolean\(result\?\.marketplaceRawDataError\)/);
  assert.match(renderer, /marketplaceRawData: prior\.marketplaceRawData/);
  assert.match(renderer, /renderMarketplaceRawData\(latestMarketplaceResult\)/);
  assert.doesNotMatch(renderer, /renderMarketplaceRawData\(latestEarningsResult\)/);
});

test('LM uses already-fetched scanner transactions and GM no longer emits generic observation events', () => {
  assert.match(main, /buildLmRawRecords\(\{/);
  assert.match(main, /transactions: scanned\.rawTransactions/);
  assert.match(main, /writeMarketplaceRawRecords\(settings, lmRawRecords\)/);
  assert.doesNotMatch(raw, /type: 'transaction_observed'/);
  assert.match(raw, /payloadHash=\$\{escapeField\(payloadHash\(event\)\)\}/);
});
