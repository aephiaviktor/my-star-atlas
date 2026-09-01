'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectDecodedCustodyRows, buildValuedCustodyRows } = require('../electron/marketplace-custody-ledger');

const deposit = {
  eventId: 'deposit', eventType: 'deposit', timestamp: '2026-08-31T11:00:00Z', faction: 'MUD',
  starbase: 'MUD-1', fromWallet: 'wallet', toWallet: 'css', asset: 'Fuel', quantityRaw: '10',
  transactionFeeAtlas: 0.5, signature: 'deposit-sig',
};

test('Custody Ledger projects only the selected faction deposits and withdrawals', () => {
  const rows = projectDecodedCustodyRows([
    deposit,
    { ...deposit, eventId: 'withdraw', eventType: 'withdraw', timestamp: '2026-08-31T12:00:00Z' },
    { ...deposit, eventId: 'oni', faction: 'ONI' },
    { ...deposit, eventId: 'transfer', eventType: 'transfer' },
    { ...deposit, eventId: 'trade', eventType: 'gm', action: 'execution' },
  ], { faction: 'MUD' });
  assert.deepEqual(rows.map((row) => row.custodyId), ['withdraw', 'deposit']);
  assert.deepEqual(rows.map((row) => row.direction), ['withdraw', 'deposit']);
  assert.ok(rows.every((row) => row.faction === 'MUD'));
});

test('factual custody rows remain explicitly Unvalued before basis correlation', () => {
  const [row] = projectDecodedCustodyRows([deposit], { faction: 'MUD' });
  assert.equal(row.quantity, 10);
  assert.equal(row.transactionFeeAtlas, 0.5);
  assert.equal(row.carriedBasisAtlas, null);
  assert.equal(row.finalBasisAtlas, null);
  assert.equal(row.costPerUnitAtlas, null);
  assert.equal(row.status, 'Unvalued');
});

test('withdrawal basis estimates uncosted inventory from the known weighted basis and crosses wallets into a faction deposit', () => {
  const events = [
    { ...deposit, eventId: 'withdraw', eventType: 'withdraw', timestamp: '2026-08-31T11:00:00Z', faction: 'MUD', starbase: 'MUD-1', fromWallet: 'css-mud', toWallet: 'wallet-a', transactionFeeAtlas: 5 },
    { ...deposit, eventId: 'transfer', eventType: 'transfer', timestamp: '2026-08-31T11:01:00Z', faction: '', fromWallet: 'wallet-a', toWallet: 'wallet-b', transactionFeeAtlas: 1 },
    { ...deposit, eventId: 'oni-deposit', eventType: 'deposit', timestamp: '2026-08-31T11:02:00Z', faction: 'ONI', starbase: 'ONI-1', fromWallet: 'wallet-b', toWallet: 'css-oni', transactionFeeAtlas: 4 },
  ];
  const observations = [{
    faction: 'MUD', starbase: 'MUD-1', asset: 'Fuel', timestamp: '2026-08-31T10:00:00Z',
    quantity: 100, knownQuantity: 80, uncostedQuantity: 20, weightedAveragePriceAtlas: 2,
  }];
  const [row] = buildValuedCustodyRows(events, { faction: 'ONI', inventoryBasisObservations: observations });
  assert.equal(row.direction, 'deposit');
  assert.equal(row.quantity, 10);
  assert.equal(row.costedQuantity, 10);
  assert.equal(row.uncostedQuantity, 0);
  assert.equal(row.carriedBasisAtlas, 26);
  assert.equal(row.finalBasisAtlas, 30);
  assert.equal(row.costPerUnitAtlas, 3);
  assert.equal(row.status, 'Complete');
});

test('successive withdrawals deplete one automatically estimated source pool', () => {
  const observations = [{
    faction: 'MUD', starbase: 'MUD-1', asset: 'Fuel', timestamp: '2026-08-31T10:00:00Z',
    quantity: 100, knownQuantity: 80, uncostedQuantity: 20, weightedAveragePriceAtlas: 2,
  }];
  const rows = buildValuedCustodyRows([
    { ...deposit, eventId: 'first', eventType: 'withdraw', timestamp: '2026-08-31T11:00:00Z', fromWallet: 'css', toWallet: 'wallet-a', quantityRaw: '15', transactionFeeAtlas: 0 },
    { ...deposit, eventId: 'second', eventType: 'withdraw', timestamp: '2026-08-31T11:01:00Z', fromWallet: 'css', toWallet: 'wallet-b', quantityRaw: '10', transactionFeeAtlas: 0 },
  ], { faction: 'MUD', inventoryBasisObservations: observations });
  const first = rows.find((row) => row.custodyId === 'first');
  const second = rows.find((row) => row.custodyId === 'second');
  assert.equal(first.costedQuantity, 15);
  assert.equal(first.uncostedQuantity, 0);
  assert.equal(first.carriedBasisAtlas, 30);
  assert.equal(second.costedQuantity, 10);
  assert.equal(second.uncostedQuantity, 0);
  assert.equal(second.carriedBasisAtlas, 20);
});

test('fully costed withdrawal reports carried and final basis as Complete', () => {
  const observations = [{
    faction: 'MUD', starbase: 'MUD-1', asset: 'Fuel', timestamp: '2026-08-31T10:00:00Z',
    quantity: 100, knownQuantity: 100, uncostedQuantity: 0, weightedAveragePriceAtlas: 2,
  }];
  const [row] = buildValuedCustodyRows([
    { ...deposit, eventId: 'withdraw', eventType: 'withdraw', fromWallet: 'css', toWallet: 'wallet', transactionFeeAtlas: 1 },
  ], { faction: 'MUD', inventoryBasisObservations: observations });
  assert.equal(row.carriedBasisAtlas, 20);
  assert.equal(row.finalBasisAtlas, 21);
  assert.equal(row.costPerUnitAtlas, 2.1);
  assert.equal(row.status, 'Complete');
});

test('custody basis automatically falls back to the nearest known basis for the same asset', () => {
  const observations = [{
    faction: 'ONI', starbase: 'ONI-9', asset: 'Fuel', timestamp: '2026-09-01T12:00:00Z',
    quantity: 50, knownQuantity: 40, uncostedQuantity: 10, weightedAveragePriceAtlas: 3,
  }];
  const [row] = buildValuedCustodyRows([
    { ...deposit, eventId: 'withdraw', eventType: 'withdraw', fromWallet: 'css', toWallet: 'wallet', transactionFeeAtlas: 1 },
  ], { faction: 'MUD', inventoryBasisObservations: observations });
  assert.equal(row.carriedBasisAtlas, 30);
  assert.equal(row.finalBasisAtlas, 31);
  assert.equal(row.status, 'Complete');
});

test('unmatched deposit is automatically valued from the nearest known asset basis', () => {
  const observations = [{
    faction: 'ONI', starbase: 'ONI-9', asset: 'Fuel', timestamp: '2026-08-31T10:00:00Z',
    quantity: 50, knownQuantity: 50, uncostedQuantity: 0, weightedAveragePriceAtlas: 3,
  }];
  const [row] = buildValuedCustodyRows([deposit], { faction: 'MUD', inventoryBasisObservations: observations });
  assert.equal(row.carriedBasisAtlas, 30);
  assert.equal(row.finalBasisAtlas, 30.5);
  assert.equal(row.status, 'Estimated');
});

test('deposit without a matching custody lot remains automated and Estimated', () => {
  const [row] = buildValuedCustodyRows([deposit], { faction: 'MUD' });
  assert.equal(row.status, 'Estimated');
  assert.equal(row.carriedBasisAtlas, 0);
  assert.equal(row.finalBasisAtlas, 0.5);
});
