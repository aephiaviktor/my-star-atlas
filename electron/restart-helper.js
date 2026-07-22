const { spawn } = require('child_process');

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
  const [, , parentPidRaw, taskName, appName, expectedVersion, appRoot, verifierPath, logPath] = process.argv;
  const parentPid = Number.parseInt(parentPidRaw, 10);
  if (!Number.isInteger(parentPid) || !taskName || !appName || !expectedVersion || !appRoot || !verifierPath || !logPath) {
    process.exit(2);
  }
  const launched = await launchAfterParentExits({
    parentPid,
    taskName,
    appName,
    expectedVersion,
    appRoot,
    verifierPath,
    logPath,
  });
  process.exit(launched ? 0 : 3);
}

if (require.main === module) {
  void main().catch(() => process.exit(1));
}

module.exports = { launchAfterParentExits, launchVerifier, runScheduledTask };
