const test = require('node:test');
const assert = require('node:assert/strict');

const { launchAfterParentExits, parseRestartArguments } = require('../electron/restart-helper');


test('restart helper accepts the legacy updater argument contract', () => {
  const parsed = parseRestartArguments([
    'electron.exe',
    'restart-helper.js',
    '123',
    'C:\\Apps\\my-star-atlas\\node_modules\\electron\\dist\\electron.exe',
    'C:\\Apps\\my-star-atlas',
    'USTUR',
  ], {
    localAppData: 'C:\\Users\\Viktor\\AppData\\Local',
    readVersion: () => '0.5.91',
  });

  assert.deepEqual(parsed, {
    parentPid: 123,
    taskName: 'My Star Atlas',
    appName: 'My Star Atlas',
    expectedVersion: '0.5.91',
    appRoot: 'C:\\Apps\\my-star-atlas',
    verifierPath: 'C:\\Apps\\my-star-atlas\\electron\\restart-status.ps1',
    logPath: 'C:\\Users\\Viktor\\AppData\\Local\\MyStarAtlas\\logs\\supervisor.log',
  });
});

test('restart helper accepts the supervisor-aware argument contract', () => {
  const parsed = parseRestartArguments([
    'electron.exe', 'restart-helper.js', '123', 'My Star Atlas', 'My Star Atlas', '0.5.91',
    'C:\\Apps\\my-star-atlas', 'C:\\Apps\\my-star-atlas\\electron\\restart-status.ps1',
    'C:\\logs\\supervisor.log',
  ]);
  assert.equal(parsed.taskName, 'My Star Atlas');
  assert.equal(parsed.expectedVersion, '0.5.91');
  assert.equal(parsed.logPath, 'C:\\logs\\supervisor.log');
});

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
