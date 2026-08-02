const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');

test('resource chart bars use the same full-height scale as their y-axis', () => {
  const resourceBarScales = renderer.match(/Math\.round\(\(value \/ maxValue\) \* \d+\)/g) || [];

  assert.equal(resourceBarScales.length, 4);
  for (const scale of resourceBarScales) {
    assert.match(scale, /\* 100\)/);
  }
});
