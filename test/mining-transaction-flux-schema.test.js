'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

function miningTransactionFluxSource() {
  const start = main.indexOf('const transactionEventsFlux = `');
  const end = main.indexOf('`;\n  const rowsByKey', start);
  assert.ok(start >= 0 && end > start, 'mining transaction Flux query must remain present');
  return main.slice(start, end);
}

test('mining transaction Flux normalizes integer counts and floating fees before combining them', () => {
  const flux = miningTransactionFluxSource();
  const fields = flux.indexOf('r._field == "txCostSol" or r._field == "txCount"');
  const normalize = flux.indexOf('|> map(fn: (r) => ({ r with _value: float(v: r._value) }))');
  const combine = flux.indexOf('|> group()');

  assert.ok(fields >= 0, 'query must select transaction cost and count fields');
  assert.ok(normalize > fields, 'mixed numeric fields must be normalized after selection');
  assert.ok(combine > normalize, 'normalization must happen before fields enter one table');
});
