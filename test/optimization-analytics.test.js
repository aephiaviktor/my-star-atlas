'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const rendererPath = path.join(ROOT, 'electron', 'renderer.js');
const htmlPath = path.join(ROOT, 'electron', 'renderer.html');
const cssPath = path.join(ROOT, 'electron', 'renderer.css');
const mainPath = path.join(ROOT, 'electron', 'main.js');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function loadAnalytics() {
  const source = fs.readFileSync(rendererPath, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    extractFunction(source, 'getOptimizationExperimentId'),
    extractFunction(source, 'parseScanningOptimizationValues'),
    "const scanningOptimizationParameterNames = Object.freeze({ scanMin: 'minProb', scanMin2: 'instantStrikeoutProb', scanMin3: 'successStrikeoutProb' });",
    extractFunction(source, 'normalizeScanningOptimizationParameter'),
    extractFunction(source, 'buildScanningOptimizationExperimentCatalog'),
    extractFunction(source, 'buildScanningOptimizationAnalytics'),
    extractFunction(source, 'sortScanningOptimizationAnalyticsGroups'),
    'this.catalog = buildScanningOptimizationExperimentCatalog;',
    'this.build = buildScanningOptimizationAnalytics;',
    'this.sortGroups = sortScanningOptimizationAnalyticsGroups;'
  ].join('\n'), context);
  return { build: context.build, catalog: context.catalog, sortGroups: context.sortGroups };
}

test('scanning analytics selects the latest experiment and ranks value groups', () => {
  const { build } = loadAnalytics();
  const rows = [
    { time: '2026-07-26T10:00:00Z', event_type: 'scan_result', experimentId: 'scan-20260726-old-10', optimizationValues: '{"scanMin":8}', fleet: 'A', success: true, sduFound: 1 },
    { time: '2026-07-27T11:00:00Z', event_type: 'scan_result', experimentId: 'scan-20260727-new-10', optimizationValues: '{"scanMin":8}', fleet: 'A', success: true, sduFound: 0, resultSectorX: 1, resultSectorY: 2 },
    { time: '2026-07-27T11:10:00Z', event_type: 'scan_result', experimentId: 'scan-20260727-new-10', optimizationValues: '{"scanMin":8}', fleet: 'A', success: true, sduFound: 2, resultSectorX: 2, resultSectorY: 2 },
    { time: '2026-07-27T11:20:00Z', event_type: 'scan_result', experimentId: 'scan-20260727-new-10', optimizationValues: '{"scanMin":12}', fleet: 'A', success: false, sduFound: 0, resultSectorX: 3, resultSectorY: 2 },
    { time: '2026-07-27T11:30:00Z', event_type: 'transaction', experimentId: 'scan-20260727-new-10', optimizationValues: '{"scanMin":12}', fleet: 'A', success: true, sduFound: 99 }
  ];
  const result = build(rows);
  assert.equal(result.experimentId, 'scan-20260727-new-10');
  assert.equal(result.samples.length, 3);
  assert.deepEqual(Array.from(result.experiments), ['scan-20260727-new-10', 'scan-20260726-old-10']);
  assert.equal(result.groups.length, 2);
  const eight = result.groups.find((group) => group.value === 8);
  assert.equal(eight.scans, 2);
  assert.equal(eight.sduPerScan, 1);
  assert.equal(Math.round(eight.sduPerHour), 6);
  const twelve = result.groups.find((group) => group.value === 12);
  assert.equal(twelve.scanSuccessRate, 0);
  assert.equal(eight.scanSuccessRate, 50);
  assert.equal(eight.txSuccessRate, 100);
  assert.equal(eight.parameter, 'minProb');
});

test('scanning analytics reports chance, economics, pauses, and movement per optimization block', () => {
  const { build } = loadAnalytics();
  const rows = [
    { time: '2026-07-29T10:00:00Z', event_type: 'optimization_start', experimentId: 'scan-20260729-economic-20', optimizationValues: '{"scanMin":8}', optimizationBlockIndex: 0, fleet: 'A' },
    { time: '2026-07-29T10:05:00Z', event_type: 'transaction', experimentId: 'scan-20260729-economic-20', optimizationValues: '{"scanMin":8}', optimizationBlockIndex: 0, fleet: 'A', operation: 'SCAN', signature: 'scan-one', txCostSol: 0.001 },
    { time: '2026-07-29T10:05:01Z', event_type: 'scan_result', experimentId: 'scan-20260729-economic-20', optimizationValues: '{"scanMin":8}', optimizationBlockIndex: 0, fleet: 'A', signature: 'scan-one', success: true, sduFound: 2, chance: 40, burnedFood: 1, pauseCount: 1, pauseSeconds: 60, txCostSol: 0.001 },
    { time: '2026-07-29T10:06:00Z', event_type: 'transaction', experimentId: 'scan-20260729-economic-20', optimizationValues: '{"scanMin":8}', optimizationBlockIndex: 0, fleet: 'A', operation: 'WARP', movementPhase: 'start', movementSeconds: 420, cooldownOverlapSeconds: 300, opportunityCostMovementSeconds: 120, burnedFuel: 3, txCostSol: 0.002 },
    { time: '2026-07-29T10:10:00Z', event_type: 'scan_result', experimentId: 'scan-20260729-economic-20', optimizationValues: '{"scanMin":8}', optimizationBlockIndex: 0, fleet: 'A', success: true, sduFound: 0, chance: 60, burnedFood: 1, pauseCount: 0, pauseSeconds: 0, txCostSol: 0.001 },
    { time: '2026-07-29T10:20:00Z', event_type: 'optimization_progress', experimentId: 'scan-20260729-economic-20', optimizationValues: '{"scanMin":12}', optimizationBlockIndex: 1, fleet: 'A' },
    { time: '2026-07-29T10:30:00Z', event_type: 'scan_result', experimentId: 'scan-20260729-economic-20', optimizationValues: '{"scanMin":12}', optimizationBlockIndex: 1, fleet: 'A', success: true, sduFound: 1, chance: 70, burnedFood: 1, txCostSol: 0.001 },
    { time: '2026-07-29T10:40:00Z', event_type: 'optimization_complete', experimentId: 'scan-20260729-economic-20', optimizationValues: '{"scanMin":12}', optimizationBlockIndex: 1, fleet: 'A' },
  ];
  const result = build(rows, '__latest__', {
    prices: { sduPriceAtl: 10, foodPriceAtl: 1, fuelPriceAtl: 2, solPriceAtl: 100, checkedAt: '2026-07-29T10:45:00Z', source: 'test prices' },
  });
  const block = result.groups.find((group) => group.value === 8);
  assert.equal(block.blockIndex, 0);
  assert.equal(block.scans, 2);
  assert.equal(block.averageScanChance, 50);
  assert.equal(block.elapsedSeconds, 1200);
  assert.equal(block.sduPerHour, 6);
  assert.equal(block.pauseCount, 1);
  assert.equal(block.pausedSeconds, 60);
  assert.equal(block.movementSeconds, 420);
  assert.equal(block.cooldownOverlapSeconds, 300);
  assert.equal(block.opportunityCostMovementSeconds, 120);
  assert.equal(block.grossRevenueAtlas, 20);
  assert.equal(block.foodCostAtlas, 2);
  assert.equal(block.fuelCostAtlas, 6);
  assert.equal(block.txCostAtlas, 0.4);
  assert.ok(Math.abs(block.netAtlasPerHour - 34.8) < 1e-9);
  assert.equal(result.priceSnapshot.checkedAt, '2026-07-29T10:45:00Z');
});

test('scanning analytics does not present missing historical pause and movement telemetry as zero', () => {
  const { build } = loadAnalytics();
  const result = build([
    { time: '2026-07-28T10:00:00Z', event_type: 'scan_result', experimentId: 'scan-20260728-legacy-10', optimizationValues: '{"scanMin":8}', optimizationBlockIndex: 0, fleet: 'A', success: true, sduFound: 1, chance: 50, burnedFood: 1, txCostSol: 0.001 },
    { time: '2026-07-28T10:01:00Z', event_type: 'transaction', experimentId: 'scan-20260728-legacy-10', optimizationValues: '{"scanMin":8}', optimizationBlockIndex: 0, fleet: 'A', operation: 'WARP', txCostSol: 0.002 },
    { time: '2026-07-28T10:10:00Z', event_type: 'optimization_complete', experimentId: 'scan-20260728-legacy-10', optimizationValues: '{"scanMin":8}', optimizationBlockIndex: 0, fleet: 'A' },
  ], '__latest__', { prices: { sduPriceAtl: 10, foodPriceAtl: 1, fuelPriceAtl: 2, solPriceAtl: 100 } });
  const block = result.groups[0];
  assert.equal(block.pausedSeconds, null);
  assert.equal(block.movementSeconds, null);
  assert.equal(block.opportunityCostMovementSeconds, null);
  assert.equal(block.netAtlasPerHour, null);
});

test('scanning analytics ranking sorts every metric and keeps unavailable values last', () => {
  const { sortGroups } = loadAnalytics();
  const groups = [
    { blockIndex: 0, parameter: 'minProb', value: 8, scans: 10, averageScanChance: 40, movementSeconds: 30 },
    { blockIndex: 1, parameter: 'minProb', value: 12, scans: 20, averageScanChance: 60, movementSeconds: null },
    { blockIndex: 2, parameter: 'minProb', value: 16, scans: 15, averageScanChance: 50, movementSeconds: 90 },
  ];
  assert.deepEqual(Array.from(sortGroups(groups, { column: 'averageScanChance', direction: 'desc' }), group => group.value), [12, 16, 8]);
  assert.deepEqual(Array.from(sortGroups(groups, { column: 'scans', direction: 'asc' }), group => group.value), [8, 16, 12]);
  assert.deepEqual(Array.from(sortGroups(groups, { column: 'movementSeconds', direction: 'desc' }), group => group.value), [16, 8, 12]);
});


test('scanning analytics merges legacy experiment ids through previousExperimentId aliases', () => {
  const { build } = loadAnalytics();
  const result = build([
    { time: '2026-07-27T11:00:00Z', event_type: 'scan_result', experimentId: 'scan-ms3j1zln-2j0r7l', optimizationValues: '{"scanMin":8}', fleet: 'SF01-OPOD', success: true, sduFound: 1 },
    { time: '2026-07-27T11:10:00Z', event_type: 'scan_result', experimentId: 'scan-20260728-SF01_OPOD-290', previousExperimentId: 'scan-ms3j1zln-2j0r7l', optimizationValues: '{"scanMin":8}', fleet: 'SF01-OPOD', success: true, sduFound: 2 }
  ]);
  assert.equal(result.experimentId, 'scan-20260728-SF01_OPOD-290');
  assert.deepEqual(Array.from(result.experiments), ['scan-20260728-SF01_OPOD-290']);
  assert.equal(result.samples.length, 2);
});

test('scanning analytics distinguishes telemetry samples from persisted runtime progress', () => {
  const { build } = loadAnalytics();
  const result = build([
    { time: '2026-07-27T11:00:00Z', event_type: 'scan_result', experimentId: 'scan-20260727-run-290', optimizationValues: '{"scanMin":8}', optimizationCompletedScans: 172, optimizationTotalScans: 290, fleet: 'A', success: true, sduFound: 1 },
    { time: '2026-07-27T11:10:00Z', event_type: 'scan_result', experimentId: 'scan-20260727-run-290', optimizationValues: '{"scanMin":8}', optimizationCompletedScans: 173, optimizationTotalScans: 290, fleet: 'A', success: true, sduFound: 2 }
  ]);
  assert.equal(result.samples.length, 2);
  assert.equal(result.runtimeCompletedScans, 173);
  assert.equal(result.runtimeTotalScans, 290);
  assert.equal(result.unavailableHistoricalScans, 171);
});

test('scanning analytics keeps two-parameter combinations as distinct tests', () => {
  const { build } = loadAnalytics();
  const result = build([
    { time: '2026-07-27T11:00:00Z', event_type: 'scan_result', experimentId: 'scan-20260727-combo-20', optimizationValues: '{"scanMin":8,"scanMin2":3}', fleet: 'A', success: true, sduFound: 1 },
    { time: '2026-07-27T11:10:00Z', event_type: 'scan_result', experimentId: 'scan-20260727-combo-20', optimizationValues: '{"scanMin":12,"scanMin2":3}', fleet: 'A', success: true, sduFound: 0 }
  ]);
  assert.equal(result.groups.length, 2);
  assert.ok(result.groups.every((group) => group.parameter === 'Combined'));
  assert.match(String(result.groups[0].value), /minProb=/);
  assert.match(String(result.groups[0].value), /instantStrikeoutProb=/);
});

test('scanning analytics catalogs experiment start dates and defaults to optimization-only data', () => {
  const { build, catalog } = loadAnalytics();
  const rows = [
    { time: '2026-07-28T08:00:00Z', event_type: 'scan_result', experimentId: 'scan-20260728-SF01_OPOD-290', optimizationValues: '{"scanMin":8}' },
    { time: '2026-07-29T08:00:00Z', event_type: 'scan_result', experimentId: 'record-20260729-SF02_RANGER', optimizationValues: '{"scanMin":12}' },
    { time: '2026-07-27T08:00:00Z', event_type: 'scan_result', experimentId: 'scan-ms3j1zln-2j0r7l', optimizationValues: '{"scanMin":16}' }
  ];
  const optimizationCatalog = catalog(rows, true);
  assert.deepEqual(Array.from(optimizationCatalog.dates, entry => entry.date), ['2026-07-28', '2026-07-27']);
  assert.equal(optimizationCatalog.dates[0].hasOptimization, true);
  assert.equal(optimizationCatalog.dates[0].hasRecording, false);
  assert.equal(build(rows).experimentId, 'scan-20260728-SF01_OPOD-290');

  const completeCatalog = catalog(rows, false);
  assert.deepEqual(Array.from(completeCatalog.dates, entry => entry.date), ['2026-07-29', '2026-07-28', '2026-07-27']);
  assert.equal(completeCatalog.dates[0].hasRecording, true);
  assert.equal(build(rows, '__latest__', { onlyOptimization: false, startDate: '2026-07-29' }).experimentId, 'record-20260729-SF02_RANGER');
  assert.equal(build(rows, 'record-20260729-SF02_RANGER', { onlyOptimization: false, startDate: '2026-07-28' }).experimentId, 'scan-20260728-SF01_OPOD-290');
});

test('scanning analytics ranks one selected parameter and charts all its values', () => {
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(renderer, /selectedScanningOptimizationParameter/);
  assert.match(renderer, /optimizationAnalyticsParameter\?\.replaceChildren/);
  assert.match(renderer, /selectedScanningOptimizationParameter === '__all__'/);
  assert.match(renderer, /parameterGroups = selectedScanningOptimizationParameter === '__all__'/);
  assert.match(renderer, /renderScanningOptimizationValueChart\(analytics, metric, selectedScanningOptimizationParameter\)/);
  assert.match(renderer, /optimization-route-arrow/);
  assert.match(html, /id="optimization-analytics-parameter"/);
  assert.match(html, /id="optimization-experiment-filter"/);
  assert.match(html, />Scan success rate</);
  assert.match(html, />Average Scan Chance</);
  assert.match(html, />Net ATLAS \/ day</);
  assert.match(html, />Opportunity Cost</);
  assert.match(html, /id="optimization-analytics-economics"/);
  assert.match(html, /id="optimization-analytics-ranking-head"/);
  assert.doesNotMatch(html, /id="optimization-analytics-ranking-parameter"/);
  assert.match(html, /id="optimization-analytics-parameter"[^>]*>[\s\S]*All Parameters/);
  assert.match(html, /data-optimization-analytics-sort="averageScanChance"/);
  assert.match(renderer, /rankingGroups = parameterGroups/);
  assert.match(renderer, /sortScanningOptimizationAnalyticsGroups\(rankingGroups, optimizationAnalyticsSort\)/);
  assert.match(css, /optimization-analytics-ranking-wrap/);
  assert.match(css, /optimization-analytics-value-chart--scrollable/);
  assert.match(css, /optimization-route-line/);
  assert.match(html, /id="optimization-analytics-date-calendar"/);
  assert.match(html, /id="optimization-analytics-only-optimization"[^>]*checked/);
  assert.match(html, /Only Optimization data/);
  assert.match(renderer, /renderScanningOptimizationDateCalendar/);
  assert.match(renderer, /optimization-calendar-day--optimization/);
  assert.match(renderer, /optimization-calendar-day--recording/);
});

test('Optimization exposes Data and Analytics for Scanning and Upgrading', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(html, /data-optimization-view="data"[^>]*>Data/);
  assert.match(html, /data-optimization-view="analytics"[^>]*>Analytics/);
  assert.match(html, /data-optimization-view-panel="analytics" data-optimization-panel="scanning"/);
  assert.match(html, /Value distribution/);
  assert.match(html, /Sector clusters/);
  assert.match(css, /optimization-analytics-grid/);
});

test('Scanning Data filters by optimization parameter instead of status', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');
  assert.match(html, /id="optimization-parameter-filter"/);
  assert.doesNotMatch(html, /id="optimization-status-filter"/);
  assert.match(renderer, /optimizationParameterFilter/);
  assert.doesNotMatch(renderer, /optimizationStatusFilter/);
  assert.match(main, /payload\.optimizationParameter/);
  assert.match(main, /r\.optimizationParameter ==/);
});

test('Scanning Data scopes rows and fleet choices to the selected faction', () => {
  const source = fs.readFileSync(rendererPath, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    "const factionLabels = Object.freeze({ MUD: 'MUD', ONI: 'ONI', USTUR: 'USTUR' });",
    extractFunction(source, 'normalizeFaction'),
    extractFunction(source, 'filterScanningOptimizationRowsByFaction'),
    'this.filterRows = filterScanningOptimizationRowsByFaction;'
  ].join('\n'), context);

  const rows = [
    { faction: 'MUD', fleet: 'Mud Fleet' },
    { faction: 'ONI', fleet: 'Oni Fleet' },
    { faction: 'UST', fleet: 'Ustur Fleet' },
    { faction: 'USTUR', fleet: 'Ustur Fleet 2' },
  ];
  assert.deepEqual(Array.from(context.filterRows(rows, 'MUD'), row => row.fleet), ['Mud Fleet']);
  assert.deepEqual(Array.from(context.filterRows(rows, 'ONI'), row => row.fleet), ['Oni Fleet']);
  assert.deepEqual(Array.from(context.filterRows(rows, 'USTUR'), row => row.fleet), ['Ustur Fleet', 'Ustur Fleet 2']);
  assert.match(source, /optimizationRows = filterScanningOptimizationRowsByFaction/);
  assert.doesNotMatch(source, /const existing = Array\.from\(select\?\.options/);
});

test('analytics requests may load complete scan history without enlarging Data pages', () => {
  const main = fs.readFileSync(mainPath, 'utf8');
  assert.match(main, /payload\.analytics === true \? 5000 : 500/);
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  const analyticsRefreshStart = renderer.indexOf('async function refreshScanningOptimizationAnalyticsData');
  const analyticsRefreshEnd = renderer.indexOf('async function refreshScanningOptimization(', analyticsRefreshStart);
  assert.notEqual(analyticsRefreshStart, -1);
  assert.notEqual(analyticsRefreshEnd, -1);
  const analyticsRefresh = renderer.slice(analyticsRefreshStart, analyticsRefreshEnd);
  assert.match(analyticsRefresh, /eventType: '__all__'/);
  assert.match(analyticsRefresh, /limit: 5000, analytics: true/);
  assert.doesNotMatch(analyticsRefresh, /optimizationStartFilter|optimizationStopFilter/, 'Analytics history must not inherit Data date filters');
  assert.match(main, /payload\.analytics === true[\s\S]*fetchCurrentEarningsPrices/);
  assert.match(renderer, /prices: optimizationAnalyticsPrices/);
  assert.match(main, /pivot[\s\S]*\$\{experimentFilter\}/);
  assert.match(main, /r\.experimentId ==/);
  assert.match(renderer, /experimentId,\n    offset/);
  assert.match(renderer, /fleet, experimentId, eventType, operation, optimizationParameter/);
});

test('Scanning Data date changes do not invalidate or reload Analytics history', () => {
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  assert.doesNotMatch(renderer, /for \(const filter of \[optimizationStartFilter, optimizationStopFilter\]\) \{[\s\S]*?optimizationAnalyticsRows = \[\];[\s\S]*?refreshScanningOptimizationAnalyticsData/);
});

test('scanning analytics values each historical event with its own at-or-before price evidence', () => {
  const { build } = loadAnalytics();
  const identity = { experimentId: 'scan-20260830-historical-2', optimizationValues: '{"scanMin":8}', optimizationBlockIndex: 0, fleet: 'A' };
  const result = build([
    { ...identity, time: '2026-08-30T10:00:00Z', event_type: 'scan_result', success: true, sduFound: 2, burnedFood: 1,
      historicalPrices: { sduPriceAtl: 3, foodPriceAtl: 5, solPriceAtl: 100 } },
    { ...identity, time: '2026-08-30T10:01:00Z', event_type: 'transaction', operation: 'WARP', movementPhase: 'start', burnedFuel: 2, txCostSol: 0.01,
      historicalPrices: { fuelPriceAtl: 7, solPriceAtl: 100 } },
  ], '__latest__', { prices: { sduPriceAtl: 999, foodPriceAtl: 999, fuelPriceAtl: 999, solPriceAtl: 999 } });
  const block = result.groups[0];
  assert.equal(block.grossRevenueAtlas, 6);
  assert.equal(block.foodCostAtlas, 5);
  assert.equal(block.fuelCostAtlas, 14);
  assert.equal(block.txCostAtlas, 1);
});
