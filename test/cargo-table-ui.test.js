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

test('Earnings chart titles omit their tab-name prefixes', () => {
  for (const prefix of ['Scanning:', 'Mining:', 'Cargo:']) {
    assert.doesNotMatch(html, new RegExp(`<span>${prefix.replace(':', '\\:')}`));
  }
  assert.match(html, /<span>Net Profit by Fleet<\/span>/);
  assert.match(html, /<span>Total Costs Breakdown<\/span>/);
});
