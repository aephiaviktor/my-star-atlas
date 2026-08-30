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

test('Marketplace shows only the table belonging to the active Raw Data or Calculations subtab', () => {
  assert.match(html, /data-marketplace-panel="raw"/);
  assert.match(html, /data-marketplace-panel="events" hidden/);
  assert.match(html, /data-marketplace-panel="calculations" hidden/);
  assert.match(renderer, /panel\.hidden = panel\.dataset\.marketplacePanel !== currentMarketplaceSubtab/);
  assert.match(css, /\[data-marketplace-panel\]\[hidden\]\s*\{\s*display:\s*none/);
});

test('Marketplace Decoded Events is a separate persisted event view linked to raw signatures', () => {
  assert.match(html, /data-marketplace-subtab="events"[^>]*>Decoded Events</);
  assert.match(html, /id="earnings-marketplace-events-table-body"/);
  assert.match(main, /r\._measurement == "marketplace_events"/);
  assert.match(main, /decodedEvents\.rows\.filter\(\(event\) => rawSignatures\.has\(event\.signature\)\)/);
  assert.match(renderer, /function renderMarketplaceDecodedEvents\(result\)/);
  assert.match(renderer, /renderMarketplaceDecodedEvents\(result\)/);
  assert.match(renderer, /eventsReadFailed[\s\S]*marketplaceEvents: prior\.marketplaceEvents/);
  assert.match(main, /async function syncMarketplaceEventsFromRawData[\s\S]*fetchMarketplaceRawDataFromInflux\(settings\)/);
  assert.match(main, /deriveCustodyEventsFromRawRows\(rawData\.rows/);
  assert.match(main, /projectMarketplaceEventsFromRawRows\(rawData\.rows, 'LM'\)/);
  assert.match(main, /projectMarketplaceEventsFromRawRows\(rawData\.rows, 'GM'\)/);
  assert.match(main, /action: 'order_cancelled'/);
  assert.doesNotMatch(main, /writeMarketplaceEvents\(settings, projectMarketplaceOrderAndExecutionEvents\(scanned/);
  assert.match(renderer, /const marketplaceEventColumns = Object\.freeze/);
  assert.match(renderer, /marketplaceEvents: new Set\(marketplaceEventColumns\.map/);
  assert.match(renderer, /currentMarketplaceSubtab === 'events'\) return 'marketplaceEvents'/);
  assert.match(renderer, /function renderMarketplaceEventsHeader\(visibleColumns\)/);
  assert.match(renderer, /dataset\.marketplaceEventsSort = column\.id/);
  assert.match(renderer, /compareMarketplaceEventValues/);
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
