'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInventoryDepositBaselineQuery,
  projectInventoryDepositBaselineRows,
} = require('../electron/inventory-deposit-baseline');

test('pre-deposit inventory query is bounded and requests the latest state before each exact game deposit', () => {
  const query = buildInventoryDepositBaselineQuery({
    bucket: 'aephia',
    depositEvents: [{
      type: 'acquire-lot', timestamp: '2026-09-03T07:00:00.000Z', location: 'MUD-1', asset: 'Ammunition',
      quantity: 5000000, flowId: 'morning-deposit', basisSource: 'marketplace-game-deposit',
    }],
  });
  assert.equal(query.scopes.length, 1);
  assert.match(query.flux, /range\(start: 0, stop: time\(v: "2026-09-03T07:00:00\.000Z"\)\)/);
  assert.match(query.flux, /r\.rss == "Ammunition" or r\.rss == "Ammo"/);
  assert.match(query.flux, /group\(\)/);
  assert.match(query.flux, /last\(\)/);
  assert.match(query.flux, /baselineIndex/);
});

test('pre-deposit inventory rows become canonical reconciliation events before their deposits', () => {
  const scopes = [{
    index: 0, timestamp: '2026-09-03T07:00:00.000Z', location: 'MUD-1', asset: 'Ammunition',
    flowId: 'morning-deposit',
  }];
  assert.deepEqual(projectInventoryDepositBaselineRows({
    scopes,
    rows: [{ baselineIndex: '0', _time: '2026-09-03T06:59:30.000Z', _value: '1', rss: 'Ammo', starbase: 'MUD-1' }],
  }), [{
    timestamp: '2026-09-03T06:59:30.000Z', starbase: 'MUD-1', asset: 'Ammunition', quantity: 1,
    depositFlowId: 'morning-deposit',
  }]);
});

test('deposit baseline query rejects an unbounded number of scopes', () => {
  const depositEvents = Array.from({ length: 129 }, (_, index) => ({
    type: 'acquire-lot', timestamp: `2026-09-03T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
    location: `MUD-${index}`, asset: 'Fuel', flowId: `deposit-${index}`, basisSource: 'marketplace-game-deposit',
  }));
  assert.throws(() => buildInventoryDepositBaselineQuery({ bucket: 'aephia', depositEvents }), /at most 128/);
});
