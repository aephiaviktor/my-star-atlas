'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMarketplaceInventoryMovements, replayMarketplaceInventoryLedger, projectGlobalLedgerRows, projectGameLedgerRows,
} = require('../electron/marketplace-inventory-ledger');
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

test('wallet pools carry weighted basis components and game-withdrawal provenance through transfers', () => {
  const result = replayMarketplaceInventoryLedger([
    { movementId: 'buy', timestamp: '2026-08-30T10:00:00Z', kind: 'buy', asset: 'Carbon', quantity: 100,
      toWallet: 'gm', principalAtlas: 1000, marketplaceFeeAtlas: 50, transactionFeeAtlas: 1 },
    { movementId: 'deposit-transfer', timestamp: '2026-08-30T10:05:00Z', kind: 'transfer', asset: 'Carbon', quantity: 100,
      fromWallet: 'gm', toWallet: 'player', transactionFeeAtlas: 0.5, transactionFeePayer: 'gm' },
    { movementId: 'game-deposit', timestamp: '2026-08-30T10:10:00Z', kind: 'deposit', asset: 'Carbon', quantity: 100,
      fromWallet: 'player', destination: 'USTUR:UST-1', transactionFeeAtlas: 0.2, transactionFeePayer: 'player' },
    { movementId: 'game-withdraw', timestamp: '2026-08-30T12:00:00Z', kind: 'withdraw', asset: 'Carbon', quantity: 40,
      toWallet: 'player', unitBasisAtlas: 6, transactionFeeAtlas: 0.2, transactionFeePayer: 'player',
      faction: 'USTUR', starbase: 'UST-1', signature: 'withdraw-signature' },
    { movementId: 'sell-transfer', timestamp: '2026-08-30T12:05:00Z', kind: 'transfer', asset: 'Carbon', quantity: 40,
      fromWallet: 'player', toWallet: 'gm', transactionFeeAtlas: 0.1, transactionFeePayer: 'player' },
    { movementId: 'sell', timestamp: '2026-08-30T13:00:00Z', kind: 'sell', asset: 'Carbon', quantity: 15,
      fromWallet: 'gm', grossAtlas: 150, marketplaceFeeAtlas: 5, transactionFeeAtlas: 1 },
  ]);
  const deposit = result.rows.find((row) => row.movementId === 'game-deposit');
  const sell = result.rows.find((row) => row.movementId === 'sell');
  assert.equal(deposit.principalAtlas, 1000);
  assert.equal(deposit.marketplaceFeeAtlas, 0, 'buyer must not inherit the seller-paid marketplace fee');
  assert.equal(deposit.transactionFeeAtlas, 1.7);
  assert.equal(deposit.basisMovedAtlas, 1001.7);
  assert.ok(Math.abs(sell.basisMovedAtlas - 90.1125) < 1e-9);
  assert.deepEqual(sell.gameOrigins.map((origin) => ({
    movementId: origin.movementId, faction: origin.faction, starbase: origin.starbase, quantity: origin.quantity,
  })), [{ movementId: 'game-withdraw', faction: 'USTUR', starbase: 'UST-1', quantity: 15 }]);
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

test('decoded events project to one global movement stream without duplicate trade transfers', () => {
  const events = [
    { eventId: 'buy', eventType: 'gm', action: 'execution', side: 'buy', timestamp: '2026-08-30T10:00:00Z',
      signature: 'buy-signature', fromWallet: 'gm', asset: 'Carbon', quantityRaw: '100', grossAtlas: 1000,
      marketplaceFeeAtlas: 50, txFeeAtlas: 1 },
    { eventId: 'duplicate-transfer', eventType: 'transfer', action: 'transfer', timestamp: '2026-08-30T10:00:00Z',
      signature: 'buy-signature', fromWallet: 'seller', toWallet: 'gm', asset: 'Carbon', quantityRaw: '100' },
    { eventId: 'wallet-transfer', eventType: 'transfer', action: 'transfer', timestamp: '2026-08-30T10:05:00Z',
      signature: 'transfer-signature', fromWallet: 'gm', toWallet: 'player', asset: 'Carbon', quantityRaw: '100',
      transactionFeeAtlas: 0.5, transactionFeePayer: 'gm' },
    { eventId: 'game-deposit', eventType: 'deposit', action: 'deposit_cargo_to_game', timestamp: '2026-08-30T10:10:00Z',
      signature: 'deposit-signature', fromWallet: 'player', toWallet: 'css', faction: 'USTUR', starbase: 'UST-1',
      asset: 'Carbon', quantityRaw: '100', transactionFeeAtlas: 0.2, transactionFeePayer: 'player' },
  ];
  const movements = buildMarketplaceInventoryMovements(events);
  assert.deepEqual(movements.map((movement) => movement.kind), ['buy', 'transfer', 'deposit']);
  assert.equal(movements[0].marketplaceFeeAtlas, 0);
  assert.equal(movements[0].transactionFeeAtlas, 1);
});

test('Game Ledger is asymmetric: deposits use game time while withdrawals use sell time and amount', () => {
  const ledger = replayMarketplaceInventoryLedger([
    { movementId: 'buy', timestamp: '2026-08-30T10:00:00Z', kind: 'buy', asset: 'Carbon', quantity: 100,
      toWallet: 'gm', principalAtlas: 1000, transactionFeeAtlas: 1 },
    { movementId: 'to-player', timestamp: '2026-08-30T10:05:00Z', kind: 'transfer', asset: 'Carbon', quantity: 100,
      fromWallet: 'gm', toWallet: 'player', transactionFeeAtlas: 0.5, transactionFeePayer: 'gm' },
    { movementId: 'game-deposit', timestamp: '2026-08-30T10:10:00Z', kind: 'deposit', asset: 'Carbon', quantity: 100,
      fromWallet: 'player', destination: 'USTUR:UST-1', faction: 'USTUR', starbase: 'UST-1',
      signature: 'deposit-signature', transactionFeeAtlas: 0.2, transactionFeePayer: 'player' },
    { movementId: 'physical-withdraw', timestamp: '2026-08-30T12:00:00Z', kind: 'withdraw', asset: 'Carbon', quantity: 40,
      toWallet: 'player', unitBasisAtlas: 6, transactionFeeAtlas: 0.2, transactionFeePayer: 'player',
      faction: 'USTUR', starbase: 'UST-1', signature: 'withdraw-signature' },
    { movementId: 'to-gm', timestamp: '2026-08-30T12:05:00Z', kind: 'transfer', asset: 'Carbon', quantity: 40,
      fromWallet: 'player', toWallet: 'gm', transactionFeeAtlas: 0.1, transactionFeePayer: 'player' },
    { movementId: 'sell-1', timestamp: '2026-08-30T13:00:00Z', kind: 'sell', asset: 'Carbon', quantity: 15,
      fromWallet: 'gm', grossAtlas: 150, marketplaceFeeAtlas: 5, transactionFeeAtlas: 1, signature: 'sell-1-signature' },
    { movementId: 'sell-2', timestamp: '2026-08-30T14:00:00Z', kind: 'sell', asset: 'Carbon', quantity: 25,
      fromWallet: 'gm', grossAtlas: 250, marketplaceFeeAtlas: 8, transactionFeeAtlas: 1, signature: 'sell-2-signature' },
  ]);
  const rows = projectGameLedgerRows(ledger.rows, { faction: 'USTUR' });
  const deposit = rows.find((row) => row.direction === 'deposit');
  const withdrawals = rows.filter((row) => row.direction === 'withdraw');
  assert.equal(deposit.timestamp, '2026-08-30T10:10:00.000Z');
  assert.equal(deposit.quantity, 100);
  assert.deepEqual(withdrawals.map((row) => [row.timestamp, row.quantity]), [
    ['2026-08-30T13:00:00.000Z', 15], ['2026-08-30T14:00:00.000Z', 25],
  ]);
  assert.ok(withdrawals.every((row) => row.physicalWithdrawalTimestamp === '2026-08-30T12:00:00.000Z'));
  assert.ok(withdrawals.every((row) => row.physicalWithdrawalSignature === 'withdraw-signature'));
});

test('Global Ledger renders wallet transfers as balanced withdrawal and deposit rows', () => {
  const ledger = replayMarketplaceInventoryLedger([
    { movementId: 'buy', timestamp: '2026-08-30T10:00:00Z', kind: 'buy', asset: 'Carbon', quantity: 10,
      toWallet: 'gm', principalAtlas: 100, transactionFeeAtlas: 1 },
    { movementId: 'transfer', timestamp: '2026-08-30T10:05:00Z', kind: 'transfer', asset: 'Carbon', quantity: 10,
      fromWallet: 'gm', toWallet: 'player', transactionFeeAtlas: 0.5, transactionFeePayer: 'gm' },
  ]);
  const rows = projectGlobalLedgerRows(ledger.rows);
  const transferRows = rows.filter((row) => row.movementId === 'transfer');
  assert.deepEqual(transferRows.map((row) => [row.direction, row.wallet, row.counterparty]), [
    ['withdraw', 'gm', 'player'], ['deposit', 'player', 'gm'],
  ]);
  assert.equal(transferRows.find((row) => row.direction === 'withdraw').finalBasisAtlas, 101);
  assert.equal(transferRows.find((row) => row.direction === 'deposit').finalBasisAtlas, 101.5);
});
