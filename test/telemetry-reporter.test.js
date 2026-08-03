'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTelemetryLedger } = require('../electron/telemetry-ledger');
const { createSnapshotMarker, generateTelemetryReport } = require('../electron/telemetry-reporter');

async function temporary() { return fs.mkdtemp(path.join(os.tmpdir(), 'msa-report-')); }

async function marker(userDataPath, boundary, now) { return createSnapshotMarker({ userDataPath, boundary, now: () => now }); }

test('snapshot markers do not reset activity and report exact [T0,T1) across UTC dates', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-08-03T23:58:00Z');
  const ledger = createTelemetryLedger({ userDataPath, profile: 'USTUR', now: () => now, flushIntervalMs: 0 }); await ledger.start();
  const start = await marker(userDataPath, '2026-08-03T23:59:00.000Z', Date.parse('2026-08-03T23:59:00Z'));
  now = Date.parse('2026-08-03T23:59:30Z');
  ledger.record({ type: 'logical-start', at: now, context: { profile: 'USTUR', faction: 'MUD', feature: 'Fleet discovery', trigger: 'manual', rpcMethod: 'getProgramAccountsV2' } });
  ledger.record({ type: 'logical-complete', at: now + 10, outcome: 'success', durationMs: 10, context: { profile: 'USTUR', faction: 'MUD', feature: 'Fleet discovery', trigger: 'manual', rpcMethod: 'getProgramAccountsV2' } });
  now = Date.parse('2026-08-04T00:00:30Z');
  ledger.record({ type: 'wire-start', at: now, context: { profile: 'USTUR', faction: 'ONI', feature: 'Earnings', trigger: 'background', providerRole: 'main', rpcMethod: 'getAccountInfo' } });
  ledger.record({ type: 'wire-complete', at: now + 5, outcome: 'success', durationMs: 5, context: { profile: 'USTUR', faction: 'ONI', feature: 'Earnings', trigger: 'background', providerRole: 'main', rpcMethod: 'getAccountInfo' } });
  now = Date.parse('2026-08-04T00:01:00Z'); await ledger.flush();
  const beforeFiles = await fs.readdir(path.join(userDataPath, 'telemetry/rpc-activity-v1'));
  const end = await marker(userDataPath, '2026-08-04T00:01:00.000Z', now);
  const afterFiles = await fs.readdir(path.join(userDataPath, 'telemetry/rpc-activity-v1'));
  assert.deepEqual(afterFiles, beforeFiles);
  const report = await generateTelemetryReport({ userDataPath, startMarker: start.snapshotId, endMarker: end.snapshotId });
  assert.equal(report.start, '2026-08-03T23:59:00.000Z'); assert.equal(report.end, '2026-08-04T00:01:00.000Z');
  assert.equal(report.totals.logicalOperations, 1); assert.equal(report.totals.logicalCompletedOperations, 1);
  assert.equal(report.totals.wireAttempts, 1); assert.equal(report.totals.wireCompletedAttempts, 1);
  assert.equal(report.reconciliation.matchesBuckets, true);
  assert.equal(report.thresholdVerdict, report.completeEvidence ? 'not_evaluated' : 'forbidden_incomplete_evidence');
});

test('missing segment, dirty runtime gap and corrupt marker forbid a verdict', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-08-03T10:00:00Z');
  const ledger = createTelemetryLedger({ userDataPath, now: () => now, flushIntervalMs: 0 }); await ledger.start();
  const start = await marker(userDataPath, '2026-08-03T10:00:00.000Z', now);
  now += 120_000; await ledger.flush();
  const end = await marker(userDataPath, '2026-08-03T10:02:00.000Z', now);
  await fs.rm(path.join(userDataPath, 'telemetry/rpc-activity-v1/2026-08-03.json'));
  const report = await generateTelemetryReport({ userDataPath, startMarker: start.snapshotId, endMarker: end.snapshotId });
  assert.equal(report.completeEvidence, false); assert.equal(report.thresholdVerdict, 'forbidden_incomplete_evidence');
  assert.ok(report.issues.some((value) => value.startsWith('missing_or_corrupt_segment:')));
});

test('report generation is read-only for activity and snapshot files', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-08-03T10:00:00Z'); const ledger = createTelemetryLedger({ userDataPath, now: () => now, flushIntervalMs: 0 }); await ledger.start();
  const start = await marker(userDataPath, new Date(now).toISOString(), now); now += 60_000; await ledger.flush(); const end = await marker(userDataPath, new Date(now).toISOString(), now);
  const root = path.join(userDataPath, 'telemetry');
  async function digest() { const files = []; async function walk(dir) { for (const e of await fs.readdir(dir, { withFileTypes: true })) { const f=path.join(dir,e.name); if(e.isDirectory()) await walk(f); else files.push([path.relative(root,f), await fs.readFile(f,'utf8')]); } } await walk(root); return files.sort(); }
  const before = await digest(); await generateTelemetryReport({ userDataPath, startMarker: start.snapshotId, endMarker: end.snapshotId }); const after = await digest();
  assert.deepEqual(after, before);
});
