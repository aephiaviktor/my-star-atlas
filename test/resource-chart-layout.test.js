const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.css'), 'utf8');

test('resource bar charts keep all 30 history days on one grid row', () => {
  const block = css.match(/\.resource-chart-bars\s*\{[\s\S]*?\}/)?.[0] || '';
  assert.match(block, /grid-template-columns:\s*32px repeat\(30, minmax\(4px, 1fr\)\)/);
  assert.doesNotMatch(block, /repeat\(14,/);
});
