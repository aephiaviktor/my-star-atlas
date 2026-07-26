const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'electron', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'electron', 'renderer.js'), 'utf8');

test('Optimization date filters select dates without times', () => {
  for (const id of [
    'optimization-start-filter',
    'optimization-stop-filter',
    'optimization-upgrading-start-filter',
    'optimization-upgrading-stop-filter',
  ]) {
    assert.match(html, new RegExp(`id="${id}" type="date"`));
  }
  assert.doesNotMatch(html, /id="optimization-(?:upgrading-)?(?:start|stop)-filter" type="datetime-local"/);
});

test('Optimization From starts at midnight and To includes the whole selected day', () => {
  assert.match(renderer, /function optimizationFilterIso\(input, includeWholeDay = false\)/);
  assert.match(renderer, /new Date\(`\$\{input\.value\}T00:00:00`\)/);
  assert.match(renderer, /if \(includeWholeDay\) date\.setDate\(date\.getDate\(\) \+ 1\)/);
  assert.match(renderer, /optimizationFilterIso\(optimizationStopFilter, true\)/);
  assert.match(renderer, /optimizationFilterIso\(optimizationUpgradingStopFilter, true\)/);
});

test('Optimization time columns are rendered in UTC rather than local time', () => {
  assert.match(renderer, /function formatOptimizationUtcDateTime\(value\)/);
  assert.match(renderer, /timeZone: 'UTC'/);
  assert.match(renderer, /timeZoneName: 'short'/);
  assert.match(renderer, /optimizationCellValue\(column, row\[column\]\)/);
  assert.match(renderer, /if \(column === 'time'\) return formatOptimizationUtcDateTime\(value\)/);
  assert.match(renderer, /if \(column\.key === 'time'\) return formatOptimizationUtcDateTime\(value\)/);
});
