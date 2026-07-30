'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('Marketplace earnings tab sits between Mining and Cargo with agreed LM execution columns', () => {
  assert.match(html, /data-earnings-subtab="mining"[\s\S]*data-earnings-subtab="marketplace"[\s\S]*data-earnings-subtab="cargo"/);
  const panel = html.match(/data-earnings-panel="marketplace"[\s\S]*?<\/div>\s*<div class="earnings-panel" data-earnings-panel="cargo"/)?.[0] || '';
  for (const label of ['Timestamp', 'Marketplace', 'Side', 'Starbase', 'Asset', 'Amount', 'Gross ATLAS', 'Price / C/U', 'Marketplace Fee', 'Tx Fee', 'Net ATLAS', 'Order ID', 'Signature']) {
    assert.match(panel, new RegExp(label.replace('/', '\\/')));
  }
  assert.ok(panel.indexOf('Net ATLAS') < panel.indexOf('Order ID'));
  assert.ok(panel.indexOf('Order ID') < panel.indexOf('Signature'));
});

test('Marketplace renderer exposes LM scan errors and links execution signatures', () => {
  assert.match(renderer, /function renderEarningsMarketplace\(/);
  assert.match(renderer, /localMarketError/);
  assert.match(renderer, /https:\/\/solscan\.io\/tx\//);
  assert.match(main, /localMarketTrades: localMarketResult\.trades/);
});

test('LM scanner resolves the configured profile through the existing settings helper', () => {
  assert.doesNotMatch(main, /getConfiguredPlayerProfile\(/);
  assert.match(main, /const profile = getSelectedPlayerProfile\(settings\);/);
});
