'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  createMarketplaceRpcTelemetry,
  createMarketplaceRpcInstrumentation,
  wrapMarketplaceConnection,
} = require('../electron/marketplace-rpc-telemetry');

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
  let underlyingConnection;
  const receivedConnections = [];
  const context = {
    input,
    marketplaceSyncInFlight: new Map(),
    normalizeSettings: (value) => value,
    readSettings: async () => { throw new Error('unexpected readSettings call'); },
    normalizeFaction: (value) => value,
    createMarketplaceRpcTelemetry,
    createMarketplaceRpcInstrumentation,
    wrapMarketplaceConnection,
    createSolanaConnection: (_settings, { instrumentation }) => {
      underlyingConnection = {
        marker: {},
        async getAccountInfo() {
          instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'main' });
          return null;
        },
      };
      return underlyingConnection;
    },
    fetchLocalMarketTrades: async (_settings, connection) => {
      calls.push('LM');
      receivedConnections.push(connection);
      await connection.getAccountInfo('lm-secret');
      return {
        trades: [{ id: 'lm-trade' }],
        error: '',
        rpc: { signatureRequests: 2, transactionRequests: 3, totalRpcRequests: 5 },
      };
    },
    fetchGlobalMarketTrades: async (_settings, connection) => {
      calls.push('GM');
      receivedConnections.push(connection);
      await connection.getAccountInfo('gm-secret');
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
  assert.equal(receivedConnections.length, 2);
  assert.notEqual(receivedConnections[0], receivedConnections[1]);
  assert.equal(receivedConnections[0].marker, underlyingConnection.marker);
  assert.equal(receivedConnections[1].marker, underlyingConnection.marker);
  assert.equal(plainResult.marketplaceRpcTelemetry.runId.length > 0, true);
  assert.equal(plainResult.marketplaceRpcTelemetry.operations.LM.methods.getAccountInfo.logicalOperations, 1);
  assert.equal(plainResult.marketplaceRpcTelemetry.operations.GM.methods.getAccountInfo.logicalOperations, 1);
  assert.deepEqual(plainResult.marketplaceRpcTelemetry.totals, {
    logicalOperations: 2, rpcAttempts: 2, retries: 0, fallbackCalls: 0, cacheHits: 0, cacheMisses: 0,
  });
  assert.equal(JSON.stringify(plainResult).includes('influx-secret'), false);
  assert.equal(JSON.stringify(plainResult).includes('rpc-secret'), false);
  assert.equal(JSON.stringify(plainResult).includes('wallet-secret'), false);
  assert.equal(JSON.stringify(plainResult).includes('lm-secret'), false);
  assert.equal(JSON.stringify(plainResult).includes('gm-secret'), false);
});

test('Marketplace sync seals telemetry on unexpected failure and coalesces callers', async () => {
  const start = main.indexOf('async function syncMarketplaceTrades(payload)');
  const end = main.indexOf('async function fetchMarketplaceSnapshot', start);
  const functionSource = main.slice(start, end);
  let releaseFailure;
  const gate = new Promise((resolve) => { releaseFailure = resolve; });
  let connectionCount = 0;
  const context = {
    input: { faction: 'ONI' },
    marketplaceSyncInFlight: new Map(),
    normalizeSettings: (value) => value,
    readSettings: async () => ({}),
    normalizeFaction: (value) => value,
    createMarketplaceRpcTelemetry,
    createMarketplaceRpcInstrumentation,
    wrapMarketplaceConnection,
    createSolanaConnection: (_settings, { instrumentation }) => {
      connectionCount += 1;
      return {
        async getAccountInfo() {
          instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'main' });
          return null;
        },
      };
    },
    fetchLocalMarketTrades: async (_settings, connection) => {
      await connection.getAccountInfo();
      await gate;
      throw new Error('simulated_failure');
    },
    fetchGlobalMarketTrades: async () => { throw new Error('GM must not run'); },
  };
  const expression = `${functionSource}\n[first, second] = [syncMarketplaceTrades(input), syncMarketplaceTrades(input)];`;
  context.first = null;
  context.second = null;
  vm.runInNewContext(expression, context);
  const firstResult = context.first.catch((caught) => caught);
  const secondResult = context.second.catch((caught) => caught);
  releaseFailure();
  const [firstError, secondError] = await Promise.all([firstResult, secondResult]);

  assert.equal(connectionCount, 1);
  assert.equal(firstError.message, 'simulated_failure');
  assert.equal(secondError.message, 'simulated_failure');
  assert.equal(firstError.marketplaceRpcTelemetry.runId, secondError.marketplaceRpcTelemetry.runId);
  assert.equal(firstError.marketplaceRpcTelemetry.operations.LM.methods.getAccountInfo.logicalOperations, 1);
  assert.equal(firstError.marketplaceRpcTelemetry.totals.rpcAttempts, 1);
  assert.equal(firstError.marketplaceRpcTelemetry.totals.cacheHits, 0);
  assert.equal(firstError.marketplaceRpcTelemetry.totals.cacheMisses, 0);
});
