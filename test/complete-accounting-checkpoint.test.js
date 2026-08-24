'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { loadCompleteAccountingCheckpoint, mergeCompleteAccountingEvents, saveCompleteAccountingCheckpoint } = require('../electron/complete-accounting-checkpoint');

test('complete accounting event journal survives restart and preserves immutable conflicts for quarantine', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-complete-accounting-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'checkpoint.json');
  const scope = { faction: 'USTUR', profile: 'p' };
  const first = { eventId: 'trade:1', timestamp: '2026-01-01T00:00:00.000Z', type: 'opening', asset: 'Ore', location: 'S1', quantity: '1', basis: null };
  const conflict = { ...first, quantity: '2' };
  assert.equal((await loadCompleteAccountingCheckpoint(filePath, scope)).status, 'missing');
  const events = mergeCompleteAccountingEvents([first], [first, conflict]);
  assert.equal(events.length, 2);
  await saveCompleteAccountingCheckpoint(filePath, { scope, events });
  const loaded = await loadCompleteAccountingCheckpoint(filePath, scope);
  assert.equal(loaded.status, 'loaded');
  assert.deepEqual(loaded.events, events);
  assert.equal(mergeCompleteAccountingEvents(loaded.events, [first]).length, 2);
});
