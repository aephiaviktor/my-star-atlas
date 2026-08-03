'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setTelemetryRecorder } = require('../electron/telemetry-context');
const { wrapRpcConnection } = require('../electron/telemetry-rpc-fetch');
const {
  createMarketplaceRpcTelemetry,
  createMarketplaceRpcInstrumentation,
  wrapMarketplaceConnection,
  createMarketplaceRpcAttemptBudget,
  isMarketplaceRpcBudgetExhaustedError,
  DEFAULT_MARKETPLACE_RPC_ATTEMPT_LIMIT,
} = require('../electron/marketplace-rpc-telemetry');

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

test('Marketplace telemetry finish is idempotent and seals later writes', () => {
  let time = 4_000;
  const telemetry = createMarketplaceRpcTelemetry({ runId: 'run-finished', now: () => time });
  telemetry.recordLogical({ operation: 'LM', method: 'getAccountInfo' });
  time = 4_250;

  const finished = telemetry.finish();
  time = 9_000;
  telemetry.recordLogical({ operation: 'GM', method: 'getSignaturesForAddress' });
  telemetry.recordAttempt({
    operation: 'GM', method: 'getSignaturesForAddress', provider: 'main', retry: true,
  });
  telemetry.recordCache({ operation: 'GM', method: 'getSignaturesForAddress', hit: true });

  assert.equal(finished.durationMs, 250);
  assert.equal(finished.completedAt, '1970-01-01T00:00:04.250Z');
  assert.deepEqual(telemetry.finish(), finished);
  assert.deepEqual(telemetry.snapshot(), finished);
});

test('Marketplace instrumentation derives retries per provider within one logical call', async () => {
  const telemetry = createMarketplaceRpcTelemetry({ runId: 'run-attempts', now: () => 5_000 });
  const instrumentation = createMarketplaceRpcInstrumentation(telemetry);

  await instrumentation.runLogical({ operation: 'LM', method: 'getAccountInfo' }, async () => {
    instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'main' });
    instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'main' });
    instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'fallback', fallback: true });
    instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'fallback', fallback: true });
  });

  const result = telemetry.finish();
  assert.deepEqual(result.totals, {
    logicalOperations: 1, rpcAttempts: 4, retries: 2, fallbackCalls: 2, cacheHits: 0, cacheMisses: 0,
  });
  assert.deepEqual(result.samples.slice(1).map(({ provider, retry, fallback }) => ({ provider, retry, fallback })), [
    { provider: 'main', retry: false, fallback: false },
    { provider: 'main', retry: true, fallback: false },
    { provider: 'fallback', retry: false, fallback: true },
    { provider: 'fallback', retry: true, fallback: true },
  ]);
});

test('Marketplace instrumentation isolates concurrent LM and GM logical contexts', async () => {
  const telemetry = createMarketplaceRpcTelemetry({ runId: 'run-concurrent', now: () => 6_000 });
  const instrumentation = createMarketplaceRpcInstrumentation(telemetry);
  let releaseLm;
  const lmGate = new Promise((resolve) => { releaseLm = resolve; });

  const lm = instrumentation.runLogical({ operation: 'LM', method: 'getAccountInfo' }, async () => {
    await lmGate;
    instrumentation.recordAttempt({ method: 'getAccountInfo', provider: 'main' });
  });
  const gm = instrumentation.runLogical({ operation: 'GM', method: 'getSignaturesForAddress' }, async () => {
    instrumentation.recordAttempt({ method: 'getSignaturesForAddress', provider: 'fallback' });
  });
  releaseLm();
  await Promise.all([lm, gm]);

  const result = telemetry.finish();
  assert.equal(result.operations.LM.methods.getAccountInfo.logicalOperations, 1);
  assert.equal(result.operations.LM.methods.getAccountInfo.rpcAttempts, 1);
  assert.equal(result.operations.GM.methods.getSignaturesForAddress.logicalOperations, 1);
  assert.equal(result.operations.GM.methods.getSignaturesForAddress.rpcAttempts, 1);
});

test('Marketplace Connection wrappers record logical and wire methods without retaining inputs', async () => {
  const telemetry = createMarketplaceRpcTelemetry({ runId: 'run-wrapper', now: () => 7_000 });
  const instrumentation = createMarketplaceRpcInstrumentation(telemetry);
  const connection = {
    endpoint: 'https://rpc.example/?api-key=rpc-secret',
    async getMultipleAccountsInfo(_secretInput) {
      instrumentation.recordAttempt({ method: 'getMultipleAccounts', provider: 'main' });
      return ['ok'];
    },
  };
  const lmConnection = wrapMarketplaceConnection(connection, { instrumentation, operation: 'LM' });

  assert.deepEqual(await lmConnection.getMultipleAccountsInfo({ token: 'wallet-secret' }), ['ok']);
  const result = telemetry.finish();
  assert.equal(result.operations.LM.methods.getMultipleAccountsInfo.logicalOperations, 1);
  assert.equal(result.operations.LM.methods.getMultipleAccounts.rpcAttempts, 1);
  assert.equal(JSON.stringify(result).includes('rpc-secret'), false);
  assert.equal(JSON.stringify(result).includes('wallet-secret'), false);
});

test('Marketplace compatibility telemetry bridges feature context without durable logical double counting', async () => {
  const durable = [];
  setTelemetryRecorder({ record(event) { durable.push(event); }, flush() {} });
  const telemetry = createMarketplaceRpcTelemetry({ runId: 'bridge-once' });
  const instrumentation = createMarketplaceRpcInstrumentation(telemetry);
  const connection = wrapRpcConnection({ async getAccountInfo() { return { ok: true }; } });
  const wrapped = wrapMarketplaceConnection(connection, { instrumentation, operation: 'LM' });
  assert.deepEqual(await wrapped.getAccountInfo('synthetic'), { ok: true });
  assert.equal(telemetry.finish().totals.logicalOperations, 1);
  assert.equal(durable.filter((event) => event.type === 'logical-start').length, 1);
  assert.equal(durable.find((event) => event.type === 'logical-start').context.feature, 'Marketplace LM');
  setTelemetryRecorder(null);
});

test('Marketplace attempt budget retains the exact first refused sentinel', () => {
  const attemptBudget = createMarketplaceRpcAttemptBudget({ limit: 0 });
  let first;
  let second;
  try { attemptBudget.admit('LM', 'getAccountInfo'); } catch (error) { first = error; }
  try { attemptBudget.admit('GM', 'getSignaturesForAddress'); } catch (error) { second = error; }

  assert.equal(first, second);
  assert.equal(attemptBudget.getExhaustion(), first);
  assert.equal(first.operation, 'LM');
  assert.equal(first.method, 'getAccountInfo');
  assert.deepEqual(attemptBudget.snapshot(), { limit: 0, used: 0 });
});

test('Marketplace attempt budget defaults to 300 and refuses without telemetry or cache cost', async () => {
  assert.equal(DEFAULT_MARKETPLACE_RPC_ATTEMPT_LIMIT, 300);
  const telemetry = createMarketplaceRpcTelemetry({ runId: 'budget-limit' });
  const attemptBudget = createMarketplaceRpcAttemptBudget({ limit: 2 });
  const instrumentation = createMarketplaceRpcInstrumentation(telemetry, { attemptBudget });

  await instrumentation.runLogical({ operation: 'LM', method: 'getAccountInfo' }, async () => {
    instrumentation.admitAttempt({ method: 'getAccountInfo', provider: 'main' });
    instrumentation.admitAttempt({ method: 'getAccountInfo', provider: 'main' });
    assert.throws(
      () => instrumentation.admitAttempt({ method: 'getAccountInfo', provider: 'fallback', fallback: true }),
      (error) => isMarketplaceRpcBudgetExhaustedError(error) && error.operation === 'LM' && error.method === 'getAccountInfo',
    );
  });
  telemetry.recordCache({ operation: 'LM', method: 'getAccountInfo', hit: true });

  assert.deepEqual(attemptBudget.snapshot(), { limit: 2, used: 2 });
  const result = telemetry.finish();
  assert.equal(result.totals.rpcAttempts, 2);
  assert.equal(result.totals.retries, 1);
  assert.equal(result.totals.fallbackCalls, 0);
  assert.equal(result.totals.cacheHits, 1);
});
