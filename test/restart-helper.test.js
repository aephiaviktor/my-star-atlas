const test = require('node:test');
const assert = require('node:assert/strict');

const { launchAfterParentExits } = require('../electron/restart-helper');

test('restart helper waits for the parent to exit before launching Electron', async () => {
  const events = [];
  let checks = 0;
  const launched = await launchAfterParentExits({
    parentPid: 123,
    electronPath: 'electron.exe',
    appRoot: 'C:\\Apps\\my-star-atlas',
    profile: 'USTUR',
    pollIntervalMs: 0,
    maxWaitMs: 100,
    isProcessRunning: () => {
      checks += 1;
      events.push(`check:${checks}`);
      return checks < 3;
    },
    spawnProcess: (file, args, options) => {
      events.push('spawn');
      assert.equal(file, 'electron.exe');
      assert.deepEqual(args, ['C:\\Apps\\my-star-atlas', '--profile', 'USTUR']);
      assert.equal(options.detached, true);
      return { unref() { events.push('unref'); } };
    },
  });

  assert.equal(launched, true);
  assert.deepEqual(events, ['check:1', 'check:2', 'check:3', 'spawn', 'unref']);
});

test('restart helper refuses to launch while the parent remains alive', async () => {
  let spawned = false;
  const launched = await launchAfterParentExits({
    parentPid: 123,
    electronPath: 'electron.exe',
    appRoot: 'C:\\Apps\\my-star-atlas',
    profile: 'USTUR',
    pollIntervalMs: 1,
    maxWaitMs: 3,
    isProcessRunning: () => true,
    spawnProcess: () => { spawned = true; },
  });

  assert.equal(launched, false);
  assert.equal(spawned, false);
});
