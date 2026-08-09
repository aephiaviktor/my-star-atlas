'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '..', 'electron/main.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'electron/cargo-cost-source.js'), 'utf8');
const price = fs.readFileSync(path.join(__dirname, '..', 'electron/atlas-price-resolver.js'), 'utf8');

test('earnings snapshot uses existing Influx path and bounded worker cadence for raw points', () => {
  assert.match(main, /fetchCanonicalRawCargoCosts/);
  assert.match(main, /queryInfluxFlux\(settings, query\)/);
  assert.match(main, /\(\) => fetchCanonicalRawCargoCosts\(settings\)/);
  assert.doesNotMatch(source, /fetch\(|Connection\(|setInterval|setTimeout|price.*fetch|RPC/i);
});

test('cutover is applied before authoritative cargo totals and allocation valuation', () => {
  const selection = main.indexOf('selectLegacyRawCutover');
  const cargoProjection = main.indexOf('const activeCargoFleetKeys');
  const allocation = main.indexOf('enrichedCargoAllocationRows = applyRawCostsToCargoAllocations');
  assert.ok(selection >= 0 && selection < cargoProjection);
  assert.ok(allocation > cargoProjection);
  assert.match(main, /const cutoverOwnedCargoRows = selectCutoverOwnedCargoRows\(\{[\s\S]*legacyRows: cutoverSelection\.legacyRows[\s\S]*cutover: cutoverSelection\.cutover/);
  assert.match(main, /cargoRows = joinCanonicalCostsWithOperationalRows\(\{[\s\S]*legacyRows: cutoverOwnedCargoRows\.legacyRows\.map[\s\S]*costRows: canonicalRawDailyRows[\s\S]*operationalRows: cutoverOwnedCargoRows\.operationalRows/);
});

test('canonical allocation scope uses immutable fleet accounts and compatibility route evidence only', () => {
  assert.doesNotMatch(source, /fleetAccount\s*\|\|\s*(?:record\.)?fleetLabel/);
  assert.doesNotMatch(source, /allocationKey[^\n]*(?:fleetLabel|assignment)/);
  assert.match(source, /allocationReason: unallocated \? 'allocation_scope_missing' : null/);
  assert.match(source, /rawDailyRows\.filter\(\(row\) => row\.allocationStatus !== 'unallocated' && clean\(row\.fleetAccount\)\)/);
  assert.match(main, /fleetByAccount\.get\(authoritativeAccount\)/);
  assert.match(main, /cargoFleetAccountFromCycleId\(row\.cycleId\)/);
  assert.match(main, /group\(columns: \["fleet", "assignment", "starbase", "cycleId", "_time"\]\)/);
  assert.match(main, /new Set\(compatibilityCargoRows\.map\(\(row\) => String\(row\.fleetAccount/);
  assert.match(main, /enrichCargoAllocationRows\([\s\S]*fleetByAccount/);
});

test('frozen price seed remains exactly July 6 through August 4', () => {
  assert.match(price, /INITIAL_SEED_START_UTC = '2026-07-06'/);
  assert.match(price, /INITIAL_SEED_END_UTC = '2026-08-04'/);
  assert.doesNotMatch(source, /aephia_historical|captureCurrentPriceSeeds|INITIAL_SEED_END_UTC/);
});
