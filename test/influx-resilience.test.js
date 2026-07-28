const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAsyncTtlCache,
  fetchWithInfluxRetry,
  loadSduSources,
} = require('../electron/influx-resilience');


test('createAsyncTtlCache deduplicates concurrent loads and reuses a fresh result', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = createAsyncTtlCache({ ttlMs: 1_000 });
  const loader = async () => {
    calls += 1;
    await gate;
    return { total: 42 };
  };

  const first = cache.get('USTUR', loader);
  const second = cache.get('USTUR', loader);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, { total: 42 });
  assert.deepEqual(await second, { total: 42 });
  assert.deepEqual(await cache.get('USTUR', loader), { total: 42 });
  assert.equal(calls, 1);
});

test('createAsyncTtlCache reloads expired results', async () => {
  let now = 100;
  let calls = 0;
  const cache = createAsyncTtlCache({ ttlMs: 50, now: () => now });
  const loader = async () => ({ call: ++calls });

  assert.deepEqual(await cache.get('MUD', loader), { call: 1 });
  now = 151;
  assert.deepEqual(await cache.get('MUD', loader), { call: 2 });
});

test('loadSduSources starts production and consumption concurrently', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = [];

  const pending = loadSduSources({
    production: async () => { started.push('production'); await gate; return 'production'; },
    consumption: async () => { started.push('consumption'); await gate; return 'consumption'; },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), ['consumption', 'production']);
  release();
  const result = await pending;
  assert.equal(result.production.value, 'production');
  assert.equal(result.consumption.value, 'consumption');
});

test('loadSduSources preserves production when consumption fails', async () => {
  const result = await loadSduSources({
    production: async () => ({ total: 42 }),
    consumption: async () => { throw new Error('influx_flux_503'); },
  });

  assert.equal(result.production.ok, true);
  assert.deepEqual(result.production.value, { total: 42 });
  assert.equal(result.consumption.ok, false);
  assert.match(result.consumption.error, /503/);
});

test('fetchWithInfluxRetry retries one transient 503 response', async () => {
  let calls = 0;
  const response = await fetchWithInfluxRetry(async () => {
    calls += 1;
    return { ok: calls > 1, status: calls > 1 ? 200 : 503 };
  }, { retries: 1, retryDelayMs: 0, timeoutMs: 100 });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('fetchWithInfluxRetry does not retry authentication failures', async () => {
  let calls = 0;
  const response = await fetchWithInfluxRetry(async () => {
    calls += 1;
    return { ok: false, status: 401 };
  }, { retries: 1, retryDelayMs: 0, timeoutMs: 100 });

  assert.equal(response.status, 401);
  assert.equal(calls, 1);
});

test('fetchWithInfluxRetry retries one timeout and then succeeds', async () => {
  let calls = 0;
  const response = await fetchWithInfluxRetry(async ({ signal }) => {
    calls += 1;
    if (calls === 1) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      });
    }
    return { ok: true, status: 200 };
  }, { retries: 1, retryDelayMs: 0, timeoutMs: 10 });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});
