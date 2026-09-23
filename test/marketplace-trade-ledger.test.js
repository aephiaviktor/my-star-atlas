'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectCanonicalMarketplaceExecutions, projectDecodedMarketplaceTrades, projectLocalMarketInventoryTrades,
} = require('../electron/marketplace-trade-ledger');

const base = {
  eventId: 'trade', timestamp: '2026-08-31T10:00:00Z', action: 'execution', eventType: 'gm',
  market: 'GM', asset: 'Fuel', quantityRaw: '10', unitPriceAtlas: 2, grossAtlas: 20,
  transactionFeeAtlas: 0.5, signature: 'sig', orderId: 'order',
};

test('decoded buy execution becomes one complete global trade row', () => {
  const [row] = projectDecodedMarketplaceTrades([{ ...base, side: 'buy', marketplaceFeeAtlas: 9 }]);
  assert.deepEqual(row, {
    tradeId: 'trade', timestamp: '2026-08-31T10:00:00Z', side: 'buy', marketplace: 'GM', faction: 'GLOBAL',
    starbase: '-', asset: 'Fuel', quantity: 10, unitPriceAtlas: 2, grossAtlas: 20, marketplaceFeeAtlas: 0,
    transactionFeeAtlas: 0.5, netAtlas: 20.5, netUnitValueAtlas: 2.05,
    orderId: 'order', signature: 'sig', status: 'Complete',
  });
});

test('decoded LM execution retains its faction while GM is always global', () => {
  const rows = projectDecodedMarketplaceTrades([
    { ...base, eventId: 'lm', eventType: 'lm', market: 'LM', faction: 'ONI', starbase: 'ONI-1', side: 'buy', marketplaceFeeAtlas: 0 },
    { ...base, eventId: 'gm', eventType: 'gm', market: 'GM', faction: 'MUD', side: 'buy', marketplaceFeeAtlas: 0 },
  ]);
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.marketplace, row.faction])), { GM: 'GLOBAL', LM: 'ONI' });
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.marketplace, row.starbase])), { GM: '-', LM: 'ONI-1' });
});

test('duplicate LM representations collapse to the starbase and order enriched execution', () => {
  const duplicate = {
    ...base, eventType: 'lm', market: 'LM', faction: 'USTUR', side: 'sell', asset: 'Iron Ore',
    timestamp: '2026-09-15T05:01:42Z', signature: 'same-signature', quantityRaw: '10000000',
    unitPriceAtlas: 0.00075, grossAtlas: 7500, marketplaceFeeAtlas: 450, txFeeAtlas: 0,
  };
  const selected = selectCanonicalMarketplaceExecutions([
    { ...duplicate, eventId: 'fallback', starbase: '', orderId: '' },
    { ...duplicate, eventId: 'enriched', starbase: 'MRZ-23', orderId: 'order-23' },
  ]);
  assert.deepEqual(selected.map((event) => event.eventId), ['enriched']);
  const [row] = projectDecodedMarketplaceTrades(selected);
  assert.equal(row.starbase, 'MRZ-23');
});

test('conflicting nonempty LM starbases are preserved for review instead of silently merged', () => {
  const duplicate = {
    ...base, eventType: 'lm', market: 'LM', faction: 'USTUR', side: 'sell', asset: 'Iron Ore',
    signature: 'conflict-signature', quantityRaw: '10000000', grossAtlas: 7500,
  };
  assert.equal(selectCanonicalMarketplaceExecutions([
    { ...duplicate, eventId: 'mrz-22', starbase: 'MRZ-22' },
    { ...duplicate, eventId: 'mrz-23', starbase: 'MRZ-23' },
  ]).length, 2);
});

test('canonical LM events become direct selected-faction starbase inventory trades', () => {
  const trades = projectLocalMarketInventoryTrades([
    { ...base, eventId: 'buy', eventType: 'lm', market: 'LM', faction: 'MUD', starbase: 'MRZ-6', side: 'buy',
      asset: 'Hydrogen', quantityRaw: '20000000', grossAtlas: 6820, txFeeAtlas: 7.92 },
    { ...base, eventId: 'sell', eventType: 'lm', market: 'LM', faction: 'MUD', starbase: 'MRZ-9', side: 'sell',
      asset: 'Food', quantityRaw: '1000000', grossAtlas: 1100, marketplaceFeeAtlas: 66, txFeeAtlas: 0.82 },
    { ...base, eventId: 'other-faction', eventType: 'lm', market: 'LM', faction: 'ONI', starbase: 'ONI-1', side: 'buy' },
  ], { faction: 'MUD' });
  assert.deepEqual(trades, [
    { id: 'buy', timestamp: '2026-08-31T10:00:00Z', marketplace: 'LM', faction: 'MUD', starbase: 'MRZ-6',
      asset: 'Hydrogen', side: 'buy', quantity: 20000000, settledAtlas: 6827.92 },
    { id: 'sell', timestamp: '2026-08-31T10:00:00Z', marketplace: 'LM', faction: 'MUD', starbase: 'MRZ-9',
      asset: 'Food', side: 'sell', quantity: 1000000, settledAtlas: 1033.18 },
  ]);
});

test('decoded sell execution subtracts seller-paid marketplace and transaction fees', () => {
  const [row] = projectDecodedMarketplaceTrades([{ ...base, side: 'sell', marketplaceFeeAtlas: 1, txFeeAtlas: 0.8 }]);
  assert.equal(row.transactionFeeAtlas, 0.8, 'trade must include execution plus allocated order-creation fees');
  assert.equal(row.netAtlas, 18.2);
  assert.ok(Math.abs(row.netUnitValueAtlas - 1.82) < 1e-12);
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
