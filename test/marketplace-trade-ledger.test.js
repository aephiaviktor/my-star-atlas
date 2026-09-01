'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectDecodedMarketplaceTrades } = require('../electron/marketplace-trade-ledger');

const base = {
  eventId: 'trade', timestamp: '2026-08-31T10:00:00Z', action: 'execution', eventType: 'gm',
  market: 'GM', asset: 'Fuel', quantityRaw: '10', unitPriceAtlas: 2, grossAtlas: 20,
  transactionFeeAtlas: 0.5, signature: 'sig', orderId: 'order',
};

test('decoded buy execution becomes one complete global trade row', () => {
  const [row] = projectDecodedMarketplaceTrades([{ ...base, side: 'buy', marketplaceFeeAtlas: 9 }]);
  assert.deepEqual(row, {
    tradeId: 'trade', timestamp: '2026-08-31T10:00:00Z', side: 'buy', marketplace: 'GM', faction: 'GLOBAL',
    asset: 'Fuel', quantity: 10, unitPriceAtlas: 2, grossAtlas: 20, marketplaceFeeAtlas: 0,
    transactionFeeAtlas: 0.5, netAtlas: 20.5, netUnitValueAtlas: 2.05,
    orderId: 'order', signature: 'sig', status: 'Complete',
  });
});

test('decoded LM execution retains its faction while GM is always global', () => {
  const rows = projectDecodedMarketplaceTrades([
    { ...base, eventId: 'lm', eventType: 'lm', market: 'LM', faction: 'ONI', side: 'buy', marketplaceFeeAtlas: 0 },
    { ...base, eventId: 'gm', eventType: 'gm', market: 'GM', faction: 'MUD', side: 'buy', marketplaceFeeAtlas: 0 },
  ]);
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.marketplace, row.faction])), { GM: 'GLOBAL', LM: 'ONI' });
});

test('decoded sell execution subtracts seller-paid marketplace and transaction fees', () => {
  const [row] = projectDecodedMarketplaceTrades([{ ...base, side: 'sell', marketplaceFeeAtlas: 1 }]);
  assert.equal(row.netAtlas, 18.5);
  assert.equal(row.netUnitValueAtlas, 1.85);
  assert.equal(row.status, 'Complete');
});

test('orders and custody events are excluded while incomplete execution evidence remains Partial', () => {
  const rows = projectDecodedMarketplaceTrades([
    { ...base, action: 'order_created' },
    { ...base, eventType: 'deposit' },
    { ...base, eventId: 'partial', side: 'sell', transactionFeeAtlas: null, marketplaceFeeAtlas: null },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tradeId, 'partial');
  assert.equal(rows[0].netAtlas, null);
  assert.equal(rows[0].status, 'Partial');
});

