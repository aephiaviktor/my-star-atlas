const test = require('node:test');
const assert = require('node:assert/strict');

const { isWindowsUpdatePlatform, performMacUpdateAction, DEFAULT_RELEASES_URL } = require('../electron/mac-update');

test('Electron is a development-only dependency so electron-builder can package the app', () => {
  const packageJson = require('../package.json');

  assert.equal(packageJson.dependencies?.electron, undefined);
  assert.match(packageJson.devDependencies?.electron || '', /^\^\d+\.\d+\.\d+$/);
});

test('only win32 is treated as the Windows PowerShell/Scheduled Task updater platform', () => {
  assert.equal(isWindowsUpdatePlatform('win32'), true);
  assert.equal(isWindowsUpdatePlatform('darwin'), false);
  assert.equal(isWindowsUpdatePlatform('linux'), false);
  assert.equal(isWindowsUpdatePlatform(undefined), false);
});

test('macOS update action opens the GitHub Releases page and never touches the Windows path', async () => {
  const opened = [];
  const result = await performMacUpdateAction({ openExternal: async (url) => { opened.push(url); } });

  assert.deepEqual(opened, [DEFAULT_RELEASES_URL]);
  assert.deepEqual(result, {
    updated: false,
    platform: 'darwin',
    opened: true,
    releasesUrl: DEFAULT_RELEASES_URL,
  });
});

test('macOS update action supports an overridden releases URL', async () => {
  const opened = [];
  const result = await performMacUpdateAction({
    openExternal: async (url) => { opened.push(url); },
    releasesUrl: 'https://example.invalid/releases/latest',
  });

  assert.deepEqual(opened, ['https://example.invalid/releases/latest']);
  assert.equal(result.releasesUrl, 'https://example.invalid/releases/latest');
});

test('macOS update action rejects without a valid openExternal function, so it can never silently no-op', async () => {
  await assert.rejects(() => performMacUpdateAction({}), /openExternal/);
});

test('the updates:download-and-restart IPC handler in main.js routes by isWindowsUpdatePlatform, never by its own copy of the check', () => {
  // This is a structural guard against regressions where main.js grows a
  // second, divergent platform check for the update path instead of
  // reusing the single source of truth in electron/mac-update.js.
  const fs = require('node:fs');
  const path = require('node:path');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

  const handlerMatch = mainSource.match(/handleTrustedIpc\('updates:download-and-restart',[\s\S]*?\)\);\n/);
  assert.ok(handlerMatch, 'expected to find the updates:download-and-restart IPC handler in main.js');
  assert.match(handlerMatch[0], /isWindowsUpdatePlatform\(process\.platform\)/);
  assert.match(handlerMatch[0], /downloadUpdateAndRestart\(\)/);
  assert.match(handlerMatch[0], /performMacUpdateAction\(/);
  assert.doesNotMatch(handlerMatch[0], /powershell|schtasks|restart-helper/i);
});
