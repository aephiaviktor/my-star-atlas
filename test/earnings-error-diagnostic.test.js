'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEarningsErrorDiagnostic } = require('../electron/earnings-error-diagnostic');

function failingError() {
  const error = new Error('fetch https://secret.example/api?token=super-secret-token Authorization: Bearer abcdefghijklmnopqrstuvwxyz player 9xQeWvG816bUx9EPfEZ5SvvWk9ZCwT');
  error.code = 'ECONNRESET';
  error.stack = `${error.name}: ${error.message}\n    at fetchSnapshot (C:/Apps/my-star-atlas/electron/main.js:42:1)`;
  return error;
}

test('records the first failing category in one bounded redacted atomic envelope', async () => {
  const writes = [];
  const diagnostic = createEarningsErrorDiagnostic({
    filePath: '/tmp/latest-earnings-error.json',
    appVersion: '0.6.156',
    writeAtomic: async (filePath, value) => writes.push({ filePath, value }),
    now: () => new Date('2026-08-11T15:00:00.000Z'),
    maxBytes: 4096,
  });
  const categories = {
    Scanning: { status: 'fulfilled' },
    Mining: { status: 'rejected', error: failingError() },
    Cargo: { status: 'pending' }, Crafting: { status: 'pending' }, Upgrading: { status: 'pending' },
  };
  const record = await diagnostic.record({ correlationId: 'earnings-123', channel: 'earnings:snapshot', faction: 'MUD', stage: 'category_collection', categories, error: failingError() });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filePath, '/tmp/latest-earnings-error.json');
  assert.equal(record.failingCategory, 'Mining');
  assert.equal(record.categories.Mining.status, 'rejected');
  assert.equal(record.error.code, 'ECONNRESET');
  assert.ok(Buffer.byteLength(`${JSON.stringify(record, null, 2)}\n`) <= 4096);
  const serialized = JSON.stringify(record);
  for (const secret of ['secret.example', 'super-secret-token', 'Authorization', 'abcdefghijklmnopqrstuvwxyz', '9xQeWvG816bUx9EPfEZ5SvvWk9ZCwT']) assert.doesNotMatch(serialized, new RegExp(secret));
});

test('successful refreshes perform no diagnostic write and preserve their value', async () => {
  let writes = 0;
  const diagnostic = createEarningsErrorDiagnostic({ filePath: '/tmp/x', appVersion: '0.6.156', writeAtomic: async () => { writes += 1; } });
  const value = { ok: true, scanningRows: [{ value: 7 }] };
  assert.strictEqual(await diagnostic.run({ correlationId: 'ok', channel: 'earnings:snapshot', faction: 'ONI' }, async () => value), value);
  assert.equal(writes, 0);
});

test('failed execution preserves the original thrown error after recording', async () => {
  const writes = [];
  const diagnostic = createEarningsErrorDiagnostic({ filePath: '/tmp/x', appVersion: '0.6.156', writeAtomic: async (_path, value) => writes.push(value) });
  const original = failingError();
  await assert.rejects(diagnostic.run({ correlationId: 'x', channel: 'earnings:snapshot', faction: 'USTUR', categories: {} }, async () => { throw original; }), (error) => error === original);
  assert.equal(writes.length, 1);
});

test('diagnostic write failure preserves the original application error', async () => {
  const diagnostic = createEarningsErrorDiagnostic({ filePath: '/tmp/x', appVersion: '0.6.156', writeAtomic: async () => { throw new Error('disk full'); } });
  const original = failingError();
  await assert.rejects((async () => {
    try { await diagnostic.run({ correlationId: 'x', channel: 'earnings:snapshot', faction: 'MUD' }, async () => { throw original; }); }
    catch (error) { if (error !== original) throw error; throw error; }
  })(), (error) => error === original);
});

test('main and renderer boundaries can persist independently without overwriting', async () => {
  const writes = [];
  const make = (filePath) => createEarningsErrorDiagnostic({ filePath, appVersion: '0.6.156', writeAtomic: async (path, value) => writes.push({ path, value }) });
  await make('/tmp/latest-earnings-error.json').record({ boundary: 'main', source: 'fetchEarningsSnapshot', error: failingError() });
  await make('/tmp/latest-earnings-renderer-error.json').record({ boundary: 'renderer', source: 'refreshEarnings', error: failingError() });
  assert.deepEqual(writes.map((entry) => entry.path), ['/tmp/latest-earnings-error.json', '/tmp/latest-earnings-renderer-error.json']);
  assert.deepEqual(writes.map((entry) => entry.value.boundary), ['main', 'renderer']);
});
