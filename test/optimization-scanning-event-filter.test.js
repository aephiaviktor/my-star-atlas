const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');

test('Optimization Scanning event filter includes optimization_progress', () => {
  const filter = html.match(/<select id="optimization-event-filter">([\s\S]*?)<\/select>/)?.[1] || '';
  assert.match(filter, /<option value="optimization_progress">optimization_progress<\/option>/);
});
