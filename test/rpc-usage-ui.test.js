'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildRpcUsageView } = require('../electron/rpc-usage-model');
const { normalizeContext } = require('../electron/telemetry-context');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'electron', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'electron', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');

test('combined faction and method filtering keeps the UTC-day total separate', () => {
  const summary = {
    totalRequests: 10,
    rows: [
      { faction: 'MUD', method: 'getTransaction', provider: 'main', requests: 4, retries: 1, fallbackAttempts: 0, batchElements: 0 },
      { faction: 'MUD', method: 'getAccountInfo', provider: 'main', requests: 2, retries: 0, fallbackAttempts: 0, batchElements: 0 },
      { faction: 'ONI', method: 'getTransaction', provider: 'fallback', requests: 3, retries: 1, fallbackAttempts: 1, batchElements: 0 },
      { faction: 'global', method: 'batch', provider: 'direct', requests: 1, retries: 0, fallbackAttempts: 0, batchElements: 5 },
    ],
  };
  const view = buildRpcUsageView(summary, { faction: 'MUD', method: 'getTransaction' });
  assert.equal(view.dayTotal, 10);
  assert.deepEqual(view.filtered, { requests: 4, retries: 1, fallbackAttempts: 0, batchElements: 0 });
  assert.equal(view.filteredShare, 0.4);
  assert.deepEqual(view.methods.map((item) => item.method), ['getTransaction']);
});

test('RPC Usage UI moves Settings readiness into the button and exposes one trusted aggregate endpoint', () => {
  const settingsButton = html.match(/<button id="open-settings-btn"[\s\S]*?<\/button>/)?.[0] || '';
  const versionLine = html.match(/<div class="version-line">[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(settingsButton, /id="settings-status-dot"/);
  assert.match(settingsButton, /title="Settings Incomplete"/);
  assert.doesNotMatch(html, /id="settings-status"/);
  assert.match(versionLine, /id="version-label"/);
  assert.match(versionLine, /id="rpc-usage-btn"/);
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
