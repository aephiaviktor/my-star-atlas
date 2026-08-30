'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { replayMarketplaceInventoryLedger } = require('../electron/marketplace-inventory-ledger');
const {
  createBreakevenBasisState, resolveBreakevenBasisAtOrBefore, buildHistoricalBreakevenBasisStateFlux,
} = require('../electron/breakeven-basis-state');

test('historical Breakeven lookup selects the exact latest basis before a CSS withdrawal', () => {
  const states = [
    createBreakevenBasisState({ faction: 'USTUR', starbase: 'CSS', asset: 'Iron Ore', timestamp: '2026-08-30T10:00:00Z', inventory: 100, landedCostPerUnit: 5 }),
    createBreakevenBasisState({ faction: 'USTUR', starbase: 'CSS', asset: 'Iron Ore', timestamp: '2026-08-30T11:00:00Z', inventory: 90, landedCostPerUnit: 6 }),
    createBreakevenBasisState({ faction: 'USTUR', starbase: 'CSS', asset: 'Iron Ore', timestamp: '2026-08-30T13:00:00Z', inventory: 50, landedCostPerUnit: 99 }),
  ];
  const selected = resolveBreakevenBasisAtOrBefore(states, {
    faction: 'UST', starbase: 'CSS', asset: 'Iron Ore', timestamp: '2026-08-30T12:00:00Z',
  });
  assert.equal(selected.landedCostPerUnit, 6);
  assert.match(buildHistoricalBreakevenBasisStateFlux('slya', { stop: '2026-08-30T12:00:00Z' }), /stop: time\(v: "2026-08-30T12:00:00.000Z"\)/);
});

test('ledger carries GM buy basis into game and production basis back out to realized sell profit', () => {
  const result = replayMarketplaceInventoryLedger([
    { movementId: '1-buy', timestamp: '2026-08-30T10:00:00Z', kind: 'buy', asset: 'Iron Ore', quantity: 100,
      toWallet: 'gm', principalAtlas: 1000, transactionFeeAtlas: 1 },
    { movementId: '2-transfer-in', timestamp: '2026-08-30T10:05:00Z', kind: 'transfer', asset: 'Iron Ore', quantity: 100,
      fromWallet: 'gm', toWallet: 'player', transactionFeeAtlas: 0.5, transactionFeePayer: 'gm' },
    { movementId: '3-deposit', timestamp: '2026-08-30T10:10:00Z', kind: 'deposit', asset: 'Iron Ore', quantity: 100,
      fromWallet: 'player', destination: 'USTUR:CSS' },
    { movementId: '4-withdraw', timestamp: '2026-08-30T12:00:00Z', kind: 'withdraw', asset: 'Iron Ore', quantity: 40,
      toWallet: 'player', unitBasisAtlas: 6, basisSource: 'breakeven_basis_state', transactionFeeAtlas: 0.2 },
    { movementId: '5-transfer-out', timestamp: '2026-08-30T12:05:00Z', kind: 'transfer', asset: 'Iron Ore', quantity: 40,
      fromWallet: 'player', toWallet: 'gm', transactionFeeAtlas: 0.1, transactionFeePayer: 'player' },
    { movementId: '6-sell', timestamp: '2026-08-30T12:10:00Z', kind: 'sell', asset: 'Iron Ore', quantity: 40,
      fromWallet: 'gm', grossAtlas: 400, marketplaceFeeAtlas: 10, transactionFeeAtlas: 1 },
  ]);
  const deposit = result.rows.find((row) => row.kind === 'deposit');
  const withdrawal = result.rows.find((row) => row.kind === 'withdraw');
  const sale = result.rows.find((row) => row.kind === 'sell');
  assert.equal(deposit.basisMovedAtlas, 1001.5);
  assert.equal(withdrawal.basisMovedAtlas, 240.2);
  assert.ok(Math.abs(sale.basisMovedAtlas - 240.3) < 1e-9);
  assert.equal(sale.netProceedsAtlas, 389);
  assert.ok(Math.abs(sale.realizedProfitAtlas - 148.7) < 1e-9);
  assert.equal(result.pools.find((pool) => pool.wallet === 'gm').quantity, 0);
});

test('ledger is deterministic, idempotent, and holds unresolved sells pending instead of inventing cost', () => {
  const movements = [
    { movementId: 'sell', timestamp: '2026-08-30T12:00:00Z', kind: 'sell', asset: 'Carbon', quantity: 10,
      fromWallet: 'gm', grossAtlas: 100 },
    { movementId: 'sell', timestamp: '2026-08-30T12:00:00Z', kind: 'sell', asset: 'Carbon', quantity: 10,
      fromWallet: 'gm', grossAtlas: 100 },
  ];
  const first = replayMarketplaceInventoryLedger(movements);
  const second = replayMarketplaceInventoryLedger([...movements].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].status, 'pending_inventory');
  assert.equal(first.rows[0].realizedProfitAtlas, undefined);
});
