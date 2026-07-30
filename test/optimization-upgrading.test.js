'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const main = fs.readFileSync('electron/main.js', 'utf8');
const preload = fs.readFileSync('electron/preload.js', 'utf8');
const renderer = fs.readFileSync('electron/renderer.js', 'utf8');
const html = fs.readFileSync('electron/renderer.html', 'utf8');

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

test('upgrading optimization backend joins snapshots, process evidence, and analytics history', () => {
  assert.match(main, /async function fetchUpgradingOptimization\(/);
  assert.match(main, /base\('optimization_upgrading'\)/);
  assert.match(main, /optimization_upgrading_component/);
  assert.match(main, /lp_upgrade_process_history/);
  assert.match(main, /summarizeUpgradingProcessHistory/);
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
  for (const id of ['optimization-upgrading-start-filter', 'optimization-upgrading-stop-filter', 'optimization-upgrading-sync-status', 'optimization-upgrading-table-head', 'optimization-upgrading-table-body', 'optimization-upgrading-analytics-status', 'optimization-upgrading-redemption-chart', 'optimization-upgrading-forecast-chart', 'optimization-upgrading-error-chart', 'optimization-upgrading-process-evidence-body']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Process automation evidence/);
  assert.match(html, /How to read this page/);
  assert.match(html, /optimization-process-evidence-wrap/);
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
  const css = fs.readFileSync('electron/renderer.css', 'utf8');
  assert.match(css, /\.optimization-surface\.optimization-analytics-surface\s*\{[\s\S]*?overflow-y:\s*scroll/);
  assert.match(css, /\.optimization-process-evidence-wrap\s*\{[\s\S]*?overflow:\s*visible/);
  assert.match(css, /\.optimization-line-hit/);
  assert.match(css, /pointer-events: stroke/);
});
