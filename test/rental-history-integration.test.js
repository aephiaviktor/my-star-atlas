'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('Earnings fetches rental history as a bounded read-only category', () => {
  assert.match(main, /const flux = buildRentalHistoryFluxQuery\(settings\.influxBucket\)/);
  assert.match(main, /const rows = parseInfluxCsv\(await queryInfluxFlux\(settings, flux\)\)/);
  assert.match(main, /\(\) => fetchRentalHistoryIndex\(settings\)/);
  assert.doesNotMatch(main, /fetchRentalHistoryIndex[\s\S]{0,1200}api\/v2\/write/);
});

test('Scanning, Mining, and Cargo use date-matched history instead of current fleet rate projection', () => {
  const matches = main.match(/const rentalRateAtlasPerDay = historicalRental\?\.rentalCostAtlas \?\? null;/g) || [];
  assert.equal(matches.length, 3);
  const snapshotStart = main.indexOf('async function fetchEarningsSnapshot');
  const snapshotEnd = main.indexOf("handleTrustedIpc('earnings:snapshot'", snapshotStart);
  const snapshot = main.slice(snapshotStart, snapshotEnd > snapshotStart ? snapshotEnd : undefined);
  assert.doesNotMatch(snapshot, /fleet\?\.rentalRateAtlasPerDay/);
  assert.match(snapshot, /rentalForRow\(fleet, cargoRow\.fleet, cargoRow\.isoDate, authoritativeAccount\)/);
});

test('historical required crew overrides current composition for date-matched per-crew results', () => {
  const matches = main.match(/const totalRequiredCrew = historicalRental\?\.requiredCrew \?\? fleet\?\.totalRequiredCrew \?\? null;/g) || [];
  assert.equal(matches.length, 3);
  assert.match(main, /netProfitPerCrew: Number\.isFinite\(netProfitAtlas\) && Number\.isFinite\(totalRequiredCrew\)/);
  assert.match(main, /crewSnapshotSource: historicalRental\?\.crewSnapshotSource/);
});

test('historical rental unavailability is partial-result metadata and cannot erase category rows', () => {
  assert.match(main, /let rentalHistoryIndex = createRentalHistoryIndex\(\[\]\)/);
  assert.match(main, /else rentalHistoryError = String\(/);
  assert.match(main, /rawCargoCostError,\s*rentalHistoryError,/);
});
