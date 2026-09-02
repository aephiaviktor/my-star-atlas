'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMarketplaceInventoryMovements, replayMarketplaceInventoryLedger, projectGlobalLedgerRows, projectGameLedgerRows,
  projectInventoryCostLedgerDepositEvents,
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

test('game withdrawal falls back to historical landed basis when inventory snapshot basis is zero', () => {
  const [movement] = buildMarketplaceInventoryMovements([{
    eventId: 'withdraw', eventType: 'withdraw', action: 'withdraw_cargo_from_game',
    timestamp: '2026-08-30T12:00:00Z', signature: 'withdraw-signature', toWallet: 'player',
    faction: 'USTUR', starbase: 'UST-1', asset: 'Iron Ore', quantityRaw: '40',
  }], {
    inventoryBasisObservations: [{ faction: 'USTUR', starbase: 'UST-1', asset: 'Iron Ore',
      timestamp: '2026-08-30T11:30:00Z', weightedAveragePriceAtlas: 0 }],
    breakevenBasisStates: [createBreakevenBasisState({ faction: 'USTUR', starbase: 'UST-1', asset: 'Iron Ore',
      timestamp: '2026-08-30T11:00:00Z', inventory: 90, landedCostPerUnit: 6 })],
  });
  assert.equal(movement.unitBasisAtlas, 6);
  assert.equal(movement.basisSource, 'breakeven_basis_state');
});

test('missing withdrawal basis remains pending instead of becoming zero principal', () => {
  const [movement] = buildMarketplaceInventoryMovements([{
    eventId: 'withdraw', eventType: 'withdraw', action: 'withdraw_cargo_from_game',
    timestamp: '2026-08-30T12:00:00Z', signature: 'withdraw-signature', toWallet: 'player',
    faction: 'USTUR', starbase: 'UST-1', asset: 'Iron Ore', quantityRaw: '1000000',
  }]);
  assert.equal(movement.unitBasisAtlas, null);
  const [row] = replayMarketplaceInventoryLedger([movement]).rows;
  assert.equal(row.status, 'pending_basis');
  assert.equal(row.principalAtlas, undefined);
});

test('ledger carries GM buy basis through game and back out to realized sell profit', () => {
  const result = replayMarketplaceInventoryLedger([
    { movementId: '1-buy', timestamp: '2026-08-30T10:00:00Z', kind: 'buy', asset: 'Iron Ore', quantity: 100,
      toWallet: 'gm', principalAtlas: 1000, transactionFeeAtlas: 1 },
    { movementId: '2-transfer-in', timestamp: '2026-08-30T10:05:00Z', kind: 'transfer', asset: 'Iron Ore', quantity: 100,
      fromWallet: 'gm', toWallet: 'player', transactionFeeAtlas: 0.5, transactionFeePayer: 'gm' },
    { movementId: '3-deposit', timestamp: '2026-08-30T10:10:00Z', kind: 'deposit', asset: 'Iron Ore', quantity: 100,
      fromWallet: 'player', destination: 'USTUR:CSS' },
    { movementId: '4-withdraw', timestamp: '2026-08-30T12:00:00Z', kind: 'withdraw', asset: 'Iron Ore', quantity: 40,
      toWallet: 'player', unitBasisAtlas: 6, basisSource: 'breakeven_basis_state', transactionFeeAtlas: 0.2,
      faction: 'USTUR', starbase: 'CSS' },
    { movementId: '5-transfer-out', timestamp: '2026-08-30T12:05:00Z', kind: 'transfer', asset: 'Iron Ore', quantity: 40,
      fromWallet: 'player', toWallet: 'gm', transactionFeeAtlas: 0.1, transactionFeePayer: 'player' },
    { movementId: '6-sell', timestamp: '2026-08-30T12:10:00Z', kind: 'sell', asset: 'Iron Ore', quantity: 40,
      fromWallet: 'gm', grossAtlas: 400, marketplaceFeeAtlas: 10, transactionFeeAtlas: 1 },
  ]);
  const deposit = result.rows.find((row) => row.kind === 'deposit');
  const withdrawal = result.rows.find((row) => row.kind === 'withdraw');
  const sale = result.rows.find((row) => row.kind === 'sell');
  assert.equal(deposit.basisMovedAtlas, 1001.5);
  assert.ok(Math.abs(withdrawal.basisMovedAtlas - 400.8) < 1e-9);
  assert.ok(Math.abs(sale.basisMovedAtlas - 400.9) < 1e-9);
  assert.equal(sale.netProceedsAtlas, 389);
  assert.ok(Math.abs(sale.realizedProfitAtlas - (-11.9)) < 1e-9);
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
  assert.ok(Math.abs(sell.basisMovedAtlas - 150.3675) < 1e-9);
  assert.deepEqual(sell.gameOrigins.map((origin) => ({
    movementId: origin.movementId, faction: origin.faction, starbase: origin.starbase, quantity: origin.quantity,
  })), [{ movementId: 'game-withdraw', faction: 'USTUR', starbase: 'UST-1', quantity: 15 }]);
});

test('game deposits fund later withdrawals and sells with the carried principal', () => {
  const ledger = replayMarketplaceInventoryLedger([
    { movementId: 'buy', timestamp: '2026-08-30T10:00:00Z', kind: 'buy', asset: 'Iron Ore', quantity: 100,
      toWallet: 'gm', principalAtlas: 1000, transactionFeeAtlas: 1 },
    { movementId: 'to-player', timestamp: '2026-08-30T10:05:00Z', kind: 'transfer', asset: 'Iron Ore', quantity: 100,
      fromWallet: 'gm', toWallet: 'player', transactionFeeAtlas: 0.5, transactionFeePayer: 'gm' },
    { movementId: 'game-deposit', timestamp: '2026-08-30T10:10:00Z', kind: 'deposit', asset: 'Iron Ore', quantity: 100,
      fromWallet: 'player', destination: 'USTUR:UST-1', faction: 'USTUR', starbase: 'UST-1',
      transactionFeeAtlas: 0.2, transactionFeePayer: 'player' },
    { movementId: 'game-withdraw', timestamp: '2026-08-30T12:00:00Z', kind: 'withdraw', asset: 'Iron Ore', quantity: 40,
      toWallet: 'player', unitBasisAtlas: 0, faction: 'USTUR', starbase: 'UST-1', transactionFeeAtlas: 0.2,
      transactionFeePayer: 'player', signature: 'withdraw-signature' },
    { movementId: 'to-gm', timestamp: '2026-08-30T12:05:00Z', kind: 'transfer', asset: 'Iron Ore', quantity: 40,
      fromWallet: 'player', toWallet: 'gm', transactionFeeAtlas: 0.1, transactionFeePayer: 'player' },
    { movementId: 'sell', timestamp: '2026-08-30T13:00:00Z', kind: 'sell', asset: 'Iron Ore', quantity: 40,
      fromWallet: 'gm', grossAtlas: 500, marketplaceFeeAtlas: 10, transactionFeeAtlas: 1 },
  ]);
  const withdrawal = ledger.rows.find((row) => row.movementId === 'game-withdraw');
  const sell = ledger.rows.find((row) => row.movementId === 'sell');
  assert.equal(withdrawal.basisSource, 'game_pool');
  assert.equal(withdrawal.principalAtlas, 400);
  assert.equal(sell.principalAtlas, 400);
  assert.ok(Math.abs(sell.basisMovedAtlas - 400.98) < 1e-9);
  const [gameWithdrawal] = projectGameLedgerRows(ledger.rows, { faction: 'USTUR' })
    .filter((row) => row.direction === 'withdraw');
  assert.ok(Math.abs(gameWithdrawal.principalAtlas - 400.98) < 1e-9);
  assert.ok(Math.abs(gameWithdrawal.finalBasisAtlas - 400.98) < 1e-9);
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
    { eventId: 'external-transfer', eventType: 'transfer', action: 'transfer', timestamp: '2026-08-30T10:06:00Z',
      signature: 'external-signature', fromWallet: 'gm', toWallet: 'external', asset: 'Carbon', quantityRaw: '5' },
    { eventId: 'game-deposit', eventType: 'deposit', action: 'deposit_cargo_to_game', timestamp: '2026-08-30T10:10:00Z',
      signature: 'deposit-signature', fromWallet: 'player', toWallet: 'css', faction: 'USTUR', starbase: 'UST-1',
      asset: 'Carbon', quantityRaw: '100', transactionFeeAtlas: 0.2, transactionFeePayer: 'player' },
  ];
  const movements = buildMarketplaceInventoryMovements(events);
  assert.deepEqual(movements.map((movement) => movement.kind), ['buy', 'transfer', 'deposit']);
  assert.equal(movements[0].marketplaceFeeAtlas, 0);
  assert.equal(movements[0].transactionFeeAtlas, 1);
  assert.ok(!movements.some((movement) => movement.toWallet === 'external'));
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

test('Game Ledger aggregates one sale signature and rebases its complete weighted sell lot', () => {
  const rows = projectGameLedgerRows([
    { movementId: 'physical-1', kind: 'withdraw', timestamp: '2026-08-30T13:15:19Z', signature: 'withdraw-1',
      faction: 'USTUR', asset: 'Iron Ore', quantity: 1265420, toWallet: 'HHD' },
    { movementId: 'physical-2', kind: 'withdraw', timestamp: '2026-09-01T06:27:39Z', signature: 'withdraw-2',
      faction: 'USTUR', asset: 'Iron Ore', quantity: 7339436, toWallet: 'HHD' },
    { movementId: 'wallet-transfer', kind: 'transfer', status: 'applied', timestamp: '2026-09-01T06:27:59Z',
      asset: 'Iron Ore', quantity: 7339436, fromWallet: 'HHD', toWallet: 'GQAC' },
    { movementId: 'sell-event', kind: 'sell', status: 'applied', timestamp: '2026-09-01T12:10:23Z',
      signature: 'sell-signature', asset: 'Iron Ore', quantity: 7339437, fromWallet: 'GQAC', basisMovedAtlas: 4127.33,
      marketplaceFeeAtlas: 391.03, saleTransactionFeeAtlas: 7.62, grossAtlas: 8689.53, netProceedsAtlas: 8290.88,
      gameOrigins: [
        { movementId: 'physical-1', signature: 'withdraw-1', faction: 'USTUR', starbase: 'UST-1',
          quantity: 1088291, principalAtlas: 471.32, transactionFeeAtlas: 1.2 },
        { movementId: 'physical-2', signature: 'withdraw-2', faction: 'USTUR', starbase: 'UST-1',
          quantity: 6251146, principalAtlas: 3514.25, transactionFeeAtlas: 2.4 },
      ] },
  ], { faction: 'USTUR' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 7339437);
  assert.equal(rows[0].principalAtlas, 4127.33);
  assert.equal(rows[0].carriedBasisAtlas, 4127.33);
  assert.equal(rows[0].marketplaceFeeAtlas, 391.03);
  assert.equal(rows[0].transactionFeeAtlas, 7.62);
  assert.equal(rows[0].finalBasisAtlas, 4127.33, 'selling fees must not inflate inventory basis');
  assert.ok(Math.abs(rows[0].receivedPerUnitAtlas - (8290.88 / 7339437)) < 1e-12);
  assert.ok(Math.abs(rows[0].netProfitPerUnitAtlas - ((8290.88 - 4127.33) / 7339437)) < 1e-12);
  assert.deepEqual(rows[0].physicalWithdrawals, [
    { movementId: 'physical-2', signature: 'withdraw-2', timestamp: '2026-09-01T06:27:39Z', quantity: 7339436 },
  ]);
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

test('Global pending game deposits retain their faction starbase counterparty', () => {
  const ledger = replayMarketplaceInventoryLedger([{
    movementId: 'deposit', timestamp: '2026-09-01T18:35:43Z', kind: 'deposit', asset: 'Framework', quantity: 3000000,
    fromWallet: 'player', destination: 'USTUR:UST-1', faction: 'USTUR', starbase: 'UST-1', signature: 'deposit-signature',
  }]);
  const [row] = projectGlobalLedgerRows(ledger.rows);
  assert.equal(row.status, 'pending_inventory');
  assert.equal(row.counterparty, 'UST-1');
  const [gameRow] = projectGameLedgerRows(ledger.rows, { faction: 'USTUR' });
  assert.equal(gameRow.status, 'Pending Inventory');
  assert.equal(gameRow.quantity, 3000000);
  assert.equal(gameRow.principalAtlas, null);
});

test('ProcessHarvest rewards enter owned inventory at zero principal plus transaction fees', () => {
  const ledger = replayMarketplaceInventoryLedger(buildMarketplaceInventoryMovements([
    { eventId: 'reward', eventType: 'reward', action: 'process_harvest', timestamp: '2026-09-01T15:00:00Z',
      signature: 'harvest', fromWallet: 'treasury', toWallet: 'player', asset: 'Ammo', quantityRaw: '25',
      principalAtlas: 0, transactionFeeAtlas: 0.4, transactionFeePayer: 'player' },
    { eventId: 'deposit', eventType: 'deposit', action: 'deposit_cargo_to_game', timestamp: '2026-09-01T16:00:00Z',
      signature: 'deposit', fromWallet: 'player', asset: 'Ammo', quantityRaw: '25', faction: 'USTUR', starbase: 'UST-1',
      transactionFeeAtlas: 0.2, transactionFeePayer: 'player' },
  ]));
  const deposit = ledger.rows.find((row) => row.kind === 'deposit');
  assert.equal(deposit.principalAtlas, 0);
  assert.ok(Math.abs(deposit.transactionFeeAtlas - 0.6) < 1e-12);
  assert.ok(Math.abs(deposit.basisMovedAtlas - 0.6) < 1e-12);
});

test('completed GM-origin game deposits become exact Inventory Cost Ledger lots', () => {
  const events = projectInventoryCostLedgerDepositEvents([
    { movementId: 'gm-deposit', kind: 'deposit', status: 'applied', timestamp: '2026-09-01T10:00:00Z',
      faction: 'MUD', starbase: 'MUD-1', asset: 'Framework', quantity: 100, principalAtlas: 250,
      basisMovedAtlas: 253, gameOrigins: [] },
    { movementId: 'game-redeposit', kind: 'deposit', status: 'applied', timestamp: '2026-09-01T11:00:00Z',
      faction: 'MUD', starbase: 'MUD-PHANTOM', asset: 'Framework', quantity: 10, principalAtlas: 20,
      basisMovedAtlas: 21, gameOrigins: [{ movementId: 'withdraw' }] },
  ], { faction: 'MUD' });
  assert.deepEqual(events, [{
    type: 'acquire-lot', timestamp: '2026-09-01T10:00:00.000Z', location: 'MUD-1', asset: 'Framework',
    quantity: 100, uncostedQuantity: 0,
    costs: { scanning: 0, mining: 0, crafting: 0, lm: 0, gm: 250 }, cargoCost: 3,
    flowId: 'gm-deposit', basisSource: 'marketplace-game-deposit',
  }, {
    type: 'acquire-lot', timestamp: '2026-09-01T11:00:00.000Z', location: 'MUD-PHANTOM', asset: 'Framework',
    quantity: 10, uncostedQuantity: 0,
    costs: { scanning: 0, mining: 0, crafting: 0, lm: 0, gm: 20 }, cargoCost: 1,
    flowId: 'game-redeposit', basisSource: 'marketplace-game-deposit',
  }]);
  assert.equal(projectInventoryCostLedgerDepositEvents([{
    movementId: 'ammo', kind: 'deposit', status: 'applied', timestamp: '2026-09-01T12:00:00Z', faction: 'MUD',
    starbase: 'MUD-1', asset: 'Ammo', quantity: 1, principalAtlas: 1, basisMovedAtlas: 1, gameOrigins: [],
  }], { faction: 'MUD' })[0].asset, 'Ammunition');
});

test('Global sale keeps cumulative fees visible without adding selling fees to inventory basis', () => {
  const [row] = projectGlobalLedgerRows([{
    movementId: 'sell', kind: 'sell', status: 'applied', timestamp: '2026-09-01T12:10:23Z',
    signature: 'sell-signature', asset: 'Iron Ore', quantity: 7339437, fromWallet: 'GQAC',
    principalAtlas: 3985.56, transactionFeeAtlas: 3.64, basisMovedAtlas: 3989.2,
    marketplaceFeeAtlas: 391.03, saleTransactionFeeAtlas: 7.62,
  }]);
  assert.equal(row.transactionFeeAtlas, 11.26);
  assert.equal(row.marketplaceFeeAtlas, 391.03);
  assert.equal(row.finalBasisAtlas, 3989.2);
});

test('ledger ordering uses slot and instruction position before lexical event identity', () => {
  const result = replayMarketplaceInventoryLedger([
    { movementId: 'a-transfer', timestamp: '2026-08-30T10:00:00Z', slot: 2, outerIndex: 0, kind: 'transfer',
      asset: 'Carbon', quantity: 10, fromWallet: 'gm', toWallet: 'player' },
    { movementId: 'z-buy', timestamp: '2026-08-30T10:00:00Z', slot: 1, outerIndex: 1, kind: 'buy',
      asset: 'Carbon', quantity: 10, toWallet: 'gm', principalAtlas: 100 },
  ]);
  assert.deepEqual(result.rows.map((row) => [row.movementId, row.status]), [
    ['z-buy', 'applied'], ['a-transfer', 'applied'],
  ]);
});

test('one wallet-transfer transaction fee is divided across its decoded asset movements', () => {
  const movements = buildMarketplaceInventoryMovements([
    { eventId: 'buy', eventType: 'gm', action: 'execution', side: 'buy', timestamp: '2026-08-30T10:00:00Z',
      signature: 'buy', fromWallet: 'gm', asset: 'Carbon', quantityRaw: '10', grossAtlas: 100 },
    { eventId: 'carbon-transfer', eventType: 'transfer', action: 'transfer', timestamp: '2026-08-30T10:05:00Z',
      signature: 'transfer', fromWallet: 'gm', toWallet: 'player', asset: 'Carbon', quantityRaw: '10',
      transactionFeeAtlas: 1, transactionFeePayer: 'gm' },
    { eventId: 'food-transfer', eventType: 'transfer', action: 'transfer', timestamp: '2026-08-30T10:05:00Z',
      signature: 'transfer', fromWallet: 'gm', toWallet: 'player', asset: 'Food', quantityRaw: '5',
      transactionFeeAtlas: 1, transactionFeePayer: 'gm' },
    { eventId: 'deposit', eventType: 'deposit', action: 'deposit_cargo_to_game', timestamp: '2026-08-30T10:10:00Z',
      signature: 'deposit', fromWallet: 'player', faction: 'USTUR', starbase: 'UST-1', asset: 'Carbon', quantityRaw: '10' },
  ]);
  const transfers = movements.filter((movement) => movement.kind === 'transfer');
  assert.deepEqual(transfers.map((movement) => movement.transactionFeeAtlas), [0.5, 0.5]);
});
