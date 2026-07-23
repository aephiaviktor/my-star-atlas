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

test('renderer wires the Breakeven Analysis subtab, panel, and filters', () => {
  const html = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
  const js = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  assert.match(html, /data-earnings-subtab="breakeven"/);
  assert.match(html, /id="earnings-breakeven-table-head"/);
  assert.match(html, /id="earnings-breakeven-table-body"/);
  assert.match(html, /id="earnings-breakeven-starbase-filter"/);
  assert.match(html, /id="earnings-breakeven-asset-filter"/);
  assert.match(html, /id="earnings-breakeven-source-filter"/);
  assert.match(html, /id="earnings-breakeven-hide-low-inventory"/);
  assert.doesNotMatch(html, /activity-filter-note">Landed cost =/);
  assert.match(html, /<th>Inventory Value<\/th>/);
  assert.match(html, /<th>GM Price \/ Unit<\/th>/);
  assert.match(js, /function renderEarningsBreakeven\(/);
  for (const name of [
    'earningsBreakevenTableHead',
    'earningsBreakevenTableBody',
    'earningsBreakevenSyncStatus',
    'earningsBreakevenStarbaseFilter',
    'earningsBreakevenAssetFilter',
    'earningsBreakevenSourceFilter',
  ]) {
    assert.match(js, new RegExp(`const ${name} = document\\.querySelector`), `${name} must be declared before use`);
  }
  assert.match(js, /breakeven: 'breakevenRows'/);
  assert.match(js, /breakeven: \(\) => earningsBreakevenTableHead/);
  assert.match(js, /const breakevenEarningsOptionalColumns/);
  assert.match(js, /breakeven: breakevenEarningsOptionalColumns/);
  assert.match(js, /breakeven: new Set\(\['source'\]\)/);
  assert.match(js, /breakeven: \{ starbase: '', asset: '', source: '', hideLowInventory: false \}/);
  assert.match(js, /handle\(earningsBreakevenTableHead, 'breakeven'\)/);
  assert.match(js, /else if \(subtab === 'breakeven'\) renderEarningsBreakeven\(latestEarningsResult\);/);
  assert.match(js, /renderEarningsUpgrading\(result\);\s+renderEarningsBreakeven\(result\);/);
});

test('production breakeven inventory loop does not shadow its source row', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /for \(const inventoryRow of inventoryRows\)/);
  assert.doesNotMatch(main, /for \(const inventory of inventoryRows\)[\s\S]*?const inventory = Number\(inventory\.quantity\)/);
});

test('earnings snapshot declares the optional Breakeven error before returning it', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /let breakevenRows = \[\];\s+let breakevenError = '';/);
});

test('production Breakeven cost basis uses enriched Atlas fields and the fresh cutoff', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /const BREAKEVEN_COST_BASIS_START_ISO = '2026-07-24';/);
  assert.match(main, /const costsPerUnit = Number\(row\.costsPerUnitAtlas\);/);
  assert.match(main, /row\.fuelCostsAtlas/);
  assert.match(main, /row\.txsCostsAtlas/);
});
