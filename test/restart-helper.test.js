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

test('restart helper starts the scheduled task after it is Ready, then launches the verifier', async () => {
  const events = [];
  const launched = await launchAfterParentExits({
    parentPid: 123,
    taskName: 'My Star Atlas',
    appName: 'My Star Atlas',
    expectedVersion: '0.5.93',
    appRoot: 'C:\\Apps\\my-star-atlas',
    logPath: 'C:\\logs\\supervisor.log',
    verifierPath: 'C:\\Apps\\my-star-atlas\\electron\\restart-status.ps1',
    getScheduledTaskState: async () => 3,
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
  assert.deepEqual(events, ['task:My Star Atlas', 'verify:0.5.93']);
});

test('restart helper does not let a stale parent PID probe block task handoff', async () => {
  let taskStarted = false;
  const launched = await launchAfterParentExits({
    parentPid: 123,
    taskName: 'My Star Atlas',
    getScheduledTaskState: async () => 3,
    isProcessRunning: () => { throw new Error('parent probe must not be called'); },
    runScheduledTask: async () => { taskStarted = true; return true; },
    launchVerifier: () => {},
  });

  assert.equal(launched, true);
  assert.equal(taskStarted, true);
});

test('restart helper waits for the scheduled task to become Ready before requesting restart', async () => {
  const states = [4, 4, 3];
  const events = [];
  const launched = await launchAfterParentExits({
    parentPid: 123,
    taskName: 'My Star Atlas',
    taskPollIntervalMs: 0,
    taskReadyWaitMs: 100,
    isProcessRunning: () => false,
    getScheduledTaskState: async () => {
      const state = states.shift();
      events.push(`state:${state}`);
      return state;
    },
    runScheduledTask: async () => { events.push('run'); return true; },
    launchVerifier: () => { events.push('verify'); },
  });

  assert.equal(launched, true);
  assert.deepEqual(events, ['state:4', 'state:4', 'state:3', 'run', 'verify']);
});

test('restart helper does not launch the verifier when the scheduled task fails', async () => {
  let verifierStarted = false;
  const launched = await launchAfterParentExits({
    parentPid: 123,
    taskName: 'My Star Atlas',
    getScheduledTaskState: async () => 3,
    isProcessRunning: () => false,
    runScheduledTask: async () => false,
    launchVerifier: () => { verifierStarted = true; },
  });

  assert.equal(launched, false);
  assert.equal(verifierStarted, false);
});
