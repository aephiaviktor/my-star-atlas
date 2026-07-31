'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketplaceRpcTelemetry } = require('../electron/marketplace-rpc-telemetry');

test('Marketplace telemetry keeps LM and GM aggregates separate', () => {
  let time = 1_000;
  const telemetry = createMarketplaceRpcTelemetry({ runId: 'run-a', now: () => time });

  telemetry.recordLogical({ operation: 'LM', method: 'getAccountInfo' });
  telemetry.recordAttempt({ operation: 'LM', method: 'getAccountInfo', provider: 'main' });
  telemetry.recordAttempt({
    operation: 'LM', method: 'getAccountInfo', provider: 'fallback', retry: true, fallback: true,
  });
  telemetry.recordCache({ operation: 'LM', method: 'getAccountInfo', hit: false });
  telemetry.recordLogical({ operation: 'GM', method: 'getSignaturesForAddress' });
  telemetry.recordCache({ operation: 'GM', method: 'getSignaturesForAddress', hit: true });
  time = 1_250;

  const result = telemetry.finish();
  assert.equal(result.runId, 'run-a');
  assert.equal(result.coverage, 'marketplace_only');
  assert.equal(result.durationMs, 250);
  assert.equal(result.completedAt, '1970-01-01T00:00:01.250Z');
  assert.deepEqual(result.totals, {
    logicalOperations: 2, rpcAttempts: 2, retries: 1, fallbackCalls: 1, cacheHits: 1, cacheMisses: 1,
  });
  assert.deepEqual(result.operations.LM, {
    logicalOperations: 1, rpcAttempts: 2, retries: 1, fallbackCalls: 1, cacheHits: 0, cacheMisses: 1,
    methods: {
      getAccountInfo: {
        logicalOperations: 1, rpcAttempts: 2, retries: 1, fallbackCalls: 1, cacheHits: 0, cacheMisses: 1,
      },
    },
  });
  assert.deepEqual(result.operations.GM, {
    logicalOperations: 1, rpcAttempts: 0, retries: 0, fallbackCalls: 0, cacheHits: 1, cacheMisses: 0,
    methods: {
      getSignaturesForAddress: {
        logicalOperations: 1, rpcAttempts: 0, retries: 0, fallbackCalls: 0, cacheHits: 1, cacheMisses: 0,
      },
    },
  });
});

test('Marketplace telemetry caps samples and excludes supplied secret-bearing fields', () => {
  const telemetry = createMarketplaceRpcTelemetry({ runId: 'run-b', maxSamples: 2, now: () => 2_000 });
  const unsafe = {
    operation: 'LM', method: 'https://rpc.example/?api-key=rpc-secret', provider: 'main',
    rpcUrl: 'https://rpc.example/?api-key=rpc-secret', error: 'influx-secret', settings: { token: 'wallet-secret' },
  };

  telemetry.recordLogical(unsafe);
  telemetry.recordAttempt(unsafe);
  telemetry.recordCache({ ...unsafe, hit: true });

  const result = telemetry.finish();
  const serialized = JSON.stringify(result);
  assert.equal(result.samples.length, 2);
  assert.equal(result.samplesDropped, 1);
  assert.equal(result.operations.LM.methods.unknown.logicalOperations, 1);
  assert.equal(result.operations.LM.methods.unknown.rpcAttempts, 1);
  assert.equal(result.operations.LM.methods.unknown.cacheHits, 1);
  assert.equal(serialized.includes('rpc-secret'), false);
  assert.equal(serialized.includes('influx-secret'), false);
  assert.equal(serialized.includes('wallet-secret'), false);
});

test('Marketplace telemetry collectors are isolated and perform no RPC work', () => {
  let rpcCalls = 0;
  const connection = { getAccountInfo() { rpcCalls += 1; } };
  const first = createMarketplaceRpcTelemetry({ runId: 'run-first', now: () => 3_000 });
  const second = createMarketplaceRpcTelemetry({ runId: 'run-second', now: () => 3_000 });

  first.recordLogical({ operation: 'LM', method: 'getAccountInfo' });
  first.recordAttempt({ operation: 'LM', method: 'getAccountInfo', provider: 'main' });
  second.recordCache({ operation: 'GM', method: 'getAccountInfo', hit: true });

  assert.equal(connection.getAccountInfo.name, 'getAccountInfo');
  assert.equal(rpcCalls, 0);
  assert.equal(first.finish().totals.rpcAttempts, 1);
  assert.equal(first.finish().totals.cacheHits, 0);
  assert.equal(second.finish().totals.rpcAttempts, 0);
  assert.equal(second.finish().totals.cacheHits, 1);
});
