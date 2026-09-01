'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setTelemetryRecorder, runFeature } = require('../electron/telemetry-context');
const { scanLocalMarketTrades, fetchTransactions } = require('../electron/local-market-scanner');

test('scanner records cursor and transaction-miss decisions but never transport attempts', async () => {
  const events = []; setTelemetryRecorder({ record(event) { events.push(event); }, flush() {} });
  const connection = {
    async getSignaturesForAddress() { return []; },
    async getParsedTransaction() { return null; },
  };
  await runFeature({ feature: 'Marketplace LM', faction: 'USTUR', trigger: 'manual' }, () => scanLocalMarketTrades(connection, {
    trackedWallets: ['synthetic-wallet'], walletCursors: { 'synthetic-wallet': 'synthetic-cursor' },
    addressFactory: (value) => value, startIso: '2026-08-01T00:00:00.000Z', requestsPerSecond: 100000,
  }));
  await fetchTransactions(connection, new Map([['synthetic-signature', { signature: 'synthetic-signature', blockTime: 1 }]]), null, { transactionRequests: 0, transactionMisses: 0 });
  assert.equal(events.some((event) => event.type === 'counter' && event.counter === 'cursorResumes'), true);
  assert.equal(events.some((event) => event.type === 'counter' && event.counter === 'transactionMisses'), true);
  assert.equal(events.some((event) => event.type === 'wire-start'), false);
  setTelemetryRecorder(null);
});

test('raw backfill fetches exact LM signatures even after discovery cursors passed them', async () => {
  const initializeSignature = 'm7Z41p13pEJwnqJ6aX4Fr38FjknrnyV28qKagdim2bm5HR5dvNLZVRVXaqQssBGY3ips4xSTit5L3ERqHTvnxMf';
  const exchangeSignature = '41SsXyaEekKwmuZGbNJbRF5C3CdKmq7UL8NTt8JAePVwMYrjhsmNKzXJCNEXgZzd9Ap5d3791N5PsRhxapUQtjeu';
  const transactions = new Map([
    [initializeSignature, { blockTime: 1788250000, transaction: { signatures: [initializeSignature], message: { accountKeys: [], instructions: [] } }, meta: { err: null } }],
    [exchangeSignature, { blockTime: 1788250100, transaction: { signatures: [exchangeSignature], message: { accountKeys: [], instructions: [] } }, meta: { err: null } }],
  ]);
  const requested = [];
  const connection = {
    async getParsedTransaction(signature) {
      requested.push(signature);
      return transactions.get(signature) || null;
    },
  };
  const result = await scanLocalMarketTrades(connection, {
    rawBackfillSignatures: [initializeSignature, exchangeSignature],
    startIso: '2026-07-24T00:00:00.000Z',
    requestsPerSecond: 100000,
  });
  assert.deepEqual(new Set(requested), new Set([initializeSignature, exchangeSignature]));
  assert.deepEqual(result.rawTransactions.map((transaction) => transaction.signature), [initializeSignature, exchangeSignature]);
});
