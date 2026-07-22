const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function writeJsonAtomic(targetPath, value, hooks = {}) {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  const content = `${JSON.stringify(value, null, 2)}\n`;

  await fs.mkdir(directory, { recursive: true });
  try {
    const file = await fs.open(temporaryPath, 'wx', 0o600);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    if (hooks.beforeRename) await hooks.beforeRename(temporaryPath, targetPath);
    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

module.exports = { writeJsonAtomic };
