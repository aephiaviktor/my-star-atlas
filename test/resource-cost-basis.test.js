'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichRows, selectRows } = require('../electron/resource-cost-basis');
const pools = [{ location: 'A', asset: 'Food', totalCostPerUnit: 2 }, { location: 'B', asset: 'Food', totalCostPerUnit: 4 }, { location: 'A', asset: 'Fuel', totalCostPerUnit: 0 }];
const scan = { burnedFood: 5, burnedFuel: 2, resourceConsumptionByStarbase: { burnedFood: [{ starbase: 'A', quantity: 2 }, { starbase: 'B', quantity: 3 }], burnedFuel: [{ starbase: 'A', quantity: 2 }] }, foodCostsAtlas: 50, fuelCostsAtlas: 20, revenueAtlasPerDay: 100, rentalRateAtlasPerDay: 3, txsCostsAtlas: 1, totalRequiredCrew: 2, sduFound: 10 };
test('current ledger basis blends actual supply quantities across starbases and preserves zero', () => {
  const enriched = enrichRows([scan], 'scanning', pools);
  assert.deepEqual(enriched[0].internalResourceCosts, { foodCosts: 16, fuelCosts: 0 });
  const selected = selectRows(enriched, 'scanning', 'internal');
  assert.deepEqual(selected.fallbackColumns, []);
  assert.equal(selected.rows[0].totalCostsAtlas, 20);
  assert.equal(selected.rows[0].netProfitAtlas, 80);
  assert.equal(selected.rows[0].netProfitPerCrew, 40);
  assert.equal(selected.rows[0].costsPerUnitAtlas, 2);
  assert.equal(selected.rows[0].profitMarginPercent, 80);
  assert.equal(enriched[0].foodCostsAtlas, 50);
  assert.equal(selectRows(enriched, 'scanning', 'external').rows[0].foodCostsAtlas, 50);
});
test('missing supply/basis uses entire affected column only; filtered selection can recover internal', () => {
  const rows = enrichRows([scan, { ...scan, resourceConsumptionByStarbase: { ...scan.resourceConsumptionByStarbase, burnedFood: [{ starbase: 'C', quantity: 5 }] } }], 'scanning', pools);
  const result = selectRows(rows, 'scanning', 'internal');
  assert.deepEqual(result.fallbackColumns, ['foodCosts']);
  assert.ok(result.rows.every((row) => row.foodCostsAtlas === 50 && row.fuelCostsAtlas === 0));
  assert.deepEqual(selectRows(rows.slice(0, 1), 'scanning', 'internal').fallbackColumns, []);
  assert.equal(enrichRows([{ ...scan, resourceConsumptionByStarbase: {} }], 'scanning', pools)[0].internalResourceCosts.foodCosts, null);
});
test('incomplete historical location coverage never borrows from output/current location', () => {
  const row = { ...scan, starbase: 'A', productionByStarbase: [{ starbase: 'A', quantity: 10 }], resourceConsumptionByStarbase: { burnedFood: [{ starbase: 'A', quantity: 4 }] } };
  assert.equal(enrichRows([row], 'scanning', pools)[0].internalResourceCosts.foodCosts, null);
  assert.equal(enrichRows([scan], 'scanning', [])[0].internalResourceCosts.foodCosts, null);
});
test('mining matches exact starbase and canonical Ammo asset, including no-consumption zero', () => {
  const row = { starbase: 'A', burnedFood: 2, burnedAmmo: 3, burnedFuel: 0 };
  assert.deepEqual(enrichRows([row], 'mining', [...pools, { location: 'A', asset: 'Ammo', totalCostPerUnit: 5 }])[0].internalResourceCosts, { ammoCosts: 15, foodCosts: 4, fuelCosts: 0 });
  assert.equal(enrichRows([{ ...row, starbase: 'C' }], 'mining', pools)[0].internalResourceCosts.foodCosts, null);
});

test('resource price is exactly the Inventory Ledger projection including authoritative basis and cargo', () => {
  const { projectInventoryCostLedgerRows } = require('../electron/inventory-cost-ledger-view');
  const inventory = projectInventoryCostLedgerRows({ ledgerRows: [{ location: 'A', asset: 'Food', quantity: 20, uncostedQuantity: 10, knownCosts: { gm: 40 }, knownCargoCost: 10 }] });
  assert.equal(inventory[0].totalCostPerUnit, 5);
  assert.equal(enrichRows([{ starbase: 'A', burnedFood: 3, burnedAmmo: 0, burnedFuel: 0 }], 'mining', inventory)[0].internalResourceCosts.foodCosts, 15);
});
test('missing GM fallback stays unavailable and does not invent zero profit', () => {
  const row = { ...scan, foodCostsAtlas: null, internalResourceCosts: { foodCosts: null, fuelCosts: 0 } };
  const result = selectRows([row], 'scanning', 'internal');
  assert.deepEqual(result.fallbackColumns, ['foodCosts']);
  for (const field of ['totalCostsAtlas', 'netProfitAtlas', 'netProfitPerCrew', 'profitMarginPercent']) assert.equal(result.rows[0][field], null);
  assert.deepEqual(selectRows([], 'scanning', 'internal'), { rows: [], fallbackColumns: [] });
});

const fs = require('node:fs');
const vm = require('node:vm');
const main = fs.readFileSync(require.resolve('../electron/main.js'), 'utf8');
const renderer = fs.readFileSync(require.resolve('../electron/renderer.js'), 'utf8');
function sourceFunction(source, name, next) {
  const start = source.indexOf(name);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
test('actual Scanning query preserves every source quantity, including untagged history', async () => {
  const queries = [];
  const day = '2026-09-06';
  const records = [
    { fleet: 'S1', _time: day, _measurement: 'sdu', _field: 'burnedFood', starbase: 'A', _value: 2 },
    { fleet: 'S1', _time: day, _measurement: 'sdu', _field: 'burnedFood', starbase: 'B', _value: 3 },
    { fleet: 'S1', _time: day, _measurement: 'movement', _field: 'burnedFuel', starbase: 'A', _value: 2 },
    { fleet: 'S2', _time: day, _measurement: 'sdu', _field: 'burnedFood', _value: 1 },
  ];
  const scope = {
    getLastUtcDays: () => [new Date(day)], getUtcDateKey: (date) => date.toISOString().slice(0, 10),
    escapeFluxString: (value) => value, buildInstanceScopeFilter: () => '',
    fetchStarbaseCoordinateMap: async () => new Map(), formatShortUtcDate: (date) => date.toISOString().slice(0, 10),
    resolveStarbaseName: (row) => row.starbase || '', parseInfluxCsv: (rows) => rows,
    queryInfluxFlux: async (_settings, flux) => {
      queries.push(flux);
      if (flux.includes('r._field == "amount" or')) return records.filter((row) => row._measurement === 'sdu');
      if (flux.includes('r._measurement == "movement"')) return records.filter((row) => row._measurement === 'movement');
      return [];
    },
  };
  vm.runInNewContext(sourceFunction(main, 'async function fetchScanningEarningsRows', 'async function fetchMiningEarningsRows') + '\nthis.fetchRows = fetchScanningEarningsRows;', scope);
  const rows = await scope.fetchRows({ influxUrl: 'fixture', influxAuthToken: 'fixture', influxBucket: 'fixture' });
  assert.equal(queries.length, 6, 'no extra query added');
  const enriched = enrichRows(rows, 'scanning', pools);
  assert.equal(enriched.find((row) => row.fleet === 'S1').internalResourceCosts.foodCosts, 16);
  assert.equal(enriched.find((row) => row.fleet === 'S2').internalResourceCosts.foodCosts, null);
  assert.ok(queries.filter((flux) => flux.includes('"_measurement", "_field", "_time"')).every((flux) => flux.includes('["fleet", "starbase", "_measurement"')));
});

test('actual renderer applies filtered basis to charts/cards and independent tab state', () => {
  for (const subtab of ['scanning', 'mining']) {
    const capturedCharts = [];
    const capturedText = new Map();
    const base = subtab === 'scanning' ? scan : { ...scan, starbase: 'A', burnedAmmo: 0, ammoCostsAtlas: 0, mined: 10 };
    const sourceRows = enrichRows([{ ...base, fleet: 'Fleet', isoDate: '2026-09-06' }], subtab, pools);
    const sourceSnapshot = { ok: true, checkedAt: '2026-09-07T08:00:00Z', rows: sourceRows, miningRows: sourceRows };
    const before = JSON.stringify(sourceSnapshot);
    const state = { scanning: 'internal', mining: 'internal' };
    const scope = {
      ResourceCostBasis: { selectRows }, earningsCostBasisMode: state,
      earningsResourceFallbackColumns: { scanning: [], mining: [] },
      earningsChartMode: { scanning: 'total', mining: 'total' },
      latestSettings: { faction: 'MUD' }, normalizeFaction: (v) => v,
      getFilteredEarningsRows: (_tab, rows) => rows,
      renderEarningsNetProfitChart: (result) => capturedCharts.push(result.rows),
      renderEarningsMining: () => {}, earningsTableBody: null, earningsMiningTableBody: null,
      setText: (target, text) => capturedText.set(target, text),
      formatAtlasWhole: (value) => value, formatAtlasNumber: (value) => value,
      earningsSduScanNote: 'scanProfit', earningsMiningMinedNote: 'miningProfit',
      Number, String, Date, Map, Math, Array, Object,
    };
    const noop = () => {};
    const globals = new Proxy(scope, {
      has: (_target, key) => !['scope', 'snapshot'].includes(String(key)),
      get: (target, key) => key === Symbol.unscopables ? undefined : key in target ? target[key] : noop,
      set: (target, key, value) => { target[key] = value; return true; },
    });
    const functionText = sourceFunction(renderer, subtab === 'scanning' ? 'function renderEarnings(result)' : 'function renderEarningsMining(result)', subtab === 'scanning' ? 'function renderEarningsMining(result)' : 'function renderEarningsCrafting(result)');
    const leaderText = sourceFunction(renderer, 'function resourceProfitLeader', 'function renderEarnings(result)');
    const invoke = new Function('scope', 'snapshot', `with(scope) { ${leaderText}\n${functionText}\n${subtab === 'scanning' ? 'renderEarnings' : 'renderEarningsMining'}(snapshot); }`);
    invoke(globals, sourceSnapshot);
    assert.ok(capturedCharts.length > 0);
    assert.equal(capturedCharts[0][0].foodCostsAtlas, subtab === 'scanning' ? 16 : 10);
    assert.equal(capturedText.get(subtab === 'scanning' ? 'scanProfit' : 'miningProfit'), `${subtab === 'scanning' ? 80 : 86} Yesterday`);
    assert.equal(JSON.stringify(sourceSnapshot), before, 'cached backend rows remain external and immutable');
    state[subtab] = 'external';
    capturedCharts.length = 0;
    invoke(globals, sourceSnapshot);
    assert.equal(capturedCharts[0][0].foodCostsAtlas, 50);
    assert.equal(state[subtab === 'scanning' ? 'mining' : 'scanning'], 'internal');
  }
});

test('real headers mark only externally substituted resource columns, including Per Unit mode', () => {
  const element = () => ({ children: [], classList: { add() {} }, dataset: {}, appendChild(child) { this.children.push(child); }, textContent: '' });
  const head = element();
  const scope = { document: { createElement: element }, earningsTableHead: head,
    earningsSort: {}, earningsCostBasisMode: { scanning: 'internal' }, earningsResourceFallbackColumns: { scanning: ['fuelCosts'] },
    getVisibleEarningsColumns: () => [{ id: 'foodCosts', label: 'Food Cost' }, { id: 'fuelCosts', label: 'Fuel Cost' }, { id: 'totalCosts', label: 'Total Costs' }],
    isEarningsPerUnitEnabled: () => true, isEarningsPerUnitColumn: () => true,
  };
  vm.runInNewContext(sourceFunction(renderer, 'function appendEarningsHeaderCell', 'function createEarningsFleetCell') + "\nrenderEarningsHeader('scanning');", scope);
  assert.deepEqual(head.children[0].children.map((cell) => cell.children[0].textContent), ['Date', 'Fleet', 'Food Cost / Unit', 'Fuel Cost / Unit*', 'Total Costs / Unit']);
});

test('real cost-basis click handlers preserve independent state and selected button appearance', () => {
  const buttons = ['scanning', 'mining'].flatMap((subtab) => ['internal', 'external'].map((mode) => ({
    dataset: { earningsCostBasis: subtab, costBasisMode: mode },
    classList: { toggle(_name, active) { this.active = active; } },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(_name, handler) { this.click = handler; },
  })));
  const rendered = [];
  const scope = {
    document: { querySelectorAll: (selector) => selector === '[data-earnings-cost-basis]' ? buttons : buttons.filter((button) => selector.includes(`"${button.dataset.earningsCostBasis}"`)) },
    earningsCostBasisMode: { scanning: 'internal', mining: 'internal' }, latestEarningsResult: {},
    renderEarnings: () => rendered.push('scanning'), renderEarningsMining: () => rendered.push('mining'),
  };
  vm.runInNewContext(sourceFunction(renderer, "for (const button of document.querySelectorAll('[data-earnings-cost-basis]'))", "for (const button of document.querySelectorAll('[data-earnings-per-unit]'))"), scope);
  buttons[3].click();
  assert.equal(scope.earningsCostBasisMode.mining, 'external');
  assert.equal(scope.earningsCostBasisMode.scanning, 'internal');
  assert.equal(buttons[3]['aria-pressed'], 'true');
  assert.equal(buttons[2]['aria-pressed'], 'false');
  assert.deepEqual(rendered, ['mining']);
  const html = fs.readFileSync(require.resolve('../electron/renderer.html'), 'utf8');
  for (const subtab of ['scanning', 'mining']) {
    const first = html.indexOf(`data-earnings-cost-basis="${subtab}"`);
    assert.ok(first >= 0 && first < html.indexOf(`data-earnings-per-unit="${subtab}"`));
  }
  assert.ok(html.indexOf('src="./resource-cost-basis.js"') < html.indexOf('src="./renderer.js"'));
});


test('zero consumption with an unknown source cannot force an otherwise complete column to GM', () => {
  const row = { ...scan, resourceConsumptionByStarbase: { ...scan.resourceConsumptionByStarbase, burnedFood: [...scan.resourceConsumptionByStarbase.burnedFood, { starbase: '', quantity: 0 }] } };
  const enriched = enrichRows([row], 'scanning', pools);
  assert.equal(enriched[0].internalResourceCosts.foodCosts, 16);
  assert.deepEqual(selectRows(enriched, 'scanning', 'internal').fallbackColumns, []);
});
