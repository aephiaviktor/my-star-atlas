'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'electron', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'electron', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const raw = fs.readFileSync(path.join(root, 'electron', 'marketplace-rawdata.js'), 'utf8');

test('Marketplace Raw Data exposes filters, coverage, sortable headers, and payload details', () => {
  for (const id of ['raw-from', 'raw-to', 'raw-stream', 'raw-record', 'raw-wallet', 'raw-event', 'raw-asset']) {
    assert.match(html, new RegExp(`id="earnings-marketplace-${id}"`));
  }
  assert.match(html, /id="earnings-marketplace-raw-coverage-summary"/);
  assert.match(html, /data-marketplace-raw-sort="timestamp"/);
  assert.match(html, /data-marketplace-raw-sort="quantityRaw"/);
  assert.match(html, /data-marketplace-raw-sort="payloadHash"/);
  assert.match(renderer, /marketplaceRawSort = \{ column: 'timestamp', direction: 'desc' \}/);
  assert.match(renderer, /' ▲' : ' ▼'/);
  assert.match(renderer, /setAttribute\('aria-sort'/);
  assert.match(renderer, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(renderer, /className = 'marketplace-raw-payload'/);
});

test('Marketplace Raw Data owns persistent sidebar controls for its current table columns', () => {
  assert.match(html, /id="earnings-marketplace-raw-table-head"/);
  assert.match(renderer, /const marketplaceRawColumns = Object\.freeze/);
  for (const id of ['timestamp', 'record', 'stream', 'eventType', 'decodedStatus', 'fromWallet', 'toWallet', 'asset', 'quantityRaw', 'atlasAmount', 'program', 'slot', 'eventId', 'signature', 'payloadHash', 'payload']) {
    assert.match(renderer, new RegExp(`id: '${id}'`));
  }
  assert.match(renderer, /marketplaceRaw: new Set\(marketplaceRawColumns\.map/);
  assert.match(renderer, /currentMarketplaceSubtab === 'raw'\) return 'marketplaceRaw'/);
  assert.match(renderer, /renderMarketplaceRawHeader\(visibleColumns\)/);
  assert.match(renderer, /cell\.appendChild\(button\);[\s\S]*row\.appendChild\(cell\)/);
  assert.match(renderer, /for \(const column of visibleColumns\) tr\.appendChild\(createMarketplaceRawCell/);
  assert.match(renderer, /updateMarketplaceSubtab\(\);\s*renderEarningsColumnControls\(\)/);
});

test('Raw reader keeps transaction rows neutral and attributes wallets only on decoded event rows', () => {
  assert.match(main, /row\.payload\?\.type === 'transaction_observed'/);
  assert.match(main, /eventType: isEvent \? String\(payload\.type \|\| ''\) : 'transaction'/);
  assert.match(main, /fromWallet: isEvent \? String\(payload\.fromWallet/);
  assert.match(main, /toWallet: isEvent \? String\(payload\.toWallet/);
  assert.doesNotMatch(main, /firstSigner/);
  assert.match(main, /quantityRaw:/);
  assert.match(main, /decodedStatus:/);
  assert.match(main, /marketplaceRawDataCoverage/);
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
