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

function loadFleetAggregator() {
  const start = renderer.indexOf('function sumFiniteEarningsFields');
  const end = renderer.indexOf('function aggregateTotalCargoRows', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  vm.runInNewContext(`${renderer.slice(start, end)}\nthis.aggregate = aggregateTotalFleetRows;`, context);
  return context.aggregate;
}

test('Scanning, Mining, Crafting, and Upgrading monetary values use their own positive unit denominator', () => {
  const resolve = loadResolver();
  const scanning = { sduFound: 10, revenueAtlasPerDay: 100, foodCostsAtlas: 10, fuelCostsAtlas: 20, rentalRateAtlasPerDay: 5, txsCostsAtlas: 5, totalCostsAtlas: 40, netProfitAtlas: 60 };
  assert.equal(resolve(scanning, 'scanning', 'revenue', false), 100);
  assert.equal(resolve(scanning, 'scanning', 'revenue', true), 10);
  assert.equal(resolve(scanning, 'scanning', 'foodCosts', true), 1);
  assert.equal(resolve(scanning, 'scanning', 'fuelCosts', true), 2);
  assert.equal(resolve(scanning, 'scanning', 'rental', true), 0.5);
  assert.equal(resolve(scanning, 'scanning', 'txsCosts', true), 0.5);
  assert.equal(resolve(scanning, 'scanning', 'totalCosts', true), 4);
  assert.equal(resolve(scanning, 'scanning', 'netProfit', true), 6);

  const mining = { mined: 20, revenueAtlasPerDay: 200, ammoCostsAtlas: 20, foodCostsAtlas: 10, fuelCostsAtlas: 30, rentalRateAtlasPerDay: 10, txsCostsAtlas: 10, totalCostsAtlas: 80, netProfitAtlas: 120 };
  assert.equal(resolve(mining, 'mining', 'revenue', true), 10);
  assert.equal(resolve(mining, 'mining', 'ammoCosts', true), 1);
  assert.equal(resolve(mining, 'mining', 'foodCosts', true), 0.5);
  assert.equal(resolve(mining, 'mining', 'fuelCosts', true), 1.5);
  assert.equal(resolve(mining, 'mining', 'rental', true), 0.5);
  assert.equal(resolve(mining, 'mining', 'txsCosts', true), 0.5);
  assert.equal(resolve(mining, 'mining', 'totalCosts', true), 4);
  assert.equal(resolve(mining, 'mining', 'netProfit', true), 6);

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

test('Mining total-fleet rows remain resource-scoped for Per Unit values', () => {
  const aggregate = loadFleetAggregator();
  const rows = [
    { isoDate: '2026-09-04', rawMaterial: 'Iron Ore', mined: 10, totalCostsAtlas: 20 },
    { isoDate: '2026-09-04', rawMaterial: 'Iron Ore', mined: 30, totalCostsAtlas: 40 },
    { isoDate: '2026-09-04', rawMaterial: 'Copper Ore', mined: 5, totalCostsAtlas: 15 },
  ];
  const totals = aggregate('mining', rows);
  assert.equal(totals.length, 2);
  const iron = totals.find((row) => row.rawMaterial === 'Iron Ore');
  const copper = totals.find((row) => row.rawMaterial === 'Copper Ore');
  assert.equal(iron.mined, 40);
  assert.equal(iron.costsPerUnitAtlas, 1.5);
  assert.equal(copper.costsPerUnitAtlas, 3);
});

test('Per Unit mode fails closed for missing or non-positive denominators', () => {
  const resolve = loadResolver();
  for (const sduFound of [0, -1, null, undefined]) assert.equal(resolve({ sduFound, totalCostsAtlas: 10 }, 'scanning', 'totalCosts', true), null);
  for (const mined of [0, -1, null, undefined]) assert.equal(resolve({ mined, totalCostsAtlas: 10 }, 'mining', 'totalCosts', true), null);
  for (const crafted of [0, -1, null, undefined]) assert.equal(resolve({ crafted, totalCostsAtlas: 10 }, 'crafting', 'totalCosts', true), null);
  for (const installed of [0, -1, null, undefined]) assert.equal(resolve({ installed, totalCostsAtlas: 10 }, 'upgrading', 'totalCosts', true), null);
  assert.equal(resolve({ crafted: 2, totalCostsAtlas: null }, 'crafting', 'totalCosts', true), null);
});

test('Scanning, Mining, Crafting, Upgrading, and Inventory Ledger expose independent orange Per Unit controls', () => {
  assert.equal((html.match(/data-earnings-per-unit=/g) || []).length, 5);
  assert.match(html, /data-earnings-per-unit="scanning"[^>]*>Per Unit</);
  assert.match(html, /data-earnings-per-unit="mining"[^>]*>Per Unit</);
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

test('Scanning, Mining, and Crafting remove the redundant standalone Cost per Unit column', () => {
  const scanningColumns = renderer.slice(renderer.indexOf('const scanningEarningsOptionalColumns'), renderer.indexOf('const miningEarningsOptionalColumns'));
  const miningColumns = renderer.slice(renderer.indexOf('const miningEarningsOptionalColumns'), renderer.indexOf('const cargoEarningsOptionalColumns'));
  const craftingColumns = renderer.slice(renderer.indexOf('const craftingEarningsOptionalColumns'), renderer.indexOf('const upgradingEarningsOptionalColumns'));
  assert.doesNotMatch(scanningColumns, /id: 'costsPerUnit'/);
  assert.doesNotMatch(miningColumns, /id: 'costsPerUnit'/);
  assert.doesNotMatch(craftingColumns, /id: 'costsPerUnit'/);
  const state = renderer.slice(renderer.indexOf('const earningsColumnState'), renderer.indexOf('const EARNINGS_COLUMN_STORAGE_KEY'));
  for (const subtab of ['scanning', 'mining', 'crafting']) {
    assert.doesNotMatch(state.match(new RegExp(`${subtab}: new Set\\([^\\n]+`))?.[0] || '', /costsPerUnit/);
  }
});
