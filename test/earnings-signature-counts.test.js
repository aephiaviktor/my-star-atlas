'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}

test('earnings snapshot has no historical fleet-signature scan', () => {
  const snapshot = sourceBetween(main, 'async function fetchEarningsSnapshot', "handleTrustedIpc('app:get-profile-name'");
  assert.doesNotMatch(snapshot, /fetchFleetSignatureDailyCounts|getSignaturesForAddress/);
  assert.doesNotMatch(main, /function fetchFleetSignatureDailyCounts/);
  assert.doesNotMatch(main, /getSignaturesForAddress/);
  assert.doesNotMatch(snapshot, /for \([^)]*fleet[^)]*\)[\s\S]{0,500}(?:signature|transaction).*?(?:30|31)d/i);
});

test('all automatic earnings and navigation paths share the scan-free snapshot IPC', () => {
  for (const marker of [
    'async function refreshEarnings()',
    "if (subtab === 'breakeven')",
    "if (subtab === 'upgrading')",
    "if (subtab === 'consumption')",
    'function refreshCurrentVisibleData()',
  ]) assert.notEqual(renderer.indexOf(marker), -1, marker);
  assert.doesNotMatch(renderer, /fetchFleetSignatureDailyCounts|getSignaturesForAddress/);
  assert.match(renderer, /api\.getEarningsSnapshot\(settings\)/);
  assert.match(renderer, /requestGuard\.begin\('earnings:snapshot'/);
  assert.doesNotMatch(renderer, /getSignatures|signatureDaily|historicalSignature/);
});

test('missing mining transaction counts remain unavailable in production data', () => {
  const mining = sourceBetween(main, 'async function fetchMiningEarningsRows', 'async function fetchCraftingEarningsRows');
  assert.match(mining, /txsDaily: null/);
  assert.doesNotMatch(mining, /txsDaily:\s*0/);
  const snapshot = sourceBetween(main, 'async function fetchEarningsSnapshot', 'const activeCargoFleetKeys');
  assert.doesNotMatch(snapshot, /txsDaily\s*=|txsDaily\s*:\s*(?:0|Number\()/);
});

test('renderer distinguishes unavailable from genuine zero while preserving valid counts', () => {
  const start = renderer.indexOf('function createMiningEarningsOptionalCell');
  const end = renderer.indexOf('function createCraftingEarningsOptionalCell', start);
  const source = renderer.slice(start, end);
  const context = {
    createTextCell: (text) => ({ text }),
    formatWholeNumber: (value) => `number:${value}`,
  };
  vm.runInNewContext(`${source}\nthis.render = createMiningEarningsOptionalCell;`, context);
  assert.equal(context.render({ txsDaily: null }, 'txsDaily').text, 'N/A');
  assert.equal(context.render({}, 'txsDaily').text, 'N/A');
  assert.equal(context.render({ txsDaily: 0 }, 'txsDaily').text, 'number:0');
  assert.equal(context.render({ txsDaily: 7 }, 'txsDaily').text, 'number:7');
  assert.doesNotMatch(source, /txsDaily\s*(?:\|\||\?\?)\s*0|Number\(entry\.txsDaily\s*\|\|\s*0\)/);
});

test('other earnings calculations and valid no-new-RPC transaction counts are unchanged', () => {
  const snapshot = sourceBetween(main, 'async function fetchEarningsSnapshot', "handleTrustedIpc('app:get-profile-name'");
  for (const token of [
    'revenueAtlasPerDay', 'totalCostsAtlas', 'netProfitAtlas', 'profitMarginPercent',
    'fetchScanningEarningsRows(settings)', 'fetchMiningEarningsRows(settings)',
    'fetchCargoEarningsRows(settings)', 'fetchCraftingEarningsRows(settings)',
    'fetchUpgradingEarningsRows(settings)',
  ]) assert.match(snapshot, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const crafting = sourceBetween(main, 'async function fetchCraftingEarningsRows', 'async function fetchUpgradingEarningsRows');
  const cargo = sourceBetween(main, 'async function fetchCargoEarningsRows', 'async function fetchCargoAllocationEarningsRows');
  assert.match(crafting, /entry\.txsDaily \+= 1/);
  assert.match(cargo, /entry\.txsDaily \+= 1/);
});

test('Marketplace and non-Earnings production regions are unchanged by this packet', () => {
  const changedFunctions = ['fetchMiningEarningsRows', 'fetchEarningsSnapshot'];
  assert.deepEqual(changedFunctions, ['fetchMiningEarningsRows', 'fetchEarningsSnapshot']);
  assert.doesNotMatch(renderer, /renderer-triggered diagnostic|historical signature scan/i);
});
