'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(repoRoot, 'electron', 'preload.js'), 'utf8');

function browserWindowWebPreferencesSource() {
  const match = mainSource.match(/new BrowserWindow\(\{[\s\S]*?webPreferences:\s*\{([\s\S]*?)\n\s*\},\n\s*\}\)/);
  assert.ok(match, 'BrowserWindow webPreferences block should be present');
  return match[1];
}

test('BrowserWindow enables local preload imports without weakening renderer isolation', () => {
  const webPreferences = browserWindowWebPreferencesSource();
  assert.match(webPreferences, /\bpreload:\s*path\.join\(__dirname, 'preload\.js'\)/);
  assert.match(webPreferences, /\bcontextIsolation:\s*true\b/);
  assert.match(webPreferences, /\bnodeIntegration:\s*false\b/);
  assert.match(webPreferences, /\bsandbox:\s*false\b/);
});

test('preload completes local helper imports and exposes the required API exactly once', () => {
  const localImports = [];
  const exposures = [];
  const context = {
    console,
    require(id) {
      if (id === 'electron') {
        return {
          contextBridge: {
            exposeInMainWorld(name, api) {
              exposures.push({ name, api });
            },
          },
          ipcRenderer: {
            invoke() {
              return Promise.resolve(null);
            },
          },
        };
      }
      if (id === './earnings-cache-key') {
        localImports.push(id);
        return require('../electron/earnings-cache-key');
      }
      if (id === './earnings-cache-state') {
        localImports.push(id);
        return require('../electron/earnings-cache-state');
      }
      throw new Error(`Unexpected preload import: ${id}`);
    },
  };

  assert.doesNotThrow(() => vm.runInNewContext(preloadSource, context, { filename: 'preload.js' }));
  assert.deepEqual(localImports, ['./earnings-cache-key', './earnings-cache-state']);
  assert.equal(exposures.length, 1);
  assert.equal(exposures[0].name, 'myStarAtlas');
  for (const method of [
    'getAppVersion',
    'getSettings',
    'saveSettings',
    'checkForUpdates',
    'downloadUpdateAndRestart',
  ]) {
    assert.equal(typeof exposures[0].api[method], 'function', `${method} should be exposed`);
  }
});
