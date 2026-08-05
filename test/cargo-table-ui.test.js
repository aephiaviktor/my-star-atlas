const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('Cargo tables use a two-option switch instead of collapsible panel headers', () => {
  assert.match(html, /class="cargo-table-switch"[^>]*role="tablist"/);
  assert.match(html, /data-cargo-table-select="fleet"[^>]*aria-selected="true"[^>]*>Cargo Costs by Fleet</);
  assert.match(html, /data-cargo-table-select="allocation"[^>]*aria-selected="false"[^>]*>Cargo Cost Allocation by Fleet &amp; Asset</);
  assert.doesNotMatch(html, /data-cargo-table-toggle/);
  assert.doesNotMatch(html, /cargo-table-panel collapsed/);
  assert.match(js, /\[data-cargo-table-select\]/);
  assert.match(js, /view\.hidden = !selected/);
});

test('Cargo movement telemetry provides Txs Daily without being overwritten by an empty RPC result', () => {
  assert.match(main, /entry\.txsDaily \+= 1/);
  assert.doesNotMatch(main, /const cargoSignatureCounts = await Promise\.race/);
});

test('optional Cargo telemetry queries cannot discard core fleet rows', () => {
  const cargoFunction = main.slice(main.indexOf('async function fetchCargoEarningsRows'), main.indexOf('async function fetchCargoAllocationEarningsRows'));
  assert.match(cargoFunction, /const completedCycleFlux =/);
  assert.match(cargoFunction, /const cargoCsv = await queryInfluxFlux\(settings, cargoFlux\);/);
  assert.match(cargoFunction, /const \[typeResult, moveTimeResult, txDailyResult, completedCycleResult\] = await Promise\.allSettled/);
  assert.match(cargoFunction, /const optionalCsv = \(result\) => result\.status === 'fulfilled' \? result\.value : ''/);
});

test('Cargo query errors expose the actionable failure instead of a generic unavailable label', () => {
  assert.match(js, /Cargo query failed: \$\{formatInfluxError\(result\.cargoError\)\}/);
});

test('Cargo table shows completed cycles immediately after Txs Daily', () => {
  assert.match(js, /id: 'txsDaily', label: 'Txs Daily' \}\),\s*Object\.freeze\(\{ id: 'cargoCycles', label: 'Cycles Daily'/);
  assert.match(js, /columnId === 'cargoCycles'[\s\S]*entry\.cargoCycles[\s\S]*entry\.cargoLegs/);
  assert.match(html, /<th scope="col">Txs Daily<\/th>\s*<th scope="col">Cycles Daily<\/th>\s*<th scope="col">Assignment<\/th>/);
});

test('Cargo allocation offers fleet detail columns off by default', () => {
  const allocationColumns = js.slice(
    js.indexOf('const cargoAllocationEarningsOptionalColumns'),
    js.indexOf('const craftingEarningsOptionalColumns')
  );
  for (const id of ['color', 'ownership', 'ships', 'requiredCrew']) {
    assert.match(allocationColumns, new RegExp(`id: '${id}'`));
  }
  assert.match(js, /cargoAllocation: new Set\(\['assignment'/);
});

test('Cargo table views use the same fixed table height as other Earnings tables', () => {
  assert.match(css, /\.cargo-table-view\s*>\s*\.fleet-table-wrap\s*\{[^}]*height:\s*560px/s);
});

test('Cargo filters offer calculated Total views for fleets and assets', () => {
  assert.match(js, /subtab === 'scanning' \|\| subtab === 'mining' \|\| subtab === 'cargo' \|\| subtab === 'cargoAllocation'/);
  assert.match(js, /filters\.asset[\s\S]*EARNINGS_TOTAL_ASSETS_FILTER/);
  assert.match(js, /function aggregateTotalCargoRows\(/);
  assert.match(js, /function aggregateTotalCargoAllocationRows\(/);
  assert.match(js, /earningsFilters\.cargo\.fleet === EARNINGS_TOTAL_FLEETS_FILTER/);
  assert.match(js, /earningsFilters\.cargoAllocation\.asset === EARNINGS_TOTAL_ASSETS_FILTER/);
});

test('Earnings chart titles omit their tab-name prefixes', () => {
  for (const prefix of ['Scanning:', 'Mining:', 'Cargo:']) {
    assert.doesNotMatch(html, new RegExp(`<span>${prefix.replace(':', '\\:')}`));
  }
  assert.match(html, /<span>Net Profit by Fleet<\/span>/);
  assert.match(html, /<span>Total Costs Breakdown<\/span>/);
});
