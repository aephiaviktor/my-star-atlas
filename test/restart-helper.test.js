const test = require('node:test');
const assert = require('node:assert/strict');

const { launchAfterParentExits } = require('../electron/restart-helper');

test('restart helper waits for the parent, starts the scheduled task, then launches the verifier', async () => {
  const events = [];
  let checks = 0;
  const launched = await launchAfterParentExits({
    parentPid: 123,
    taskName: 'My Star Atlas',
    appName: 'My Star Atlas',
    expectedVersion: '0.5.90',
    appRoot: 'C:\\Apps\\my-star-atlas',
    logPath: 'C:\\logs\\supervisor.log',
    verifierPath: 'C:\\Apps\\my-star-atlas\\electron\\restart-status.ps1',
    pollIntervalMs: 0,
    maxWaitMs: 100,
    supervisorSettleMs: 0,
    isProcessRunning: () => {
      checks += 1;
      events.push(`check:${checks}`);
      return checks < 3;
    },
    runScheduledTask: async (taskName) => {
      events.push(`task:${taskName}`);
      return true;
    },
    launchVerifier: (options) => {
      events.push(`verify:${options.expectedVersion}`);
      assert.equal(options.taskName, 'My Star Atlas');
      assert.equal(options.appRoot, 'C:\\Apps\\my-star-atlas');
    },
  });

  assert.equal(launched, true);
  assert.deepEqual(events, ['check:1', 'check:2', 'check:3', 'task:My Star Atlas', 'verify:0.5.90']);
});

test('restart helper refuses to restart while the parent remains alive', async () => {
  let taskStarted = false;
  const launched = await launchAfterParentExits({
    parentPid: 123,
    taskName: 'My Star Atlas',
    pollIntervalMs: 1,
    maxWaitMs: 3,
    supervisorSettleMs: 0,
    isProcessRunning: () => true,
    runScheduledTask: async () => { taskStarted = true; return true; },
    launchVerifier: () => {},
  });

  assert.equal(launched, false);
  assert.equal(taskStarted, false);
});

test('restart helper does not launch the verifier when the scheduled task fails', async () => {
  let verifierStarted = false;
  const launched = await launchAfterParentExits({
    parentPid: 123,
    taskName: 'My Star Atlas',
    supervisorSettleMs: 0,
    isProcessRunning: () => false,
    runScheduledTask: async () => false,
    launchVerifier: () => { verifierStarted = true; },
  });

  assert.equal(launched, false);
  assert.equal(verifierStarted, false);
});
