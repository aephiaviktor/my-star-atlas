const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('sensitive settings stay in OS safe storage and are redacted from renderer IPC', async () => {
  const main = await fs.readFile(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const renderer = await fs.readFile(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  assert.match(main, /safeStorage\.isEncryptionAvailable\(\)/);
  assert.match(main, /SECRET_SETTING_KEYS = Object\.freeze\(\['aephiaApiKey', 'influxAuthToken', 'rpcUrl'\]\)/);
  assert.match(main, /redacted\[key\] = ''/);
  assert.match(main, /delete storedSettings\[key\]/);
  assert.match(renderer, /Stored securely — enter a new value to replace/);
});

test('settings always reopen with the revealable field hidden', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  assert.match(renderer, /function openSettings\(\) \{\s*form\.classList\.add\('sensitive-hidden'\)/);
});

test('RPC limiter UI exposes only the current shared URL through the blur control', async () => {
  const html = await fs.readFile(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
  const main = await fs.readFile(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const css = await fs.readFile(path.join(__dirname, '..', 'electron', 'renderer.css'), 'utf8');
  assert.match(html, /class="sensitive-field" id="rpc-limiter-current-url"/);
  assert.doesNotMatch(html, /class="sensitive-field" name="aephiaApiKey"/);
  assert.doesNotMatch(html, /class="sensitive-field" name="influxAuthToken"/);
  assert.doesNotMatch(html, /class="sensitive-field" name="rpcUrl"/);
  assert.match(main, /sharedRpcLimiter\.wait\('rpc:shared'/);
  assert.match(main, /fetch: async \(info, init\)/);
  assert.match(main, /no Current RPC Limiter URL is configured/);
  assert.doesNotMatch(css, /sensitive-hidden \.sensitive-field:focus/);
});
