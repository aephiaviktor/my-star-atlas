'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');

test('earnings snapshot persists current fleet compositions to the SQLite fleet store', () => {
  assert.match(main, /const \{ createFleetCompositionStore \} = require\('\.\/fleet-composition-store'\)/);
  assert.match(main, /function getFleetCompositionStore\(\)/);
  assert.match(main, /fleet-compositions-v1\.sqlite/);
  assert.match(main, /fleetCompositionStore\.upsertComposition\(\{/);
  assert.match(main, /fleetAccount: account,/);
  assert.match(main, /ships: fleet\.ships \|\| \[\]/);
  assert.match(main, /compositionObservedAtMs/);
  assert.match(main, /storedCompositionFor\(/);
  assert.match(main, /fleetCompositionStore\.readComposition\(/);
  assert.match(main, /fleetCompositionStore\.readCompositionByLabel\(/);
});

test('mining rows fall back to the stored fleet composition for ships and crew', () => {
  const miningStart = main.indexOf('const mining = await Promise.all(miningRows.map');
  const miningRegion = main.slice(miningStart, main.indexOf('const miningCostTotalsByFleetDateAndMaterial', miningStart));
  assert.match(miningRegion, /const storedComposition = fleet \? null : storedCompositionFor\(resolvedFleetAccount, miningRow\.fleet\)/);
  assert.match(miningRegion, /ships: fleet\?\.ships \|\| storedComposition\?\.ships \|\| \[\]/);
  assert.match(miningRegion, /shipTypes: fleet\?\.shipTypes \|\| storedComposition\?\.shipTypes \|\| 0/);
  assert.match(miningRegion, /historicalRental\?\.requiredCrew \?\? fleet\?\.totalRequiredCrew \?\? storedComposition\?\.totalRequiredCrew \?\? null/);
});

test('scanning and cargo rows also fall back to the stored fleet composition', () => {
  const scanningStart = main.indexOf('const rows = await Promise.all(scanningRows.map');
  const scanningRegion = main.slice(scanningStart, main.indexOf('for (const row of rows)', scanningStart));
  assert.match(scanningRegion, /storedCompositionFor\('', scanRow\.fleet\)/);
  assert.match(scanningRegion, /ships: fleet\?\.ships \|\| storedComposition\?\.ships \|\| \[\]/);
  const cargoStart = main.indexOf('let cargo = await Promise.all(cargoRows.map');
  const cargoRegion = main.slice(cargoStart, main.indexOf('cargo = projectCargoFleetDateRows', cargoStart));
  assert.match(cargoRegion, /storedCompositionFor\(authoritativeAccount \|\| historicalRental\?\.fleetAccount \|\| '', cargoRow\.fleet\)/);
  assert.match(cargoRegion, /ships: fleet\?\.ships \|\| storedComposition\?\.ships \|\| \[\]/);
});

test('mining TXS application keeps per-material telemetry for ambiguous multi-material fleet-days', () => {
  const miningStart = main.indexOf('const mining = await Promise.all(miningRows.map');
  const miningRegion = main.slice(miningStart, main.indexOf('const miningCostTotalsByFleetDateAndMaterial', miningStart));
  assert.match(miningRegion, /const miningDayUnambiguous = unambiguousMiningFleetDays\.has/);
  assert.match(miningRegion, /applyMiningFleetDayTransactionEvidence\(miningRow, \{/);
  assert.match(miningRegion, /unambiguous: miningDayUnambiguous,/);
  assert.match(miningRegion, /canonicalRows: canonicalMiningTransactions,/);
});