'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { revalueMarketplaceScanWithHistoricalSol } = require('../electron/marketplace-historical-fees');

test('Marketplace trade and custody fees use independent historical execution and creation prices', async () => {
  const scanned = {
    orders: [{ orderId: 'order', createdAt: '2026-08-30T10:00:00Z', creationTxFeeSol: 0.01 }],
    trades: [{ orderId: 'order', timestamp: '2026-08-30T12:00:00Z', side: 'sell', grossAtlas: 100,
      marketplaceFeeAtlas: 2, executionTxFeeSol: 0.02, allocatedCreationTxFeeSol: 0.005 }],
    assetFlows: [{ timestamp: '2026-08-30T13:00:00Z', txFeeSol: 0.001 }],
  };
  const rates = { '2026-08-30T10:00:00.000Z': 10, '2026-08-30T12:00:00.000Z': 20, '2026-08-30T13:00:00.000Z': 30 };
  await revalueMarketplaceScanWithHistoricalSol(scanned, async (_asset, timestamp) => ({
    status: 'complete', priceATL: rates[new Date(timestamp).toISOString()], observedAt: timestamp,
  }));
  assert.equal(scanned.orders[0].creationTxFeeAtlas, 0.1);
  assert.equal(scanned.trades[0].executionTxFeeAtlas, 0.4);
  assert.equal(scanned.trades[0].allocatedCreationTxFeeAtlas, 0.05);
  assert.equal(scanned.trades[0].txFeeAtlas, 0.45);
  assert.equal(scanned.trades[0].netAtlas, 97.55);
  assert.equal(scanned.assetFlows[0].txFeeAtlas, 0.03);
});

test('Marketplace historical fee valuation never substitutes a price when positive SOL lacks prior evidence', async () => {
  const scanned = { orders: [], trades: [{ timestamp: '2026-08-30T12:00:00Z', side: 'buy', grossAtlas: 100,
    marketplaceFeeAtlas: 0, executionTxFeeSol: 0.01, allocatedCreationTxFeeSol: 0 }], assetFlows: [] };
  await revalueMarketplaceScanWithHistoricalSol(scanned, async () => ({ status: 'incomplete', priceATL: null }));
  assert.equal(scanned.trades[0].executionTxFeeAtlas, null);
  assert.equal(scanned.trades[0].allocatedCreationTxFeeAtlas, 0);
  assert.equal(scanned.trades[0].txFeeAtlas, null);
  assert.equal(scanned.trades[0].netAtlas, undefined);
});
