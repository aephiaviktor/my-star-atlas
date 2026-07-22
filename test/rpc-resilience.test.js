const test = require('node:test');
const assert = require('node:assert/strict');
const { createRpcFetcher, createRpcRateGate } = require('../electron/rpc-resilience');

test('RPC fetch retries a transient thrown network error', async () => {
  let calls = 0;
  const fetchRpc = createRpcFetcher({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return { ok: true, status: 200 };
    },
    sleep: async () => {},
    random: () => 0,
    maxAttempts: 3,
    logger: { warn() {} },
  });

  const response = await fetchRpc('https://rpc.test', {}, { logLabel: 'test' });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('RPC fetch does not retry an aborted request', async () => {
  let calls = 0;
  const fetchRpc = createRpcFetcher({
    fetchImpl: async () => {
      calls += 1;
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    },
    sleep: async () => {},
    logger: { warn() {} },
  });

  await assert.rejects(fetchRpc('https://rpc.test', {}, { logLabel: 'test' }), /aborted/);
  assert.equal(calls, 1);
});

test('RPC rate gate serializes concurrent slot acquisition', async () => {
  let now = 0;
  const starts = [];
  const gate = createRpcRateGate({
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  const settings = { useRpcLimiter: true, rpcRequestsPerSecond: '2' };

  await Promise.all([
    gate.acquire(settings).then(() => starts.push(now)),
    gate.acquire(settings).then(() => starts.push(now)),
    gate.acquire(settings).then(() => starts.push(now)),
  ]);

  assert.deepEqual(starts, [0, 500, 1000]);
});
