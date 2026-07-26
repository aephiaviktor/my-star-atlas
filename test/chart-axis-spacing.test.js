const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');

test('30-day PCR and Inventory charts label every fifth day plus endpoints', () => {
  assert.match(renderer, /x-axis day labels \(every fifth day, plus first and last\)/i);
  assert.match(renderer, /X axis day labels \(every fifth day, plus first and last\)/);
  assert.equal((renderer.match(/i % 5 !== 0/g) || []).length, 2);
  assert.doesNotMatch(renderer, /X axis day labels \(every other day/i);
  assert.doesNotMatch(renderer, /x-axis day labels \(every other day/i);
});
