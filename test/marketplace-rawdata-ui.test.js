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
  assert.match(html, /data-marketplace-panel="calculations" hidden/);
  assert.match(renderer, /panel\.hidden = panel\.dataset\.marketplacePanel !== currentMarketplaceSubtab/);
  assert.match(css, /\[data-marketplace-panel\]\[hidden\]\s*\{\s*display:\s*none/);
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
  assert.match(main, /r\.record == "transaction"/);
  assert.match(main, /r\._field == "slot" or r\._field == "success" or r\._field == "payloadHash" or r\._field == "payload"/);
  assert.doesNotMatch(main, /streamsBySignature/);
  assert.doesNotMatch(main, /eventType: isEvent/);
  assert.doesNotMatch(main, /fromWallet: isEvent/);
  assert.doesNotMatch(main, /quantityRaw:/);
  assert.match(main, /lines\.push\(formatRawTransactionInfluxLine/);
  assert.doesNotMatch(main, /lines\.push\(formatRawEventInfluxLine/);
  assert.match(main, /return \{ transactions: \(records \|\| \[\]\)\.length, events: 0 \}/);
  assert.match(main, /marketplaceRawDataCoverage/);
});

test('Raw ingestion records factual discovery provenance without decoding event streams', () => {
  assert.match(raw, /gm: 'gm_wallet', css: 'css_account', token: 'token_account'/);
  assert.match(raw, /discoverySources: \['lm_scanner'\]/);
  assert.doesNotMatch(raw.match(/async function scanMarketplaceRawData[\s\S]*?return \{ records, cursors:/)?.[0] || '', /classifyCssCargoEvents|playerTransferEvents/);
  assert.match(main, /gm: 'gm_wallet', lm: 'lm_scanner', deposit: 'css_account', withdraw: 'css_account'/);
  assert.match(main, /transfer: 'token_account', multi: 'multiple', chain: 'legacy_unknown'/);
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
