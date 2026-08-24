'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { exactText, marketplaceEvents, buildProductionCompleteAccounting } = require('../electron/complete-accounting-production-adapter');

const decimal = (value) => value?.decimal;

test('production adapter preserves exact decimals and authoritative marketplace identities', () => {
  assert.equal(exactText({ atoms: '1234500', decimals: 4, unit: 'asset:x' }), '123.45');
  assert.equal(exactText(1e-7), '0.0000001');
  const events = marketplaceEvents([{ id: 'trade-1', timestamp: '2026-01-02T00:00:00Z', marketplace: 'GM', side: 'sell', asset: 'Ore', starbase: 'S1', quantity: '2.5', grossAtlas: '10.00', netAtlas: '9.75', wallet: 'w' }]);
  assert.deepEqual(events, [{
    eventId: 'market:gm:trade-1', timestamp: '2026-01-02T00:00:00.000Z', type: 'sale', source: 'gm', location: 'S1', asset: 'Ore', quantity: '2.5', grossProceeds: '10.00', fees: '0.25', marketplaceFee: '0.25', transactionFee: '0', tradeId: 'trade-1', originWallet: 'w', lineageStatus: 'allocated',
  }]);
  const unallocated = marketplaceEvents([{ id: 'trade-2', timestamp: '2026-01-02T00:00:00Z', marketplace: 'GM', side: 'buy', asset: 'Ore', wallet: 'w', quantity: '4', settledAtlas: '3' }], { faction: 'USTUR', profile: 'p' });
  assert.equal(unallocated[0].type, 'unallocated');
  assert.equal(unallocated[0].lineageStatus, 'wallet-unallocated');
});

test('production shape produces visible equation, COGS, coverage, quarantine and reconciliation', () => {
  const result = buildProductionCompleteAccounting({
    scope: { faction: 'USTUR', profile: 'profile-1' },
    period: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z', days: 30 },
    ledgerEvents: [
      { type: 'acquire', timestamp: '2026-01-01T00:00:00Z', location: 'S1', asset: 'Ore', quantity: '10', totalCost: null },
      { type: 'acquire', timestamp: '2026-01-02T00:00:00Z', location: 'S1', asset: 'Ore', quantity: '10', source: 'mining', totalCost: '5' },
    ],
    marketplaceTrades: [
      { id: 'buy-1', timestamp: '2026-01-03T00:00:00Z', marketplace: 'LM', side: 'buy', asset: 'Ore', starbase: 'S1', quantity: '5', totalCostAtlas: '4' },
      { id: 'sell-1', timestamp: '2026-01-04T00:00:00Z', marketplace: 'LM', side: 'sell', asset: 'Ore', starbase: 'S1', quantity: '10', grossAtlas: '12', netAtlas: '11.5' },
      { id: 'ambiguous-1', timestamp: '2026-01-05T00:00:00Z', marketplace: 'GM', side: 'buy', asset: 'Ore', wallet: 'w', quantity: '2', totalCostAtlas: '1', lineageStatus: 'ambiguous' },
    ],
    actualClosing: [{ asset: 'Ore', curAmount: '15' }],
  });
  const row = result.rows[0];
  assert.equal(decimal(row.openingQuantity), '10');
  assert.equal(decimal(row.acquisitions.mining), '10');
  assert.equal(decimal(row.acquisitions.lm), '5');
  assert.equal(decimal(row.salesQuantity), '10');
  assert.equal(decimal(row.salesNetProceeds), '11.5');
  assert.equal(row.salesCoverage.status, 'uncosted');
  assert.equal(row.cogs, null);
  assert.equal(row.realizedProfit, null);
  assert.equal(decimal(row.remainingQuantity), '15');
  assert.equal(decimal(row.actualClosing), '15');
  assert.equal(row.reconciliationStatus, 'reconciled');
  assert.equal(decimal(row.quarantinedQuantity), '2');
  assert.equal(result.eventCounts.quarantined, 1);
  assert.equal(result.inputEventCount, 5);
});
