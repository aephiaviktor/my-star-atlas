const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');

test('Optimization Scanning column selections are restored and persisted', () => {
  assert.match(renderer, /OPTIMIZATION_COLUMN_STORAGE_KEY/);
  assert.match(renderer, /restoreOptimizationColumnState\(\);/);
  assert.match(renderer, /localStorage\.setItem\(OPTIMIZATION_COLUMN_STORAGE_KEY/);
  assert.match(renderer, /persistOptimizationColumnState\(\);\s*renderOptimizationTable\(\);/);
});

test('restored hidden columns are not re-selected when columns are rediscovered', () => {
  assert.match(renderer, /optimizationKnownColumns\.has\(column\)/);
  assert.match(renderer, /optimizationKnownColumns\.add\(column\)/);
});
