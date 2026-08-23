'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const renderer = fs.readFileSync(require.resolve('../electron/renderer'), 'utf8');

function extractFunction(name) {
  const start = renderer.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < renderer.length; index += 1) {
    if (renderer[index] === '{') { depth += 1; opened = true; }
    if (renderer[index] === '}') depth -= 1;
    if (opened && depth === 0) return renderer.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('a slower Cargo Beta response stays loading and renders automatically when it completes', async () => {
  const source = extractFunction('createLatestEarningsResponseCoordinator');
  const context = {};
  vm.runInNewContext(`${source}; coordinator = createLatestEarningsResponseCoordinator();`, context);
  const slow = deferred();
  const events = [];
  const pending = context.coordinator.run({
    load: () => slow.promise,
    onLoading: () => events.push('Loading Cargo allocations…'),
    onResult: (value) => events.push(`rows:${value.cargoBreakevenBetaRows.length}`),
  });
  assert.deepEqual(events, ['Loading Cargo allocations…']);
  slow.resolve({ cargoBreakevenBetaRows: [{ betaId: 'cycle:1' }] });
  assert.equal((await pending).accepted, true);
  assert.deepEqual(events, ['Loading Cargo allocations…', 'rows:1']);
});

test('an older overlapping Earnings refresh cannot overwrite the newer result', async () => {
  const source = extractFunction('createLatestEarningsResponseCoordinator');
  const context = {};
  vm.runInNewContext(`${source}; coordinator = createLatestEarningsResponseCoordinator();`, context);
  const older = deferred();
  const newer = deferred();
  const rendered = [];
  const first = context.coordinator.run({ load: () => older.promise, onLoading: () => {}, onResult: (value) => rendered.push(value.id) });
  const second = context.coordinator.run({ load: () => newer.promise, onLoading: () => {}, onResult: (value) => rendered.push(value.id) });
  newer.resolve({ id: 'newer' });
  assert.equal((await second).accepted, true);
  older.resolve({ id: 'older' });
  assert.equal((await first).accepted, false);
  assert.deepEqual(rendered, ['newer']);
});

test('initial and manual Earnings refresh paths include Cargo Beta without changing backend queries', () => {
  assert.match(renderer, /function renderCargoBreakevenBetaLoading\(message = 'Loading Cargo allocations…'\)/);
  const refresh = renderer.slice(renderer.indexOf('async function refreshEarnings('), renderer.indexOf('\nfunction optimizationFilterIso'));
  assert.match(refresh, /renderCargoBreakevenBetaLoading\(\)/);
  assert.match(refresh, /renderCargoBreakevenBeta\(result\)/);
  assert.match(refresh, /responseCoordinator\.run/);
  const manual = renderer.slice(renderer.indexOf('function refreshCurrentVisibleData'), renderer.indexOf('\nfunction setActiveSubtab'));
  assert.match(manual, /return refreshEarnings\(\{ force: true \}\)/);
});
