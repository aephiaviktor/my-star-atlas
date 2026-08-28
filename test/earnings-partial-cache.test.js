'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');

function loadPolicy() {
  const start = renderer.indexOf('function isEarningsSnapshotCacheComplete');
  const end = renderer.indexOf('function getCachedFactionResult', start);
  assert.notEqual(start, -1, 'cache-completeness policy must exist');
  assert.notEqual(end, -1, 'cache-completeness policy must precede faction cache access');
  const context = {};
  vm.runInNewContext(`${renderer.slice(start, end)}\nthis.policy = isEarningsSnapshotCacheComplete;`, context);
  return context.policy;
}

test('partial Earnings category failures never satisfy the background cache', () => {
  const isComplete = loadPolicy();
  assert.equal(isComplete({ ok: true, cargoError: 'fetch failed' }), false);
  assert.equal(isComplete({ ok: true, scanningError: 'fetch failed' }), false);
  assert.equal(isComplete({ ok: true, miningError: 'fetch failed' }), false);
  assert.equal(isComplete({ ok: true, craftingError: 'fetch failed' }), false);
  assert.equal(isComplete({ ok: true, upgradingError: 'fetch failed' }), false);
  assert.equal(isComplete({ ok: false }), false);
  assert.equal(isComplete({ ok: true, cargoError: '', miningError: '' }), true);
});

test('Earnings prefetch retries an existing partial faction snapshot', () => {
  assert.match(renderer, /cached: \(\) => isEarningsSnapshotCacheComplete\(getCachedFactionResult\(faction, 'earnings'\)\) \|\| !profile/);
});
