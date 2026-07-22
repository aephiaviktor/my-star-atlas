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

async function launchAfterParentExits(options) {
  const {
    parentPid,
    electronPath,
    appRoot,
    profile,
    pollIntervalMs = 250,
    maxWaitMs = 30_000,
    isProcessRunning: processProbe = isProcessRunning,
    spawnProcess = spawn,
  } = options;
  const deadline = Date.now() + maxWaitMs;

  while (processProbe(parentPid)) {
    if (Date.now() >= deadline) return false;
    await sleep(pollIntervalMs);
  }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnProcess(electronPath, [appRoot, '--profile', profile], {
    cwd: appRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env,
  });
  child.unref();
  return true;
}

async function main() {
  const [, , parentPidRaw, electronPath, appRoot, profile] = process.argv;
  const parentPid = Number.parseInt(parentPidRaw, 10);
  if (!Number.isInteger(parentPid) || !electronPath || !appRoot || !profile) process.exit(2);
  const launched = await launchAfterParentExits({ parentPid, electronPath, appRoot, profile });
  process.exit(launched ? 0 : 3);
}

if (require.main === module) {
  void main().catch(() => process.exit(1));
}

module.exports = { launchAfterParentExits };
