'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const main = fs.readFileSync('electron/main.js', 'utf8');
const preload = fs.readFileSync('electron/preload.js', 'utf8');
const renderer = fs.readFileSync('electron/renderer.js', 'utf8');
const html = fs.readFileSync('electron/renderer.html', 'utf8');
const css = fs.readFileSync('electron/renderer.css', 'utf8');

const components = ['Framework', 'Electronics', 'Power Source', 'Electromagnet', 'Field Stabilizer', 'Particle Accelerator', 'Radiation Absorber', 'Survey Data Unit'];

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') { depth += 1; opened = true; }
    if (source[index] === '}') depth -= 1;
    if (opened && depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} is incomplete`);
}

test('upgrading optimization backend joins snapshots, prices, and analytics history', () => {
  assert.match(main, /async function fetchUpgradingOptimization\(/);
  assert.match(main, /base\('optimization_upgrading'\)/);
  assert.match(main, /optimization_upgrading_component/);
  assert.doesNotMatch(main.slice(main.indexOf('async function fetchUpgradingOptimization'), main.indexOf('function getInfluxScopeNote')), /lp_upgrade_process_history/);
  assert.doesNotMatch(main, /r\._measurement == "lp_per_profile" and r\._field == "lp"/);
  assert.match(main, /fetchRedeemedLpSummaryByDate\(settings\)/);
  assert.match(main, /const aephiaFaction = normalizeFaction\(/);
  assert.match(main, /playerProfiles/);
  assert.match(main, /playerRow\?\.contribution/);
  assert.match(main, /redeemedLpSummary\.playerDaily\?\.\[aephiaFaction\]/);
  assert.match(main, /redeemedLpSummary\.factionDaily\?\.\[aephiaFaction\]/);
  assert.match(main, /mergeUpgradingOptimizationRows\(/);
  assert.match(main, /handleTrustedIpc\('optimization:upgrading'/);
  assert.match(preload, /getUpgradingOptimization:.*optimization:upgrading/);
});

test('process automation evidence deduplicates snapshots and summarizes exact repeat chains', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    extractFunction(main, 'optimizationNumberQuantile'),
    extractFunction(main, 'detectUpgradingRestartGap'),
    extractFunction(main, 'summarizeUpgradingProcessHistory'),
    'this.summarize = summarizeUpgradingProcessHistory;',
  ].join('\n'), context);
  const process = (id, profile, start, end) => ({
    process: id, profile, starbase: '0,-24', recipeKey: 'framework', quantity: 100,
    durationSeconds: 3600, startTime: start, endTime: end,
    _time: new Date(start * 1000).toISOString(),
  });
  const rows = [
    process('a', 'p1', 1000, 4600), process('a', 'p1', 1000, 4600),
    process('b', 'p1', 4674, 8274), process('c', 'p1', 8354, 11954),
    process('d', 'p2', 2000, 5600),
  ];
  const result = context.summarize(rows);
  assert.equal(result.snapshotRows, 5);
  assert.equal(result.uniqueProcesses, 4);
  assert.equal(result.profiles, 2);
  assert.equal(result.repeatGroups, 1);
  assert.equal(result.predecessorLinks, 2);
  assert.equal(result.longestChain, 3);
  assert.equal(result.restartGapMedianSeconds, 77);
  assert.equal(result.restartGapP80Seconds, 78.8);
  assert.equal(result.restartWithin120, 2);
  assert.equal(result.restartWithin120Percent, 100);
  assert.equal(result.automationGapLowerSeconds, 74);
  assert.equal(result.automationGapUpperSeconds, 80);
  assert.equal(result.probablyAutomatedPercent, 50);
});

test('upgrading comparison scales use all factions while keeping chart units separate', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    extractFunction(renderer, 'optimizationQuantile'),
    extractFunction(renderer, 'buildUpgradingOptimizationAnalytics'),
    extractFunction(renderer, 'getUpgradingComparisonScales'),
    'this.scales = getUpgradingComparisonScales;',
  ].join('\n'), context);
  const result = context.scales([
    { factionDaily: [{ date: '2026-07-27', lp: 100 }], playerDaily: [{ date: '2026-07-27', lp: 1_000 }], rows: [{ time: '2026-07-27T01:00:00Z', phantom_crew: 10, expected_total_lp_eod: 80 }, { time: '2026-07-27T02:00:00Z', phantom_crew: 10, expected_total_lp_eod: 80 }] },
    { factionDaily: [{ date: '2026-07-27', lp: 200 }], playerDaily: [{ date: '2026-07-27', lp: 4_000 }], rows: [{ time: '2026-07-27T01:00:00Z', phantom_crew: 20, expected_total_lp_eod: 500 }, { time: '2026-07-27T02:00:00Z', phantom_crew: 20, expected_total_lp_eod: 500 }] },
  ], new Date('2026-07-28T12:00:00Z'));
  assert.equal(result.playerLpPerCrewMax, 200);
  assert.equal(result.forecastErrorBound, 300);
});

test('upgrading redemption scatter normalizes player LP by average hourly phantom crew', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    extractFunction(renderer, 'optimizationQuantile'),
    extractFunction(renderer, 'buildUpgradingOptimizationAnalytics'),
    'this.build = buildUpgradingOptimizationAnalytics;',
  ].join('\n'), context);
  const result = context.build({
    factionDaily: [{ date: '2026-07-27', lp: 1_000_000 }],
    playerDaily: [{ date: '2026-07-27', lp: 10_000 }],
    rows: [
      { time: '2026-07-27T01:05:00Z', phantom_crew: 100, expected_total_lp_eod: 800_000 },
      { time: '2026-07-27T01:55:00Z', phantom_crew: 200, expected_total_lp_eod: 850_000 },
      { time: '2026-07-27T02:05:00Z', phantom_crew: 400, expected_total_lp_eod: 900_000 },
    ],
  }, new Date('2026-07-28T12:00:00Z'));
  assert.equal(result.scatter.length, 1);
  assert.equal(result.scatter[0].averageCrew, 300);
  assert.equal(result.scatter[0].playerLpPerCrew, 10_000 / 300);
});

test('Optimization exposes Upgrading after Scanning with date filters, table, and analytics charts', () => {
  assert.match(html, /data-optimization-subtab="scanning"[^>]*>Scanning</);
  assert.match(html, /data-optimization-subtab="upgrading"[^>]*>Upgrading</);
  assert.ok(html.indexOf('data-optimization-subtab="scanning"') < html.indexOf('data-optimization-subtab="upgrading"'));
  for (const id of ['optimization-upgrading-start-filter', 'optimization-upgrading-stop-filter', 'optimization-upgrading-sync-status', 'optimization-upgrading-table-head', 'optimization-upgrading-table-body', 'optimization-upgrading-analytics-status', 'optimization-upgrading-redemption-legend', 'optimization-upgrading-net-atlas-chart', 'optimization-upgrading-margin-chart', 'optimization-upgrading-efficiency-chart', 'optimization-upgrading-redemption-chart', 'optimization-upgrading-forecast-chart', 'optimization-upgrading-error-chart', 'optimization-upgrading-breakeven-body']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /Process automation evidence/);
  assert.match(html, />LP Analysis yesterday</);
  assert.match(html, /optimization-upgrading-primary-chart-card[\s\S]*?Faction LP redemption vs player LP per upgrading crew[\s\S]*?id="optimization-upgrading-redemption-chart"/);
  assert.match(html, /id="optimization-upgrading-error-chart"[\s\S]*?optimization-upgrading-redemption-chart-row[\s\S]*?id="optimization-upgrading-redemption-legend"[\s\S]*?<h3>Component NET ATLAS\/s vs Faction LP Redemption<\/h3>[\s\S]*?id="optimization-upgrading-net-atlas-chart"[\s\S]*?<h3>Component Profit Margin vs Faction LP Redemption<\/h3>[\s\S]*?id="optimization-upgrading-margin-chart"[\s\S]*?optimization-upgrading-breakeven-card optimization-analytics-summary-card[\s\S]*?>LP Analysis yesterday[\s\S]*?optimization-upgrading-primary-chart-card[\s\S]*?Component Efficiency Frontier[\s\S]*?id="optimization-upgrading-efficiency-chart"/);
  assert.match(html, /id="optimization-upgrading-forecast-chart"[\s\S]*?id="optimization-upgrading-error-chart"/);
  assert.match(html, /<section class="optimization-analytics-card">\s*<h3>Forecast error by snapshot hour<\/h3>/);
  assert.match(html, /optimization-upgrading-primary-chart-card/);
  assert.match(html, /How to read this page/);
  assert.doesNotMatch(html, /optimization-process-evidence-wrap/);
  assert.match(html, /optimization-upgrading-page-guide[\s\S]*earnings-metric-guide-item/);
  assert.match(html, /optimization-upgrading-page-guide[\s\S]*Formula:/);
  assert.match(html, /optimization-upgrading-page-guide[\s\S]*Interpretation:/);
  assert.match(html, /optimization-scanning-page-guide[\s\S]*How to read this page/);
  assert.match(html, /optimization-scanning-page-guide[\s\S]*Formula:/);
  assert.match(html, /optimization-scanning-page-guide[\s\S]*Interpretation:/);
  assert.doesNotMatch(html, /How to read this table/);
  assert.ok(html.indexOf('id="optimization-analytics-tooltip"') > html.indexOf('data-optimization-panel="upgrading"'), 'shared tooltip must live outside hidden analytics panels');
  assert.doesNotMatch(html, /id="optimization-upgrading-instance-filter"/);
  assert.doesNotMatch(renderer, /optimizationUpgradingInstanceFilter/);
});

test('Upgrading renderer defines the agreed columns and component pairs', () => {
  for (const label of ['Player LP Installed Today', 'Faction LP Installed Today', 'Phantom Crew', 'Neutral LP Target', 'Requested LP Target', 'Optimizer LP Target', 'Aggr. (rel.)', 'Aggr. (abs.)', 'Expected Additional LP by EOD', 'Expected Total LP by EOD', 'Uninstalled automated LP', 'Uninstalled not automated LP', 'Uninstalled not automated LP (>24h)', 'Oldest Uninstalled Age']) assert.match(renderer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const component of components) assert.match(renderer, new RegExp(`'${component}'`));
  assert.match(renderer, /label: `\$\{label\} Installed`/);
  assert.match(renderer, /function refreshUpgradingOptimization\(/);
  assert.match(renderer, /api\.getUpgradingOptimization/);
  assert.match(renderer, /function buildUpgradingOptimizationAnalytics\(/);
  assert.match(renderer, /function renderUpgradingOptimizationAnalytics\(/);
  assert.match(renderer, /correlation/);
  assert.match(renderer, /const startY=intercept\+slope\*minX,endY=intercept\+slope\*maxX/);
  assert.doesNotMatch(renderer, /const startY=Math\.max\(0,Math\.min\(maxY,intercept\)\)/);
  assert.match(renderer, /clip-path':`url\(#optimization-upgrading-scatter-clip\)`/);
  assert.match(renderer, /x:axes\.width-axes\.right,y:axes\.top-2,'text-anchor':'end'/);
  for (const label of ['Faction LP redeemed', 'Player LP / avg phantom crew', 'Snapshot hour (UTC)', 'Expected total LP by EOD', 'Forecast error (LP)']) assert.match(renderer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const subtitle of ['One dot per completed UTC day', 'Hourly optimization snapshots', 'Median signed error with the middle 50% band']) assert.doesNotMatch(html, new RegExp(subtitle));
  assert.match(fs.readFileSync('electron/renderer.css', 'utf8'), /\.optimization-upgrading-tall-chart svg \{ height: auto; aspect-ratio: 760 \/ 340; \}/);
  assert.match(fs.readFileSync('electron/renderer.css', 'utf8'), /\.optimization-upgrading-primary-chart-card \.optimization-upgrading-tall-chart \{ width: 66\.6667%; margin-inline: auto; \}/);
  assert.match(renderer, /row\.lpPerSecond\.toFixed\(1\)/);
  assert.match(renderer, /const upgradingBreakevenColumns = Object\.freeze\(\[[\s\S]*?key: 'name'[\s\S]*?key: 'upgradingTime'[\s\S]*?key: 'lpValue'[\s\S]*?key: 'lpPerSecond'[\s\S]*?key: 'factionLp'[\s\S]*?key: 'breakevenLp'[\s\S]*?key: 'gmPrice'[\s\S]*?key: 'grossAtlasPerSecond'/);
  assert.match(renderer, /key: 'grossAtlasPerSecond', label: 'Gross ATLAS\/s', selected: false/);
  for (const key of ['name', 'lpPerSecond', 'breakevenLp', 'gmPrice', 'marginPercent', 'netAtlasPerSecond', 'netAtlasPerCargoUnit', 'limit']) assert.match(renderer, new RegExp(`key: '${key}', label: [^\\n]+ selected: true`));
  for (const key of ['upgradingTime', 'lpValue', 'factionLp']) assert.match(renderer, new RegExp(`key: '${key}', label: [^\\n]+ selected: false`));
  assert.match(renderer, /currentOptimizationSubtab === 'upgrading' && currentOptimizationView === 'analytics'/);
  assert.match(renderer, /persistUpgradingBreakevenColumnState\(\)/);
  assert.match(html, /id="optimization-upgrading-breakeven-head"/);
  assert.match(renderer, /upgradingTime:`\$\{row\.durationSeconds\}s`/);
  assert.match(renderer, /lpValue:row\.lp\.toLocaleString\(\)/);
  assert.match(renderer, /factionLp:formatCompactNumber\(factionLp\)/);
  assert.match(renderer, /expected_total_lp_eod/);
  assert.match(renderer, /points\.sort\(\(a,b\) => a\.hour-b\.hour\)\.slice\(1\)/);
  assert.match(renderer, /bindOptimizationAnalyticsTooltip\(snapshot/);
  assert.match(renderer, /bindOptimizationAnalyticsTooltip\(hitArea/);
  assert.match(renderer, /optimizationAnalyticsTooltip\.getBoundingClientRect\(\)/);
  assert.match(renderer, /window\.innerWidth - bounds\.width - margin/);
  assert.match(renderer, /window\.innerHeight - bounds\.height - margin/);
  assert.match(renderer, /final \$\{factionLabel\} faction LP redemption/);
  assert.match(renderer, /optimization-line-hit/);
  assert.match(renderer, /selectedUpgradingRedemptionComponents = new Set[\s\S]*?name !== 'Ink'/);
  assert.match(renderer, /renderUpgradingRedemptionLegend[\s\S]*?renderUpgradingNetAtlasChart\(analytics\)[\s\S]*?renderUpgradingMarginChart\(analytics\)/);
  assert.match(renderer, /buildUpgradingMarginSeries[^(]*\([^;]+?\.filter\(\(entry\) => selectedUpgradingRedemptionComponents\.has\(entry\.name\)\)/);
  assert.match(css, /\.optimization-upgrading-redemption-chart-row[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
  assert.match(css, /\.optimization-upgrading-redemption-charts[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.optimization-upgrading-redemption-chart[\s\S]*?min-height:\s*340px/);
  assert.match(renderer, /bindUpgradingRedemptionChartNavigation/);
  assert.match(renderer, /bindUpgradingAnalyticsChartNavigation/);
  for (const chartKey of ['scatter', 'forecast', 'error', 'efficiency']) assert.match(renderer, new RegExp(`bindUpgradingAnalyticsChartNavigation\\(svg, axes, analytics, '${chartKey}'`));
  assert.match(renderer, /upgradingTimeChartView/);
  assert.match(renderer, /upgradingScatterChartView/);
  assert.match(renderer, /upgradingEfficiencyChartView/);
  assert.match(renderer, /startDrag\('x-zoom'/);
  assert.match(renderer, /startDrag\('y-zoom'/);
  assert.match(renderer, /startDrag\('pan'/);
  assert.match(renderer, /addEventListener\('dblclick'/);
  assert.match(renderer, /addEventListener\('wheel'/);
  assert.match(renderer, /xFloor: 0/);
  assert.match(css, /\.optimization-chart-axis-drag/);
  assert.match(css, /\.optimization-chart-pan-area/);
  assert.match(renderer, /rgba\(69, 214, 193/);
  assert.match(renderer, /analytics\.scatter\.forEach.*?fill:'#45d6c1'/);
  assert.doesNotMatch(renderer, /analytics\.scatter\.forEach.*?optimizationAnalyticsColor/);
  assert.match(renderer, /#f59e0b.*?isToday\?/);
  assert.match(renderer, /actual final/);
  assert.match(renderer, /forecast error/);
  assert.match(css, /\.optimization-surface\.optimization-analytics-surface\s*\{[\s\S]*?overflow-y:\s*scroll/);
  assert.match(css, /\.optimization-line-hit/);
  assert.match(css, /pointer-events: stroke/);
});


test('component margin chart uses pool share value, current GM price, and latest completed faction redemption', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    `const upgradingMarginComponents = Object.freeze([['Framework', 68]]);`,
    `const upgradingDurationSeconds = Object.freeze({ Framework: 12 });`,
    extractFunction(renderer, 'buildUpgradingMarginSeries'),
    'this.build = buildUpgradingMarginSeries;',
  ].join('\n'), context);
  const series = context.build({ atlasPool: 2_000_000, componentPricesAtl: { framework: 2 } }, 10_000_000_000, 50_000_000_000);
  assert.equal(series.length, 1);
  assert.equal(series[0].points[0].factionLp, 10_000_000_000);
  assert.equal(series[0].points.at(-1).marginPercent, -99.864);
  assert.ok(Math.abs(series[0].points.at(-1).netAtlasPerSecond - (-0.16644)) < 1e-12);
  assert.match(main, /fetchAephiaResourceData\(\)\.catch/);
  assert.match(main, /pricingATL\?\.priceATL/);
  assert.match(main, /atlasPool: UPGRADE_ATLAS_POOLS\[aephiaFaction\]/);
  assert.match(renderer, /latestFactionRedemption/);
  assert.match(renderer, /formatCompactNumber\(Number\(result\.atlasPool\)\*row\.lp\/row\.gmPrice\)/);
  assert.match(renderer, /sort\(\(a, b\) => a\.lp - b\.lp\)/);
  assert.match(css, /\.optimization-upgrading-breakeven-table \{ min-width: 0; font-size: 11px; \}/);
  for (const component of ['Power Source', 'Framework', 'Electromagnet', 'Electronics', 'Field Stabilizer', 'Particle Accelerator', 'Radiation Absorber', 'Survey Data Unit', 'Ink']) assert.match(renderer, new RegExp(component));
});


test('component efficiency calculates gross and net ATLAS per second and marks dominated choices', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    `const upgradingMarginComponents = Object.freeze([['Framework', 68], ['Power Source', 98]]);`,
    `const upgradingDurationSeconds = Object.freeze({ Framework: 12, 'Power Source': 15 });`,
    `const upgradingCargoWeight = Object.freeze({ Framework: 1, 'Power Source': 2 });`,
    extractFunction(renderer, 'buildUpgradingEfficiencyRows'),
    extractFunction(renderer, 'markUpgradingDominatedRows'),
    'this.build = (result, factionLp) => markUpgradingDominatedRows(buildUpgradingEfficiencyRows(result, factionLp));',
  ].join('\n'), context);
  const rows = context.build({ atlasPool: 2_000_000, componentPricesAtl: { framework: 0.003, 'power source': 0.01 } }, 40_000_000_000);
  const framework = rows.find((row) => row.name === 'Framework');
  const powerSource = rows.find((row) => row.name === 'Power Source');
  assert.equal(framework.durationSeconds, 12);
  assert.equal(framework.cargoWeight, 1);
  assert.ok(Math.abs(framework.grossAtlasPerSecond - 0.00028333333333333335) < 1e-15);
  assert.ok(Math.abs(framework.netAtlasPerSecond - 0.00003333333333333333) < 1e-15);
  assert.equal(framework.dominated, false);
  assert.equal(powerSource.dominated, true);
  assert.match(renderer, /optimization-dominated-cross/);
  assert.match(renderer, /optimization-pareto-frontier/);
  assert.match(extractFunction(renderer, 'markUpgradingDominatedRows'), /includeCargo/);
  assert.match(renderer, /markUpgradingDominatedRows\(rows, false\)/);
  assert.match(renderer, /duration: 3000/);
  assert.match(renderer, /optimization-efficiency-label/);
  assert.match(renderer, /const factionLp = Number\(buildUpgradingOptimizationAnalytics\(result\)\.latestFactionRedemption/);
  assert.match(renderer, /anchorPrice \/ anchor\.durationSeconds/);
  assert.match(renderer, /upgradingLimitAnchorByFaction/);
  assert.match(renderer, /row\.durationSeconds\*\(row\.grossAtlasPerSecond-targetNet\)/);
  assert.match(html, /Capital-limited/);
  assert.match(html, /Crew-limited/);
  assert.match(html, /Cargo-limited/);
  assert.match(html, /Gross ATLAS\/s/);
  assert.match(html, /Net ATLAS\/s/);
});


test('upgrading redemption chart drag math zooms axes and pans a shared viewport', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    extractFunction(renderer, 'calculateUpgradingRedemptionDragView'),
    'this.drag = calculateUpgradingRedemptionDragView;',
  ].join('\n'), context);
  const view = { xMin: 10e9, xMax: 50e9, yMin: -0.2, yMax: 0.2 };
  const xZoom = context.drag(view, 'x-zoom', 100, 0, 500, 300);
  assert.ok(xZoom.xMax - xZoom.xMin > 40e9);
  assert.equal(xZoom.yMin, view.yMin);
  const pan = context.drag(view, 'pan', 100, -75, 500, 300);
  assert.equal(pan.xMin, 2e9);
  assert.equal(pan.xMax, 42e9);
  assert.ok(Math.abs(pan.yMin - (-0.3)) < 1e-12);
  assert.ok(Math.abs(pan.yMax - 0.1) < 1e-12);
  const yZoom = context.drag(view, 'y-zoom', 0, 75, 500, 300);
  assert.ok(yZoom.yMax - yZoom.yMin < 0.4);
  assert.equal(yZoom.xMin, view.xMin);
  const clampedPan = context.drag(view, 'pan', 1000, 0, 500, 300, { xFloor: 0 });
  assert.equal(clampedPan.xMin, 0);
  assert.equal(clampedPan.xMax, 40e9);
  const clampedZoom = context.drag({ ...view, xMin: 0, xMax: 40e9 }, 'x-zoom', 100, 0, 500, 300, { xFloor: 0, xMinSpan: 100e6, xMaxSpan: 100e9 });
  assert.equal(clampedZoom.xMin, 0);
  assert.ok(clampedZoom.xMax > 40e9);
  const hourlyZoom = context.drag({ xMin: 0, xMax: 24, yMin: 0, yMax: 1 }, 'x-zoom', -100, 0, 500, 300);
  assert.ok(hourlyZoom.xMax - hourlyZoom.xMin < 24);
  assert.ok(hourlyZoom.xMax - hourlyZoom.xMin > 1);
});

test('upgrading chart axes preserve sub-unit ranges instead of collapsing ATLAS-per-second values', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${extractFunction(renderer, 'mapUpgradingChartY')}\nthis.mapY = mapUpgradingChartY;`, context);
  assert.equal(context.mapY(0.0002, 0.0001, 0.0002, 12, 292), 12);
  assert.equal(context.mapY(0.0001, 0.0001, 0.0002, 12, 292), 292);
  assert.doesNotMatch(renderer, /Math\.max\(1,maxY-minY\)/);
});

test('LIMIT mode gives every achievable component Framework-equivalent net ATLAS per second', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${extractFunction(renderer, 'applyUpgradingLimitPrices')}\nthis.apply = applyUpgradingLimitPrices;`, context);
  const rows = [
    { name: 'Framework', durationSeconds: 12, grossAtlasPerSecond: 0.0003, impliedAtlasValue: 0.0036, cargoWeight: 1 },
    { name: 'Electronics', durationSeconds: 14, grossAtlasPerSecond: 0.0004, impliedAtlasValue: 0.0056, cargoWeight: 2 },
  ];
  const result = context.apply(rows, 'Framework', 0.0012);
  assert.equal(result.length, 2);
  assert.ok(Math.abs(result[0].netAtlasPerSecond - 0.0002) < 1e-15);
  assert.ok(Math.abs(result[1].netAtlasPerSecond - 0.0002) < 1e-15);
  assert.ok(Math.abs(result[1].limitPrice - 0.0028) < 1e-15);
  assert.match(html, /id="optimization-upgrading-efficiency-limit"/);
  assert.match(css, /optimization-upgrading-breakeven-wrap \{ max-height: none; overflow: visible; \}/);
});

test('LP Analysis yesterday exposes a cost basis toggle beside the title and an Internal Cost column', () => {
  assert.match(html, /optimization-upgrading-breakeven-header/);
  assert.match(html, /id="optimization-upgrading-breakeven-basis-external"/);
  assert.match(html, /id="optimization-upgrading-breakeven-basis-internal"/);
  assert.match(html, /data-basis="external"/);
  assert.match(html, /data-basis="internal"/);
  const headerIdx = html.indexOf('optimization-upgrading-breakeven-header');
  const externalIdx = html.indexOf('id="optimization-upgrading-breakeven-basis-external"');
  const internalIdx = html.indexOf('id="optimization-upgrading-breakeven-basis-internal"');
  const h3Idx = html.indexOf('<h3>LP Analysis yesterday</h3>');
  assert.ok(headerIdx < externalIdx && headerIdx < internalIdx);
  assert.ok(h3Idx < externalIdx && h3Idx < internalIdx);
  assert.ok(externalIdx < internalIdx);
  assert.match(renderer, /const UPGRADING_BREAKEVEN_BASIS_STORAGE_KEY = 'my-star-atlas:optimization-upgrading-analysis-cost-basis:v1';/);
  assert.match(renderer, /const UPGRADING_BREAKEVEN_BASISES = Object\.freeze\(\{ external: 'external', internal: 'internal' \}\);/);
  assert.match(renderer, /let upgradingBreakevenCostBasis = UPGRADING_BREAKEVEN_BASISES\.external;/);
  assert.match(renderer, /restoreUpgradingBreakevenCostBasis\(\);/);
  assert.match(renderer, /setUpgradingBreakevenCostBasis\(UPGRADING_BREAKEVEN_BASISES\.internal\)/);
  assert.match(renderer, /syncUpgradingBreakevenBasisToggle\(\);/);
  assert.match(renderer, /key: 'internalCost', label: 'Internal Cost', selected: true/);
  assert.match(css, /\.optimization-upgrading-breakeven-toggle-option\.active/);
});

test('phantom starbase lookup and breakeven cost summation', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    `const UPGRADING_BREAKEVEN_BASISES = Object.freeze({ external: 'external', internal: 'internal' });`,
    extractFunction(renderer, 'phantomStarbaseForFaction'),
    extractFunction(renderer, 'sumBreakevenCostPerUnit'),
    'this.phantom = phantomStarbaseForFaction;',
    'this.sum = sumBreakevenCostPerUnit;',
  ].join('\n'), context);
  assert.equal(context.phantom('MUD'), 'MUD-PHANTOM');
  assert.equal(context.phantom('ONI'), 'ONI-PHANTOM');
  assert.equal(context.phantom('USTUR'), 'USTUR-PHANTOM');
  assert.equal(context.phantom('UST'), 'USTUR-PHANTOM');
  assert.equal(context.sum({ scanningCostPerUnit: 1, miningCostPerUnit: 2, craftingCostPerUnit: 3, cargoCostPerUnit: 4 }), 10);
  assert.equal(context.sum({ scanningCostPerUnit: 1, miningCostPerUnit: null, craftingCostPerUnit: 3, cargoCostPerUnit: null }), 4);
  assert.equal(context.sum({}), null);
  assert.equal(context.sum(null), null);
});

test('Internal cost basis also recalculates the Profit Margin chart series', () => {
  const context = { latestBreakevenResult: null };
  vm.createContext(context);
  vm.runInContext([
    `const UPGRADING_BREAKEVEN_BASISES = Object.freeze({ external: 'external', internal: 'internal' });`,
    extractFunction(renderer, 'phantomStarbaseForFaction'),
    extractFunction(renderer, 'sumBreakevenCostPerUnit'),
    extractFunction(renderer, 'getUpgradingBreakevenInternalCosts'),
    extractFunction(renderer, 'applyUpgradingMarginCostBasis'),
    'this.apply = applyUpgradingMarginCostBasis;',
  ].join('\n'), context);
  const series = [{
    name: 'Framework', lp: 68, price: 0.003, durationSeconds: 12,
    points: [{ factionLp: 10_000_000_000, impliedAtlasValue: 0.0034, marginPercent: 13.333, netAtlasPerSecond: 0.0000333 }],
  }];
  context.latestBreakevenResult = { breakevenRows: [{ starbase: 'MUD-PHANTOM', asset: 'Framework', scanningCostPerUnit: 0.001, miningCostPerUnit: 0.0005, craftingCostPerUnit: 0.0008, cargoCostPerUnit: 0.0002 }] };
  const internal = context.apply(series, 'internal', 'MUD');
  assert.equal(internal.length, 1);
  assert.equal(internal[0].costBasis, 'internal');
  assert.ok(Math.abs(internal[0].price - 0.0025) < 1e-12);
  assert.ok(Math.abs(internal[0].points[0].marginPercent - 36) < 1e-12);
  assert.ok(Math.abs(internal[0].points[0].netAtlasPerSecond - 0.000075) < 1e-12);

  context.latestBreakevenResult = { breakevenRows: [{ starbase: 'OTHER-PHANTOM', asset: 'Framework', scanningCostPerUnit: 1 }] };
  assert.deepEqual(context.apply(series, 'internal', 'MUD'), []);
  assert.equal(context.apply(series, 'external', 'MUD')[0].price, 0.003);
  assert.match(renderer, /renderUpgradingMarginChart\(analytics\);/);
  assert.match(renderer, /applyUpgradingMarginCostBasis\(buildUpgradingMarginSeries/);
});

test('Internal cost basis replaces GM price for net metrics and stays unavailable without a phantom starbase row', () => {
  const context = { latestBreakevenResult: null };
  vm.createContext(context);
  vm.runInContext([
    `const UPGRADING_BREAKEVEN_BASISES = Object.freeze({ external: 'external', internal: 'internal' });`,
    extractFunction(renderer, 'phantomStarbaseForFaction'),
    extractFunction(renderer, 'sumBreakevenCostPerUnit'),
    extractFunction(renderer, 'getUpgradingBreakevenInternalCosts'),
    extractFunction(renderer, 'applyUpgradingCostBasis'),
    'this.latestBreakevenResult = null;',
    'this.apply = applyUpgradingCostBasis;',
  ].join('\n'), context);
  const baseRows = [
    { name: 'Framework', lp: 68, gmPrice: 0.003, durationSeconds: 12, cargoWeight: 1, lpPerSecond: 5.667, impliedAtlasValue: 0.0034, grossAtlasPerSecond: 0.000283, netAtlasPerSecond: 0.000033, marginPercent: 13.33, netAtlasPerCargoUnit: 0.0004 },
  ];
  const external = context.apply(baseRows, 'external', 'MUD');
  assert.equal(external[0].basis, 'external');
  assert.equal(external[0].internalCost, null);
  assert.equal(external[0].netAtlasPerSecond, baseRows[0].netAtlasPerSecond);

  context.latestBreakevenResult = { breakevenRows: [{ starbase: 'MUD-PHANTOM', asset: 'Framework', scanningCostPerUnit: 0.001, miningCostPerUnit: 0.0005, craftingCostPerUnit: 0.0008, cargoCostPerUnit: 0.0002 }] };
  const internal = context.apply(baseRows, 'internal', 'MUD');
  assert.equal(internal[0].basis, 'internal');
  assert.ok(Math.abs(internal[0].internalCost - 0.0025) < 1e-12);
  assert.equal(internal[0].marginPercent > 0, true);
  assert.notEqual(internal[0].netAtlasPerSecond, baseRows[0].netAtlasPerSecond);

  context.latestBreakevenResult = { breakevenRows: [{ starbase: 'OTHER-1', asset: 'Framework', scanningCostPerUnit: 0.001, miningCostPerUnit: 0.0005, craftingCostPerUnit: 0.0008, cargoCostPerUnit: 0.0002 }] };
  const missing = context.apply(baseRows, 'internal', 'MUD');
  assert.equal(missing[0].internalCost, null);
  assert.equal(missing[0].marginPercent, null);
  assert.equal(missing[0].netAtlasPerSecond, null);
  assert.equal(missing[0].netAtlasPerCargoUnit, null);

  context.latestBreakevenResult = { breakevenRows: [{ starbase: 'MUD-PHANTOM', asset: 'Other', scanningCostPerUnit: 1, miningCostPerUnit: 1, craftingCostPerUnit: 1, cargoCostPerUnit: 1 }] };
  const mismatched = context.apply(baseRows, 'internal', 'MUD');
  assert.equal(mismatched[0].internalCost, null);
  assert.equal(mismatched[0].netAtlasPerSecond, null);
});
