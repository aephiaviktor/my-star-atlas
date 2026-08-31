'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildRpcUsageView, tabsForMenu } = require('../electron/rpc-usage-model');
const { normalizeContext } = require('../electron/telemetry-context');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'electron', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'electron', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');

test('cascading menu, tab, faction, and method filtering keeps the UTC-day total separate', () => {
  const summary = {
    totalRequests: 10,
    rows: [
      { menu: 'EA', tab: 'scanning', faction: 'MUD', method: 'getTransaction', provider: 'main', requests: 4, retries: 1, fallbackAttempts: 0, batchElements: 0 },
      { menu: 'EA', tab: 'mining', faction: 'MUD', method: 'getAccountInfo', provider: 'main', requests: 2, retries: 0, fallbackAttempts: 0, batchElements: 0 },
      { menu: 'PC', tab: 'cargo', faction: 'ONI', method: 'getTransaction', provider: 'fallback', requests: 3, retries: 1, fallbackAttempts: 1, batchElements: 0 },
      { faction: 'global', method: 'batch', provider: 'direct', requests: 1, retries: 0, fallbackAttempts: 0, batchElements: 5 },
    ],
  };
  const view = buildRpcUsageView(summary, { menu: 'EA', tab: 'scanning', faction: 'MUD', method: 'getTransaction' });
  assert.equal(view.dayTotal, 10);
  assert.deepEqual(view.filtered, { requests: 4, retries: 1, fallbackAttempts: 0, batchElements: 0 });
  assert.equal(view.filteredShare, 0.4);
  assert.deepEqual(view.methods.map((item) => item.method), ['getTransaction']);
});

test('RPC Usage tab choices follow the fixed visible menu structure', () => {
  assert.deepEqual(tabsForMenu('MF').map((item) => item.label), ['My Fleets']);
  assert.deepEqual(tabsForMenu('PC').map((item) => item.label), ['Scanning', 'Mining', 'Crafting', 'Production', 'Consumption', 'PCR Charts', 'Inventory']);
  assert.deepEqual(tabsForMenu('EA').map((item) => item.label), ['Scanning', 'Mining', 'Marketplace', 'Cargo', 'Crafting', 'Upgrading', 'Inventory Ledger']);
  assert.deepEqual(tabsForMenu('OP').map((item) => item.label), ['Scanning', 'Upgrading']);
  assert.deepEqual(tabsForMenu('EA', [{ menu: 'EA', tab: 'unattributed' }]).map((item) => item.label), ['Scanning', 'Mining', 'Marketplace', 'Cargo', 'Crafting', 'Upgrading', 'Inventory Ledger', 'Unattributed']);
});

test('RPC Usage UI moves Settings readiness into the button and exposes one trusted aggregate endpoint', () => {
  const settingsButton = html.match(/<button id="open-settings-btn"[\s\S]*?<\/button>/)?.[0] || '';
  const versionLine = html.match(/<div class="version-line">[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(settingsButton, /id="settings-status-dot"/);
  assert.match(settingsButton, /title="Settings Incomplete"/);
  assert.doesNotMatch(html, /id="settings-status"/);
  assert.match(versionLine, /id="version-label"/);
  assert.match(versionLine, /id="rpc-usage-btn"/);
  assert.match(html, /id="rpc-usage-menu-select"/);
  assert.match(html, /id="rpc-usage-tab-select"/);
  assert.match(html, />My Fleets</);
  assert.match(html, />Production \/ Consumption</);
  assert.match(html, />Earnings</);
  assert.match(html, />Optimization</);
  assert.match(main, /'consumption:cargo': \['PC', 'consumption'\]/);
  assert.match(main, /'optimization:scanning': \['OP', 'scanning'\]/);
  assert.match(html, /rpc-usage-date-select[\s\S]*rpc-usage-faction-select[\s\S]*rpc-usage-menu-select[\s\S]*rpc-usage-tab-select[\s\S]*rpc-usage-method-select/);
  assert.doesNotMatch(html, /<option value="all">Total<\/option>/);
  assert.match(renderer, /Settings Ready/);
  assert.match(renderer, /Settings Incomplete/);
  assert.match(preload, /getRpcUsageDay: \(utcDate\) => ipcRenderer\.invoke\('telemetry:rpc-usage-day', utcDate\)/);
  assert.match(main, /handleTrustedIpc\('telemetry:rpc-usage-day'/);
  assert.match(renderer, /No telemetry recorded/);
});

test('telemetry attribution keeps Shared/Global distinct and preserves safe RPC method names', () => {
  assert.equal(normalizeContext({ faction: 'GLOBAL' }).faction, 'global');
  assert.equal(normalizeContext({ faction: 'not-a-faction' }).faction, 'unknown');
  assert.equal(normalizeContext({ rpcMethod: 'getTransaction' }).rpcMethod, 'getTransaction');
  assert.equal(normalizeContext({ rpcMethod: 'https://secret.invalid' }).rpcMethod, 'unknown');
});
