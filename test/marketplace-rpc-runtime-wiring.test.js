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

function functionSource(name, nextName, nextIsAsync = false) {
  const start = main.indexOf(`function ${name}`);
  const end = main.indexOf(`${nextIsAsync ? 'async ' : ''}function ${nextName}`, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return main.slice(start, end);
}

function createHarness({ status, platformFetch, acquireRpcSlot }) {
  const instances = [];
  class FakeConnection {
    constructor(url, config) {
      this.url = url;
      this.config = config;
      instances.push(this);
    }

    async getAccountInfo(mode) {
      if (mode === 'retry') {
        await this.config.fetch(this.url, { body: JSON.stringify({ method: 'getAccountInfo' }) });
      }
      return this.config.fetch(this.url, { body: JSON.stringify({ method: 'getAccountInfo' }) });
    }
  }
  const context = {
    Connection: FakeConnection,
    DEFAULT_RPC_URL: 'https://default.invalid',
    getRpcLimiterStatus: () => status,
    isUsableSharedRpcUrl: (value) => Boolean(value),
    acquireRpcSlot: acquireRpcSlot || (async () => {}),
    getRpcMethodLabel: (init) => {
      try { return JSON.parse(String(init?.body || '{}')).method || 'solanaRpc'; }
      catch (_error) { return 'solanaRpc'; }
    },
    fetch: platformFetch || (async () => ({ ok: true })),
    sharedRpcLimiter: null,
    isRpcRateLimitError: () => false,
  };
  vm.runInNewContext([
    functionSource('resolveSolanaConnectionRoutes', 'createSolanaConnection'),
    functionSource('createSolanaConnection', 'getProgramAccountsV2', true),
    'this.createSolanaConnection = createSolanaConnection;',
  ].join('\n'), context);
  return { ...context, instances };
}

async function runLogicalCall(harness, settings, mode) {
  const telemetry = createMarketplaceRpcTelemetry({ runId: 'runtime-wiring' });
  const instrumentation = createMarketplaceRpcInstrumentation(telemetry);
  const connection = harness.createSolanaConnection(settings, { instrumentation });
  const wrapped = wrapMarketplaceConnection(connection, { instrumentation, operation: 'LM' });
  await wrapped.getAccountInfo(mode);
  return { snapshot: telemetry.finish(), instances: harness.instances };
}

test('Marketplace runtime labels all four provider configurations without retaining URLs', async () => {
  const cases = [
    {
      name: 'main plus fallback',
      settings: { useRpcLimiter: true },
      status: { providers: { main: { url: 'https://main.invalid' }, fallback: { url: 'https://fallback.invalid' } } },
      expectedProvider: 'main',
      expectedInstances: 2,
    },
    {
      name: 'main only',
      settings: { useRpcLimiter: true },
      status: { providers: { main: { url: 'https://main.invalid' }, fallback: {} } },
      expectedProvider: 'main',
      expectedInstances: 1,
    },
    {
      name: 'fallback only',
      settings: { useRpcLimiter: true },
      status: { providers: { main: {}, fallback: { url: 'https://fallback.invalid' } } },
      expectedProvider: 'fallback',
      expectedInstances: 1,
    },
    {
      name: 'limiter disabled',
      settings: { useRpcLimiter: false, rpcUrl: 'https://direct.invalid/?api-key=rpc-secret' },
      status: undefined,
      expectedProvider: 'main',
      expectedInstances: 1,
    },
  ];

  for (const scenario of cases) {
    const harness = createHarness({ status: scenario.status });
    const { snapshot, instances } = await runLogicalCall(harness, scenario.settings);
    assert.equal(instances.length, scenario.expectedInstances, scenario.name);
    assert.equal(snapshot.samples[1].provider, scenario.expectedProvider, scenario.name);
    assert.equal(snapshot.samples[1].fallback, false, scenario.name);
    assert.equal(JSON.stringify(snapshot).includes('.invalid'), false, scenario.name);
    assert.equal(JSON.stringify(snapshot).includes('rpc-secret'), false, scenario.name);
  }
});

test('Marketplace runtime attributes retry and main-to-fallback attempts to one logical call', async () => {
  let failMain = true;
  const harness = createHarness({
    status: { providers: { main: { url: 'https://main.invalid' }, fallback: { url: 'https://fallback.invalid' } } },
    platformFetch: async (url) => {
      if (url.includes('main') && failMain) {
        failMain = false;
        throw new Error('primary failed');
      }
      return { ok: true };
    },
  });
  const { snapshot } = await runLogicalCall(harness, { useRpcLimiter: true }, 'retry');

  assert.deepEqual(snapshot.totals, {
    logicalOperations: 1, rpcAttempts: 3, retries: 1, fallbackCalls: 2, cacheHits: 0, cacheMisses: 0,
  });
  assert.deepEqual(snapshot.samples.slice(1).map(({ provider, retry, fallback }) => ({ provider, retry, fallback })), [
    { provider: 'main', retry: false, fallback: false },
    { provider: 'fallback', retry: false, fallback: true },
    { provider: 'fallback', retry: true, fallback: true },
  ]);
});

test('Marketplace runtime counts a web3 retry as another attempt in the same logical operation', async () => {
  const harness = createHarness({
    status: { providers: { main: { url: 'https://main.invalid' }, fallback: {} } },
  });
  const { snapshot } = await runLogicalCall(harness, { useRpcLimiter: true }, 'retry');

  assert.equal(snapshot.totals.logicalOperations, 1);
  assert.equal(snapshot.totals.rpcAttempts, 2);
  assert.equal(snapshot.totals.retries, 1);
  assert.equal(snapshot.totals.fallbackCalls, 0);
});

test('Marketplace runtime does not count limiter rejection as an HTTP attempt', async () => {
  let fetchCalls = 0;
  const harness = createHarness({
    status: { providers: { main: { url: 'https://main.invalid' }, fallback: {} } },
    acquireRpcSlot: async () => { throw new Error('limiter rejected'); },
    platformFetch: async () => { fetchCalls += 1; },
  });
  const telemetry = createMarketplaceRpcTelemetry({ runId: 'limiter-failure' });
  const instrumentation = createMarketplaceRpcInstrumentation(telemetry);
  const connection = harness.createSolanaConnection({ useRpcLimiter: true }, { instrumentation });
  const wrapped = wrapMarketplaceConnection(connection, { instrumentation, operation: 'GM' });

  await assert.rejects(wrapped.getAccountInfo(), /limiter rejected/);
  const snapshot = telemetry.finish();
  assert.equal(snapshot.totals.logicalOperations, 1);
  assert.equal(snapshot.totals.rpcAttempts, 0);
  assert.equal(fetchCalls, 0);
});

test('Marketplace sync failure IPC result carries the sealed telemetry snapshot', () => {
  assert.match(main, /marketplaceRpcTelemetry: error\?\.marketplaceRpcTelemetry \|\| null/);
  assert.match(main, /const marketplaceRpcTelemetry = telemetry\.finish\(\)/);
  assert.match(main, /telemetryAttached = error\.marketplaceRpcTelemetry === marketplaceRpcTelemetry/);
  assert.match(main, /wrapped\.marketplaceRpcTelemetry = marketplaceRpcTelemetry/);
});
