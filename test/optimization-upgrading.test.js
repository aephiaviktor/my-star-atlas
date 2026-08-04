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
  for (const id of ['optimization-upgrading-start-filter', 'optimization-upgrading-stop-filter', 'optimization-upgrading-sync-status', 'optimization-upgrading-table-head', 'optimization-upgrading-table-body', 'optimization-upgrading-analytics-status', 'optimization-upgrading-margin-chart', 'optimization-upgrading-efficiency-chart', 'optimization-upgrading-redemption-chart', 'optimization-upgrading-forecast-chart', 'optimization-upgrading-error-chart', 'optimization-upgrading-breakeven-body']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /Process automation evidence/);
  assert.match(html, />LP Analysis yesterday</);
  assert.match(html, /optimization-upgrading-primary-chart-card[\s\S]*?Faction LP redemption vs player LP per upgrading crew[\s\S]*?id="optimization-upgrading-redemption-chart"/);
  assert.match(html, /id="optimization-upgrading-error-chart"[\s\S]*?Component profit margin vs faction LP redemption[\s\S]*?id="optimization-upgrading-margin-chart"[\s\S]*?Component Efficiency Frontier[\s\S]*?id="optimization-upgrading-efficiency-chart"[\s\S]*?optimization-upgrading-breakeven-card optimization-analytics-summary-card[\s\S]*?>LP Analysis yesterday</);
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
  assert.match(renderer, /x:axes\.width-axes\.right,y:axes\.top-2,'text-anchor':'end'/);
  for (const label of ['Faction LP redeemed', 'Player LP / avg phantom crew', 'Snapshot hour (UTC)', 'Expected total LP by EOD', 'Forecast error (LP)']) assert.match(renderer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const subtitle of ['One dot per completed UTC day', 'Hourly optimization snapshots', 'Median signed error with the middle 50% band']) assert.doesNotMatch(html, new RegExp(subtitle));
  assert.match(fs.readFileSync('electron/renderer.css', 'utf8'), /\.optimization-upgrading-tall-chart svg \{ height: auto; aspect-ratio: 760 \/ 340; \}/);
  assert.match(renderer, /expected_total_lp_eod/);
  assert.match(renderer, /points\.sort\(\(a,b\) => a\.hour-b\.hour\)\.slice\(1\)/);
  assert.match(renderer, /bindOptimizationAnalyticsTooltip\(snapshot/);
  assert.match(renderer, /bindOptimizationAnalyticsTooltip\(hitArea/);
  assert.match(renderer, /optimizationAnalyticsTooltip\.getBoundingClientRect\(\)/);
  assert.match(renderer, /window\.innerWidth - bounds\.width - margin/);
  assert.match(renderer, /window\.innerHeight - bounds\.height - margin/);
  assert.match(renderer, /final \$\{factionLabel\} faction LP redemption/);
  assert.match(renderer, /optimization-line-hit/);
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
    extractFunction(renderer, 'buildUpgradingMarginSeries'),
    'this.build = buildUpgradingMarginSeries;',
  ].join('\n'), context);
  const series = context.build({ atlasPool: 2_000_000, componentPricesAtl: { framework: 2 } }, 10_000_000_000, 50_000_000_000);
  assert.equal(series.length, 1);
  assert.equal(series[0].points[0].factionLp, 10_000_000_000);
  assert.equal(series[0].points.at(-1).marginPercent, -99.864);
  assert.match(main, /fetchAephiaResourceData\(\)\.catch/);
  assert.match(main, /pricingATL\?\.priceATL/);
  assert.match(main, /atlasPool: UPGRADE_ATLAS_POOLS\[aephiaFaction\]/);
  assert.match(renderer, /latestFactionRedemption/);
  assert.match(renderer, /formatCompactNumber\(Number\(result\.atlasPool\) \* row\.lp \/ row\.gmPrice\)/);
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
  assert.doesNotMatch(extractFunction(renderer, 'markUpgradingDominatedRows'), /cargoWeight/);
  assert.match(renderer, /duration: 3000/);
  assert.match(renderer, /optimization-efficiency-label/);
  assert.match(renderer, /const factionLp = Number\(buildUpgradingOptimizationAnalytics\(result\)\.latestFactionRedemption/);
  assert.match(renderer, /frameworkLimit \/ framework\.durationSeconds/);
  assert.match(renderer, /row\.durationSeconds \* \(row\.grossAtlasPerSecond - targetNet\)/);
  assert.match(html, /Capital-limited/);
  assert.match(html, /Crew-limited/);
  assert.match(html, /Cargo-limited/);
  assert.match(html, /Gross ATLAS\/s/);
  assert.match(html, /Net ATLAS\/s/);
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
  const result = context.apply(rows, 0.0012);
  assert.equal(result.length, 2);
  assert.ok(Math.abs(result[0].netAtlasPerSecond - 0.0002) < 1e-15);
  assert.ok(Math.abs(result[1].netAtlasPerSecond - 0.0002) < 1e-15);
  assert.ok(Math.abs(result[1].limitPrice - 0.0028) < 1e-15);
  assert.match(html, /id="optimization-upgrading-efficiency-limit"/);
  assert.match(css, /optimization-upgrading-breakeven-wrap \{ max-height: none; overflow: visible; \}/);
});
