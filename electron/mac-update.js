'use strict';

// macOS has no access to the Windows updater: no PowerShell, no
// schtasks.exe, no Scheduled Task, no copying source files into the app
// bundle, no `npm install`, no restart-helper.js. For v1 of macOS support,
// the safe "Update" action simply opens the GitHub Releases page so the
// user can download the latest macOS build themselves. A native
// self-updater for macOS can be a later, independent task.
const DEFAULT_RELEASES_URL = 'https://github.com/aephiaviktor/my-star-atlas/releases/latest';

// The only platform allowed to run the existing PowerShell/Scheduled Task
// updater (downloadUpdateAndRestart in main.js). Every other platform,
// including macOS, must go through performMacUpdateAction instead.
function isWindowsUpdatePlatform(platform) {
  return platform === 'win32';
}

async function performMacUpdateAction({ openExternal, releasesUrl = DEFAULT_RELEASES_URL }) {
  if (typeof openExternal !== 'function') {
    throw new Error('performMacUpdateAction requires an openExternal function.');
  }
  await openExternal(releasesUrl);
  return { updated: false, platform: 'darwin', opened: true, releasesUrl };
}

module.exports = {
  DEFAULT_RELEASES_URL,
  isWindowsUpdatePlatform,
  performMacUpdateAction,
};
