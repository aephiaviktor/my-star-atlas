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
