'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.css'), 'utf8');

function loadResolver() {
  const start = renderer.indexOf('function resolveEarningsMonetaryDisplayValue');
  const end = renderer.indexOf('function isEarningsPerUnitColumn', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  vm.runInNewContext(`${renderer.slice(start, end)}\nthis.resolve = resolveEarningsMonetaryDisplayValue;`, context);
  return context.resolve;
}

test('Crafting and Upgrading monetary values use their own positive unit denominator', () => {
  const resolve = loadResolver();
  const crafting = { crafted: 4, revenueAtlasPerDay: 100, ingCostsAtlas: 20, feeCostsAtlas: 8, txsCostsAtlas: 4, totalCostsAtlas: 32, netProfitAtlas: 68 };
  assert.equal(resolve(crafting, 'crafting', 'revenue', false), 100);
  assert.equal(resolve(crafting, 'crafting', 'revenue', true), 25);
  assert.equal(resolve(crafting, 'crafting', 'ingCosts', true), 5);
  assert.equal(resolve(crafting, 'crafting', 'feeCosts', true), 2);
  assert.equal(resolve(crafting, 'crafting', 'txsCosts', true), 1);
  assert.equal(resolve(crafting, 'crafting', 'totalCosts', true), 8);
  assert.equal(resolve(crafting, 'crafting', 'netProfit', true), 17);

  const upgrading = { installed: 5, revenueAtlasPerDay: 80, upgradingCostsAtlas: 30, txsCostsAtlas: 5, totalCostsAtlas: 35, netProfitAtlas: 45 };
  assert.equal(resolve(upgrading, 'upgrading', 'revenue', true), 16);
  assert.equal(resolve(upgrading, 'upgrading', 'upgCosts', true), 6);
  assert.equal(resolve(upgrading, 'upgrading', 'txsCosts', true), 1);
  assert.equal(resolve(upgrading, 'upgrading', 'totalCosts', true), 7);
  assert.equal(resolve(upgrading, 'upgrading', 'netProfit', true), 9);
});

test('Per Unit mode fails closed for missing or non-positive Crafted and Installed', () => {
  const resolve = loadResolver();
  for (const crafted of [0, -1, null, undefined]) assert.equal(resolve({ crafted, totalCostsAtlas: 10 }, 'crafting', 'totalCosts', true), null);
  for (const installed of [0, -1, null, undefined]) assert.equal(resolve({ installed, totalCostsAtlas: 10 }, 'upgrading', 'totalCosts', true), null);
  assert.equal(resolve({ crafted: 2, totalCostsAtlas: null }, 'crafting', 'totalCosts', true), null);
});

test('Crafting, Upgrading, and Inventory Ledger expose independent orange Per Unit controls', () => {
  assert.equal((html.match(/data-earnings-per-unit=/g) || []).length, 3);
  assert.match(html, /data-earnings-per-unit="crafting"[^>]*>Per Unit</);
  assert.match(html, /data-earnings-per-unit="upgrading"[^>]*>Per Unit</);
  assert.match(html, /data-earnings-per-unit="inventoryLedger"[^>]*>Per Unit</);
  assert.match(css, /\.earnings-per-unit-btn/);
  assert.match(css, /\.earnings-per-unit-btn\.active/);
  assert.match(css, /\.earnings-per-unit-column/);
  assert.match(renderer, /earningsPerUnitModeByFaction/);
  assert.match(renderer, /label = `\$\{label\} \/ Unit`/);
  assert.match(renderer, /sortEarningsRows[\s\S]*resolveEarningsMonetaryDisplayValue\(row, subtab, sortState\.column, true\)/);
});

test('Crafting removes the redundant standalone Cost per Unit column', () => {
  const columns = renderer.slice(renderer.indexOf('const craftingEarningsOptionalColumns'), renderer.indexOf('const upgradingEarningsOptionalColumns'));
  assert.doesNotMatch(columns, /id: 'costsPerUnit'/);
  const state = renderer.slice(renderer.indexOf('const earningsColumnState'), renderer.indexOf('const EARNINGS_COLUMN_STORAGE_KEY'));
  assert.doesNotMatch(state.match(/crafting: new Set\([^\n]+/)?.[0] || '', /costsPerUnit/);
});
