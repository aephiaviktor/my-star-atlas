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

test('faction switching preserves secure-setting readiness', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  assert.match(renderer, /secureSettingsStatus: latestSettings\?\.secureSettingsStatus \|\| \{\}/);
  assert.match(renderer, /setFormValues\(saved\);\s*updateSettingsStatus\(saved\);/);
});

test('RPC limiter UI exposes only the current provider URLs through the blur control', async () => {
  const html = await fs.readFile(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
  const main = await fs.readFile(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const renderer = await fs.readFile(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  const css = await fs.readFile(path.join(__dirname, '..', 'electron', 'renderer.css'), 'utf8');
  assert.match(html, /class="sensitive-field" id="rpc-limiter-main-url"/);
  assert.match(html, /class="sensitive-field" id="rpc-limiter-fallback-url"/);
  assert.doesNotMatch(html, /class="sensitive-field" name="aephiaApiKey"/);
  assert.doesNotMatch(html, /class="sensitive-field" name="influxAuthToken"/);
  assert.doesNotMatch(html, /class="sensitive-field" name="rpcUrl"/);
  assert.match(main, /sharedRpcLimiter\.wait\('rpc:shared'/);
  assert.match(main, /fetch: telemetryFetchFactory\(fetch, \{/);
  assert.match(main, /no RPC Limiter URLs are configured/);
  assert.match(renderer, /providerRole: data\.get\('providerRole'\) \? 'fallback' : 'main'/);
  assert.match(main, /const role = payload\.providerRole === 'fallback' \? 'fallback' : 'main';/);
  assert.doesNotMatch(main, /parseBooleanSetting\(payload\.providerRole\)/);
  assert.match(main, /state\.providers\[role\] = \{/);
  assert.match(main, /const replacementRpcUrl = String\(payload\.rpcUrl \|\| ''\)\.trim\(\);/);
  assert.match(main, /if \(!replacementRpcUrl\) \{\s*state\.providers\[role\] = \{\};/);
  assert.match(main, /if \(role === 'main'\) \{\s*delete state\.rpcBaseUrl;\s*delete state\.apiKey;/);
  assert.match(main, /state\.enabled = Boolean\(state\.providers\.main\?\.rpcBaseUrl \|\| state\.providers\.fallback\?\.rpcBaseUrl\);/);
  assert.match(main, /if \(replacementRpcUrl\) \{\s*parsedProvider = parseRpcUrlForLimiter\(replacementRpcUrl\);[\s\S]*?Requests \/ sec must be a positive number/);
  assert.match(main, /if \(!replacementRpcUrl\) \{[\s\S]*?state\.providers\[role\] = \{\};[\s\S]*?\} else \{[\s\S]*?state\.buckets\['rpc:shared'\] = \{/);
  assert.match(main, /channel === 'settings:save' \|\| channel === 'rpc-limiter:send-settings'/);
  assert.match(main, /handleTrustedIpc\('rpc-limiter:send-settings', async \(_event, payload\) => sendSettingsToRpcLimiter\(payload\)\);/);
  assert.match(html, /Leave the URL empty to clear the selected Main or Fallback slot\./);
  assert.match(renderer, /const rpcLimiterSlot = payload\.providerRole === 'fallback' \? 'Fallback' : 'Main';/);
  assert.match(renderer, /const rpcLimiterAction = String\(payload\.rpcUrl \|\| ''\)\.trim\(\) \? 'updated' : 'cleared';/);
  assert.match(renderer, /`RPC limiter \$\{rpcLimiterSlot\} slot \$\{rpcLimiterAction\}`/);
  assert.doesNotMatch(css, /sensitive-hidden \.sensitive-field:focus/);
  const telemetryFiles = await Promise.all([
    'telemetry-context.js', 'telemetry-ledger.js', 'telemetry-rpc-fetch.js', 'telemetry-reporter.js',
  ].map((name) => fs.readFile(path.join(__dirname, '..', 'electron', name), 'utf8')));
  const persistedSchema = telemetryFiles.join('\n');
  assert.doesNotMatch(persistedSchema, /dimensions\.(?:url|apiKey|headers|body|params|response|wallet|username|hostname)/i);
  assert.doesNotMatch(persistedSchema, /context\.(?:url|apiKey|headers|body|params|response|wallet)/i);
});
