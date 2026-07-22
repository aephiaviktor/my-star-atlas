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

async function getScheduledTaskState(taskName, spawnProcess = spawn) {
  const child = spawnProcess(
    'powershell.exe',
    ['-NoProfile', '-Command', '[int](Get-ScheduledTask -TaskName $env:MSA_RESTART_TASK).State'],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, MSA_RESTART_TASK: taskName },
    }
  );
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  const succeeded = await waitForExit(child);
  return succeeded ? Number.parseInt(output.trim(), 10) : null;
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
    taskPollIntervalMs = 250,
    taskReadyWaitMs = 30_000,
    isProcessRunning: processProbe = isProcessRunning,
    getScheduledTaskState: readTaskState = getScheduledTaskState,
    runScheduledTask: startTask = runScheduledTask,
    launchVerifier: startVerifier = launchVerifier,
  } = options;
  const deadline = Date.now() + maxWaitMs;

  while (processProbe(parentPid)) {
    if (Date.now() >= deadline) return false;
    await sleep(pollIntervalMs);
  }

  // A /Run request issued while the existing scheduled task is still Running
  // is accepted but does not queue another instance. Wait for the supervisor
  // wrapper itself to become Ready before requesting the replacement.
  const taskDeadline = Date.now() + taskReadyWaitMs;
  while (await readTaskState(taskName) !== 3) {
    if (Date.now() >= taskDeadline) return false;
    await sleep(taskPollIntervalMs);
  }
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

module.exports = {
  getScheduledTaskState,
  launchAfterParentExits,
  launchVerifier,
  parseRestartArguments,
  runScheduledTask,
};
