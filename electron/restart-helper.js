const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseRestartArguments(argv, options = {}) {
  const args = argv.slice(2);
  const parentPid = Number.parseInt(args[0], 10);
  if (!Number.isInteger(parentPid)) return null;

  if (args.length >= 7) {
    const [, taskName, appName, expectedVersion, appRoot, verifierPath, logPath] = args;
    if (!taskName || !appName || !expectedVersion || !appRoot || !verifierPath || !logPath) return null;
    return { parentPid, taskName, appName, expectedVersion, appRoot, verifierPath, logPath };
  }

  // Legacy 0.5.88/0.5.89 contract:
  // parentPid, electronPath, appRoot, profile. The updater overwrites this
  // helper before invoking it, so a new helper must remain able to accept
  // the previous caller's argument shape during the transition.
  if (args.length === 4) {
    const [, _electronPath, appRoot] = args;
    if (!appRoot) return null;
    const readVersion = options.readVersion || (() => {
      const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
      return String(packageJson.version || '');
    });
    const expectedVersion = readVersion();
    const localAppData = options.localAppData || process.env.LOCALAPPDATA;
    if (!expectedVersion || !localAppData) return null;
    return {
      parentPid,
      taskName: 'My Star Atlas',
      appName: 'My Star Atlas',
      expectedVersion,
      appRoot,
      verifierPath: path.win32.join(appRoot, 'electron', 'restart-status.ps1'),
      logPath: path.win32.join(localAppData, 'MyStarAtlas', 'logs', 'supervisor.log'),
    };
  }

  return null;
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

async function runScheduledTask(taskName, spawnProcess = spawn) {
  const child = spawnProcess('schtasks.exe', ['/Run', '/TN', taskName], {
    windowsHide: true,
    stdio: 'ignore',
  });
  return waitForExit(child);
}

function launchVerifier(options, spawnProcess = spawn) {
  const child = spawnProcess(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', options.verifierPath,
      '-AppName', options.appName,
      '-ExpectedVersion', options.expectedVersion,
      '-AppRoot', options.appRoot,
      '-TaskName', options.taskName,
      '-LogPath', options.logPath,
    ],
    {
      cwd: options.appRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }
  );
  child.unref();
}

async function launchAfterParentExits(options) {
  const {
    parentPid,
    taskName,
    pollIntervalMs = 250,
    maxWaitMs = 30_000,
    supervisorSettleMs = 1000,
    isProcessRunning: processProbe = isProcessRunning,
    runScheduledTask: startTask = runScheduledTask,
    launchVerifier: startVerifier = launchVerifier,
  } = options;
  const deadline = Date.now() + maxWaitMs;

  while (processProbe(parentPid)) {
    if (Date.now() >= deadline) return false;
    await sleep(pollIntervalMs);
  }

  // The scheduled-task wrapper may still be unwinding after Electron exits.
  // Give it a moment to become runnable before requesting the new instance.
  await sleep(supervisorSettleMs);
  if (!await startTask(taskName)) return false;
  startVerifier(options);
  return true;
}

async function main() {
  const restartOptions = parseRestartArguments(process.argv);
  if (!restartOptions) process.exit(2);
  const launched = await launchAfterParentExits(restartOptions);
  process.exit(launched ? 0 : 3);
}

if (require.main === module) {
  void main().catch(() => process.exit(1));
}

module.exports = { launchAfterParentExits, launchVerifier, parseRestartArguments, runScheduledTask };
