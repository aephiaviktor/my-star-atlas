'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('Marketplace sync returns separate partial LM and GM RPC summaries without settings', async () => {
  const start = main.indexOf('async function syncMarketplaceTrades(payload)');
  const end = main.indexOf('async function fetchMarketplaceSnapshot', start);
  const functionSource = main.slice(start, end);
  const calls = [];
  const input = {
    faction: 'MUD',
    influxAuthToken: 'influx-secret',
    rpcUrl: 'https://rpc.example/?api-key=rpc-secret',
    gmTradingWallets: 'wallet-secret',
  };
  const context = {
    input,
    marketplaceSyncInFlight: new Map(),
    normalizeSettings: (value) => value,
    readSettings: async () => { throw new Error('unexpected readSettings call'); },
    normalizeFaction: (value) => value,
    createSolanaConnection: () => ({ mocked: true }),
    fetchLocalMarketTrades: async () => {
      calls.push('LM');
      return {
        trades: [{ id: 'lm-trade' }],
        error: '',
        rpc: { signatureRequests: 2, transactionRequests: 3, totalRpcRequests: 5 },
      };
    },
    fetchGlobalMarketTrades: async () => {
      calls.push('GM');
      return {
        trades: [{ id: 'gm-trade' }],
        error: '',
        rpc: { signatureRequests: 7, transactionRequests: 11, totalRpcRequests: 18 },
      };
    },
  };

  const result = await vm.runInNewContext(
    `${functionSource}\nsyncMarketplaceTrades(input);`,
    context,
  );
  const plainResult = JSON.parse(JSON.stringify(result));

  assert.deepEqual(calls, ['LM', 'GM']);
  assert.deepEqual(plainResult.trades, [{ id: 'lm-trade' }, { id: 'gm-trade' }]);
  assert.deepEqual(plainResult.localMarketTrades, [{ id: 'lm-trade' }]);
  assert.deepEqual(plainResult.globalMarketTrades, [{ id: 'gm-trade' }]);
  assert.deepEqual(plainResult.localMarketRpc, {
    signatureRequests: 2, transactionRequests: 3, totalRpcRequests: 5,
  });
  assert.deepEqual(plainResult.globalMarketRpc, {
    signatureRequests: 7, transactionRequests: 11, totalRpcRequests: 18,
  });
  assert.equal(plainResult.rpcCoverage, 'scanner_and_open_orders_only');
  assert.equal(JSON.stringify(plainResult).includes('influx-secret'), false);
  assert.equal(JSON.stringify(plainResult).includes('rpc-secret'), false);
  assert.equal(JSON.stringify(plainResult).includes('wallet-secret'), false);
});
