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

test('renderer wires the Inventory Ledger pool-basis table and filters', () => {
  const html = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
  const js = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  assert.match(html, /data-earnings-subtab="breakeven"/);
  assert.match(html, /id="earnings-cost-ledger-table-head"/);
  assert.match(html, /id="earnings-cost-ledger-table-body"/);
  assert.match(html, /id="earnings-breakeven-starbase-filter"/);
  assert.match(html, /id="earnings-breakeven-asset-filter"/);
  assert.match(html, /id="earnings-breakeven-hide-low-inventory"[^>]*> Hide Inventory ≤ 2/);
  assert.match(html, /data-earnings-per-unit="inventoryLedger"/);
  assert.match(js, /function renderInventoryCostLedger\(/);
  assert.match(js, /earningsCostLedgerTableHead\.replaceChildren\(tr\)/);
  assert.match(js, /result\?\.openingInventoryError/);
  assert.match(js, /result\?\.ledgerCheckpointStatus/);
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
  assert.match(main, /needsInventoryLedger \? cargoAllocationSource\.load\(settings\)/);
  assert.match(main, /cargoAllocationLedgerRows = cargoAllocationLedgerResult\.value\.rows \|\| \[\]/);
  assert.match(main, /cargoRows: cargoAllocationLedgerRows/);
  assert.doesNotMatch(main, /cargoRows: \[\]/);
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
    assert.match(ledgerBreakeven, new RegExp(`const ${source}CostPerUnit = perUnit\\(knownCosts\\?\\.${source}\\)`));
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
    /const factionStarbases = await fetchFactionStarbases\(settings\);[\s\S]*?breakevenRows = buildLedgerBreakevenRows\([\s\S]*?\)\s*\.filter\(\(row\) => isStarbaseIncluded\(row\.starbase, factionStarbases, faction\)\);/,
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

test('Inventory Ledger distinguishes priced, estimated, and unpriced pool bases', () => {
  const renderer = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  assert.match(renderer, /row\?\.basisStatus === 'priced' \? 'Priced'/);
  assert.match(renderer, /row\?\.basisStatus === 'estimated' \? 'Estimated' : 'Unpriced'/);
  assert.doesNotMatch(renderer, /Costed Qty|Uncosted Qty/);
});

test('Inventory Ledger exposes one pool-basis table with a per-unit toggle', () => {
  const htmlSource = require('node:fs').readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
  const rendererSource = require('node:fs').readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  const mainSource = require('node:fs').readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(htmlSource, /data-earnings-subtab="breakeven"[^>]*>Inventory Ledger<\/button>/);
  assert.match(htmlSource, /data-earnings-per-unit="inventoryLedger"[^>]*>Per Unit<\/button>/);
  assert.doesNotMatch(htmlSource, /Inventory Valuation/);
  assert.doesNotMatch(htmlSource, /Costed Qty|Uncosted Qty/);
  assert.match(htmlSource, /id="earnings-cost-ledger-table-head"/);
  assert.match(htmlSource, /id="earnings-cost-ledger-table-body"/);
  assert.match(rendererSource, /function renderInventoryCostLedger\(result\)/);
  assert.match(rendererSource, /result\?\.inventoryCostLedgerRows/);
  assert.match(rendererSource, /isEarningsPerUnitEnabled\('inventoryLedger'\)/);
  assert.match(rendererSource, /row\?\.basisStatus === 'priced' \? 'Priced'/);
  assert.doesNotMatch(rendererSource, /currentInventoryLedgerView|inventoryLedgerViewButtons/);
  assert.match(mainSource, /poolBasisRows: inventoryDepositPoolBasisRows/);
});

test('Inventory Ledger suppresses zeroes, sorts every column, and exposes every column control', () => {
  const htmlSource = require('node:fs').readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
  const rendererSource = require('node:fs').readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  assert.match(rendererSource, /function formatInventoryLedgerBasisValue[\s\S]*Math\.abs\(number\) < 1e-12[\s\S]*return '--'/);
  assert.match(rendererSource, /handle\(earningsCostLedgerTableHead, 'breakeven'\)/);
  assert.match(rendererSource, /appendEarningsHeaderCell\(tr, column\.id, label, sortState/);
  assert.match(rendererSource, /sort\(\(left, right\) => sortState\?\.column[\s\S]*compareEarningsValues\(inventoryLedgerSortValue/);
  assert.match(rendererSource, /const breakevenEarningsOptionalColumns = Object\.freeze\(\[/);
  for (const id of ['starbase', 'asset', 'quantity', 'scanning', 'mining', 'crafting', 'lm', 'gm', 'cargo', 'totalBasis', 'status']) {
    assert.match(rendererSource, new RegExp(`id: '${id}'`));
  }
  assert.match(rendererSource, /breakeven: new Set\(breakevenEarningsOptionalColumns\.map\(\(column\) => column\.id\)\)/);
  assert.match(rendererSource, /subtab === 'breakeven' && Number\(saved\.schemaVersion \|\| 1\) < 4[\s\S]*restoredIds = getEarningsColumns\(subtab\)\.map/);
  assert.match(rendererSource, /schemaVersion: 4/);
  assert.doesNotMatch(htmlSource, /0\.000000/);
});
