const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSecureSettingsStore } = require('../electron/secure-settings');

function makeStore(filePath) {
  return createSecureSettingsStore({
    filePath,
    encryptString: async (value) => Buffer.from(`encrypted:${value}`),
    decryptString: async (value) => ({ result: value.toString().replace(/^encrypted:/, ''), shouldReEncrypt: false }),
  });
}

test('secure settings persist encrypted base64 and decrypt on read', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-secure-settings-'));
  const filePath = path.join(dir, 'secure-settings.json');
  const store = makeStore(filePath);

  await store.update({ aephiaApiKey: 'aephia-secret', influxAuthToken: 'influx-secret', rpcUrl: 'https://rpc.invalid/?api-key=rpc-secret' });
  const raw = await fs.readFile(filePath, 'utf8');
  assert.doesNotMatch(raw, /aephia-secret|influx-secret|rpc-secret/);
  assert.deepEqual(await store.read(), {
    aephiaApiKey: 'aephia-secret',
    influxAuthToken: 'influx-secret',
    rpcUrl: 'https://rpc.invalid/?api-key=rpc-secret',
  });
  await fs.rm(dir, { recursive: true, force: true });
});

test('blank secure-setting updates preserve existing values', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-secure-settings-'));
  const store = makeStore(path.join(dir, 'secure-settings.json'));
  await store.update({ aephiaApiKey: 'kept', influxAuthToken: 'also-kept' });
  await store.update({ aephiaApiKey: '', influxAuthToken: '' });
  assert.deepEqual(await store.read(), { aephiaApiKey: 'kept', influxAuthToken: 'also-kept' });
  await fs.rm(dir, { recursive: true, force: true });
});
