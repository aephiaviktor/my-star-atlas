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
const start = main.indexOf('function marketplaceSyncAttempt');
const end = main.indexOf('async function fetchMarketplaceSnapshot', start);
const functionSource = main.slice(start, end);

function createContext(overrides = {}) {
  return {
    marketplaceSyncActive: null,
    normalizeSettings: (value) => value,
    readSettings: async () => ({}),
    normalizeFaction: (value) => value,
    createMarketplaceRpcTelemetry,
    createMarketplaceRpcInstrumentation,
    wrapMarketplaceConnection,
    createSolanaConnection: (_settings, { instrumentation }) => ({
      async getAccountInfo() {
        instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'main' });
        return null;
      },
    }),
    fetchLocalMarketTrades: async (_settings, connection) => {
      await connection.getAccountInfo();
      return { trades: [{ id: 'lm' }], error: '', rpc: { totalRpcRequests: 1 } };
    },
    fetchGlobalMarketTrades: async (_settings, connection) => {
      await connection.getAccountInfo();
      return { trades: [{ id: 'gm' }], error: '', rpc: { totalRpcRequests: 1 } };
    },
    ...overrides,
  };
}

function install(context) {
  vm.runInNewContext(`${functionSource}\nthis.syncMarketplaceTrades = syncMarketplaceTrades;`, context);
  return context.syncMarketplaceTrades;
}

test('Marketplace global exclusion returns caller-specific started, coalesced, and skipped dispositions', async () => {
  let releaseMud;
  const mudGate = new Promise((resolve) => { releaseMud = resolve; });
  let connectionCount = 0;
  let concurrentRuns = 0;
  let maxConcurrentRuns = 0;
  const sequence = [];
  const context = createContext({
    createSolanaConnection: (_settings, { instrumentation }) => {
      connectionCount += 1;
      return {
        async getAccountInfo() {
          instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'main' });
          return null;
        },
      };
    },
    fetchLocalMarketTrades: async (settings, connection) => {
      concurrentRuns += 1;
      maxConcurrentRuns = Math.max(maxConcurrentRuns, concurrentRuns);
      sequence.push(`${settings.faction}:LM`);
      await connection.getAccountInfo();
      await mudGate;
      return { trades: [{ id: 'mud-lm' }], error: '', rpc: { totalRpcRequests: 1 } };
    },
    fetchGlobalMarketTrades: async (settings, connection) => {
      sequence.push(`${settings.faction}:GM`);
      await connection.getAccountInfo();
      concurrentRuns -= 1;
      return { trades: [{ id: 'mud-gm' }], error: '', rpc: { totalRpcRequests: 1 } };
    },
  });
  const sync = install(context);

  const startedPromise = sync({ faction: 'MUD' });
  const coalescedPromise = sync({ faction: 'MUD' });
  const skipped = await sync({ faction: 'ONI' });

  assert.deepEqual(JSON.parse(JSON.stringify(skipped)), {
    ok: true,
    skipped: true,
    faction: 'ONI',
    marketplaceSyncAttempt: {
      disposition: 'skipped', requestedFaction: 'ONI', activeFaction: 'MUD', runId: skipped.marketplaceSyncAttempt.runId,
    },
  });
  assert.equal('trades' in skipped, false);
  assert.equal('localMarketRpc' in skipped, false);
  assert.equal('globalMarketRpc' in skipped, false);
  assert.equal('marketplaceRpcTelemetry' in skipped, false);
  assert.equal('error' in skipped, false);
  assert.equal(connectionCount, 1);

  releaseMud();
  const [started, coalesced] = await Promise.all([startedPromise, coalescedPromise]);
  assert.deepEqual(sequence, ['MUD:LM', 'MUD:GM']);
  assert.equal(maxConcurrentRuns, 1);
  assert.equal(connectionCount, 1);
  assert.equal(started.marketplaceSyncAttempt.disposition, 'started');
  assert.equal(coalesced.marketplaceSyncAttempt.disposition, 'coalesced');
  assert.equal(started.marketplaceSyncAttempt.runId, coalesced.marketplaceSyncAttempt.runId);
  assert.equal(started.marketplaceRpcTelemetry.runId, coalesced.marketplaceRpcTelemetry.runId);
  assert.notEqual(started, coalesced);
});

test('Marketplace global guard releases after success and preserves normal run results', async () => {
  let connectionCount = 0;
  const context = createContext({
    createSolanaConnection: (_settings, { instrumentation }) => {
      connectionCount += 1;
      return {
        async getAccountInfo() {
          instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'main' });
          return null;
        },
      };
    },
    fetchLocalMarketTrades: async (settings, connection) => {
      await connection.getAccountInfo();
      return {
        trades: [{ id: `${settings.faction}-lm` }], error: '',
        rpc: { signatureRequests: 2, transactionRequests: 3, totalRpcRequests: 5 },
      };
    },
    fetchGlobalMarketTrades: async (settings, connection) => {
      await connection.getAccountInfo();
      return {
        trades: [{ id: `${settings.faction}-gm` }], error: '',
        rpc: { signatureRequests: 7, transactionRequests: 11, totalRpcRequests: 18 },
      };
    },
  });
  const sync = install(context);

  const mud = await sync({ faction: 'MUD' });
  const oni = await sync({ faction: 'ONI' });

  assert.equal(connectionCount, 2);
  assert.equal(mud.marketplaceSyncAttempt.disposition, 'started');
  assert.equal(oni.marketplaceSyncAttempt.disposition, 'started');
  assert.notEqual(mud.marketplaceRpcTelemetry.runId, oni.marketplaceRpcTelemetry.runId);
  assert.deepEqual(JSON.parse(JSON.stringify(oni.trades)), [{ id: 'ONI-lm' }, { id: 'ONI-gm' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(oni.localMarketRpc)), {
    signatureRequests: 2, transactionRequests: 3, totalRpcRequests: 5,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(oni.globalMarketRpc)), {
    signatureRequests: 7, transactionRequests: 11, totalRpcRequests: 18,
  });
  assert.equal(oni.rpcCoverage, 'scanner_and_open_orders_only');
  assert.equal(oni.marketplaceRpcTelemetry.totals.logicalOperations, 2);
  assert.equal(oni.marketplaceRpcTelemetry.totals.rpcAttempts, 2);
  assert.equal(oni.marketplaceRpcTelemetry.totals.cacheHits, 0);
  assert.equal(oni.marketplaceRpcTelemetry.totals.cacheMisses, 0);
});

test('Marketplace failure keeps caller diagnostics isolated and releases the global guard', async () => {
  let releaseFailure;
  const failureGate = new Promise((resolve) => { releaseFailure = resolve; });
  let shouldFail = true;
  let connectionCount = 0;
  const context = createContext({
    createSolanaConnection: (_settings, { instrumentation }) => {
      connectionCount += 1;
      return {
        async getAccountInfo() {
          instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'main' });
          return null;
        },
      };
    },
    fetchLocalMarketTrades: async (settings, connection) => {
      await connection.getAccountInfo();
      if (shouldFail) {
        await failureGate;
        throw new Error('shared_failure');
      }
      return { trades: [{ id: `${settings.faction}-lm` }], error: '', rpc: { totalRpcRequests: 1 } };
    },
    fetchGlobalMarketTrades: async (settings, connection) => {
      await connection.getAccountInfo();
      return { trades: [{ id: `${settings.faction}-gm` }], error: '', rpc: { totalRpcRequests: 1 } };
    },
  });
  const sync = install(context);

  const startedResult = sync({ faction: 'MUD' }).catch((error) => error);
  const coalescedResult = sync({ faction: 'MUD' }).catch((error) => error);
  releaseFailure();
  const [startedError, coalescedError] = await Promise.all([startedResult, coalescedResult]);

  assert.equal(startedError.message, 'shared_failure');
  assert.equal(coalescedError.message, 'shared_failure');
  assert.notEqual(startedError, coalescedError);
  assert.equal(startedError.marketplaceSyncAttempt.disposition, 'started');
  assert.equal(coalescedError.marketplaceSyncAttempt.disposition, 'coalesced');
  assert.equal(startedError.marketplaceSyncAttempt.runId, coalescedError.marketplaceSyncAttempt.runId);
  assert.equal(startedError.marketplaceRpcTelemetry.runId, coalescedError.marketplaceRpcTelemetry.runId);
  assert.notEqual(startedError.marketplaceRpcTelemetry.completedAt, null);
  assert.equal(startedError.marketplaceRpcTelemetry.totals.cacheHits, 0);
  assert.equal(startedError.marketplaceRpcTelemetry.totals.cacheMisses, 0);
  coalescedError.marketplaceSyncAttempt.disposition = 'changed';
  assert.equal(startedError.marketplaceSyncAttempt.disposition, 'started');

  shouldFail = false;
  const oni = await sync({ faction: 'ONI' });
  assert.equal(oni.marketplaceSyncAttempt.disposition, 'started');
  assert.notEqual(oni.marketplaceRpcTelemetry.runId, startedError.marketplaceRpcTelemetry.runId);
  assert.equal(connectionCount, 2);
});
