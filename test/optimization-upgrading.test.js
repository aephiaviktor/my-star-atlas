'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const main = fs.readFileSync('electron/main.js', 'utf8');
const preload = fs.readFileSync('electron/preload.js', 'utf8');
const renderer = fs.readFileSync('electron/renderer.js', 'utf8');
const html = fs.readFileSync('electron/renderer.html', 'utf8');

const components = ['Framework', 'Electronics', 'Power Source', 'Electromagnet', 'Field Stabilizer', 'Particle Accelerator', 'Radiation Absorber', 'Survey Data Unit'];

test('upgrading optimization backend joins aggregate and component snapshots', () => {
  assert.match(main, /async function fetchUpgradingOptimization\(/);
  assert.match(main, /base\('optimization_upgrading'\)/);
  assert.match(main, /optimization_upgrading_component/);
  assert.match(main, /mergeUpgradingOptimizationRows\(/);
  assert.match(main, /handleTrustedIpc\('optimization:upgrading'/);
  assert.match(preload, /getUpgradingOptimization:.*optimization:upgrading/);
});

test('Optimization exposes Upgrading after Scanning with date filters and a table', () => {
  assert.match(html, /data-optimization-subtab="scanning"[^>]*>Scanning</);
  assert.match(html, /data-optimization-subtab="upgrading"[^>]*>Upgrading</);
  assert.ok(html.indexOf('data-optimization-subtab="scanning"') < html.indexOf('data-optimization-subtab="upgrading"'));
  for (const id of ['optimization-upgrading-start-filter', 'optimization-upgrading-stop-filter', 'optimization-upgrading-sync-status', 'optimization-upgrading-table-head', 'optimization-upgrading-table-body']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="optimization-upgrading-instance-filter"/);
  assert.doesNotMatch(renderer, /optimizationUpgradingInstanceFilter/);
});

test('Upgrading renderer defines the agreed columns and component pairs', () => {
  for (const label of ['Player LP Installed Today', 'Faction LP Installed Today', 'Phantom Crew', 'Neutral LP Target', 'Requested LP Target', 'Optimizer LP Target', 'Aggr. (rel.)', 'Aggr. (abs.)', 'Expected Additional LP by EOD', 'Expected Total LP by EOD', 'Uninstalled automated LP', 'Uninstalled not automated LP', 'Uninstalled not automated LP (>24h)', 'Oldest Uninstalled Age']) assert.match(renderer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const component of components) assert.match(renderer, new RegExp(`'${component}'`));
  assert.match(renderer, /label: `\$\{label\} Installed`/);
  assert.match(renderer, /function refreshUpgradingOptimization\(/);
  assert.match(renderer, /api\.getUpgradingOptimization/);
});
