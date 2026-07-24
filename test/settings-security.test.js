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
