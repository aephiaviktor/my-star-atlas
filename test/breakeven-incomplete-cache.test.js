'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

function loadErrorPolicy() {
  const start = renderer.indexOf('function getBreakevenSnapshotError');
  const end = renderer.indexOf('async function fetchCompleteBreakevenSnapshot', start);
  assert.notEqual(start, -1, 'Breakeven completeness policy must exist');
  assert.notEqual(end, -1, 'validated Breakeven loader must follow the policy');
  const context = {};
  vm.runInNewContext(`${renderer.slice(start, end)}\nthis.getError = getBreakevenSnapshotError;`, context);
  return context.getError;
}

test('Breakeven completeness reports the exact failed evidence source', () => {
  const getError = loadErrorPolicy();
  assert.equal(getError({ ok: false, error: 'backend down' }), 'backend down');
  assert.equal(getError({ ok: true, breakevenError: 'projection failed' }), 'Inventory basis projection: projection failed');
  assert.equal(getError({ ok: true, openingInventoryError: 'Influx unavailable' }), 'Opening inventory baseline: Influx unavailable');
  assert.equal(getError({ ok: true, cargoAllocationLedgerError: 'cargo unavailable' }), 'Cargo allocation ledger: cargo unavailable');
  assert.equal(getError({ ok: true, cargoError: 'fetch failed' }), 'Cargo earnings: fetch failed');
  assert.equal(getError({ ok: true, localMarketError: 'LM unavailable' }), 'Local Marketplace: LM unavailable');
  assert.equal(getError({ ok: true, ledgerCheckpointStatus: 'baseline-unavailable' }), 'Inventory ledger baseline is unavailable');
  assert.equal(getError({ ok: true, breakevenRows: [] }), '');
});

test('foreground and background Breakeven loads reject incomplete snapshots', () => {
  assert.match(renderer, /async function fetchCompleteBreakevenSnapshot[\s\S]*getBreakevenSnapshotError\(result\)[\s\S]*throw new Error\(error\)/);
  assert.match(renderer, /earnings-breakeven[\s\S]*load: \(\) => api\.breakevenCache\.ensure\([^\n]*fetchCompleteBreakevenSnapshot\(settings\)/);
  const refresh = renderer.slice(renderer.indexOf('async function refreshBreakeven'), renderer.indexOf('async function refreshCargoAllocation'));
  assert.match(refresh, /api\.breakevenCache\.ensure\(input, \(\) => fetchCompleteBreakevenSnapshot\(settings\)\)/);
});

test('Inventory Ledger rendering preserves exact source diagnostics', () => {
  const render = renderer.slice(renderer.indexOf('function renderEarningsBreakeven(result)'), renderer.indexOf('// Legacy wiring assertions'));
  assert.match(render, /const snapshotError = getBreakevenSnapshotError\(result\)/);
  assert.match(render, /snapshotError \? ' · ' \+ snapshotError : ''/);
});

test('missing optional deposit baselines degrade to estimated evidence instead of blanking the ledger', () => {
  const baselineFetch = main.slice(main.indexOf('async function fetchInventoryDepositBaselines'), main.indexOf('async function fetchShipStatsSot'));
  assert.doesNotMatch(baselineFetch, /throw new Error\('inventory_deposit_baseline_missing'\)/);
  assert.match(baselineFetch, /return rows/);
});

test('Inventory Ledger resets unavailable faction filters before rendering rows', () => {
  const render = renderer.slice(renderer.indexOf('function renderEarningsBreakeven(result)'), renderer.indexOf('// Legacy wiring assertions'));
  assert.ok(render.indexOf("populateEarningsFilterOptions('breakeven'") < render.indexOf('renderInventoryCostLedger(result)'));
});
