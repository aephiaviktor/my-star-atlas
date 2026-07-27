const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');

test('daily SDU response retains daily series for every fleet', () => {
  assert.match(main, /fleetDaysByName/);
  assert.match(main, /fleetDays:\s*Object\.fromEntries\(fleetDaysByName\)/);
});

test('switching scanning fleets uses retained data before requesting Influx again', () => {
  assert.match(renderer, /function selectCachedSduFleet\(result, fleet\)/);
  assert.match(renderer, /if \(selectCachedSduFleet\(latestSduResult, selectedScanningFleet\)\) return;/);
});
