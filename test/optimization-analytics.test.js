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
    extractFunction(source, 'buildScanningOptimizationAnalytics'),
    'this.build = buildScanningOptimizationAnalytics;'
  ].join('\n'), context);
  return context.build;
}

test('scanning analytics selects the latest experiment and ranks value groups', () => {
  const build = loadAnalytics();
  const rows = [
    { time: '2026-07-27T10:00:00Z', event_type: 'scan_result', experimentId: 'old', optimizationValues: '{"scanMin":8}', fleet: 'A', success: true, sduFound: 1 },
    { time: '2026-07-27T11:00:00Z', event_type: 'scan_result', experimentId: 'new', optimizationValues: '{"scanMin":8}', fleet: 'A', success: true, sduFound: 0, resultSectorX: 1, resultSectorY: 2 },
    { time: '2026-07-27T11:10:00Z', event_type: 'scan_result', experimentId: 'new', optimizationValues: '{"scanMin":8}', fleet: 'A', success: true, sduFound: 2, resultSectorX: 2, resultSectorY: 2 },
    { time: '2026-07-27T11:20:00Z', event_type: 'scan_result', experimentId: 'new', optimizationValues: '{"scanMin":12}', fleet: 'A', success: false, sduFound: 0, resultSectorX: 3, resultSectorY: 2 },
    { time: '2026-07-27T11:30:00Z', event_type: 'transaction', experimentId: 'new', optimizationValues: '{"scanMin":12}', fleet: 'A', success: true, sduFound: 99 }
  ];
  const result = build(rows);
  assert.equal(result.experimentId, 'new');
  assert.equal(result.samples.length, 3);
  assert.deepEqual(Array.from(result.experiments), ['new', 'old']);
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


test('scanning analytics merges legacy experiment ids through previousExperimentId aliases', () => {
  const build = loadAnalytics();
  const result = build([
    { time: '2026-07-27T11:00:00Z', event_type: 'scan_result', experimentId: 'scan-ms3j1zln-2j0r7l', optimizationValues: '{"scanMin":8}', fleet: 'SF01-OPOD', success: true, sduFound: 1 },
    { time: '2026-07-27T11:10:00Z', event_type: 'scan_result', experimentId: 'scan-20260728-SF01_OPOD-290', previousExperimentId: 'scan-ms3j1zln-2j0r7l', optimizationValues: '{"scanMin":8}', fleet: 'SF01-OPOD', success: true, sduFound: 2 }
  ]);
  assert.equal(result.experimentId, 'scan-20260728-SF01_OPOD-290');
  assert.deepEqual(Array.from(result.experiments), ['scan-20260728-SF01_OPOD-290']);
  assert.equal(result.samples.length, 2);
});

test('scanning analytics keeps two-parameter combinations as distinct tests', () => {
  const build = loadAnalytics();
  const result = build([
    { time: '2026-07-27T11:00:00Z', event_type: 'scan_result', experimentId: 'combo', optimizationValues: '{"scanMin":8,"scanMin2":3}', fleet: 'A', success: true, sduFound: 1 },
    { time: '2026-07-27T11:10:00Z', event_type: 'scan_result', experimentId: 'combo', optimizationValues: '{"scanMin":12,"scanMin2":3}', fleet: 'A', success: true, sduFound: 0 }
  ]);
  assert.equal(result.groups.length, 2);
  assert.ok(result.groups.every((group) => group.parameter === 'Combined'));
  assert.match(String(result.groups[0].value), /minProb=/);
  assert.match(String(result.groups[0].value), /instantStrikeoutProb=/);
});

test('scanning analytics ranks one selected parameter and charts all its values', () => {
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(renderer, /selectedScanningOptimizationParameter/);
  assert.match(renderer, /optimizationAnalyticsParameter\?\.replaceChildren/);
  assert.match(renderer, /parameterGroups = analytics\.groups\.filter/);
  assert.match(renderer, /renderScanningOptimizationValueChart\(analytics, metric, selectedScanningOptimizationParameter\)/);
  assert.match(renderer, /optimization-route-arrow/);
  assert.match(html, /id="optimization-analytics-parameter"/);
  assert.match(html, /id="optimization-experiment-filter"/);
  assert.match(html, />Scan success</);
  assert.match(css, /optimization-analytics-ranking-wrap/);
  assert.match(css, /optimization-route-line/);
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

test('analytics requests may load complete scan history without enlarging Data pages', () => {
  const main = fs.readFileSync(mainPath, 'utf8');
  assert.match(main, /payload\.analytics === true \? 5000 : 500/);
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  assert.match(renderer, /eventType: 'scan_result'/);
  assert.match(renderer, /limit: 5000, analytics: true/);
  assert.match(main, /\['experimentId', payload\.experimentId\]/);
  assert.match(renderer, /experimentId,\n    offset/);
});
