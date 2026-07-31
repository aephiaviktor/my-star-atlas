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
  createMarketplaceRpcAttemptBudget,
  DEFAULT_MARKETPLACE_RPC_ATTEMPT_LIMIT,
} = require('../electron/marketplace-rpc-telemetry');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

function loadCheckpointCursorResolver() {
  const start = main.indexOf('function resolveMarketplaceCheckpointCursors');
  const end = main.indexOf('async function fetchLocalMarketTrades', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  vm.runInNewContext(`${main.slice(start, end)}\nthis.resolve = resolveMarketplaceCheckpointCursors;`, context);
  return context.resolve;
}

test('Marketplace exhaustion preserves durable migration cursors without persisting its marker', () => {
  assert.match(main, /walletCursors: needsTradeEnrichment \? \{\} : checkpoint\.walletCursors/);
  assert.match(main, /walletCursors: checkpoint\.assetFlowBackfilled \? checkpoint\.walletCursors : \{\}/);
  assert.equal((main.match(/const persistedCursors = resolveMarketplaceCheckpointCursors\(checkpoint, scanned\)/g) || []).length, 2);
  const resolve = loadCheckpointCursorResolver();
  const checkpoint = {
    walletCursors: { walletA: 'durable-wallet' },
    orderCursors: { orderA: 'durable-order' },
  };
  for (const operation of ['LM', 'GM']) {
    const persisted = resolve(checkpoint, {
      walletCursors: {}, orderCursors: {}, exhaustion: { operation, method: 'getAccountInfo' },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(persisted)), {
      walletCursors: { walletA: 'durable-wallet' },
      orderCursors: { orderA: 'durable-order' },
    });
    assert.equal(JSON.stringify(persisted).includes('exhaustion'), false);
  }
});

test('Marketplace completed scans retain returned cursor behavior', () => {
  const resolve = loadCheckpointCursorResolver();
  const persisted = resolve(
    { walletCursors: { old: 'wallet' }, orderCursors: { old: 'order' } },
    { walletCursors: { next: 'wallet' }, orderCursors: { next: 'order' }, exhaustion: null },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(persisted)), {
    walletCursors: { next: 'wallet' }, orderCursors: { next: 'order' },
  });
});

test('Marketplace sync returns separate partial LM and GM RPC summaries without settings', async () => {
  const start = main.indexOf('function marketplaceSyncAttempt');
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
    marketplaceSyncActive: null,
    normalizeSettings: (value) => value,
    readSettings: async () => { throw new Error('unexpected readSettings call'); },
    normalizeFaction: (value) => value,
    createMarketplaceRpcTelemetry,
    createMarketplaceRpcInstrumentation,
    wrapMarketplaceConnection,
    createMarketplaceRpcAttemptBudget,
    DEFAULT_MARKETPLACE_RPC_ATTEMPT_LIMIT,
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
  assert.deepEqual(plainResult.marketplaceSyncAttempt, {
    disposition: 'started', requestedFaction: 'MUD', activeFaction: 'MUD', runId: plainResult.marketplaceRpcTelemetry.runId,
  });
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
  const start = main.indexOf('function marketplaceSyncAttempt');
  const end = main.indexOf('async function fetchMarketplaceSnapshot', start);
  const functionSource = main.slice(start, end);
  let releaseFailure;
  const gate = new Promise((resolve) => { releaseFailure = resolve; });
  let connectionCount = 0;
  const context = {
    input: { faction: 'ONI' },
    marketplaceSyncActive: null,
    normalizeSettings: (value) => value,
    readSettings: async () => ({}),
    normalizeFaction: (value) => value,
    createMarketplaceRpcTelemetry,
    createMarketplaceRpcInstrumentation,
    wrapMarketplaceConnection,
    createMarketplaceRpcAttemptBudget,
    DEFAULT_MARKETPLACE_RPC_ATTEMPT_LIMIT,
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
  assert.equal(firstError.marketplaceSyncAttempt.disposition, 'started');
  assert.equal(secondError.marketplaceSyncAttempt.disposition, 'coalesced');
  assert.equal(firstError.marketplaceSyncAttempt.runId, secondError.marketplaceSyncAttempt.runId);
  assert.equal(firstError.marketplaceRpcTelemetry.operations.LM.methods.getAccountInfo.logicalOperations, 1);
  assert.equal(firstError.marketplaceRpcTelemetry.totals.rpcAttempts, 1);
  assert.equal(firstError.marketplaceRpcTelemetry.totals.cacheHits, 0);
  assert.equal(firstError.marketplaceRpcTelemetry.totals.cacheMisses, 0);
});

test('Marketplace sync preserves telemetry for primitive and frozen errors', async () => {
  const start = main.indexOf('function marketplaceSyncAttempt');
  const end = main.indexOf('async function fetchMarketplaceSnapshot', start);
  const functionSource = main.slice(start, end);
  const cases = [
    { thrown: 'primitive_failure', message: 'primitive_failure' },
    { thrown: Object.freeze(new Error('frozen_failure')), message: 'frozen_failure' },
  ];

  for (const scenario of cases) {
    const context = {
      input: { faction: 'MUD' },
      marketplaceSyncActive: null,
      normalizeSettings: (value) => value,
      readSettings: async () => ({}),
      normalizeFaction: (value) => value,
      createMarketplaceRpcTelemetry,
      createMarketplaceRpcInstrumentation,
      wrapMarketplaceConnection,
      createMarketplaceRpcAttemptBudget,
      DEFAULT_MARKETPLACE_RPC_ATTEMPT_LIMIT,
      createSolanaConnection: (_settings, { instrumentation }) => ({
        async getAccountInfo() {
          instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'main' });
          return null;
        },
      }),
      fetchLocalMarketTrades: async (_settings, connection) => {
        await connection.getAccountInfo();
        throw scenario.thrown;
      },
      fetchGlobalMarketTrades: async () => { throw new Error('GM must not run'); },
    };

    const error = await vm.runInNewContext(
      `${functionSource}\nsyncMarketplaceTrades(input);`,
      context,
    ).catch((caught) => caught);

    assert.equal(typeof error, 'object');
    assert.equal(error.message, scenario.message);
    assert.notEqual(error.marketplaceRpcTelemetry, null);
    assert.notEqual(error.marketplaceRpcTelemetry.completedAt, null);
    assert.equal(error.marketplaceSyncAttempt.disposition, 'started');
    assert.equal(error.marketplaceSyncAttempt.runId, error.marketplaceRpcTelemetry.runId);
    assert.equal(error.marketplaceRpcTelemetry.operations.LM.methods.getAccountInfo.logicalOperations, 1);
    assert.equal(error.marketplaceRpcTelemetry.totals.logicalOperations, 1);
    assert.equal(error.marketplaceRpcTelemetry.totals.rpcAttempts, 1);
    assert.equal(error.marketplaceRpcTelemetry.totals.cacheHits, 0);
    assert.equal(error.marketplaceRpcTelemetry.totals.cacheMisses, 0);
  }
});

test('Marketplace sync returns bounded resumable exhaustion with partial LM data and no GM start', async () => {
  const start = main.indexOf('function marketplaceSyncAttempt');
  const end = main.indexOf('async function fetchMarketplaceSnapshot', start);
  const functionSource = main.slice(start, end);
  let gmCalls = 0;
  let transportAttempts = 0;
  const context = {
    input: { faction: 'MUD', rpcUrl: 'https://secret.invalid' },
    marketplaceSyncActive: null,
    normalizeSettings: (value) => value,
    readSettings: async () => ({}),
    normalizeFaction: (value) => value,
    createMarketplaceRpcTelemetry,
    createMarketplaceRpcInstrumentation,
    wrapMarketplaceConnection,
    createMarketplaceRpcAttemptBudget,
    DEFAULT_MARKETPLACE_RPC_ATTEMPT_LIMIT,
    createSolanaConnection: (_settings, { instrumentation }) => ({
      async getAccountInfo() {
        instrumentation.admitAttempt({ method: 'getAccountInfo', provider: 'main' });
        transportAttempts += 1;
        return null;
      },
    }),
    fetchLocalMarketTrades: async (_settings, connection) => {
      await connection.getAccountInfo();
      await connection.getAccountInfo();
      try { await connection.getAccountInfo(); } catch (exhaustion) {
        return {
          trades: [{ id: 'decoded-lm' }], error: '', rpc: { totalRpcRequests: 2 }, exhaustion,
        };
      }
      throw new Error('budget did not stop');
    },
    fetchGlobalMarketTrades: async () => { gmCalls += 1; throw new Error('GM must not start'); },
  };

  const result = await vm.runInNewContext(
    `${functionSource}\nsyncMarketplaceTrades(input, { rpcAttemptLimit: 2 });`, context,
  );
  const plain = JSON.parse(JSON.stringify(result));
  assert.equal(transportAttempts, 2);
  assert.equal(gmCalls, 0);
  assert.equal(plain.ok, true);
  assert.equal(plain.status, 'budget_exhausted');
  assert.equal(plain.resumable, true);
  assert.equal(plain.partial, true);
  assert.deepEqual(plain.localMarketTrades, [{ id: 'decoded-lm' }]);
  assert.deepEqual(plain.globalMarketTrades, []);
  assert.deepEqual(plain.marketplaceRpcBudget, {
    status: 'exhausted', limit: 2, used: 2, operation: 'LM', method: 'getAccountInfo',
  });
  assert.equal(plain.marketplaceRpcTelemetry.totals.rpcAttempts, 2);
  assert.equal(plain.marketplaceSyncAttempt.disposition, 'started');
  assert.equal(JSON.stringify(plain).includes('secret.invalid'), false);
});

test('Marketplace stops before GM when completed LM consumes the shared budget', async () => {
  const start = main.indexOf('function marketplaceSyncAttempt');
  const end = main.indexOf('async function fetchMarketplaceSnapshot', start);
  const functionSource = main.slice(start, end);
  let gmCalls = 0;
  const context = {
    input: { faction: 'ONI' }, marketplaceSyncActive: null,
    normalizeSettings: (value) => value, readSettings: async () => ({}), normalizeFaction: (value) => value,
    createMarketplaceRpcTelemetry, createMarketplaceRpcInstrumentation, wrapMarketplaceConnection,
    createMarketplaceRpcAttemptBudget, DEFAULT_MARKETPLACE_RPC_ATTEMPT_LIMIT,
    createSolanaConnection: (_settings, { instrumentation }) => ({
      async getAccountInfo() { instrumentation.admitAttempt({ method: 'getAccountInfo', provider: 'main' }); return null; },
    }),
    fetchLocalMarketTrades: async (_settings, connection) => {
      await connection.getAccountInfo();
      return { trades: [{ id: 'complete-lm' }], error: '', rpc: { totalRpcRequests: 1 } };
    },
    fetchGlobalMarketTrades: async () => { gmCalls += 1; return { trades: [], error: '' }; },
  };
  const result = await vm.runInNewContext(
    `${functionSource}\nsyncMarketplaceTrades(input, { rpcAttemptLimit: 1 });`, context,
  );
  assert.equal(gmCalls, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.marketplaceRpcBudget)), {
    status: 'exhausted', limit: 1, used: 1, operation: 'GM', method: null,
  });
  assert.equal(result.localMarketTrades[0].id, 'complete-lm');
});
