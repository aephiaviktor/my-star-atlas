const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeJsonAtomic } = require('../electron/atomic-json');

test('atomic JSON write replaces the destination with complete parseable data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-settings-test-'));
  const target = path.join(dir, 'settings.json');
  try {
    await fs.writeFile(target, '{"old":true}\n');
    await writeJsonAtomic(target, { faction: 'MUD', token: 'secret' });
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { faction: 'MUD', token: 'secret' });
    assert.deepEqual((await fs.readdir(dir)).sort(), ['settings.json']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('failed atomic JSON write preserves the previous destination', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-settings-test-'));
  const target = path.join(dir, 'settings.json');
  try {
    await fs.writeFile(target, '{"old":true}\n');
    await assert.rejects(writeJsonAtomic(target, { next: true }, {
      beforeRename: async () => { throw new Error('simulated failure'); },
    }), /simulated failure/);
    assert.equal(await fs.readFile(target, 'utf8'), '{"old":true}\n');
    assert.deepEqual((await fs.readdir(dir)).sort(), ['settings.json']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
