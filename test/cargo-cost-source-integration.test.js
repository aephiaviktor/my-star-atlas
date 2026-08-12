'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '..', 'electron/main.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'electron/cargo-cost-source.js'), 'utf8');
const price = fs.readFileSync(path.join(__dirname, '..', 'electron/atlas-price-resolver.js'), 'utf8');
const projector = fs.readFileSync(path.join(__dirname, '..', 'electron/cargo-allocation-projector.js'), 'utf8');

test('earnings snapshot uses existing Influx path and bounded worker cadence for raw points', () => {
  assert.match(main, /fetchCanonicalRawCargoCosts/);
  assert.match(main, /queryInfluxFlux\(settings, query\)/);
  assert.match(main, /\(\) => fetchCanonicalRawCargoCosts\(settings\)/);
  assert.doesNotMatch(source, /fetch\(|Connection\(|setInterval|setTimeout|price.*fetch|RPC/i);
});

test('dedicated Allocation applies cutover before canonical valuation', () => {
  const dedicated = projector;
  const selection = dedicated.indexOf('selectCutover(');
  const application = dedicated.indexOf('applyRawCosts(');
  const valuation = dedicated.indexOf("resolvePrice('Fuel', row.isoDate)");
  assert.ok(selection >= 0 && selection < application && application < valuation);
  assert.match(dedicated, /valueRawCosts[\s\S]*aggregateRawCosts[\s\S]*applyRawCosts/);
  assert.match(dedicated, /valueNativeCost\(\{ eventType: 'fuel'/);
  assert.match(dedicated, /valueNativeCost\(\{ eventType: 'sol_fee'/);
});

test('dedicated Allocation scope uses immutable fleet accounts and exact completion evidence', () => {
  const dedicated = projector;
  assert.doesNotMatch(source, /fleetAccount\s*\|\|\s*(?:record\.)?fleetLabel/);
  assert.doesNotMatch(source, /allocationKey[^\n]*(?:fleetLabel|assignment)/);
  assert.match(source, /allocationReason: unallocated \? 'allocation_scope_missing' : null/);
  assert.match(source, /rawDailyRows\.filter\(\(entry\) => entry\.allocationStatus !== 'unallocated' && clean\(entry\.fleetAccount\)\)/);
  assert.match(dedicated, /scopedCargoFleetAccounts = new Set\(compatibilityCargoRows\.map/);
  assert.match(dedicated, /cargoFleetAccountFromCycleId\(row\.cycleId\)/);
  assert.match(dedicated, /filterCompleted\(fleetScopedCargoAllocationRows, compatibilityCargoRows\)/);
  assert.match(dedicated, /completedCycleIdentityCount[\s\S]*exactCycleMatchCount[\s\S]*fleetScopedCount[\s\S]*completedCycleMatchedCount/);
});

test('frozen price seed remains exactly July 6 through August 4', () => {
  assert.match(price, /INITIAL_SEED_START_UTC = '2026-07-06'/);
  assert.match(price, /INITIAL_SEED_END_UTC = '2026-08-04'/);
  assert.doesNotMatch(source, /aephia_historical|captureCurrentPriceSeeds|INITIAL_SEED_END_UTC/);
});
