const fs = require('node:fs/promises');
const { writeJsonAtomic } = require('./atomic-json');

const STORE_VERSION = 1;

function createSecureSettingsStore({ filePath, encryptString, decryptString }) {
  async function readDocument() {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (parsed?.version !== STORE_VERSION || !parsed.values || typeof parsed.values !== 'object') {
        throw new Error('Unsupported secure settings format.');
      }
      return parsed;
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: STORE_VERSION, values: {} };
      throw error;
    }
  }

  async function read() {
    const document = await readDocument();
    const values = {};
    let changed = false;
    for (const [key, encoded] of Object.entries(document.values)) {
      const decrypted = await decryptString(Buffer.from(String(encoded), 'base64'));
      values[key] = typeof decrypted === 'string' ? decrypted : decrypted.result;
      if (decrypted?.shouldReEncrypt) {
        document.values[key] = (await encryptString(values[key])).toString('base64');
        changed = true;
      }
    }
    if (changed) await writeJsonAtomic(filePath, document);
    return values;
  }

  async function update(patch) {
    const document = await readDocument();
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete document.values[key];
      else if (String(value).trim()) document.values[key] = (await encryptString(String(value))).toString('base64');
    }
    await writeJsonAtomic(filePath, document);
    return read();
  }

  return { read, update };
}

module.exports = { createSecureSettingsStore };
