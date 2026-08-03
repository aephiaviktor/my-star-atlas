'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTelemetryLedger, ensureInstallation, writeAtomicDurable, pruneRetention, COMPLETED_RETENTION_DAYS, MAX_SNAPSHOTS } = require('../electron/telemetry-ledger');

async function temporary() { return fs.mkdtemp(path.join(os.tmpdir(), 'msa-telemetry-')); }

test('installation identity is random, stable and not path-derived', async (t) => {
  const root = await temporary(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await ensureInstallation(path.join(root, 'telemetry'));
  const second = await ensureInstallation(path.join(root, 'telemetry'));
  assert.match(first.installationId, /^[a-f0-9]{32}$/); assert.equal(second.installationId, first.installationId);
  assert.equal(JSON.stringify(first).includes(root), false);
});

test('concurrent flushes merge without losing counters and keep strict safe dimensions', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-08-03T10:15:20Z');
  const ledger = createTelemetryLedger({ userDataPath, profile: 'USTUR', now: () => now, flushIntervalMs: 0 });
  await ledger.start();
  for (let index = 0; index < 50; index += 1) ledger.record({ type: 'wire-start', at: now, context: { faction: 'USTUR', feature: 'Earnings', trigger: 'manual', providerRole: 'main', rpcMethod: 'getAccountInfo' } });
  await Promise.all([ledger.flush(), ledger.flush(), ledger.flush()]);
  const day = JSON.parse(await fs.readFile(path.join(userDataPath, 'telemetry/rpc-activity-v1/2026-08-03.json'), 'utf8'));
  assert.equal(day.minutes['10:15'].rows[0].counters.wireAttempts, 50);
  assert.equal(JSON.stringify(day).includes('http'), false);
  await ledger.stop();
});

test('atomic write failure preserves previous valid document', async (t) => {
  const root = await temporary(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'value.json');
  await writeAtomicDurable(target, { valid: 1 });
  await assert.rejects(writeAtomicDurable(target, { valid: 2 }, { beforeRename() { throw new Error('synthetic failure'); } }));
  assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { valid: 1 });
});

test('UTC minute buckets are DST-independent and split at midnight', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-03-29T00:59:59Z');
  const ledger = createTelemetryLedger({ userDataPath, now: () => now, flushIntervalMs: 0 }); await ledger.start();
  ledger.record({ type: 'counter', counter: 'cacheHits', at: now, context: {} });
  now = Date.parse('2026-03-29T01:00:00Z'); ledger.record({ type: 'counter', counter: 'cacheHits', at: now, context: {} });
  now = Date.parse('2026-03-30T00:00:00Z'); ledger.record({ type: 'counter', counter: 'cacheHits', at: now, context: {} });
  await ledger.flush();
  const first = JSON.parse(await fs.readFile(path.join(userDataPath, 'telemetry/rpc-activity-v1/2026-03-29.json')));
  const second = JSON.parse(await fs.readFile(path.join(userDataPath, 'telemetry/rpc-activity-v1/2026-03-30.json')));
  assert.ok(first.minutes['00:59']); assert.ok(first.minutes['01:00']); assert.ok(second.minutes['00:00']);
});

test('retention constants enforce current plus fourteen completed days and thirty-two markers', () => {
  assert.equal(COMPLETED_RETENTION_DAYS, 14); assert.equal(MAX_SNAPSHOTS, 32);
});

test('snapshot retention keeps the newest createdAt values regardless of boundary or random suffix order', async (t) => {
  const root = await temporary(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const activityRoot = path.join(root, 'activity'); const snapshotsRoot = path.join(root, 'snapshots');
  await fs.mkdir(activityRoot); await fs.mkdir(snapshotsRoot);
  for (let index = 0; index < 35; index += 1) {
    const boundaryPrefix = index === 34 ? '20200101000000000' : '20260803000000000';
    const suffix = String(999999 - index).padStart(12, '0');
    await fs.writeFile(path.join(snapshotsRoot, `${boundaryPrefix}-${suffix}.json`), JSON.stringify({ createdAt: new Date(Date.parse('2026-08-03T00:00:00Z') + index).toISOString() }));
  }
  await fs.writeFile(path.join(snapshotsRoot, 'malformed.json'), '{');
  await pruneRetention({ root, activityRoot, snapshotsRoot, now: Date.parse('2026-08-03T01:00:00Z') });
  const remaining = await fs.readdir(snapshotsRoot);
  assert.equal(remaining.length, 32);
  assert.ok(remaining.some((name) => name.startsWith('20200101')), 'later-created old-boundary marker must remain');
  assert.equal(remaining.includes('malformed.json'), false, 'malformed marker is bounded as oldest');
});
