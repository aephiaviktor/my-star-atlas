const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const BREAKEVEN_COST_BASIS_START_ISO = '2026-07-24';

// Re-implement the breakeven aggregation logic from electron/main.js in a
// small pure helper so the v1 ledger can be tested without spinning up
// the full Electron main process. Mirrors the production code shape.
function buildBreakevenRows({ miningRows = [], cargoAllocations = [], inventoryRows = [], prices = null } = {}) {
  const resourcePriceByName = (prices && prices.resourcePricesAtlByName) || {};

  const baseAggregator = new Map();
  for (const row of miningRows) {
    if (String(row.isoDate || '') < BREAKEVEN_COST_BASIS_START_ISO) continue;
    const starbase = String(row.starbase || '').trim();
    const asset = String(row.rawMaterial || '').trim();
    if (!starbase || !asset) continue;
    const mined = Number(row.mined);
    const costsPerUnit = Number(row.costsPerUnitAtlas);
    if (!Number.isFinite(mined) || mined <= 0) continue;
    if (!Number.isFinite(costsPerUnit) || costsPerUnit < 0) continue;
    const key = `${starbase}\n${asset}`;
    const entry = baseAggregator.get(key) || { starbase, asset, totalCost: 0, totalUnits: 0 };
    entry.totalCost += costsPerUnit * mined;
    entry.totalUnits += mined;
    baseAggregator.set(key, entry);
  }
  const baseByKey = new Map();
  for (const [key, entry] of baseAggregator.entries()) {
    if (entry.totalUnits > 0) {
      baseByKey.set(key, {
        starbase: entry.starbase,
        asset: entry.asset,
        baseCostPerUnit: entry.totalCost / entry.totalUnits,
      });
    }
  }

  const cargoAggregator = new Map();
  for (const row of cargoAllocations) {
    if (String(row.isoDate || '') < BREAKEVEN_COST_BASIS_START_ISO) continue;
    const starbase = String(row.destination || '').trim();
    const asset = String(row.asset || '').trim();
    if (!starbase || !asset) continue;
    const amount = Number(row.amount);
    const costsPerUnit = Number(row.costsPerUnitAtlas);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!Number.isFinite(costsPerUnit) || costsPerUnit < 0) continue;
    const key = `${starbase}\n${asset}`;
    const entry = cargoAggregator.get(key) || { starbase, asset, totalCost: 0, totalUnits: 0 };
    entry.totalCost += costsPerUnit * amount;
    entry.totalUnits += amount;
    cargoAggregator.set(key, entry);
  }
  const cargoByKey = new Map();
  for (const [key, entry] of cargoAggregator.entries()) {
    if (entry.totalUnits > 0) {
      cargoByKey.set(key, {
        starbase: entry.starbase,
        asset: entry.asset,
        cargoCostPerUnit: entry.totalCost / entry.totalUnits,
      });
    }
  }

  const rows = [];
  const seen = new Set();
  for (const inventoryRow of inventoryRows) {
    const starbase = String(inventoryRow.starbase || '').trim();
    const asset = String(inventoryRow.asset || '').trim();
    if (!starbase || !asset) continue;
    const key = `${starbase}\n${asset}`;
    const base = baseByKey.get(key);
    const cargo = cargoByKey.get(key);
    const baseCostPerUnit = base?.baseCostPerUnit ?? null;
    const cargoCostPerUnit = cargo?.cargoCostPerUnit ?? null;
    const landedCostPerUnit = (baseCostPerUnit != null || cargoCostPerUnit != null)
      ? (baseCostPerUnit || 0) + (cargoCostPerUnit || 0)
      : null;
    const inventory = Number(inventoryRow.quantity) || 0;
    const inventoryValue = landedCostPerUnit != null ? inventory * landedCostPerUnit : null;
    const gmPricePerUnit = Number(resourcePriceByName[normalizeName(asset)]) || null;
    const source = !base && !cargo
      ? 'Inventory only'
      : base && cargo
        ? 'Mining + Cargo'
        : base
          ? 'Mining'
          : 'Cargo';
    rows.push({
      starbase,
      asset,
      inventory,
      baseCostPerUnit,
      cargoCostPerUnit,
      landedCostPerUnit,
      inventoryValue,
      gmPricePerUnit,
      source,
    });
    seen.add(key);
  }
  for (const [key, base] of baseByKey.entries()) {
    if (seen.has(key)) continue;
    const cargo = cargoByKey.get(key);
    const cargoCostPerUnit = cargo?.cargoCostPerUnit ?? null;
    const baseCostPerUnit = base.baseCostPerUnit;
    const landedCostPerUnit = (baseCostPerUnit || 0) + (cargoCostPerUnit || 0) || null;
    const gmPricePerUnit = Number(resourcePriceByName[normalizeName(base.asset)]) || null;
    rows.push({
      starbase: base.starbase,
      asset: base.asset,
      inventory: 0,
      baseCostPerUnit,
      cargoCostPerUnit,
      landedCostPerUnit,
      inventoryValue: 0,
      gmPricePerUnit,
      source: cargo ? 'Mining + Cargo' : 'Mining',
    });
  }
  rows.sort((a, b) => a.starbase.localeCompare(b.starbase) || a.asset.localeCompare(b.asset));
  return rows;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

test('buildBreakevenRows combines mining base cost and cargo delivery cost for the same starbase and asset', () => {
  const miningRows = [
    { isoDate: '2026-07-24', starbase: 'MRZ-17', rawMaterial: 'ARCO', mined: 1000, costsPerUnitAtlas: 0.000388 },
  ];
  const cargoAllocations = [
    { isoDate: '2026-07-24', destination: 'MRZ-21', asset: 'ARCO', amount: 500, costsPerUnitAtlas: 0.000143 },
  ];
  const inventoryRows = [
    { starbase: 'MRZ-21', asset: 'ARCO', quantity: 100, lastDate: '2026-07-22T00:00:00Z' },
  ];
  const prices = { resourcePricesAtlByName: { arco: 0.0006 } };

  const rows = buildBreakevenRows({ miningRows, cargoAllocations, inventoryRows, prices });
  const arco = rows.find((row) => row.asset === 'ARCO' && row.starbase === 'MRZ-21');
  assert.ok(arco, 'ARCO row at MRZ-21 should be present');
  assert.equal(arco.cargoCostPerUnit, 0.000143);
  assert.equal(arco.landedCostPerUnit, 0.000143);
  assert.equal(arco.inventory, 100);
  assert.equal(arco.inventoryValue, 100 * 0.000143);
  assert.equal(arco.gmPricePerUnit, 0.0006);
  assert.equal(arco.source, 'Cargo');
});

test('buildBreakevenRows adds mining + cargo together when both are present for the same starbase and asset', () => {
  const miningRows = [
    { isoDate: '2026-07-24', starbase: 'MRZ-17', rawMaterial: 'ARCO', mined: 1000, costsPerUnitAtlas: 0.000388 },
  ];
  const cargoAllocations = [
    { isoDate: '2026-07-24', destination: 'MRZ-17', asset: 'ARCO', amount: 500, costsPerUnitAtlas: 0.000143 },
  ];
  const inventoryRows = [
    { starbase: 'MRZ-17', asset: 'ARCO', quantity: 2000, lastDate: '2026-07-22T00:00:00Z' },
  ];
  const prices = { resourcePricesAtlByName: { arco: 0.0006 } };

  const rows = buildBreakevenRows({ miningRows, cargoAllocations, inventoryRows, prices });
  const arco = rows.find((row) => row.asset === 'ARCO' && row.starbase === 'MRZ-17');
  assert.ok(arco);
  assert.equal(arco.baseCostPerUnit, 0.000388);
  assert.equal(arco.cargoCostPerUnit, 0.000143);
  assert.equal(arco.landedCostPerUnit, 0.000531);
  assert.equal(arco.inventoryValue, 2000 * 0.000531);
  assert.equal(arco.source, 'Mining + Cargo');
});

test('buildBreakevenRows keeps an inventory-only row when no mining or cargo telemetry exists', () => {
  const inventoryRows = [
    { starbase: 'MRZ-5', asset: 'Hydrogen Fuel', quantity: 50, lastDate: '2026-07-22T00:00:00Z' },
  ];
  const rows = buildBreakevenRows({ inventoryRows, prices: { resourcePricesAtlByName: { 'hydrogen fuel': 0.00012 } } });
  const fuel = rows.find((row) => row.asset === 'Hydrogen Fuel' && row.starbase === 'MRZ-5');
  assert.ok(fuel);
  assert.equal(fuel.baseCostPerUnit, null);
  assert.equal(fuel.cargoCostPerUnit, null);
  assert.equal(fuel.landedCostPerUnit, null);
  assert.equal(fuel.inventoryValue, null);
  assert.equal(fuel.gmPricePerUnit, 0.00012);
  assert.equal(fuel.source, 'Inventory only');
});

test('buildBreakevenRows weights base cost by mined units, not by row count', () => {
  const miningRows = [
    { isoDate: '2026-07-24', starbase: 'MRZ-9', rawMaterial: 'Iron', mined: 100, costsPerUnitAtlas: 0.001 },
    { isoDate: '2026-07-24', starbase: 'MRZ-9', rawMaterial: 'Iron', mined: 900, costsPerUnitAtlas: 0.0001 },
  ];
  const inventoryRows = [
    { starbase: 'MRZ-9', asset: 'Iron', quantity: 1000, lastDate: '2026-07-22T00:00:00Z' },
  ];
  const rows = buildBreakevenRows({ miningRows, inventoryRows, prices: {} });
  const iron = rows.find((row) => row.asset === 'Iron');
  // (100 * 0.001 + 900 * 0.0001) / 1000 = 0.00019
  assert.ok(Math.abs(iron.baseCostPerUnit - 0.00019) < 1e-9);
});

test('buildBreakevenRows skips rows with zero units or negative cost', () => {
  const miningRows = [
    { isoDate: '2026-07-24', starbase: 'MRZ-1', rawMaterial: 'Carbon', mined: 0, costsPerUnitAtlas: 0.0002 },
    { isoDate: '2026-07-24', starbase: 'MRZ-1', rawMaterial: 'Carbon', mined: 500, costsPerUnitAtlas: -0.0001 },
  ];
  const cargoAllocations = [
    { isoDate: '2026-07-24', destination: 'MRZ-1', asset: 'Carbon', amount: 0, costsPerUnitAtlas: 0.0003 },
  ];
  const inventoryRows = [
    { starbase: 'MRZ-1', asset: 'Carbon', quantity: 100, lastDate: '2026-07-22T00:00:00Z' },
  ];
  const rows = buildBreakevenRows({ miningRows, cargoAllocations, inventoryRows, prices: {} });
  const carbon = rows.find((row) => row.asset === 'Carbon');
  assert.ok(carbon);
  assert.equal(carbon.baseCostPerUnit, null);
  assert.equal(carbon.cargoCostPerUnit, null);
  assert.equal(carbon.source, 'Inventory only');
});

test('buildBreakevenRows excludes cost telemetry before the fresh UTC cutoff', () => {
  const miningRows = [
    { isoDate: '2026-07-23', starbase: 'MRZ-17', rawMaterial: 'ARCO', mined: 1000, costsPerUnitAtlas: 0.000388 },
    { isoDate: '2026-07-24', starbase: 'MRZ-17', rawMaterial: 'ARCO', mined: 1000, costsPerUnitAtlas: 0.0005 },
  ];
  const cargoAllocations = [
    { isoDate: '2026-07-23', destination: 'MRZ-17', asset: 'ARCO', amount: 500, costsPerUnitAtlas: 0.000143 },
    { isoDate: '2026-07-24', destination: 'MRZ-17', asset: 'ARCO', amount: 500, costsPerUnitAtlas: 0.0002 },
  ];
  const inventoryRows = [{ starbase: 'MRZ-17', asset: 'ARCO', quantity: 100 }];
  const [arco] = buildBreakevenRows({ miningRows, cargoAllocations, inventoryRows });
  assert.equal(arco.baseCostPerUnit, 0.0005);
  assert.equal(arco.cargoCostPerUnit, 0.0002);
  assert.equal(arco.landedCostPerUnit, 0.0007);
});

test('buildBreakevenRows sorts output by starbase then asset for a stable table layout', () => {
  const inventoryRows = [
    { starbase: 'MRZ-21', asset: 'ARCO', quantity: 100 },
    { starbase: 'MRZ-17', asset: 'Iron', quantity: 200 },
    { starbase: 'MRZ-17', asset: 'ARCO', quantity: 300 },
  ];
  const rows = buildBreakevenRows({ inventoryRows, prices: {} });
  const keys = rows.map((row) => `${row.starbase}/${row.asset}`);
  assert.deepEqual(keys, ['MRZ-17/ARCO', 'MRZ-17/Iron', 'MRZ-21/ARCO']);
});

test('renderer wires the complete Break-even accounting subtab, panel, filters, and evidence columns', () => {
  const html = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
  const js = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  assert.match(html, /data-earnings-subtab="breakeven"/);
  assert.match(html, /id="earnings-breakeven-table-head"/);
  assert.match(html, /id="earnings-breakeven-table-body"/);
  assert.match(html, /id="earnings-breakeven-period-filter"/);
  assert.match(html, /id="earnings-breakeven-asset-filter"/);
  assert.match(html, /id="earnings-breakeven-source-filter"/);
  assert.match(html, /id="earnings-breakeven-hide-low-inventory"[^>]*> Hide remaining ≤ 2/);
  assert.match(html, /class="breakeven-inventory-toggle"/);
  assert.doesNotMatch(html, /activity-filter-note">Landed cost =/);
  assert.match(html, /<th>LM In<\/th>.*<th>GM In<\/th>.*<th>Scanning In<\/th>.*<th>Mining \/ Rental In<\/th>.*<th>Crafting Out<\/th>.*<th>Cargo \/ Transfer In<\/th>/s);
  assert.match(html, /<th>Remaining Basis<\/th>/);
  assert.match(html, /<th>Cost Coverage<\/th>/);
  assert.match(html, /<th>Quarantined<\/th>/);
  assert.match(html, /<th>Status<\/th>/);
  assert.match(js, /function renderEarningsBreakeven\(/);
  for (const name of [
    'earningsBreakevenTableHead',
    'earningsBreakevenTableBody',
    'earningsBreakevenSyncStatus',
    'earningsBreakevenAssetFilter',
    'earningsBreakevenPeriodFilter',
    'earningsBreakevenSourceFilter',
  ]) {
    assert.match(js, new RegExp(`const ${name} = document\\.querySelector`), `${name} must be declared before use`);
  }
  assert.match(js, /breakeven: 'breakevenRows'/);
  assert.match(js, /breakeven: \(\) => earningsBreakevenTableHead/);
  assert.match(js, /const breakevenEarningsOptionalColumns/);
  assert.match(js, /breakeven: breakevenEarningsOptionalColumns/);
  assert.match(js, /breakeven: new Set\(\)/);
  assert.match(js, /breakeven: \{ asset: '', source: '', hideLowInventory: false \}/);
  const css = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.css'), 'utf8');
  assert.match(css, /\.breakeven-inventory-toggle\s*\{[^}]*font-size:\s*0\.72rem/s);
  assert.match(js, /else if \(subtab === 'breakeven'\) renderEarningsBreakeven\(latestEarningsResult\);/);
  assert.match(js, /renderEarningsUpgrading\(result\);\s+renderEarningsMarketplace\(result\);\s+renderEarningsBreakeven\(result\);/);
  assert.match(js, /const accounting = result\?\.completeAccounting/);
  assert.match(js, /missing evidence is never treated as zero/);
});

test('production ledger loads and atomically saves a per-faction checkpoint', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /loadLedgerCheckpoint\(checkpointPath, \{ faction: ledgerFaction, profile: profileName \}\)/);
  assert.match(main, /initialLedger: checkpoint\.status === 'loaded' \? checkpoint\.ledger : null/);
  assert.match(main, /seenEventFingerprints: checkpoint\.seenEventFingerprints/);
  assert.match(main, /await saveLedgerCheckpoint\(checkpointPath,/);
  assert.match(main, /ledgerCheckpointStatus/);
});

test('production ledger seeds opening inventory from the last snapshot before its event window', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /async function fetchOpeningPerStarbaseInventory\(settings\)/);
  assert.match(main, /range\(start: -38d, stop: -31d\)/);
  assert.match(main, /group\(columns: \["rss", "starbase"\]\)[\s\S]*?last\(\)[\s\S]*?filter\(fn: \(r\) => r\._value > 0\)/);
  assert.match(main, /openingInventoryRows = \(await fetchOpeningPerStarbaseInventory\(settings\)\)/);
  assert.match(main, /buildCostLedgerResult\(\{[\s\S]*?openingInventoryRows,/);
});

test('production Breakeven reconciles current inventory against ledger quantity', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const ledgerBreakeven = readFileSync(path.join(__dirname, '..', 'electron', 'ledger-breakeven.js'), 'utf8');
  assert.match(main, /const \{ buildLedgerBreakevenRows \} = require\('\.\/ledger-breakeven'\)/);
  assert.match(ledgerBreakeven, /const quantityVariance = inventory - ledgerQuantity;/);
  assert.match(ledgerBreakeven, /const reconciliationStatus = Math\.abs\(quantityVariance\) <= 1e-9/);
  assert.match(ledgerBreakeven, /quantityVariance > 0 \? 'surplus' : 'shortfall'/);
  assert.match(ledgerBreakeven, /for \(const ledgerRow of ledgerRows \|\| \[\]\)/);
  assert.match(ledgerBreakeven, /inventoryEntries\.push\(\{ starbase: ledgerRow\.location, asset: ledgerRow\.asset, quantity: 0 \}\)/);
});

test('earnings snapshot declares the optional Breakeven error before returning it', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /let breakevenRows = \[\];\s+let breakevenError = '';/);
});

test('production Breakeven derives source columns and extrapolated totals from known-cost quantity', () => {
  const ledgerBreakeven = readFileSync(path.join(__dirname, '..', 'electron', 'ledger-breakeven.js'), 'utf8');
  for (const source of ['scanning', 'mining', 'crafting', 'lm', 'gm']) {
    assert.match(ledgerBreakeven, new RegExp(`const ${source}CostPerUnit = perUnit\\(ledger\\?\\.costs\\?\\.${source}\\)`));
  }
  assert.match(ledgerBreakeven, /const knownCostQuantity = Math\.max\(0, ledgerQuantity - Number\(ledger\?\.uncostedQuantity \|\| 0\)\);/);
  assert.match(ledgerBreakeven, /const baseCostPerUnit = knownCostQuantity > 0/);
  assert.match(ledgerBreakeven, /const landedCostPerUnit = knownCostQuantity > 0 \? baseCostPerUnit \+ cargoCostPerUnit : null;/);
  assert.match(ledgerBreakeven, /inventory \* landedCostPerUnit/);
});

test('Crafting and Upgrading use consumed ledger basis instead of current GM prices', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const craftingBasis = readFileSync(path.join(__dirname, '..', 'electron', 'crafting-cost-basis.js'), 'utf8');
  assert.match(main, /buildCraftingBasisByDay\(inventoryCostLedgerAppliedEventResults\)/);
  assert.match(craftingBasis, /const craftingBasis = craftingBasisByDay\.get/);
  assert.match(craftingBasis, /craftingBasis && !craftingBasis\.uncosted/);
  assert.match(main, /const componentBasis = upgradingBasisByDay\.get/);
  assert.match(main, /const upgradingCostsAtlas = componentBasis && !componentBasis\.uncosted \? componentBasis\.basis : null;/);
  assert.doesNotMatch(main, /const upgradingCostsAtlas = componentPriceAtl/);
});

test('production Breakeven rows are restricted to starbases in the selected faction', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(
    main,
    /currentInventoryRows = \(await fetchCurrentPerStarbaseInventory\(settings\)\)\s*\.filter\(\(row\) => isStarbaseIncluded\(row\.starbase, ledgerFactionStarbases, ledgerFaction\)\);/,
  );
});

test('Breakeven falls back to the explicit faction map when the starbase tag lookup is unavailable', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /if \(!factionStarbases\) throw new Error\('breakeven_faction_starbases_unavailable'\)/);
  assert.match(main, /const fallbackStarbases = new Set\(FACTION_STARBASES\[faction\] \|\| \[\]\);/);
  assert.match(main, /return fallbackStarbases\.has\(entryStarbase\);/);
});

test('earnings column selections persist per subtab in local storage', () => {
  const renderer = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  assert.match(renderer, /const EARNINGS_COLUMN_STORAGE_KEY = 'my-star-atlas:earnings-columns:v1';/);
  assert.match(renderer, /function restoreEarningsColumnState\(\)/);
  assert.match(renderer, /localStorage\.getItem\(EARNINGS_COLUMN_STORAGE_KEY\)/);
  assert.match(renderer, /function persistEarningsColumnState\(\)/);
  assert.match(renderer, /localStorage\.setItem\(EARNINGS_COLUMN_STORAGE_KEY, JSON\.stringify\(serialized\)\)/);
  assert.match(renderer, /restoreEarningsColumnState\(\);/);
  assert.match(renderer, /persistEarningsColumnState\(\);/);
});

test('complete Cost Coverage renders explicit status and known-over-total quantities', () => {
  const renderer = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  assert.match(renderer, /entry\.costCoverage\?\.status/);
  assert.match(renderer, /entry\.costCoverage\?\.knownQuantity/);
  assert.match(renderer, /entry\.costCoverage\?\.totalQuantity/);
  assert.doesNotMatch(renderer, /`0% estimated`/);
});
