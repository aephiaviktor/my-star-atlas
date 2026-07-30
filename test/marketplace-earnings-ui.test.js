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
